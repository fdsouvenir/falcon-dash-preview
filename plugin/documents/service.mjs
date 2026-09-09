import { internalAuthority } from '../authority.mjs';
import * as fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError, requireValue } from '../errors.mjs';

const { O_RDONLY, O_NONBLOCK, O_DIRECTORY, O_NOFOLLOW, O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
const forbidden =
	/(^\.|^openclaw\.json$|credential|secret|password|token|vault|auth|\.kdbx$|\.key$|\.pem$|\.p12$|\.sqlite|\.db$)/i;
const extensions = new Set([
	'.md',
	'.txt',
	'.csv',
	'.svg',
	'.html',
	'.css',
	'.js',
	'.ts',
	'.json',
	'.yaml',
	'.yml'
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
function assertPublicText(bytes) {
	const text = bytes.toString('utf8');
	requireValue(
		!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text),
		'protected_content',
		'Credential material is not available through Documents'
	);
	if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			return;
		}
		const visit = (value) => {
			if (!value || typeof value !== 'object') return;
			for (const [key, child] of Object.entries(value)) {
				requireValue(
					!/^(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i.test(
						key
					) ||
						typeof child !== 'string' ||
						!child.length,
					'protected_content',
					'Use Vault for credential material'
				);
				visit(child);
			}
		};
		visit(data);
	}
}
export class Documents {
	constructor(roots, { protectedRoots = [], forbiddenRoots = [] } = {}) {
		this.roots = new Map();
		protectedRoots = protectedRoots.map((p) =>
			fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p)
		);
		forbiddenRoots = forbiddenRoots.map((p) =>
			fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p)
		);
		try {
			for (const root of roots) {
				requireValue(
					typeof root.id === 'string' &&
						root.id.length > 0 &&
						root.id.length <= 128 &&
						!this.roots.has(root.id),
					'invalid_config',
					'Workspace root ids must be nonempty and unique'
				);
				requireValue(
					path.isAbsolute(root.path) && Array.isArray(root.actors) && root.actors.length,
					'invalid_config',
					'Documents roots need an absolute path and explicit actors'
				);
				const real = fs.realpathSync(root.path);
				requireValue(
					real === root.path &&
						path.basename(real) !== '.openclaw' &&
						!forbiddenRoots.includes(real) &&
						!protectedRoots.some(
							(p) => real === p || real.startsWith(p + path.sep) || p.startsWith(real + path.sep)
						),
					'unsafe_root',
					'Use an authorized workspace root, not runtime or credential storage'
				);
				const fd = fs.openSync(real, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
				this.roots.set(root.id, { ...root, fd });
			}
		} catch (error) {
			this.close();
			throw error;
		}
	}
	close() {
		for (const root of this.roots.values()) fs.closeSync(root.fd);
		this.roots.clear();
	}
	root(id, actor, write = false) {
		const r = this.roots.get(id);
		requireValue(
			r && r.actors.includes(actor) && (!write || r.writable === true),
			'access_denied',
			'Workspace access is not authorized'
		);
		let current;
		try {
			current = fs.statSync(r.path);
			requireValue(
				fs.realpathSync(r.path) === r.path,
				'stale_root',
				'Workspace root was moved or replaced'
			);
		} catch {
			throw new DomainError('stale_root', 'Workspace root was moved or replaced');
		}
		const pinned = fs.fstatSync(r.fd);
		requireValue(
			current.ino === pinned.ino && current.dev === pinned.dev,
			'stale_root',
			'Workspace root was moved or replaced'
		);
		return r;
	}
	rootsFor(actor) {
		return {
			roots: [...this.roots.values()]
				.filter((r) => r.actors.includes(actor))
				.slice(0, 100)
				.map((r) => ({ id: r.id, writable: r.writable === true }))
		};
	}
	copyPath(input, actor) {
		this.read(input, actor);
		const root = this.root(input.root_id, actor);
		return { path: path.join(root.path, input.path) };
	}
	parts(value, empty = false) {
		requireValue(
			typeof value === 'string' &&
				value.length <= 1000 &&
				!value.includes('\\') &&
				!value.includes('\0') &&
				!path.isAbsolute(value),
			'unsafe_path',
			'Use a workspace-relative path'
		);
		const parts = value.split('/');
		if (empty && value === '') return [];
		requireValue(
			parts.every((p) => p && p !== '.' && p !== '..' && !forbidden.test(p)),
			'protected_path',
			'Path is not available in Documents'
		);
		return parts;
	}
	parent(root, parts) {
		let fd = fs.openSync(`/proc/self/fd/${root.fd}`, O_RDONLY | O_DIRECTORY);
		try {
			for (const p of parts) {
				const next = fs.openSync(`/proc/self/fd/${fd}/${p}`, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
				fs.closeSync(fd);
				fd = next;
			}
			return fd;
		} catch {
			fs.closeSync(fd);
			throw new DomainError('unsafe_path', 'Directory is unavailable or is a symbolic link');
		}
	}
	file(root, relative, callback) {
		const parts = this.parts(relative);
		requireValue(
			extensions.has(path.extname(parts.at(-1)).toLowerCase()),
			'unsupported_file',
			'This file type is not available'
		);
		const dir = this.parent(root, parts.slice(0, -1));
		try {
			return callback(`/proc/self/fd/${dir}/${parts.at(-1)}`, dir, parts.at(-1));
		} finally {
			fs.closeSync(dir);
		}
	}
	readBytes(file) {
		let fd;
		try {
			fd = fs.openSync(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
			const stat = fs.fstatSync(fd);
			requireValue(
				stat.isFile() && stat.nlink === 1 && stat.size <= 262144,
				'unsafe_file',
				'Only bounded regular files without hard links are available'
			);
			// Read at most one byte beyond the limit, even if the file grows after fstat.
			const buffer = Buffer.alloc(262145);
			let length = 0;
			while (length < buffer.length) {
				const count = fs.readSync(fd, buffer, length, buffer.length - length, length);
				if (!count) break;
				length += count;
			}
			const bytes = buffer.subarray(0, length);
			requireValue(
				bytes.length <= 262144 && !bytes.includes(0),
				'unsupported_file',
				'Only bounded text documents are available'
			);
			assertPublicText(bytes);
			return { bytes, stat };
		} catch (e) {
			if (e instanceof DomainError) throw e;
			throw new DomainError('unavailable', 'Document is unavailable');
		} finally {
			if (fd !== undefined) fs.closeSync(fd);
		}
	}
	list(
		{ root_id, path: relative = '', search = '', limit = 200, offset = 0, sort = 'name' },
		actor
	) {
		requireValue(
			typeof search === 'string' &&
				search.length <= 500 &&
				Number.isInteger(limit) &&
				limit >= 1 &&
				limit <= 200 &&
				Number.isInteger(offset) &&
				offset >= 0 &&
				['name', 'name_desc'].includes(sort),
			'invalid_input',
			'Unsupported sort, search, or pagination'
		);
		const root = this.root(root_id, actor);
		const fd = this.parent(root, this.parts(relative, true));
		try {
			const entries = fs
				.readdirSync(`/proc/self/fd/${fd}`, { withFileTypes: true })
				.filter(
					(e) =>
						!forbidden.test(e.name) &&
						!e.isSymbolicLink() &&
						(e.isDirectory() ||
							(e.isFile() && extensions.has(path.extname(e.name).toLowerCase()))) &&
						e.name.toLowerCase().includes(search.toLowerCase())
				)
				.sort(
					(a, b) =>
						Number(b.isDirectory()) -
						Number(a.isDirectory()) +
						(a.isDirectory() === b.isDirectory()
							? sort === 'name'
								? a.name.localeCompare(b.name)
								: b.name.localeCompare(a.name)
							: 0)
				)
				.map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }));
			return {
				entries: entries.slice(offset, offset + limit),
				total: entries.length,
				next_offset: offset + limit < entries.length ? offset + limit : null
			};
		} finally {
			fs.closeSync(fd);
		}
	}
	read({ root_id, path: relative }, actor) {
		return this.file(this.root(root_id, actor), relative, (file) => {
			const { bytes } = this.readBytes(file);
			return {
				content: bytes.toString('utf8'),
				version: hash(bytes),
				render: 'text',
				trust: 'untrusted-document'
			};
		});
	}
	write(
		{ root_id, path: relative, content, expected_version },
		actor,
		authority = internalAuthority
	) {
		requireValue(typeof content === 'string', 'invalid_input', 'Expected text content');
		const bytes = Buffer.from(content);
		assertPublicText(bytes);
		requireValue(
			bytes.length <= 262144 && !bytes.includes(0),
			'invalid_input',
			'Document exceeds the text limit'
		);
		return this.file(this.root(root_id, actor, true), relative, (file, dir) => {
			let old = null;
			try {
				old = this.readBytes(file);
			} catch (e) {
				if (fs.existsSync(file) || fs.lstatSync(file, { throwIfNoEntry: false })) throw e;
			}
			requireValue(
				old ? expected_version === hash(old.bytes) : expected_version === null,
				'version_conflict',
				'Document changed; keep your edits and reload before saving'
			);
			const temporary = `/proc/self/fd/${dir}/.falcon-${randomUUID()}`;
			let fd;
			try {
				authority.assert();
				fd = fs.openSync(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
				fs.writeFileSync(fd, bytes);
				fs.fsyncSync(fd);
				fs.closeSync(fd);
				fd = undefined;
				if (old) {
					const current = this.readBytes(file);
					requireValue(
						current.stat.ino === old.stat.ino && hash(current.bytes) === expected_version,
						'version_conflict',
						'Document changed during save'
					);
					authority.assert();
					fs.renameSync(temporary, file);
				} else {
					authority.assert();
					fs.linkSync(temporary, file);
					fs.unlinkSync(temporary);
				}
				fs.fsyncSync(dir);
				return { version: hash(bytes), bytes: bytes.length };
			} finally {
				if (fd !== undefined) fs.closeSync(fd);
				try {
					fs.unlinkSync(temporary);
				} catch (e) {
					if (e.code !== 'ENOENT') process.emitWarning('Temporary file cleanup failed');
				}
			}
		});
	}
	rename(
		{ root_id, path: relative, destination, expected_version },
		actor,
		authority = internalAuthority
	) {
		const root = this.root(root_id, actor, true);
		return this.file(root, relative, (source) =>
			this.file(root, destination, (target) => {
				const original = this.readBytes(source);
				requireValue(
					expected_version === hash(original.bytes),
					'version_conflict',
					'Document changed before rename'
				);
				requireValue(
					!fs.lstatSync(target, { throwIfNoEntry: false }),
					'already_exists',
					'Destination already exists'
				);
				authority.assert();
				fs.linkSync(source, target);
				try {
					const linked = fs.lstatSync(target),
						current = fs.lstatSync(source);
					requireValue(
						linked.isFile() &&
							linked.ino === original.stat.ino &&
							current.ino === original.stat.ino,
						'version_conflict',
						'Document changed during rename'
					);
					fs.unlinkSync(source);
				} catch (error) {
					fs.unlinkSync(target);
					throw error;
				}
				return { path: destination, version: hash(original.bytes) };
			})
		);
	}
	download(input, actor) {
		return {
			...this.read(input, actor),
			filename: path.basename(input.path),
			content_type: 'text/plain; charset=utf-8',
			trust: 'untrusted-document'
		};
	}
	upload(input, actor, authority = internalAuthority) {
		return this.write(input, actor, authority);
	}
	trash(
		{ root_id, path: relative, expected_version, confirmed },
		actor,
		authority = internalAuthority
	) {
		requireValue(
			confirmed === true,
			'confirmation_required',
			'Explicitly confirm targeted recoverable deletion'
		);
		const root = this.root(root_id, actor, true);
		return this.file(root, relative, (source) => {
			const original = this.readBytes(source);
			requireValue(
				expected_version === hash(original.bytes),
				'version_conflict',
				'Document changed before deletion'
			);
			const location = `/proc/self/fd/${root.fd}/.falcon-trash`;
			try {
				authority.assert();
				fs.mkdirSync(location, { mode: 0o700 });
			} catch (error) {
				if (error.code !== 'EEXIST') throw error;
			}
			const fd = fs.openSync(location, O_RDONLY | O_DIRECTORY | O_NOFOLLOW),
				id = randomUUID();
			try {
				const file = `/proc/self/fd/${fd}/${id}`;
				fs.writeFileSync(
					file + '.json',
					JSON.stringify({
						path: relative,
						version: expected_version,
						actor,
						at: new Date().toISOString()
					}),
					{ flag: 'wx', mode: 0o600 }
				);
				authority.assert();
				fs.renameSync(source, file);
				fs.fsyncSync(fd);
				return { trash_id: id, recoverable: true };
			} finally {
				fs.closeSync(fd);
			}
		});
	}
	trash_list({ root_id, offset = 0, limit = 50 }, actor, authority = internalAuthority) {
		const root = this.root(root_id, actor, true);
		requireValue(
			Number.isInteger(offset) &&
				offset >= 0 &&
				Number.isInteger(limit) &&
				limit > 0 &&
				limit <= 200,
			'invalid_input',
			'Invalid trash pagination'
		);
		authority.assert();
		let fd;
		try {
			fd = fs.openSync(
				`/proc/self/fd/${root.fd}/.falcon-trash`,
				O_RDONLY | O_DIRECTORY | O_NOFOLLOW
			);
		} catch (e) {
			if (e.code === 'ENOENT') return { entries: [], next_offset: null, total: 0, unavailable: 0 };
			throw new DomainError('unsafe_path', 'Trash directory is unavailable');
		}
		try {
			const names = fs
				.readdirSync(`/proc/self/fd/${fd}`)
				.filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))
				.sort();
			let unavailable = 0;
			const entries = [];
			for (const name of names.slice(offset, offset + limit)) {
				try {
					const metadata = JSON.parse(
						this.readBytes(`/proc/self/fd/${fd}/${name}`).bytes.toString('utf8')
					);
					this.parts(metadata.path);
					const item = name.slice(0, -5),
						content = this.readBytes(`/proc/self/fd/${fd}/${item}`);
					requireValue(
						hash(content.bytes) === metadata.version,
						'version_conflict',
						'Trash integrity mismatch'
					);
					entries.push({ trash_id: item, path: metadata.path, at: metadata.at });
				} catch {
					unavailable++;
				}
			}
			authority.assert();
			return {
				entries,
				total: names.length,
				unavailable,
				next_offset: offset + limit < names.length ? offset + limit : null
			};
		} finally {
			fs.closeSync(fd);
		}
	}

	restore({ root_id, trash_id }, actor, authority = internalAuthority) {
		requireValue(
			typeof trash_id === 'string' && /^[0-9a-f-]{36}$/.test(trash_id),
			'invalid_input',
			'Invalid trash item'
		);
		const root = this.root(root_id, actor, true),
			fd = fs.openSync(
				`/proc/self/fd/${root.fd}/.falcon-trash`,
				O_RDONLY | O_DIRECTORY | O_NOFOLLOW
			);
		try {
			const source = `/proc/self/fd/${fd}/${trash_id}`,
				metadata = JSON.parse(this.readBytes(source + '.json').bytes.toString('utf8'));
			return this.file(root, metadata.path, (target) => {
				requireValue(
					!fs.lstatSync(target, { throwIfNoEntry: false }),
					'already_exists',
					'Restore destination already exists'
				);
				const original = this.readBytes(source);
				requireValue(
					hash(original.bytes) === metadata.version,
					'version_conflict',
					'Trash content failed integrity check'
				);
				authority.assert();
				fs.linkSync(source, target);
				fs.unlinkSync(source);
				fs.unlinkSync(source + '.json');
				fs.fsyncSync(fd);
				return { path: metadata.path, version: metadata.version };
			});
		} finally {
			fs.closeSync(fd);
		}
	}

	mkdir({ root_id, path: relative }, actor, authority = internalAuthority) {
		const root = this.root(root_id, actor, true),
			parts = this.parts(relative),
			fd = this.parent(root, parts.slice(0, -1));
		try {
			authority.assert();
			fs.mkdirSync(`/proc/self/fd/${fd}/${parts.at(-1)}`, { mode: 0o700 });
			fs.fsyncSync(fd);
			return { created: true };
		} finally {
			fs.closeSync(fd);
		}
	}
}
