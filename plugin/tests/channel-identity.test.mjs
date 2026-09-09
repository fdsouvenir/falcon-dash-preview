import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production is generated from a preview tag rather than merged, so it has no source of its own and
// cannot drift. That guarantee rests entirely on the rewrite being exact and reversible: a lossy
// round trip would silently bake a difference into production that no one chose. See docs/RELEASE.md.
const repo = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const IDENTITY_FILES = [
	'package.json',
	'package-lock.json',
	'openclaw.plugin.json',
	'plugin/index.mjs',
	'plugin/work/feature-contract.mjs',
	'README.md'
];

function checkout(t) {
	const dir = fs.mkdtempSync(path.join(tmpdir(), 'falcon-channel-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.mkdirSync(path.join(dir, 'plugin/work'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
	for (const file of [...IDENTITY_FILES, 'scripts/apply-channel-identity.mjs'])
		fs.copyFileSync(path.join(repo, file), path.join(dir, file));
	return dir;
}
const apply = (dir, channel, ...flags) =>
	execFileSync(process.execPath, ['scripts/apply-channel-identity.mjs', channel, ...flags], {
		cwd: dir,
		encoding: 'utf8'
	});
const snapshot = (dir) =>
	Object.fromEntries(IDENTITY_FILES.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

test('Rewriting to the other channel and back reproduces the tree exactly', async (t) => {
	const dir = checkout(t);
	const before = snapshot(dir);
	// Works from either channel, because both repositories run this suite.
	const here = JSON.parse(before['package.json']).name.endsWith('-preview')
		? 'preview'
		: 'production';
	const other = here === 'preview' ? 'production' : 'preview';
	apply(dir, other);
	assert.notDeepEqual(snapshot(dir), before, `the ${other} rewrite changed nothing`);
	apply(dir, here);
	// Byte-for-byte. Anything less means promotion introduces a difference nobody chose.
	assert.deepEqual(snapshot(dir), before);
});

test('The preview channel carries its own package, id, data directory and banner', async (t) => {
	const dir = checkout(t);
	apply(dir, 'preview');
	const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
	const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'openclaw.plugin.json'), 'utf8'));
	const entry = fs.readFileSync(path.join(dir, 'plugin/index.mjs'), 'utf8');
	const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');

	assert.equal(pkg.name, '@fdsouvenir/falcon-dash-preview');
	assert.match(pkg.repository.url, /falcon-dash-preview\.git$/);
	// The lockfile records the name twice; verify-release-metadata rejects a mismatch.
	const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
	assert.equal(lock.name, '@fdsouvenir/falcon-dash-preview');
	assert.equal(lock.packages[''].name, '@fdsouvenir/falcon-dash-preview');
	assert.equal(manifest.id, 'falcon-dash-preview');
	assert.equal(manifest.name, 'Falcon Dash Preview');
	assert.match(manifest.icon, /\/falcon-dash-preview\/main\//);
	assert.match(entry, /id: 'falcon-dash-preview'/);
	// The data directory is a literal rather than derived from the plugin id, so it has to be
	// rewritten too. Two channels on one gateway would otherwise share a Work store.
	assert.match(entry, /ctx\.stateDir, 'falcon-dash-preview'/);
	assert.doesNotMatch(entry, /ctx\.stateDir, 'falcon-dash'\)/);
	// The feature-events service id derives from the contract's plugin id.
	const contract = fs.readFileSync(path.join(dir, 'plugin/work/feature-contract.mjs'), 'utf8');
	assert.match(contract, /pluginId: 'falcon-dash-preview'/);
	assert.match(readme, /This is the preview channel/);
	assert.match(readme, /clawhub:@fdsouvenir\/falcon-dash-preview/);
});

test('Applying the same channel twice is a no-op, and --check never writes', async (t) => {
	const dir = checkout(t);
	apply(dir, 'preview');
	const once = snapshot(dir);
	apply(dir, 'preview');
	assert.deepEqual(snapshot(dir), once, 'the rewrite is not idempotent');

	// --check reports a mismatch by exit code without touching the tree.
	let failed = false;
	try {
		apply(dir, 'production', '--check');
	} catch (error) {
		failed = true;
		assert.equal(error.status, 1);
	}
	assert.ok(failed, '--check passed on the wrong channel');
	assert.deepEqual(snapshot(dir), once, '--check modified files');
	apply(dir, 'preview', '--check');
});

test('This checkout matches its own channel', () => {
	// A checkout that has drifted toward the other channel would pass that drift into every later
	// release. The channel is read from the package name rather than assumed.
	const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
	const channel = pkg.name.endsWith('-preview') ? 'preview' : 'production';
	execFileSync(process.execPath, ['scripts/apply-channel-identity.mjs', channel, '--check'], {
		cwd: repo,
		encoding: 'utf8'
	});
});
