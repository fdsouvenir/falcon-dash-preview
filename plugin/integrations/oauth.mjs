import { internalAuthority } from '../authority.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { exact, requireValue, text, DomainError } from '../errors.mjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export class HighLevelOAuth {
	constructor(integrations, { redirectUris, clock = Date.now }) {
		this.integrations = integrations;
		this.redirectUris = new Set(redirectUris);
		this.clock = clock;
		integrations.db.exec(
			'CREATE TABLE IF NOT EXISTS oauth_attempts(state_hash TEXT PRIMARY KEY,state TEXT NOT NULL,body TEXT NOT NULL) STRICT'
		);
	}
	async begin(input, actor, authority = internalAuthority) {
		authority.assert();
		exact(input, ['connection_id', 'redirect_uri', 'scopes']);
		requireValue(
			actor.startsWith('human:'),
			'authority_required',
			'OAuth consent must begin from a verified human surface'
		);
		requireValue(
			this.redirectUris.has(input.redirect_uri),
			'invalid_redirect',
			'Use an explicitly configured callback URI'
		);
		requireValue(
			Array.isArray(input.scopes) &&
				input.scopes.length > 0 &&
				input.scopes.length <= 50 &&
				input.scopes.every((s) => typeof s === 'string' && /^[a-z0-9._:-]{1,100}$/.test(s)),
			'invalid_scope',
			'Supply explicit provider scopes'
		);
		const service = this.integrations,
			c = service.get(input.connection_id);
		requireValue(
			c.provider === 'highlevel' &&
				c.owner === 'falcon' &&
				c.actors.includes(actor) &&
				!c.disconnected &&
				c.phase === 'idle',
			'access_denied',
			'Connection cannot begin OAuth'
		);
		const material = await service.vault.resolveForExecution(
			c.vault_handle,
			actor,
			(record) => ({
				client_id: text(record.material.client_id, 500),
				vault_version: record.version
			}),
			{ authority }
		);
		authority.assert();
		requireValue(
			service.get(c.id).version === c.version,
			'authority_changed',
			'Connection changed before consent'
		);
		const state = randomBytes(32).toString('base64url');
		service.db.prepare("INSERT INTO oauth_attempts VALUES(?,'pending',?)").run(
			hash(state),
			JSON.stringify({
				connection_id: c.id,
				connection_version: c.version,
				vault_version: material.vault_version,
				actor,
				redirect_uri: input.redirect_uri,
				scopes: input.scopes,
				expires_at: this.clock() + 600000
			})
		);
		const url = new URL('https://marketplace.gohighlevel.com/oauth/chooselocation');
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', material.client_id);
		url.searchParams.set('redirect_uri', input.redirect_uri);
		url.searchParams.set('scope', input.scopes.join(' '));
		url.searchParams.set('state', state);
		return { authorization_url: url.toString(), expires_in: 600 };
	}
	async complete(input, actor, authority = internalAuthority) {
		authority.assert();
		exact(input, ['state', 'code']);
		text(input.state, 200);
		text(input.code, 4096);
		const service = this.integrations;
		let attempt, c;
		service.db.exec('BEGIN IMMEDIATE');
		try {
			const row = service.db
				.prepare('SELECT state,body FROM oauth_attempts WHERE state_hash=?')
				.get(hash(input.state));
			requireValue(
				row && row.state === 'pending',
				'invalid_oauth_state',
				'OAuth state is invalid or already consumed'
			);
			attempt = JSON.parse(String(row.body));
			requireValue(
				attempt.actor === actor && actor.startsWith('human:') && attempt.expires_at > this.clock(),
				'invalid_oauth_state',
				'OAuth state does not belong to this human or has expired'
			);
			c = service.get(attempt.connection_id);
			requireValue(
				c.version === attempt.connection_version &&
					c.actors.includes(actor) &&
					!c.disconnected &&
					c.phase === 'idle',
				'authority_changed',
				'Connection changed during consent'
			);
			service.db
				.prepare("UPDATE oauth_attempts SET state='exchanging' WHERE state_hash=?")
				.run(hash(input.state));
			c.phase = 'authorizing';
			c.version++;
			service.save(c);
			service.db.exec('COMMIT');
		} catch (error) {
			service.db.exec('ROLLBACK');
			throw error;
		}
		const lease = c.version;
		const guard = {
			signal: authority.signal,
			assert() {
				authority.assert();
				const now = service.get(c.id);
				requireValue(
					!service.closing &&
						now.version === lease &&
						now.phase === 'authorizing' &&
						now.actors.includes(actor) &&
						!now.disconnected &&
						!now.paused,
					'authority_changed',
					'OAuth authority changed'
				);
			}
		};
		try {
			const adapter = service.adapters.highlevel;
			await service.vault.resolveForExecution(
				c.vault_handle,
				actor,
				async (record, credentialGuard) => {
					const ioGuard = {
						signal: credentialGuard?.signal ?? guard.signal,
						assert() {
							guard.assert();
							credentialGuard?.assert();
						}
					};
					ioGuard.assert();
					requireValue(
						record.version === attempt.vault_version,
						'authority_changed',
						'Client credential changed during consent'
					);
					const output = await adapter.exchange(
						record.material,
						{
							code: input.code,
							redirect_uri: attempt.redirect_uri
						},
						ioGuard
					);
					ioGuard.assert();
					requireValue(
						service.get(c.id).version === lease,
						'authority_changed',
						'Connection changed before storing OAuth credentials'
					);
					await service.vault.rotate(
						c.vault_handle,
						output.material,
						record.version,
						actor,
						{
							database: service.path,
							id: c.id,
							version: lease,
							phase: 'authorizing'
						},
						ioGuard
					);
				},
				{ authority: guard }
			);
			guard.assert();
			c.phase = 'idle';
			c.health = 'unavailable';
			c.refresh_uncertain = false;
			c.uncertain_credential_version = null;
			c.last_success = null;
			c.validated_capabilities = [];
			c.expires_at = null;
			c.next_refresh_at = null;
			c.next_at = this.clock();
			c.next_action = 'test';
			c.requested_scopes = attempt.scopes;
			c.scopes = [];
			c.scope_verification = 'unverified';
			c.version++;
			service.compareAndSave(c, lease);
			service.db
				.prepare("UPDATE oauth_attempts SET state='completed' WHERE state_hash=?")
				.run(hash(input.state));
			service.audit(c.id, 'oauth_exchange', 'connected_unvalidated');
			return { id: c.id, connected: true, health: 'unavailable', next_action: 'test' };
		} catch {
			const current = service.get(c.id);
			if (current.version === lease) {
				current.phase = 'idle';
				current.health = 'reauthorization_required';
				current.next_at = null;
				current.version++;
				service.compareAndSave(current, lease);
			}
			service.db
				.prepare("UPDATE oauth_attempts SET state='failed' WHERE state_hash=?")
				.run(hash(input.state));
			service.audit(c.id, 'oauth_exchange', 'failed');
			throw new DomainError(
				'reauthorization_required',
				'OAuth exchange did not complete. Begin a new consent flow; codes are never replayed'
			);
		}
	}
}
