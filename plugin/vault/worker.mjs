import { DatabaseSync } from 'node:sqlite';
// Invoked under flock. stdin/stdout are private pipes owned by the Vault service.
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { snapshotVault, listSnapshots } from './recovery.mjs';
// The database and key are addressed separately from the plugin's private directory so the Vault can
// open the operator's existing KeePassXC database, which is what `plugin-v4-scope.md` requires and
// what every release through 3.1.1 did. Policy, audit and recovery stay private regardless.
const directory = process.argv[2];
const database = process.argv[3] || path.join(directory, 'credentials.kdbx'),
	key = process.argv[4] || path.join(directory, 'unlock.key');
const policyPath = path.join(directory, 'policy.json');

// KeePassXC titles are human text: "Anthem Blue Cross" and "GitHub Verlbot CLI" are ordinary entries.
// Only the path separator, backslashes, control characters and the relative segments are excluded.
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be excluded
const SEGMENT = /^(?!\.{1,2}$)[^/\\\x00-\x1f]{1,120}$/;
function validHandle(value, { depth = 5 } = {}) {
	if (typeof value !== 'string' || !value.length) return false;
	const segments = value.split('/');
	if (segments.length > depth) return false;
	return segments.every((s) => SEGMENT.test(s) && s.trim() === s);
}

// A plugin-written credential stores a JSON envelope in Password. An entry a person created in
// KeePassXC stores a plain secret with the ordinary UserName/URL/Notes fields. Both are readable;
// neither is rewritten into the other's shape, because the exec SecretRef resolver reads plain
// fields and converting them would break every existing reference.
const PLAIN_FIELDS = { username: 'UserName', url: 'URL', notes: 'Notes' };
function attribute(args, db, id, name) {
	try {
		return cli(['show', ...args, '-s', '-a', name, db, id]).replace(/\n$/, '');
	} catch {
		return '';
	}
}
function readRecord(args, db, id) {
	const raw = cli(['show', ...args, '-s', '-a', 'Password', db, id]).replace(/\n$/, '');
	let envelope = null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.material)
			envelope = parsed;
	} catch {
		envelope = null;
	}
	if (envelope) return { ...envelope, plain: false };
	const material = { password: raw };
	for (const [field, name] of Object.entries(PLAIN_FIELDS)) {
		const value = attribute(args, db, id, name);
		if (value) material[field] = value;
	}
	return {
		version: 1,
		material,
		created_by: null,
		allowed_executors: [],
		revoked: false,
		plain: true
	};
}
// Writing an ordinary KeePassXC entry: the secret through stdin, the other fields as flags, then a
// readback of what actually landed in the encrypted snapshot.
function writePlain(command, args, db, id, material) {
	const field = (flag, value) => (typeof value === 'string' ? [flag, value] : []);
	cli(
		[
			command,
			...args,
			'-p',
			...field('-u', material.username),
			...field('--url', material.url),
			...field('--notes', material.notes),
			db,
			id
		],
		(material.password ?? '') + '\n'
	);
	const written = readRecord(args, db, id);
	for (const [name, value] of Object.entries(material))
		if (typeof value === 'string' && written.material[name] !== value)
			throw new Error('verification_failed');
}
function policyWrite(policy) {
	const temp = path.join(directory, `policy-${randomUUID()}.tmp`);
	fs.writeFileSync(temp, JSON.stringify(policy), { mode: 0o600, flag: 'wx' });
	const fd = fs.openSync(temp, 'r');
	fs.fsyncSync(fd);
	fs.closeSync(fd);
	authorizeCommit();
	fs.renameSync(temp, policyPath);
}
let commitChannel = false;
function authorizeCommit() {
	if (!commitChannel) return;
	fs.writeSync(3, 'commit\n');
	const reply = Buffer.alloc(1);
	for (;;) {
		try {
			if (fs.readSync(3, reply, 0, 1, null) !== 1 || reply[0] !== 49)
				throw new Error('authority_changed');
			return;
		} catch (error) {
			if (error.code !== 'EAGAIN') throw error;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
		}
	}
}
function mutateDatabase(change) {
	const temp = path.join(directory, `transaction-${randomUUID()}.kdbx`);
	try {
		fs.copyFileSync(database, temp, fs.constants.COPYFILE_EXCL);
		fs.chmodSync(temp, 0o600);
		change(temp);
		const fd = fs.openSync(temp, 'r');
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		authorizeCommit();
		fs.renameSync(temp, database);
		const dir = fs.openSync(directory, 'r');
		fs.fsyncSync(dir);
		fs.closeSync(dir);
	} finally {
		fs.rmSync(temp, { force: true });
	}
}
// The Gateway authenticates humans before any request reaches this worker, so a `human:` actor is
// already an owner here; `policy.owners` stays recorded for the audit trail. Agents authenticate
// nothing, so they keep the configured-executor check as defence against a stale service instance.
function owns(actor) {
	return actor === 'system:vault' || actor.startsWith('human:');
}
function authorize(policy, actor, owner = false) {
	if (owns(actor)) return;
	if (owner || !policy.executors.includes(actor)) throw new Error('access_denied');
}
function cli(args, input = '') {
	const result = spawnSync('keepassxc-cli', args, {
		input,
		encoding: 'utf8',
		maxBuffer: 1048576,
		timeout: 30000
	});
	if (result.status !== 0) throw new Error('vault_operation_failed');
	return result.stdout;
}
let auditDb, operation, requestMeta;
function audit(outcome) {
	if (!auditDb || !operation) return;
	auditDb
		.prepare(
			'INSERT INTO access_events(operation,action,entry_id,actor,at,outcome) VALUES(?,?,?,?,?,?)'
		)
		.run(operation, requestMeta.action, requestMeta.entry, requestMeta.actor, Date.now(), outcome);
}
function reply(value) {
	const denied = ['access_denied', 'vault_locked', 'authority_changed'];
	audit(
		value.error
			? denied.includes(value.error)
				? 'denied'
				: `failed:${value.error}`
			: value.errors && Object.keys(value.errors).length
				? Object.keys(value.values ?? {}).length
					? 'partial'
					: 'denied'
				: 'resolved'
	);
	auditDb?.close();
	auditDb = undefined;
	process.stdout.write(JSON.stringify(value));
}
let guardDb;
try {
	const request = JSON.parse(fs.readFileSync(0, 'utf8'));
	commitChannel = request.commit_channel === true;
	auditDb = new DatabaseSync(path.join(directory, 'audit.db'));
	fs.chmodSync(path.join(directory, 'audit.db'), 0o600);
	auditDb.exec(
		"PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS access_events(seq INTEGER PRIMARY KEY,operation TEXT NOT NULL,action TEXT NOT NULL,entry_id TEXT,actor TEXT NOT NULL,at INTEGER NOT NULL,outcome TEXT NOT NULL) STRICT;CREATE TRIGGER IF NOT EXISTS access_events_no_update BEFORE UPDATE ON access_events BEGIN SELECT RAISE(ABORT,'immutable_audit');END;CREATE TRIGGER IF NOT EXISTS access_events_no_delete BEFORE DELETE ON access_events BEGIN SELECT RAISE(ABORT,'immutable_audit');END;"
	);
	const known = new Set([
		'initialize',
		'adopt',
		'reconcile',
		'lock',
		'unlock',
		'inventory',
		'inventory_all',
		'create',
		'rotate',
		'resolve',
		'metadata',
		'group_create',
		'grant_secretrefs',
		'revoke_secretrefs',
		'resolve_refs',
		'revoke_entry',
		'restore_entry',
		'grant_executors',
		'audit',
		'backup',
		'recovery_list',
		'relocate',
		'remove_entry',
		'group_remove'
	]);
	requestMeta = {
		action:
			request.action === 'resolve' && request.human
				? request.purpose === 'copy'
					? 'human_copy'
					: 'human_reveal'
				: known.has(request.action)
					? request.action
					: 'unknown',
		entry:
			typeof request.id === 'string' && request.id.length <= 400 && validHandle(request.id)
				? request.id
				: null,
		actor:
			typeof request.actor === 'string' &&
			/^(human|agent|service|system):/.test(request.actor) &&
			request.actor.length <= 256
				? request.actor
				: request.action === 'resolve_refs'
					? 'runtime:secretref'
					: 'system:vault'
	};
	if (!known.has(request.action)) throw new Error('invalid_action');
	if (request.action !== 'audit') {
		operation = randomUUID();
		audit('attempt');
	}

	// Adoption records policy beside a database that already exists, without touching a single
	// credential in it. This is the path an operator's existing KeePassXC vault takes on first start.
	if (request.action === 'adopt') {
		if (request.actor !== 'system:vault') throw new Error('access_denied');
		if (!fs.existsSync(database)) throw new Error('not_initialized');
		if (!fs.existsSync(key)) throw new Error('recovery_required');
		if (fs.existsSync(policyPath)) throw new Error('already_initialized');
		policyWrite({
			owners: request.owners,
			executors: request.executors,
			locked: true,
			generation: 1,
			secretref_ids: []
		});
		reply({ adopted: true });
		process.exit(0);
	}
	if (request.action === 'initialize') {
		if (fs.existsSync(database)) throw new Error('already_initialized');
		if (fs.existsSync(key)) throw new Error('recovery_required');
		fs.writeFileSync(key, randomBytes(32), { mode: 0o600, flag: 'wx' });
		cli(['db-create', '-q', '--set-key-file', key, database]);
		fs.chmodSync(database, 0o600);
		policyWrite({
			owners: request.owners,
			executors: request.executors,
			locked: true,
			generation: 1,
			secretref_ids: []
		});
		reply({ initialized: true });
	} else {
		if (!fs.existsSync(policyPath)) throw new Error('not_initialized');
		const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
		if (['backup', 'recovery_list'].includes(request.action)) {
			authorize(policy, request.actor, true);
			reply(
				request.action === 'backup'
					? snapshotVault(directory, auditDb, authorizeCommit, { database, key })
					: listSnapshots(directory)
			);
			process.exit(0);
		}
		if (request.action === 'audit') {
			authorize(policy, request.actor, true);
			const limit = request.limit ?? 25,
				before = request.before ?? Number.MAX_SAFE_INTEGER;
			if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(before))
				throw new Error('invalid_handle');
			const rows = auditDb
				.prepare('SELECT * FROM access_events WHERE seq<? ORDER BY seq DESC LIMIT ?')
				.all(before, limit);
			reply({ entries: rows, next_before: rows.length === limit ? rows.at(-1).seq : null });
			process.exit(0);
		}

		if (request.action === 'reconcile') {
			if (request.actor !== 'system:vault') throw new Error('access_denied');
			policy.owners = request.owners;
			policy.executors = request.executors;
			policyWrite(policy);
			reply({ owners: policy.owners.length, executors: policy.executors.length });
			process.exit(0);
		}
		if (request.action === 'lock') {
			authorize(policy, request.actor, true);
			policy.locked = true;
			policy.generation++;
			policyWrite(policy);
			reply({ locked: true, generation: policy.generation });
			process.exit(0);
		}
		if (request.action === 'unlock') {
			authorize(policy, request.actor, true);
			policy.locked = false;
			policy.generation++;
			policyWrite(policy);
			reply({ locked: false, generation: policy.generation });
			process.exit(0);
		}
		if (policy.locked) throw new Error('vault_locked');
		if (request.action !== 'resolve_refs') {
			authorize(policy, request.actor);
			if (request.generation !== undefined && request.generation !== policy.generation)
				throw new Error('authority_changed');
		}
		if (request.action === 'grant_secretrefs' || request.action === 'revoke_secretrefs') {
			authorize(policy, request.actor, true);
			if (!Array.isArray(request.ids) || request.ids.length > 100)
				throw new Error('invalid_handle');
			if (
				!request.ids.every(
					(id) =>
						typeof id === 'string' &&
						/^entries\/(.+)\/(password|username|url|notes|api-key|access-token|refresh-token|client-secret)$/.test(
							id
						)
				)
			)
				throw new Error('invalid_handle');
			const beforeCount = policy.secretref_ids.length;
			policy.secretref_ids =
				request.action === 'grant_secretrefs'
					? [...new Set([...policy.secretref_ids, ...request.ids])]
					: policy.secretref_ids.filter((id) => !request.ids.includes(id));
			policyWrite(policy);
			reply({
				granted: Math.max(0, policy.secretref_ids.length - beforeCount),
				revoked: Math.max(0, beforeCount - policy.secretref_ids.length),
				total: policy.secretref_ids.length
			});
			process.exit(0);
		}
		if (request.action === 'resolve_refs') {
			if (!Array.isArray(request.ids) || request.ids.length > 50) throw new Error('invalid_handle');
			const values = {},
				errors = {};
			const exactPaths = new Set(
				cli(['ls', '-q', '--no-password', '--key-file', key, '-R', '-f', database])
					.trim()
					.split('\n')
			);
			for (const id of request.ids) {
				try {
					if (typeof id !== 'string' || !policy.secretref_ids.includes(id))
						throw new Error('access_denied');
					const match =
						/^entries\/(.+)\/(password|username|url|notes|api-key|access-token|refresh-token|client-secret)$/.exec(
							id
						);
					if (!match || !validHandle(match[1]) || !exactPaths.has(match[1]))
						throw new Error('invalid_handle');
					const record = readRecord(['-q', '--no-password', '--key-file', key], database, match[1]);
					if (record.revoked) throw new Error('access_denied');
					const value = record.material[match[2].replaceAll('-', '_')];
					if (typeof value !== 'string' || !value.length) throw new Error('not_found');
					auditDb
						.prepare(
							'INSERT INTO access_events(operation,action,entry_id,actor,at,outcome) VALUES(?,?,?,?,?,?)'
						)
						.run(operation, 'resolve_ref', match[1], 'runtime:secretref', Date.now(), 'resolved');
					values[id] = value;
				} catch {
					errors[id] = { code: 'NOT_FOUND' };
				}
			}
			reply({ protocolVersion: 1, values, errors });
			process.exit(0);
		}
		const id = request.id;
		if (id && !validHandle(id)) throw new Error('invalid_handle');
		const args = ['-q', '--no-password', '--key-file', key];
		// `show` may fall back to a title search (including recycled entries). Never use that
		// behavior as handle resolution: require an exact flattened path in current inventory.
		const paths = new Set(
			cli(['ls', ...args, '-R', '-f', database])
				.trim()
				.split('\n')
		);
		if (
			id &&
			!['create', 'group_create'].includes(request.action) &&
			!paths.has(id) &&
			!paths.has(id + '/')
		)
			throw Error('not_found');
		if (request.action === 'create' && (paths.has(id) || paths.has(id + '/')))
			throw Error('already_exists');

		if (request.action === 'group_create') {
			authorize(policy, request.actor, true);
			if (!id) throw new Error('invalid_handle');
			mutateDatabase((temp) => {
				cli(['mkdir', ...args, temp, id]);
				cli(['ls', ...args, temp, id]);
			});
			reply({ id, kind: 'group' });
			process.exit(0);
		}

		if (request.action === 'group_remove') {
			authorize(policy, request.actor, true);
			if (
				!request.confirmed ||
				!id ||
				!['', '[empty]'].includes(cli(['ls', ...args, database, id]).trim())
			)
				throw Error('group_not_empty_or_unconfirmed');
			const recovery = snapshotVault(directory, auditDb, authorizeCommit, { database, key });
			mutateDatabase((temp) => {
				cli(['rmdir', ...args, temp, id]);
			});
			reply({ id, removed: true, recovery_id: recovery.id });
			process.exit(0);
		}
		if (request.action === 'inventory') {
			const group = request.group ?? '';
			if (group && !validHandle(group)) throw new Error('invalid_handle');
			if (group && !paths.has(group + '/')) throw Error('not_found');
			const names = cli(['ls', ...args, database, ...(group ? [group] : [])])
				.trim()
				.split('\n')
				// `keepassxc-cli ls` prints this placeholder for a group with no children. It is output,
				// not an entry, and the stricter 4.0 name filter hid it only by accident.
				.filter((x) => x !== '[empty]' && validHandle(x.replace(/\/$/, ''), { depth: 1 }));
			reply({
				entries: names.map((name) => ({
					id: (group ? group + '/' : '') + name.replace(/\/$/, ''),
					kind: name.endsWith('/') ? 'group' : 'entry'
				}))
			});
		} else if (request.action === 'inventory_all') {
			// The whole tree in one call, so the UI can search every entry without walking group by
			// group. `paths` is the recursive flattened listing already read above for handle
			// validation, so this costs nothing extra. Names only: no field is read here, because
			// reading one attribute per entry costs a subprocess each and would dominate the call.
			const all = [];
			for (const path of paths) {
				if (!path) continue;
				const isGroup = path.endsWith('/'),
					entryId = isGroup ? path.slice(0, -1) : path;
				// `keepassxc-cli ls` prints an `[empty]` placeholder for a childless group. The flat
				// listing prints it under its group as `Group/[empty]`, so matching the bare string is
				// not enough: a phantom entry there makes an emptied group look occupied, which hides
				// its removal control and offers a row whose metadata call can only fail.
				if (entryId.split('/').at(-1) === '[empty]') continue;
				if (!validHandle(entryId)) continue;
				all.push({ id: entryId, kind: isGroup ? 'group' : 'entry' });
			}
			reply({ entries: all });
		} else {
			let current = null;
			if (request.action !== 'create') current = readRecord(args, database, id);

			if (['relocate', 'remove_entry'].includes(request.action)) {
				authorize(policy, request.actor, true);
				if (request.expected_version !== current.version) throw Error('version_conflict');
				if (!request.confirmed) throw Error('confirmation_required');
				const destination = request.destination;
				if (request.action === 'relocate') {
					if (typeof destination !== 'string' || !validHandle(destination) || destination === id)
						throw Error('invalid_handle');
					const group = destination.split('/').slice(0, -1).join('/'),
						name = destination.split('/').at(-1);
					const names = cli(['ls', ...args, database, ...(group ? [group] : [])])
						.trim()
						.split('\n');
					if (names.includes(name) || names.includes(name + '/')) throw Error('already_exists');
				}
				const recovery = snapshotVault(directory, auditDb, authorizeCommit, { database, key });
				mutateDatabase((temp) => {
					if (request.action === 'relocate') {
						// A moved entry keeps its own shape. Rewriting a person's entry as an envelope here
						// would silently stop every SecretRef that resolves it.
						if (current.plain) writePlain('add', args, temp, destination, current.material);
						else {
							const next = { ...current, version: current.version + 1 };
							cli(['add', ...args, '-p', temp, destination], JSON.stringify(next) + '\n');
							const check = JSON.parse(
								cli(['show', ...args, '-s', '-a', 'Password', temp, destination])
							);
							if (JSON.stringify(check) !== JSON.stringify(next))
								throw Error('verification_failed');
						}
					}
					cli(
						['edit', ...args, '-p', temp, id],
						JSON.stringify({ ...current, revoked: true, version: current.version + 1 }) + '\n'
					);
					cli(['rm', ...args, temp, id]);
				});
				if (destination) requestMeta.entry = destination;
				reply({
					id: destination ?? id,
					removed: request.action === 'remove_entry',
					version: current.version + 1,
					recovery_id: recovery.id
				});
				process.exit(0);
			}
			if (request.action === 'metadata') {
				reply({
					id,
					// Field names, never values: the UI needs to know which of Password/UserName/URL/Notes
					// an entry actually carries so it offers Reveal only for fields that exist.
					fields: Object.keys(current.material ?? {}),
					plain: current.plain === true,
					version: current.version,
					execution_disabled: !!current.revoked,
					created_by: current.created_by ?? null,
					allowed_executors: current.allowed_executors ?? [],
					execution_policy_review_required: !Array.isArray(current.allowed_executors)
				});
				process.exit(0);
			}
			if (current && !owns(request.actor)) {
				const allowed =
					current.allowed_executors ?? (current.created_by ? [current.created_by] : []);
				if (current.revoked || !allowed.includes(request.actor)) throw new Error('access_denied');
			}
			if (['revoke_entry', 'restore_entry', 'grant_executors'].includes(request.action))
				authorize(policy, request.actor, true);
			if (request.action === 'resolve') {
				if (request.human) authorize(policy, request.actor, true);
				reply(current);
			} else {
				if (request.action !== 'create' && request.expected_version !== current.version)
					throw new Error('version_conflict');

				const material =
					request.action === 'rotate'
						? { ...current.material, ...request.material }
						: ['revoke_entry', 'restore_entry', 'grant_executors'].includes(request.action)
							? current.material
							: request.material;
				if (
					request.action === 'grant_executors' &&
					(!Array.isArray(request.executors) ||
						request.executors.length > 25 ||
						!request.executors.every((x) => policy.executors.includes(x)))
				)
					throw new Error('access_denied');
				const next = {
					...(current ?? {}),
					version: (current?.version ?? 0) + 1,
					material,
					created_by: current?.created_by ?? request.actor,
					allowed_executors:
						request.action === 'grant_executors'
							? [...new Set(request.executors)]
							: (current?.allowed_executors ??
								(policy.executors.includes(request.actor) ? [request.actor] : [])),
					revoked:
						request.action === 'revoke_entry'
							? true
							: request.action === 'restore_entry'
								? false
								: (current?.revoked ?? false)
				};
				const temp = path.join(directory, `transaction-${randomUUID()}.kdbx`);
				try {
					fs.copyFileSync(database, temp, fs.constants.COPYFILE_EXCL);
					fs.chmodSync(temp, 0o600);
					const command = request.action === 'create' ? 'add' : 'edit';
					// An entry a person owns keeps its ordinary KeePassXC shape. Rewriting it into the
					// envelope would make the exec SecretRef resolver, which reads plain fields, stop
					// resolving it, so the existing record's shape always wins over any request flag.
					const plainWrite = current ? current.plain === true : request.plain === true;
					if (plainWrite) writePlain(command, args, temp, id, material);
					else {
						cli([command, ...args, '-p', temp, id], JSON.stringify(next) + '\n');
						// Validate both values from the written encrypted snapshot before publishing it.
						const check = JSON.parse(cli(['show', ...args, '-s', '-a', 'Password', temp, id]));
						if (JSON.stringify(check) !== JSON.stringify(next))
							throw new Error('verification_failed');
					}
					const fd = fs.openSync(temp, 'r');
					fs.fsyncSync(fd);
					fs.closeSync(fd);
					authorizeCommit();
					if (request.guard) {
						if (request.guard.database !== path.join(path.dirname(directory), 'integrations.db'))
							throw new Error('access_denied');
						guardDb = new DatabaseSync(request.guard.database);
						guardDb.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
						const row = guardDb
							.prepare('SELECT version,body FROM connections WHERE id=?')
							.get(request.guard.id);
						const connection = row ? JSON.parse(String(row.body)) : null;
						if (
							!row ||
							row.version !== request.guard.version ||
							connection.phase !== request.guard.phase ||
							connection.disconnected ||
							connection.paused ||
							!connection.actors.includes(request.actor)
						)
							throw new Error('authority_changed');
					}
					fs.renameSync(temp, database);
					const dir = fs.openSync(directory, 'r');
					fs.fsyncSync(dir);
					fs.closeSync(dir);
					if (guardDb) {
						guardDb.exec('COMMIT');
						guardDb.close();
						guardDb = undefined;
					}
					reply({ id, version: next.version });
				} finally {
					try {
						fs.unlinkSync(temp);
					} catch (e) {
						if (e.code !== 'ENOENT') process.emitWarning('Temporary file cleanup failed');
					}
				}
			}
		}
	}
} catch (error) {
	if (guardDb) {
		try {
			guardDb.exec('ROLLBACK');
		} finally {
			guardDb.close();
		}
	}
	const safe = [
		'version_conflict',
		'already_initialized',
		'not_initialized',
		'recovery_required',
		'invalid_handle',
		'invalid_action',
		'access_denied',
		'vault_locked',
		'authority_changed'
	].includes(error.message)
		? error.message
		: 'vault_unavailable';
	try {
		reply({ error: safe });
	} catch {
		auditDb?.close();
		process.stdout.write(JSON.stringify({ error: 'vault_unavailable' }));
	}
	process.exitCode = 1;
}
