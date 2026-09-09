import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Vault } from '../vault/service.mjs';
async function resolve(directory, ids) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL('../vault/resolve-secrets.mjs', import.meta.url))],
			{
				env: { PATH: process.env.PATH, FALCON_VAULT_DIRECTORY: directory },
				stdio: ['pipe', 'pipe', 'pipe']
			}
		);
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.resume();
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, result: JSON.parse(output) }));
		child.stdin.end(JSON.stringify({ protocolVersion: 1, provider: 'falcon-vault', ids }));
	});
}
test('Real resolver returns only exact owner-granted IDs and honors durable lock across processes', async (t) => {
	const directory = mkdtempSync(tmpdir() + '/falcon-secretref-');
	t.after(() => rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: ['human:owner'], executors: ['agent:worker'] });
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create(
		'sample',
		{ password: 'SYNTHETIC-PIPE-CANARY', api_key: 'SYNTHETIC-DENIED-CANARY' },
		'agent:worker'
	);
	await vault.grantSecretRefs(['entries/sample/password'], 'human:owner');
	const out = await resolve(directory, ['entries/sample/password', 'entries/sample/api-key']);
	assert.equal(out.result.values['entries/sample/password'], 'SYNTHETIC-PIPE-CANARY');
	assert.equal(out.result.values['entries/sample/api-key'], undefined);
	assert.equal(out.result.errors['entries/sample/api-key'].code, 'NOT_FOUND');
	await vault.lock();
	const locked = await resolve(directory, ['entries/sample/password']);
	assert.equal(locked.code, 1);
	assert.deepEqual(locked.result.values, {});
});
test('Old instance cannot mutate after a second instance locks and unlocks the shared Vault', async (t) => {
	const directory = mkdtempSync(tmpdir() + '/falcon-vault-epoch-');
	t.after(() => rmSync(directory, { recursive: true }));
	const options = { owners: ['human:owner'] };
	const first = new Vault(directory, options);
	await first.initialize('human:owner');
	await first.unlock('human:owner');
	await first.create('sample', { password: 'SYNTHETIC-INITIAL' }, 'human:owner');
	const second = new Vault(directory, options);
	await second.lock();
	await second.unlock('human:owner');
	await assert.rejects(
		() => first.rotate('sample', { password: 'SYNTHETIC-STALE' }, 1, 'human:owner'),
		{ code: 'authority_changed' }
	);
	assert.equal((await second.reveal('sample', 'human:owner')).password, 'SYNTHETIC-INITIAL');
	await second.lock();
});
