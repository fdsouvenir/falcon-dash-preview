import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const files = ['credentials.kdbx', 'unlock.key', 'policy.json', 'audit.db'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function privateDirectory(directory) {
	if (fs.realpathSync(directory) !== path.resolve(directory))
		throw Error('Recovery path contains symbolic links');
	const stat = fs.statSync(directory);
	if (!stat.isDirectory() || stat.mode & 0o077) throw Error('Recovery directory must be private');
}
function boundedFile(file) {
	const fd = fs.openSync(
		file,
		fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
	);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024 || stat.mode & 0o077)
			throw Error('Unsafe recovery file');
		const bytes = Buffer.alloc(stat.size + 1);
		let count = 0;
		while (count < bytes.length) {
			const n = fs.readSync(fd, bytes, count, bytes.length - count, count);
			if (!n) break;
			count += n;
		}
		if (count !== stat.size) throw Error('Recovery file changed');
		return bytes.subarray(0, count);
	} finally {
		fs.closeSync(fd);
	}
}
function writePrivate(file, bytes) {
	fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
	const fd = fs.openSync(file, 'r');
	try {
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
// Caller holds the existing Vault flock; this function never returns credential/key bytes.
// The credential database and its key may live outside the private directory — an operator's own
// KeePassXC vault is opened where it already is. A snapshot still stores them under their canonical
// names so a restored destination remains self-contained.
export function snapshotVault(directory, auditDb, authorizePublish, sources = {}) {
	privateDirectory(directory);
	const root = path.join(directory, 'recovery');
	if (!fs.existsSync(root)) fs.mkdirSync(root, { mode: 0o700 });
	privateDirectory(root);
	const id = randomUUID(),
		temp = path.join(root, '.pending-' + id),
		target = path.join(root, id);
	fs.mkdirSync(temp, { mode: 0o700 });
	try {
		for (const name of files) {
			if (name === 'audit.db') {
				auditDb.prepare('VACUUM INTO ?').run(path.join(temp, name));
				fs.chmodSync(path.join(temp, name), 0o600);
			} else
				writePrivate(
					path.join(temp, name),
					boundedFile(
						name === 'credentials.kdbx'
							? (sources.database ?? path.join(directory, name))
							: name === 'unlock.key'
								? (sources.key ?? path.join(directory, name))
								: path.join(directory, name)
					)
				);
		}
		const manifest = {
			format: 1,
			id,
			created_at: new Date().toISOString(),
			files: Object.fromEntries(
				files.map((name) => [name, digest(boundedFile(path.join(temp, name)))])
			)
		};
		writePrivate(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
		authorizePublish();
		fs.renameSync(temp, target);
		const fd = fs.openSync(root, 'r');
		try {
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		return {
			id,
			created_at: manifest.created_at,
			encrypted_database: true,
			contains_private_unlock_key: true
		};
	} finally {
		fs.rmSync(temp, { recursive: true, force: true });
	}
}
export function listSnapshots(directory) {
	const root = path.join(directory, 'recovery');
	if (!fs.existsSync(root)) return { snapshots: [] };
	privateDirectory(root);
	return {
		snapshots: fs
			.readdirSync(root)
			.filter((name) => /^[0-9a-f-]{36}$/.test(name))
			.sort()
			.map((id) => {
				try {
					const dir = path.join(root, id);
					privateDirectory(dir);
					const data = JSON.parse(boundedFile(path.join(dir, 'manifest.json')).toString('utf8'));
					return { id, created_at: data.created_at };
				} catch {
					return { id, unavailable: true };
				}
			})
	};
}
// Offline, fresh-destination recovery only. Never overwrites an existing/live Vault.
export function restoreVaultSnapshot(snapshot, target, { quiesced = false } = {}) {
	if (!quiesced) throw Error('Explicit offline/quiesced recovery required');
	if (!path.isAbsolute(snapshot) || !path.isAbsolute(target))
		throw Error('Recovery paths must be absolute');
	snapshot = path.resolve(snapshot);
	target = path.resolve(target);
	privateDirectory(snapshot);
	privateDirectory(path.dirname(path.resolve(target)));
	if (!path.isAbsolute(target) || fs.existsSync(target))
		throw Error('Recovery needs a new absolute destination');
	const source = path.dirname(path.dirname(snapshot));
	if (target === source || target.startsWith(source + path.sep))
		throw Error('Recovery must use a separate destination outside the source Vault');
	const manifest = JSON.parse(boundedFile(path.join(snapshot, 'manifest.json')).toString('utf8'));
	if (
		manifest.format !== 1 ||
		Object.keys(manifest.files ?? {})
			.sort()
			.join() !== [...files].sort().join()
	)
		throw Error('Unsupported recovery manifest');
	const content = {};
	for (const name of files) {
		content[name] = boundedFile(path.join(snapshot, name));
		if (digest(content[name]) !== manifest.files[name])
			throw Error('Recovery integrity check failed');
	}
	const policy = JSON.parse(content['policy.json'].toString('utf8'));
	if (
		!Array.isArray(policy.owners) ||
		!Array.isArray(policy.executors) ||
		!Number.isSafeInteger(policy.generation) ||
		policy.generation < 0 ||
		policy.generation >= Number.MAX_SAFE_INTEGER
	)
		throw Error('Invalid recovery policy');
	policy.locked = true;
	policy.generation = (policy.generation ?? 0) + 1;
	content['policy.json'] = Buffer.from(JSON.stringify(policy));
	fs.mkdirSync(target, { mode: 0o700 });
	try {
		for (const name of files) writePrivate(path.join(target, name), content[name]);
		const fd = fs.openSync(target, 'r');
		try {
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		return { restored: true, locked: true, files: files.length };
	} catch (error) {
		fs.rmSync(target, { recursive: true, force: true });
		throw error;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 5 || process.argv[4] !== '--quiesced')
		throw Error('Usage: node recovery.mjs <private-snapshot> <new-private-destination> --quiesced');
	console.log(
		JSON.stringify(restoreVaultSnapshot(process.argv[2], process.argv[3], { quiesced: true }))
	);
}
