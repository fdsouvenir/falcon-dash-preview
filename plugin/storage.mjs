import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
/** @param {string} file @param {{maxVersion?:number,allowUnversioned?:boolean}} [options] */
export function privateDatabase(file, { maxVersion, allowUnversioned = false } = {}) {
	if (!isAbsolute(file) || resolve(file) !== file)
		throw new Error('Database path must be canonical and absolute');
	const directory = dirname(file);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	if (realpathSync(directory) !== directory || (lstatSync(directory).mode & 0o077) !== 0)
		throw new Error('Database directory must be private and cannot contain symlinks');
	for (const suffix of ['-wal', '-shm', '-journal']) {
		const side = lstatSync(file + suffix, { throwIfNoEntry: false });
		if (side && (!side.isFile() || side.isSymbolicLink() || side.nlink !== 1))
			throw new Error('Unsafe database sidecar');
	}
	const stat = lstatSync(file, { throwIfNoEntry: false });
	if (stat) {
		if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
			throw new Error('Unsafe database file');
		const probe = new DatabaseSync(file, { readOnly: true });
		try {
			const version = Number(probe.prepare('PRAGMA user_version').get().user_version);
			if (version === 0 && allowUnversioned) {
				const names = probe
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
					)
					.all()
					.map((x) => x.name);
				if (names.length && JSON.stringify(names) !== JSON.stringify(['audit', 'connections']))
					throw new Error('Unknown unversioned database requires explicit conversion');
			}
			if (maxVersion !== undefined && version > maxVersion)
				throw new Error('Unsupported database schema');
			if (
				version === 0 &&
				!allowUnversioned &&
				probe
					.prepare(
						"SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
					)
					.get().n !== 0
			)
				throw new Error('Existing data requires explicit offline conversion');
		} finally {
			probe.close();
		}
	}
	const db = new DatabaseSync(file);
	chmodSync(file, 0o600);
	db.exec(
		'PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;'
	);
	for (const suffix of ['-wal', '-shm']) {
		const sidecar = file + suffix;
		if (lstatSync(sidecar, { throwIfNoEntry: false })) chmodSync(sidecar, 0o600);
	}
	return db;
}
