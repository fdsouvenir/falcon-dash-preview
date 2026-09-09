import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { Documents } from '../documents/service.mjs';
function setup(t) {
	const path = fs.mkdtempSync(tmpdir() + '/falcon-documents-');
	const service = new Documents([{ id: 'test', path, actors: ['human:test'], writable: true }]);
	t.after(() => {
		service.close();
		fs.rmSync(path, { recursive: true });
	});
	return { path, service, actor: 'human:test', input: { root_id: 'test', path: 'note.md' } };
}
test('Document edit uses versions and preserves stale input', (t) => {
	const { service, actor, input } = setup(t);
	service.write({ ...input, content: 'First version', expected_version: null }, actor);
	const first = service.read(input, actor);
	service.write({ ...input, content: 'Second version', expected_version: first.version }, actor);
	assert.throws(
		() =>
			service.write({ ...input, content: 'Stale edit', expected_version: first.version }, actor),
		{ code: 'version_conflict' }
	);
	assert.equal(service.read(input, actor).content, 'Second version');
});
test('Traversal, credential names, symlinks, hardlinks and other actors are denied', (t) => {
	const { path, service, actor, input } = setup(t);
	fs.writeFileSync(path + '/note.md', 'Synthetic public document');
	fs.symlinkSync('/tmp', path + '/escape');
	fs.linkSync(path + '/note.md', path + '/linked.md');
	for (const name of ['../note.md', '.env', 'vault.json', 'escape/file.md', 'linked.md'])
		assert.throws(() => service.read({ ...input, path: name }, actor));
	assert.throws(() => service.read(input, 'agent:other'), { code: 'access_denied' });
});
test('Malicious markup remains text, never trusted HTML', (t) => {
	const { service, actor, input } = setup(t);
	service.write(
		{ ...input, content: '<script>alert("synthetic")</script>', expected_version: null },
		actor
	);
	assert.equal(service.read(input, actor).render, 'text');
});
test('Authorized text upload/download, no-clobber rename, and targeted trash/restore', (t) => {
	const { service, actor, input } = setup(t);
	service.upload(
		{ ...input, content: 'A recoverable synthetic document', expected_version: null },
		actor
	);
	const download = service.download(input, actor);
	assert.equal(download.trust, 'untrusted-document');
	service.rename(
		{ ...input, destination: 'renamed.md', expected_version: download.version },
		actor
	);
	const renamed = { ...input, path: 'renamed.md' };
	assert.throws(() => service.trash({ ...renamed, expected_version: download.version }, actor), {
		code: 'confirmation_required'
	});
	const removed = service.trash(
		{ ...renamed, expected_version: download.version, confirmed: true },
		actor
	);
	assert.throws(() => service.read(renamed, actor));
	service.restore({ root_id: input.root_id, trash_id: removed.trash_id }, actor);
	assert.equal(service.read(renamed, actor).version, download.version);
});
test('Rename cannot overwrite another document or cross protected paths', (t) => {
	const { service, actor, input } = setup(t);
	const created = service.write({ ...input, content: 'Source', expected_version: null }, actor);
	service.write(
		{ ...input, path: 'destination.md', content: 'Preserve this', expected_version: null },
		actor
	);
	assert.throws(
		() =>
			service.rename(
				{ ...input, destination: 'destination.md', expected_version: created.version },
				actor
			),
		{ code: 'already_exists' }
	);
	assert.throws(() =>
		service.rename(
			{ ...input, destination: '../escape.md', expected_version: created.version },
			actor
		)
	);
	assert.equal(service.read({ ...input, path: 'destination.md' }, actor).content, 'Preserve this');
});
test('Credential-shaped JSON and private keys cannot be exposed under innocuous filenames', (t) => {
	const { path, service, actor, input } = setup(t);
	fs.writeFileSync(
		path + '/settings.json',
		JSON.stringify({ nested: { apiKey: 'SYNTHETIC-CREDENTIAL' } })
	);
	assert.throws(() => service.read({ ...input, path: 'settings.json' }, actor), {
		code: 'protected_content'
	});
	assert.throws(
		() =>
			service.write(
				{
					...input,
					content: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----',
					expected_version: null
				},
				actor
			),
		{ code: 'protected_content' }
	);
});
test('A registered workspace below OpenClaw state is usable, but state and credential roots are not', (t) => {
	const { path } = setup(t);
	const state = path + '/.openclaw',
		workspace = state + '/workspace';
	fs.mkdirSync(workspace, { recursive: true });
	fs.mkdirSync(state + '/credentials');
	const options = { forbiddenRoots: [state], protectedRoots: [state + '/credentials'] };
	const docs = new Documents(
		[{ id: 'workspace', path: workspace, actors: ['agent:test'], writable: true }],
		options
	);
	t.after(() => docs.close());
	docs.write(
		{
			root_id: 'workspace',
			path: 'note.md',
			content: 'Allowed workspace note',
			expected_version: null
		},
		'agent:test'
	);
	assert.equal(
		docs.read({ root_id: 'workspace', path: 'note.md' }, 'agent:test').content,
		'Allowed workspace note'
	);
	assert.throws(
		() => new Documents([{ id: 'bad', path: state, actors: ['agent:test'] }], options),
		{ code: 'unsafe_root' }
	);
	assert.throws(
		() =>
			new Documents([{ id: 'bad', path: state + '/credentials', actors: ['agent:test'] }], options),
		{ code: 'unsafe_root' }
	);
});
test('Workspace discovery is actor-scoped, listing is sorted/paged, and copy path is authorized', (t) => {
	const { service, actor, input, path } = setup(t);
	service.write({ ...input, path: 'z.md', content: 'Last', expected_version: null }, actor);
	service.write({ ...input, path: 'a.md', content: 'First', expected_version: null }, actor);
	assert.equal(service.rootsFor(actor).roots.length, 1);
	assert.deepEqual(service.rootsFor('agent:other').roots, []);
	const listing = service.list({ root_id: 'test', limit: 1 }, actor);
	assert.equal(listing.entries[0].name, 'a.md');
	assert.equal(listing.total, 2);
	assert.equal(listing.next_offset, 1);
	assert.equal(service.copyPath({ ...input, path: 'a.md' }, actor).path, path + '/a.md');
});
test('Listed documents replaced by FIFO or symlink fail promptly in a timeout-bounded child', async (t) => {
	const { spawnSync } = await import('node:child_process');
	const { path } = setup(t);
	const source = new URL('../documents/service.mjs', import.meta.url).href;
	for (const kind of ['fifo', 'symlink']) {
		const child = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {Documents} from ${JSON.stringify(source)};const root=${JSON.stringify(path)};const s=new Documents([{id:'test',path:root,actors:['human:test'],writable:true}]);const file=root+'/swap.md';fs.writeFileSync(file,'listed');s.list({root_id:'test'},'human:test');fs.unlinkSync(file);if(${JSON.stringify(kind)}==='fifo')execFileSync('mkfifo',[file]);else fs.symlinkSync('/dev/zero',file);assert.throws(()=>s.read({root_id:'test',path:'swap.md'},'human:test'));fs.unlinkSync(file);fs.writeFileSync(file,'still responsive');assert.equal(s.read({root_id:'test',path:'swap.md'},'human:test').content,'still responsive');s.close();`
			],
			{ timeout: 2000, encoding: 'utf8' }
		);
		assert.equal(child.error, undefined, `${kind} read timed out`);
		assert.equal(child.status, 0, child.stderr);
	}
});
test('Document growth after fstat cannot trigger an unbounded allocation or read', async (t) => {
	const { spawnSync } = await import('node:child_process');
	const { path } = setup(t);
	const source = new URL('../documents/service.mjs', import.meta.url).href;
	const child = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`import fs from 'node:fs';import assert from 'node:assert/strict';import {syncBuiltinESMExports} from 'node:module';import {Documents} from ${JSON.stringify(source)};const file=${JSON.stringify(path + '/growing.md')};fs.writeFileSync(file,'small');const original=fs.fstatSync;let grew=false;fs.fstatSync=(fd)=>{const stat=original(fd);if(stat.isFile()&&!grew){grew=true;fs.appendFileSync(file,'x'.repeat(1048576));}return stat;};let total=0;const read=fs.readSync;fs.readSync=(...args)=>{const n=read(...args);total+=n;return n;};syncBuiltinESMExports();const service=new Documents([]);assert.throws(()=>service.readBytes(file),{code:'unsupported_file'});assert.equal(total,262145);service.close();`
		],
		{ timeout: 2000, encoding: 'utf8' }
	);
	assert.equal(child.error, undefined);
	assert.equal(child.status, 0, child.stderr);
});

test('Durable trash can be rediscovered after UI state loss, excludes corrupt records and denies other actors', (t) => {
	const { service, actor, input, path } = setup(t);
	service.write({ ...input, content: 'Recover me', expected_version: null }, actor);
	const read = service.read(input, actor);
	const item = service.trash({ ...input, expected_version: read.version, confirmed: true }, actor);
	assert.equal(service.trash_list({ root_id: 'test' }, actor).entries[0].trash_id, item.trash_id);
	assert.throws(() => service.trash_list({ root_id: 'test' }, 'human:other'), {
		code: 'access_denied'
	});
	fs.writeFileSync(
		`${path}/.falcon-trash/00000000-0000-0000-0000-000000000000.json`,
		'{"path":"../credentials.json"}'
	);
	assert.equal(service.trash_list({ root_id: 'test' }, actor).unavailable, 1);
	service.restore({ root_id: 'test', trash_id: item.trash_id }, actor);
	assert.equal(service.read(input, actor).content, 'Recover me');
	assert.equal(service.trash_list({ root_id: 'test' }, actor).entries.length, 0);
});
