import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault } from '../vault/service.mjs';

// The regression this file exists for: 4.0 pointed the Vault at a new private database instead of the
// operator's own, and every other Vault test builds a fresh empty database with `mkdtempSync`, so
// nothing failed. These tests start from a database that already holds ordinary KeePassXC entries.
function existingDatabase(t) {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-existing-'),
		database = path.join(directory, 'passwords.kdbx'),
		key = path.join(directory, 'vault.key');
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const cli = (args, input = '') =>
		execFileSync('keepassxc-cli', args, { input, encoding: 'utf8', timeout: 30000 });
	fs.writeFileSync(key, 'SYNTHETIC-FIXTURE-KEY-MATERIAL\n', { mode: 0o600 });
	cli(['db-create', '-q', '--set-key-file', key, database]);
	const auth = ['-q', '--no-password', '--key-file', key];
	// keepassxc-cli takes the command first and its options after it.
	const run = (command, rest, input = '') => cli([command, ...auth, ...rest], input);
	// Names a person actually uses. None of these pass the 4.0 `[a-zA-Z0-9_-]` inventory filter.
	run('add', ['-p', '-u', 'fred@example.invalid', '--url', 'https://kenpom.com', database, 'KenPom Password'], 'SYNTHETIC-KENPOM\n'); // prettier-ignore
	run('add', ['-p', database, 'Anthem Blue Cross'], 'SYNTHETIC-ANTHEM\n');
	run('mkdir', [database, 'Work']);
	run('add', ['-p', '--notes', 'rotate yearly', database, 'Work/GitHub Verlbot CLI'], 'SYNTHETIC-GH\n'); // prettier-ignore
	return { directory, database, key, run };
}
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('An existing KeePassXC database is adopted and listed without being rewritten', async (t) => {
	const { directory, database, key } = existingDatabase(t);
	const before = digest(database);
	const vault = new Vault(path.join(directory, 'private'), {
		owners: [],
		executors: [],
		database,
		key
	});
	assert.deepEqual(await vault.ready(), { initialized: true, locked: false });
	// Adoption records policy beside the database; it must not touch one credential byte.
	assert.equal(digest(database), before);
	assert.ok(fs.existsSync(path.join(directory, 'private', 'policy.json')));

	const root = await vault.inventory('human:owner');
	const ids = root.entries.map((e) => e.id).sort();
	assert.deepEqual(ids, ['Anthem Blue Cross', 'KenPom Password', 'Work']);
	assert.equal(root.entries.find((e) => e.id === 'Work').kind, 'group');

	const group = await vault.inventory('human:owner', 'Work');
	assert.deepEqual(
		group.entries.map((e) => e.id),
		['Work/GitHub Verlbot CLI']
	);
	await vault.lock();
});

test('Plain entries expose their real KeePassXC fields to a human reader', async (t) => {
	const { directory, database, key } = existingDatabase(t);
	const vault = new Vault(path.join(directory, 'private'), { database, key });
	await vault.ready();
	assert.equal(
		await vault.revealField('KenPom Password', 'password', 'human:owner'),
		'SYNTHETIC-KENPOM'
	);
	assert.equal(
		await vault.revealField('KenPom Password', 'username', 'human:owner'),
		'fred@example.invalid'
	);
	assert.equal(
		await vault.revealField('KenPom Password', 'url', 'human:owner'),
		'https://kenpom.com'
	);
	assert.equal(
		await vault.revealField('Work/GitHub Verlbot CLI', 'notes', 'human:owner'),
		'rotate yearly'
	);
	await vault.lock();
});

test('Entries a person creates or edits stay plain so the SecretRef resolver keeps reading them', async (t) => {
	const { directory, database, key, run } = existingDatabase(t);
	const vault = new Vault(path.join(directory, 'private'), { database, key });
	await vault.ready();

	await vault.createEntry(
		'Streaming Service',
		{ password: 'SYNTHETIC-NEW', username: 'someone@example.invalid' },
		'human:owner'
	);
	// Read straight from KeePassXC: a plain secret, not a JSON envelope. This is the exact contract
	// bin/keepassxc-secret-resolver.cjs depends on.
	const stored = run('show', ['-s', '-a', 'Password', database, 'Streaming Service']).trim();
	assert.equal(stored, 'SYNTHETIC-NEW');
	assert.equal(
		run('show', ['-s', '-a', 'UserName', database, 'Streaming Service']).trim(),
		'someone@example.invalid'
	);

	await vault.updateEntry('Streaming Service', { password: 'SYNTHETIC-ROTATED' }, 1, 'human:owner');
	assert.equal(
		run('show', ['-s', '-a', 'Password', database, 'Streaming Service']).trim(),
		'SYNTHETIC-ROTATED'
	);
	// Editing the secret must not discard the other fields a person filled in.
	assert.equal(
		run('show', ['-s', '-a', 'UserName', database, 'Streaming Service']).trim(),
		'someone@example.invalid'
	);

	// An existing plain entry is never converted, whatever an agent-shaped request asks for.
	await vault.updateEntry(
		'Anthem Blue Cross',
		{ password: 'SYNTHETIC-ANTHEM-2' },
		1,
		'human:owner'
	);
	assert.equal(
		run('show', ['-s', '-a', 'Password', database, 'Anthem Blue Cross']).trim(),
		'SYNTHETIC-ANTHEM-2'
	);
	await vault.lock();
});

test('Agent credentials keep the versioned envelope alongside a persons plain entries', async (t) => {
	const { directory, database, key, run } = existingDatabase(t);
	const vault = new Vault(path.join(directory, 'private'), {
		executors: ['agent:worker'],
		database,
		key
	});
	await vault.ready();
	await vault.create('agent-managed', { access_token: 'SYNTHETIC-TOKEN' }, 'agent:worker');
	const stored = run('show', ['-s', '-a', 'Password', database, 'agent-managed']).trim();
	assert.equal(JSON.parse(stored).material.access_token, 'SYNTHETIC-TOKEN');
	assert.equal(JSON.parse(stored).version, 1);
	// Versioned rotation still applies to envelope entries.
	await vault.rotate('agent-managed', { access_token: 'SYNTHETIC-TOKEN-2' }, 1, 'agent:worker');
	assert.equal(
		await vault.revealField('agent-managed', 'access_token', 'human:owner'),
		'SYNTHETIC-TOKEN-2'
	);
	// And the person's own entries are untouched next to it.
	assert.equal(
		await vault.revealField('Anthem Blue Cross', 'password', 'human:owner'),
		'SYNTHETIC-ANTHEM'
	);
	await vault.lock();
});

test('An emptied group reports no entries rather than the CLI placeholder', async (t) => {
	const { directory, database, key } = existingDatabase(t);
	const vault = new Vault(path.join(directory, 'private'), {
		owners: ['human:owner'],
		database,
		key
	});
	await vault.ready();
	await vault.createGroup('Archive', 'human:owner');
	// `keepassxc-cli ls` prints "[empty]" for a childless group. Listing it as an entry makes an
	// empty group look occupied, so its removal control never appears.
	assert.deepEqual((await vault.inventory('human:owner', 'Archive')).entries, []);
	await vault.lock();
});

test('Relocating a plain entry keeps it plain so its SecretRefs keep resolving', async (t) => {
	const { directory, database, key, run } = existingDatabase(t);
	const vault = new Vault(path.join(directory, 'private'), {
		owners: ['human:owner'],
		database,
		key
	});
	await vault.ready();
	await vault.createGroup('Archive', 'human:owner');
	const before = await vault.metadata('KenPom Password', 'human:owner');
	assert.equal(before.plain, true);
	await vault.worker({
		action: 'relocate',
		id: 'KenPom Password',
		destination: 'Archive/KenPom Password',
		expected_version: before.version,
		actor: 'human:owner',
		confirmed: true,
		generation: vault.policyGeneration
	});
	// Straight from KeePassXC: still a plain secret, with its other fields carried across.
	assert.equal(
		run('show', ['-s', '-a', 'Password', database, 'Archive/KenPom Password']).trim(),
		'SYNTHETIC-KENPOM'
	);
	assert.equal(
		run('show', ['-s', '-a', 'UserName', database, 'Archive/KenPom Password']).trim(),
		'fred@example.invalid'
	);
	assert.equal((await vault.metadata('Archive/KenPom Password', 'human:owner')).plain, true);
	await vault.lock();
});

test('The whole tree is listed in one call so the UI can search without walking groups', async (t) => {
	const { directory, database, key, run } = existingDatabase(t);
	// A second level, so the flat listing has to carry a nested path rather than a bare name.
	run('mkdir', [database, 'Work/APIs']);
	run('add', ['-p', database, 'Work/APIs/Stitch MCP'], 'SYNTHETIC-STITCH\n');
	const vault = new Vault(path.join(directory, 'private'), {
		owners: [],
		executors: [],
		database,
		key
	});
	await vault.ready();

	const all = await vault.inventoryAll('human:owner');
	const entries = all.entries
		.filter((e) => e.kind === 'entry')
		.map((e) => e.id)
		.sort();
	// Every entry at every depth, addressed by its full handle — not just the current group.
	assert.deepEqual(entries, [
		'Anthem Blue Cross',
		'KenPom Password',
		'Work/APIs/Stitch MCP',
		'Work/GitHub Verlbot CLI'
	]);
	const groups = all.entries
		.filter((e) => e.kind === 'group')
		.map((e) => e.id)
		.sort();
	// Groups come back without the trailing slash keepassxc-cli prints, so a group id is a handle.
	assert.deepEqual(groups, ['Work', 'Work/APIs']);

	// One flat call must agree with walking the tree group by group.
	const walked = [
		...(await vault.inventory('human:owner')).entries,
		...(await vault.inventory('human:owner', 'Work')).entries,
		...(await vault.inventory('human:owner', 'Work/APIs')).entries
	]
		.filter((e) => e.kind === 'entry')
		.map((e) => e.id)
		.sort();
	assert.deepEqual(entries, walked);
	await vault.lock();
});

test('An emptied group is not reported as holding a placeholder entry', async (t) => {
	const { directory, database, key } = existingDatabase(t);
	const vault = new Vault(path.join(directory, 'private'), {
		owners: [],
		executors: [],
		database,
		key
	});
	await vault.ready();
	const before = await vault.metadata('Work/GitHub Verlbot CLI', 'human:owner');
	await vault.worker({
		action: 'remove_entry',
		id: 'Work/GitHub Verlbot CLI',
		expected_version: before.version,
		actor: 'human:owner',
		confirmed: true,
		generation: vault.policyGeneration
	});
	// The recursive listing prints the childless-group placeholder as `Work/[empty]`, not as a bare
	// `[empty]`. Reporting it as an entry makes an emptied group look occupied, so its removal
	// control never appears and the list offers a row whose metadata call can only fail.
	const all = await vault.inventoryAll('human:owner');
	const remaining = all.entries.filter((e) => e.kind === 'entry').map((e) => e.id);
	assert.ok(
		!remaining.some((id) => id.endsWith('[empty]')),
		`placeholder leaked into the listing: ${remaining.join(', ')}`
	);
	assert.deepEqual(
		remaining.filter((id) => id.startsWith('Work/')),
		[]
	);
	// The group itself is still listed, so it can be selected and removed.
	assert.ok(all.entries.some((e) => e.kind === 'group' && e.id === 'Work'));
	await vault.lock();
});
