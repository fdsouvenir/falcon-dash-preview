import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedProcess } from './process.mjs';
import { internalAuthority } from '../authority.mjs';
import { DomainError, requireValue } from '../errors.mjs';

// The four fields a KeePassXC entry actually has. Blank strings are kept so clearing a field in the
// UI clears it in the database; absent keys are left untouched.
const PLAIN_FIELDS = ['password', 'username', 'url', 'notes'];
function plainMaterial(fields) {
	requireValue(
		fields && typeof fields === 'object' && !Array.isArray(fields),
		'invalid_input',
		'Expected credential fields'
	);
	const material = {};
	for (const name of PLAIN_FIELDS)
		if (typeof fields[name] === 'string') material[name] = fields[name];
	requireValue(Object.keys(material).length > 0, 'invalid_input', 'Expected credential fields');
	return material;
}

export class Vault {
	/**
	 * @param {string} directory
	 * @param {{owners?: string[], executors?: string[], database?: string, key?: string}} [options]
	 */
	constructor(directory, { owners = [], executors = [], database, key } = {}) {
		requireValue(
			path.isAbsolute(directory),
			'invalid_config',
			'Vault requires an explicit private directory'
		);
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		requireValue(
			fs.realpathSync(directory) === directory,
			'unsafe_path',
			'Vault path must not contain symbolic links'
		);
		fs.chmodSync(directory, 0o700);
		this.directory = directory;
		// The credential database may live outside this private directory: an operator's existing
		// KeePassXC vault is opened where it already is. Policy, audit and recovery stay private.
		this.database = database ?? path.join(directory, 'credentials.kdbx');
		this.key = key ?? path.join(directory, 'unlock.key');
		this.owners = new Set(owners);
		this.executors = new Set(executors);
		this.locked = true;
		this.generation = 0;
		this.operationController = new AbortController();
	}
	// Provisioning state, not authorization: an unprovisioned Vault has no policy to authorize against.
	get initialized() {
		return fs.existsSync(path.join(this.directory, 'policy.json'));
	}
	lock(actor = 'system:vault', authority = internalAuthority) {
		authority.assert();
		requireValue(
			actor === 'system:vault' || actor.startsWith('human:'),
			'access_denied',
			'Only an owner can lock Vault'
		);
		this.locked = true;
		this.generation++;
		this.operationController.abort();
		if (!this.initialized) return Promise.resolve({ locked: true });
		return this.worker({ action: 'lock', actor }, authority);
	}
	// Reaching an authenticated Gateway connection is the human credential for this Vault: a person
	// who can open the operator UI can manage secrets. Agents are separate — they hold no session and
	// must be named in `vaultExecutors` plus the per-entry grants a human hands out.
	authorize(actor, human = false) {
		requireValue(!this.locked, 'vault_locked', 'Protected storage is unavailable');
		requireValue(
			actor.startsWith('human:') || (!human && this.executors.has(actor)),
			'access_denied',
			'Credential access is not authorized'
		);
	}
	async worker(request, authority = internalAuthority) {
		if (
			![
				'initialize',
				'adopt',
				'reconcile',
				'unlock',
				'lock',
				'audit',
				'backup',
				'recovery_list'
			].includes(request.action)
		) {
			const original = authority,
				signal = original.signal
					? AbortSignal.any([original.signal, this.operationController.signal])
					: this.operationController.signal;
			authority = {
				signal,
				assert() {
					original.assert();
					requireValue(!signal.aborted, 'authority_changed', 'Vault operation was cancelled');
				}
			};
		}

		const output = await protectedProcess(
			'flock',
			[
				'--exclusive',
				'--timeout',
				'15',
				path.join(this.directory, 'transaction.lock'),
				process.execPath,
				fileURLToPath(new URL('./worker.mjs', import.meta.url)),
				this.directory,
				this.database,
				this.key
			],
			request,
			{ authority }
		);
		let result;
		try {
			result = JSON.parse(output);
		} catch {
			throw new DomainError('vault_unavailable', 'Protected storage is unavailable');
		}
		if (result.error) throw new DomainError(result.error, 'Protected storage operation failed');
		return result;
	}

	// The plugin owns exactly one Vault and brings it up ready to use. Provisioning and unlocking are
	// host lifecycle, never operator ceremony, so neither is reachable from a client surface.
	// Configured actors are reconciled on every start because the policy was written once, at
	// provisioning: without this a later `vaultExecutors` edit would need a recovery to take effect.
	async ready(authority = internalAuthority) {
		if (!this.initialized)
			// A database already at the configured path is the operator's own vault. It is adopted —
			// policy is recorded beside it — never recreated, so provisioning cannot clobber real
			// credentials. Only a genuinely absent database is created.
			await this.worker(
				{
					action: fs.existsSync(this.database) ? 'adopt' : 'initialize',
					actor: 'system:vault',
					owners: [...this.owners],
					executors: [...this.executors]
				},
				authority
			);
		else
			await this.worker(
				{
					action: 'reconcile',
					actor: 'system:vault',
					owners: [...this.owners],
					executors: [...this.executors]
				},
				authority
			);
		if (this.locked) await this.unlock('system:vault', authority);
		return { initialized: true, locked: false };
	}
	async initialize(actor = 'system:vault', authority = internalAuthority) {
		requireValue(
			actor === 'system:vault' || actor.startsWith('human:'),
			'access_denied',
			'Only an authorized human can provision Vault'
		);
		return this.worker(
			{
				action: 'initialize',
				actor,
				owners: [...this.owners],
				executors: [...this.executors]
			},
			authority
		);
	}
	async unlock(actor = 'system:vault', authority = internalAuthority) {
		requireValue(
			actor === 'system:vault' || actor.startsWith('human:'),
			'access_denied',
			'Only an authorized human can unlock Vault'
		);
		const epoch = ++this.generation;
		const result = await this.worker({ action: 'unlock', actor }, authority);
		requireValue(
			this.generation === epoch,
			'authority_changed',
			'Vault locked while unlock was pending'
		);
		this.policyGeneration = result.generation;
		this.locked = false;
		this.operationController = new AbortController();
		return { locked: false };
	}
	async inventory(actor, group = '', authority = internalAuthority) {
		this.authorize(actor);
		return this.worker(
			{ action: 'inventory', actor, group, generation: this.policyGeneration },
			authority
		);
	}
	/** Every group and entry in one call, so the UI can search without walking the tree. */
	async inventoryAll(actor, authority = internalAuthority) {
		this.authorize(actor);
		return this.worker(
			{ action: 'inventory_all', actor, generation: this.policyGeneration },
			authority
		);
	}
	async metadata(id, actor, authority = internalAuthority) {
		this.authorize(actor);
		return this.worker(
			{ action: 'metadata', id, actor, generation: this.policyGeneration },
			authority
		);
	}
	async grantEntryExecutors(id, expected_version, executors, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker(
			{
				action: 'grant_executors',
				id,
				expected_version,
				executors,
				actor,
				generation: this.policyGeneration
			},
			authority
		);
	}

	async revokeEntryExecution(id, expected_version, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker(
			{
				action: 'revoke_entry',
				id,
				expected_version,
				actor,
				generation: this.policyGeneration
			},
			authority
		);
	}
	async restoreEntryExecution(id, expected_version, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker(
			{
				action: 'restore_entry',
				id,
				expected_version,
				actor,
				generation: this.policyGeneration
			},
			authority
		);
	}

	async createGroup(id, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker(
			{ action: 'group_create', id, actor, generation: this.policyGeneration },
			authority
		);
	}
	// A person managing their own vault gets an ordinary KeePassXC entry: a plain secret with the
	// UserName/URL/Notes fields, exactly what every release through 3.1.1 wrote and what the exec
	// SecretRef resolver reads. Agent credentials keep the versioned envelope through `create`.
	async createEntry(id, fields, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker(
			{
				action: 'create',
				id,
				material: plainMaterial(fields),
				plain: true,
				actor,
				generation: this.policyGeneration
			},
			authority
		);
	}
	async updateEntry(id, fields, expected_version, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker(
			{
				action: 'rotate',
				id,
				material: plainMaterial(fields),
				expected_version,
				plain: true,
				actor,
				generation: this.policyGeneration
			},
			authority
		);
	}
	async create(id, material, actor, authority = internalAuthority) {
		this.authorize(actor);
		requireValue(
			material && typeof material === 'object' && !Array.isArray(material),
			'invalid_input',
			'Expected protected credential material'
		);
		return this.worker(
			{
				action: 'create',
				id,
				material,
				actor,
				generation: this.policyGeneration
			},
			authority
		);
	}
	async rotate(
		id,
		material,
		expected_version,
		actor,
		guard = undefined,
		authority = internalAuthority
	) {
		this.authorize(actor);
		const epoch = this.generation,
			original = authority;
		authority = {
			signal: original.signal,
			assert: () => {
				original.assert();
				this.authorize(actor);
				requireValue(
					epoch === this.generation,
					'authority_changed',
					'Vault authorization changed before publication'
				);
			}
		};
		return this.worker(
			{
				action: 'rotate',
				id,
				material,
				expected_version,
				actor,
				generation: this.policyGeneration,
				guard
			},
			authority
		);
	}
	async resolveForExecution(
		id,
		actor,
		execute,
		{ human = false, purpose = 'execute', authority = internalAuthority } = {}
	) {
		this.authorize(actor);
		const generation = this.generation;
		const assert = () => {
			authority.assert();
			this.authorize(actor, human);
			requireValue(this.generation === generation, 'authority_changed', 'Vault authority changed');
		};
		const guard = {
			assert,
			signal: authority.signal
				? AbortSignal.any([authority.signal, this.operationController.signal])
				: this.operationController.signal
		};
		assert();
		const record = await this.worker(
			{
				action: 'resolve',
				id,
				human,
				purpose,
				actor,
				generation: this.policyGeneration
			},
			guard
		);
		this.authorize(actor);
		requireValue(
			generation === this.generation,
			'authority_changed',
			'Vault authorization changed'
		);
		assert();
		const result = await execute(record, guard);
		assert();
		return result;
	}
	async revokeSecretRefs(ids, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker({ action: 'revoke_secretrefs', ids, actor }, authority);
	}
	async grantSecretRefs(ids, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.worker({ action: 'grant_secretrefs', ids, actor }, authority);
	}
	async audit(
		actor,
		{ limit = 25, before = Number.MAX_SAFE_INTEGER } = {},
		authority = internalAuthority
	) {
		requireValue(
			this.owners.has(actor) && actor.startsWith('human:'),
			'access_denied',
			'Only an owner can read Vault access history'
		);
		return this.worker({ action: 'audit', actor, limit, before }, authority);
	}
	async revealField(id, field, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		requireValue(
			typeof field === 'string' && /^[a-z_]{1,80}$/.test(field),
			'invalid_input',
			'Invalid credential field'
		);
		return this.resolveForExecution(
			id,
			actor,
			(record) => {
				requireValue(
					typeof record.material[field] === 'string',
					'not_found',
					'Credential field is unavailable'
				);
				return record.material[field];
			},
			{ human: true, purpose: 'reveal', authority }
		);
	}
	async copyField(id, field, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		requireValue(
			typeof field === 'string' && /^[a-z_]{1,80}$/.test(field),
			'invalid_input',
			'Invalid credential field'
		);
		return this.resolveForExecution(
			id,
			actor,
			(record) => {
				requireValue(
					typeof record.material[field] === 'string',
					'not_found',
					'Credential field is unavailable'
				);
				return record.material[field];
			},
			{ human: true, purpose: 'copy', authority }
		);
	}
	async reveal(id, actor, authority = internalAuthority) {
		this.authorize(actor, true);
		return this.resolveForExecution(id, actor, (record) => record.material, {
			human: true,
			purpose: 'reveal',
			authority
		});
	}
}
