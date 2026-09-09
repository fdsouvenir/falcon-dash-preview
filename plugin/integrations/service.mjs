import { internalAuthority } from '../authority.mjs';
import { privateDatabase } from '../storage.mjs';
import { readFileSync } from 'node:fs';
import { DomainError, requireValue, text, exact } from '../errors.mjs';

function processStart(pid) {
	try {
		return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19];
	} catch {
		return null;
	}
}
export class Integrations {
	constructor(path, vault, adapters, onAttention = null) {
		this.db = privateDatabase(path, { maxVersion: 1, allowUnversioned: true });
		this.path = path;
		this.inflight = new Set();
		this.closing = false;
		this.vault = vault;
		this.adapters = adapters;
		this.onAttention = onAttention;
		this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,connection_id TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL,outcome TEXT NOT NULL) STRICT;PRAGMA user_version=1;`);
	}
	async close() {
		this.closing = true;
		if (this.timer) clearInterval(this.timer);
		await Promise.allSettled([...this.inflight]);
		this.db.close();
	}
	get(id) {
		const r = this.db.prepare('SELECT body FROM connections WHERE id=?').get(id);
		requireValue(r, 'not_found', 'Connection not found');
		return JSON.parse(String(r.body));
	}
	save(c) {
		this.db
			.prepare(
				'INSERT INTO connections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body'
			)
			.run(c.id, c.version, JSON.stringify(c));
	}
	compareAndSave(c, expected) {
		const result = this.db
			.prepare('UPDATE connections SET version=?,body=? WHERE id=? AND version=?')
			.run(c.version, JSON.stringify(c), c.id, expected);
		requireValue(result.changes === 1, 'authority_changed', 'Connection changed during operation');
	}
	invalidateCredential(handle, authority) {
		authority.assert();
		requireValue(!this.closing, 'unavailable', 'Integration service is stopping');
		this.db.exec('BEGIN IMMEDIATE');
		try {
			for (const row of this.db.prepare('SELECT body FROM connections').all()) {
				const c = JSON.parse(String(row.body));
				if (c.vault_handle !== handle || c.owner !== 'falcon') continue;
				c.version++;
				c.phase = 'idle';
				c.paused = true;
				c.health = 'unavailable';
				c.validated_capabilities = [];
				c.last_success = null;
				c.expires_at = null;
				c.reauthorize_at = null;
				c.next_refresh_at = null;
				c.next_at = null;
				c.error_code = null;
				this.save(c);
				this.audit(c.id, 'credential_change', 'paused_unvalidated');
			}
			authority.assert();
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	list(actor) {
		return this.db
			.prepare('SELECT body FROM connections')
			.all()
			.map((r) => JSON.parse(String(r.body)))
			.filter((c) => c.actors.includes(actor))
			.map((c) => {
				const freshness =
					c.last_success && Date.now() - c.last_success < 3600000 ? 'current' : 'stale';
				const expiring =
					c.health === 'healthy' &&
					Number.isFinite(c.expires_at) &&
					c.expires_at <= Date.now() + 300000;
				const health = c.refresh_uncertain
					? 'reauthorization_required'
					: expiring
						? 'expiring'
						: c.health;
				const guidance = c.refresh_uncertain
					? 'The previous refresh outcome is uncertain. Supply renewed protected credentials or a new binding before retrying; successful access validation does not prove refresh-token lineage.'
					: expiring
						? 'The recorded credential expiry is near or has passed. Refresh supported credentials, or rotate static tokens in Vault, then test; access-token expiry alone does not imply fresh consent is required.'
						: c.disconnected
							? 'Replace or renew the credential in Vault, then explicitly prepare reconnection. Reconnection does not validate access.'
							: c.owner === 'native'
								? 'Use the native credential owner; Falcon does not refresh this connection.'
								: c.error_code === 'scope_failure'
									? 'Review the provider account and required permissions, then test again.'
									: health === 'reauthorization_required'
										? 'Complete provider consent or rotate the credential in Vault before testing again.'
										: c.error_code === 'vault_locked'
											? 'Unlock Vault and check execution grants before retrying.'
											: c.paused
												? 'Maintenance is paused. Resume explicitly when the credential is ready.'
												: c.health === 'healthy' && freshness === 'current' && !expiring
													? 'Last validation succeeded for the listed capabilities only.'
													: 'Validation is unavailable, stale or expiring. Test before relying on this connection.';
				return {
					id: c.id,
					provider: c.provider,
					purpose: c.purpose,
					owner: c.owner,
					health,
					last_success: c.last_success,
					last_failure: c.last_failure,
					next_at: c.next_at,
					paused: c.paused,
					version: c.version,
					phase: c.phase,
					validated_capabilities: c.validated_capabilities ?? [],
					freshness,
					account_id: c.account_id ?? null,
					credential_ref:
						c.owner === 'falcon'
							? { kind: 'vault', handle: c.vault_handle ?? null }
							: { kind: 'native' },
					attention_work_id: c.attention_work_id ?? null,
					actors: c.actors,
					disconnected: !!c.disconnected,
					expires_at: c.expires_at ?? null,
					reauthorize_at: c.reauthorize_at ?? null,
					next_action: c.next_action ?? (c.next_at ? 'test' : null),
					failure_code: c.error_code ?? null,
					guidance,
					agent_use:
						health === 'healthy' && freshness === 'current' && !c.disconnected
							? 'validated_capabilities_only'
							: 'not_currently_validated'
				};
			});
	}
	history(id, actor, query = {}) {
		exact(query, ['offset', 'limit']);
		const { offset = 0, limit = 25 } = query;
		const c = this.get(id);
		requireValue(c.actors.includes(actor), 'access_denied', 'Connection access is not authorized');
		requireValue(
			Number.isInteger(offset) &&
				offset >= 0 &&
				Number.isInteger(limit) &&
				limit > 0 &&
				limit <= 100,
			'invalid_filter',
			'Invalid audit pagination'
		);
		const rows = this.db
			.prepare(
				'SELECT id,action,at,outcome FROM audit WHERE connection_id=? ORDER BY id DESC LIMIT ? OFFSET ?'
			)
			.all(id, limit + 1, offset);
		return {
			entries: rows.slice(0, limit),
			next_offset: rows.length > limit ? offset + limit : null
		};
	}
	rebind(id, handle, expectedVersion, actor, authority) {
		authority.assert();
		const c = this.get(id);
		requireValue(
			actor.startsWith('human:') && c.actors.includes(actor) && c.owner === 'falcon',
			'access_denied',
			'Human connection owner required'
		);
		requireValue(
			c.version === expectedVersion && c.phase === 'idle',
			'version_conflict',
			'Pause maintenance and review the current connection first'
		);
		if (handle !== c.vault_handle) {
			c.refresh_uncertain = false;
			c.uncertain_credential_version = null;
		}
		c.vault_handle = handle;
		c.health = 'unavailable';
		c.paused = true;
		c.validated_capabilities = [];
		c.last_success = null;
		c.expires_at = null;
		c.reauthorize_at = null;
		c.next_at = null;
		c.next_refresh_at = null;
		c.error_code = null;
		c.version++;
		authority.assert();
		this.compareAndSave(c, expectedVersion);
		this.audit(id, 'credential_rebind', 'paused_unvalidated');
		return { id, version: c.version, health: c.health, paused: true };
	}

	reconnect(id, expectedVersion, actor, authority = internalAuthority) {
		authority.assert();
		const c = this.get(id);
		requireValue(
			actor.startsWith('human:') && c.actors.includes(actor) && c.owner === 'falcon',
			'access_denied',
			'Human connection owner required'
		);
		requireValue(
			c.version === expectedVersion && c.phase === 'idle',
			'version_conflict',
			'Connection changed; refresh before reconnecting'
		);
		requireValue(
			c.disconnected || c.health === 'reauthorization_required',
			'invalid_transition',
			'Connection does not need reconnection'
		);
		c.disconnected = false;
		c.last_success = null;
		c.expires_at = null;
		c.reauthorize_at = null;
		c.next_refresh_at = null;
		c.paused = true;
		c.health = 'unavailable';
		c.validated_capabilities = [];
		c.next_at = null;
		c.error_code = null;
		c.version++;
		authority.assert();
		this.compareAndSave(c, expectedVersion);
		this.audit(id, 'prepare_reconnection', 'unvalidated');
		return { id, version: c.version, paused: true, health: 'unavailable' };
	}

	create(input, actor) {
		exact(input, ['id', 'provider', 'purpose', 'owner', 'vault_handle', 'actors', 'account_id']);
		requireValue(this.adapters[input.provider], 'unsupported_provider', 'Adapter is unavailable');
		requireValue(
			['falcon', 'native'].includes(input.owner),
			'invalid_input',
			'Credential owner must be explicit'
		);
		requireValue(
			Array.isArray(input.actors) && input.actors.includes(actor),
			'access_denied',
			'Creator must retain connection access'
		);
		const c = {
			...input,
			id: text(input.id, 80),
			purpose: text(input.purpose, 500),
			health: 'unavailable',
			version: 1,
			next_at: Date.now(),
			paused: false,
			phase: 'idle'
		};
		requireValue(
			!this.db.prepare('SELECT id FROM connections WHERE id=?').get(c.id),
			'already_exists',
			'Connection already exists'
		);
		this.save(c);
		return { id: c.id, version: 1 };
	}
	audit(id, action, outcome) {
		this.db
			.prepare('INSERT INTO audit(connection_id,action,at,outcome) VALUES(?,?,?,?)')
			.run(id, action, Date.now(), outcome);
	}
	run(id, action, actor, authority = internalAuthority) {
		const operation = this.perform(id, action, actor, authority);
		const tracked = operation.finally(() => this.inflight.delete(tracked));
		this.inflight.add(tracked);
		return tracked;
	}
	async perform(id, action, actor, authority = internalAuthority) {
		authority.assert();
		requireValue(!this.closing, 'unavailable', 'Integration service is stopping');
		requireValue(
			['test', 'refresh', 'pause', 'resume', 'disconnect'].includes(action),
			'invalid_command',
			'Unsupported integration action'
		);
		this.db.exec('BEGIN IMMEDIATE');
		let c;
		try {
			c = this.get(id);
			requireValue(
				c.actors.includes(actor),
				'access_denied',
				'Connection access is not authorized'
			);
			if (action === 'disconnect' || action === 'pause') {
				c.version++;
				c.phase = 'idle';
				c.paused = true;
				if (action === 'disconnect') {
					c.disconnected = true;
					c.health = 'reauthorization_required';
					c.next_at = null;
				}
				this.save(c);
				this.audit(id, action, 'committed');
				this.db.exec('COMMIT');
				return { id, paused: true, disconnected: !!c.disconnected };
			}
			requireValue(
				!c.disconnected,
				'disconnected',
				'Reconnect explicitly before using this connection'
			);
			requireValue(
				c.phase === 'idle',
				'maintenance_busy',
				'Previous operation needs completion or recovery'
			);
			if (action === 'pause' || action === 'resume') {
				c.paused = action === 'pause';
				c.version++;
				this.save(c);
				this.audit(id, action, 'committed');
				this.db.exec('COMMIT');
				return { id, paused: c.paused };
			}
			requireValue(
				c.owner === 'falcon',
				'native_owner',
				'Use the upstream credential owner; Falcon does not refresh native credentials'
			);
			requireValue(!c.paused, 'maintenance_paused', 'Resume maintenance first');
			requireValue(
				action !== 'refresh' || this.adapters[c.provider].supports_refresh !== false,
				'unsupported_operation',
				'This provider uses explicit rotation rather than token refresh'
			);
			c.phase = action === 'refresh' ? 'refreshing' : 'testing';
			c.operation_started = Date.now();
			c.operation_pid = process.pid;
			c.operation_start = processStart(process.pid);
			c.version++;
			this.save(c);
			this.db.exec('COMMIT');
		} catch (e) {
			this.db.exec('ROLLBACK');
			throw e;
		}
		const leaseVersion = c.version;
		const assertCurrent = () => {
			authority.assert();
			requireValue(!this.closing, 'authority_changed', 'Integration service is stopping');
			const current = this.get(id);
			requireValue(
				current.version === leaseVersion &&
					current.phase === c.phase &&
					current.actors.includes(actor) &&
					!current.paused &&
					!current.disconnected,
				'authority_changed',
				'Connection authority changed'
			);
		};
		const guard = { assert: assertCurrent, signal: authority.signal };
		let providerStarted = false;
		try {
			const adapter = this.adapters[c.provider];
			const result = await this.vault.resolveForExecution(
				c.vault_handle,
				actor,
				async (record, credentialGuard) => {
					const ioGuard = {
						assert: () => {
							assertCurrent();
							credentialGuard?.assert();
						},
						signal: credentialGuard?.signal ?? guard.signal,
						beforeRequest() {
							assertCurrent();
							credentialGuard?.assert();
							providerStarted = true;
						}
					};
					ioGuard.assert();
					if (action === 'refresh' && c.refresh_uncertain)
						requireValue(
							Number.isInteger(c.uncertain_credential_version) &&
								record.version > c.uncertain_credential_version,
							'reauthorization_required',
							'Renew the credential before retrying an uncertain refresh'
						);
					c.operation_vault_version = record.version;
					this.compareAndSave(c, c.version);
					if (adapter.dispatch_guarded !== true) providerStarted = true;
					const output = await adapter[action](record.material, c, ioGuard);
					ioGuard.assert();
					// No automatic lease steal: a refresh might have consumed the old provider token.
					const current = this.get(id);
					requireValue(
						current.version === c.version &&
							current.phase === c.phase &&
							current.actors.includes(actor) &&
							!current.paused,
						'authority_changed',
						'Connection changed while preparing provider operation'
					);
					if (output.material)
						await this.vault.rotate(
							c.vault_handle,
							output.material,
							record.version,
							actor,
							{
								database: this.path,
								id,
								version: c.version,
								phase: c.phase
							},
							ioGuard
						);
					return output;
				},
				{ authority: guard }
			);
			assertCurrent();
			const operationVersion = c.version;
			c.phase = 'idle';
			c.validated_capabilities = action === 'test' ? (result.validated_capabilities ?? []) : [];
			c.health = action === 'refresh' ? 'unavailable' : (result.health ?? 'healthy');
			if (action === 'test') c.last_success = Date.now();
			else c.last_maintenance_success = Date.now();
			c.last_failure = null;
			c.error_code = null;
			c.failures = 0;
			if (action === 'refresh') {
				c.refresh_uncertain = false;
				c.uncertain_credential_version = null;
			}
			if (Number.isFinite(result.expires_at)) c.expires_at = result.expires_at;
			if (Number.isFinite(result.reauthorize_at)) c.reauthorize_at = result.reauthorize_at;
			if (action === 'refresh') {
				c.next_refresh_at = result.next_at ?? null;
				c.next_at = Date.now();
				c.next_action = 'test';
			} else {
				c.next_at = Math.min(
					Date.now() + 3600000,
					c.next_refresh_at ?? Infinity,
					result.next_at ?? Infinity
				);
				c.next_action = c.next_at === c.next_refresh_at ? 'refresh' : 'test';
			}
			c.version++;
			this.compareAndSave(c, operationVersion);
			this.audit(id, action, 'success');
			return {
				id,
				health: c.health,
				next_at: c.next_at,
				validated_capabilities: c.validated_capabilities
			};
		} catch (e) {
			const current = this.get(id);
			if (current.version !== leaseVersion) {
				this.audit(id, action, 'superseded');
				throw new DomainError(
					'authority_changed',
					'Connection was changed or disconnected during operation'
				);
			}
			const operationVersion = c.version;
			c.phase = 'idle';
			c.last_failure = Date.now();
			if (action === 'refresh' && providerStarted) {
				c.refresh_uncertain = true;
				c.uncertain_credential_version = c.operation_vault_version ?? null;
			}
			c.error_code = [
				'scope_failure',
				'reauthorization_required',
				'vault_locked',
				'provider_unavailable',
				'provider_response_invalid'
			].includes(e.code)
				? e.code
				: 'provider_unavailable';
			c.health =
				(action === 'refresh' && providerStarted) || e.code === 'reauthorization_required'
					? 'reauthorization_required'
					: e.code === 'scope_failure'
						? 'broken'
						: e.code === 'vault_locked'
							? 'unavailable'
							: 'broken';
			c.failures = (c.failures ?? 0) + 1;
			c.next_at =
				c.health === 'reauthorization_required'
					? null
					: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(c.failures, 7));
			c.version++;
			this.compareAndSave(c, operationVersion);
			this.audit(id, action, c.health);
			if (
				this.onAttention &&
				(c.failures >= 3 || ['scope_failure', 'reauthorization_required'].includes(c.error_code))
			) {
				try {
					const attention = this.onAttention({
						id: c.id,
						provider: c.provider,
						health: c.health,
						version: c.version
					});
					if (attention) {
						const savedVersion = c.version;
						c.attention_work_id = attention;
						c.version++;
						this.compareAndSave(c, savedVersion);
					}
				} catch {
					/* The failure remains visible in Integrations; never echo callback/provider data. */
				}
			}

			throw new DomainError(
				c.health,
				action === 'refresh' && providerStarted
					? 'Refresh outcome is uncertain. Reauthorize; automatic retry could reuse a consumed token.'
					: 'Validation failed; inspect access and retry'
			);
		}
	}
	recover() {
		for (const row of this.db.prepare('SELECT body FROM connections').all()) {
			const c = JSON.parse(String(row.body));
			if (
				c.phase !== 'idle' &&
				(!c.operation_pid || processStart(c.operation_pid) !== c.operation_start)
			) {
				c.health = c.phase !== 'testing' ? 'reauthorization_required' : 'unavailable';
				if (c.phase !== 'testing') {
					c.refresh_uncertain = true;
					c.uncertain_credential_version = c.operation_vault_version ?? null;
				}
				c.phase = 'idle';
				c.next_at = null;
				c.version++;
				this.save(c);
				this.audit(c.id, 'restart_recovery', c.health);
			}
		}
	}
	start(actor) {
		this.recover();
		let running = false;
		this.timer = setInterval(async () => {
			if (running) return;
			running = true;
			try {
				const due = this.list(actor)
					.filter((c) => c.owner === 'falcon' && !c.paused && c.next_at && c.next_at <= Date.now())
					.slice(0, 1);
				for (const c of due) {
					try {
						await this.run(c.id, this.get(c.id).next_action ?? 'test', actor);
					} catch {
						/* redacted status persisted */
					}
				}
			} finally {
				running = false;
			}
		}, 30000);
		this.timer.unref();
	}
}
