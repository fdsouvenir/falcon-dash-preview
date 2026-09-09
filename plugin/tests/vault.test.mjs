import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { Vault } from '../vault/service.mjs';
test('Real KeePassXC synthetic credentials: protected inventory, human access, pair rotation and conflict', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-vault-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: ['human:owner'], executors: ['agent:worker'] });
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('operator-added', { password: 'SYNTHETIC-OPERATOR-CANARY' }, 'human:owner');
	await vault.create(
		'agent-added',
		{ access_token: 'SYNTHETIC-ACCESS-1', refresh_token: 'SYNTHETIC-REFRESH-1' },
		'agent:worker'
	);
	const inventory = await vault.inventory('agent:worker');
	assert.ok(!JSON.stringify(inventory).includes('SYNTHETIC'));
	assert.equal(
		(await vault.reveal('operator-added', 'human:owner')).password,
		'SYNTHETIC-OPERATOR-CANARY'
	);
	assert.equal(
		(await vault.reveal('agent-added', 'human:owner')).access_token,
		'SYNTHETIC-ACCESS-1'
	);
	await assert.rejects(() => vault.reveal('agent-added', 'agent:worker'), {
		code: 'access_denied'
	});
	const results = await Promise.allSettled([
		vault.rotate(
			'agent-added',
			{ access_token: 'SYNTHETIC-ACCESS-2', refresh_token: 'SYNTHETIC-REFRESH-2' },
			1,
			'agent:worker'
		),
		vault.rotate('agent-added', { access_token: 'SYNTHETIC-ACCESS-3' }, 1, 'agent:worker')
	]);
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
	await vault.resolveForExecution('agent-added', 'agent:worker', (record) => {
		assert.equal(record.version, 2);
		assert.ok(record.material.refresh_token);
	});
	await vault.lock();
	await assert.rejects(() => vault.reveal('agent-added', 'human:owner'), { code: 'vault_locked' });
});
test('Groups and nested credential handles use the real encrypted database without value-bearing inventory', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-groups-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: ['human:owner'], executors: ['agent:worker'] });
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.createGroup('services', 'human:owner');
	await vault.create('services/client', { password: 'SYNTHETIC-GROUP-CANARY' }, 'agent:worker');
	const root = await vault.inventory('human:owner');
	assert.deepEqual(root.entries, [{ id: 'services', kind: 'group' }]);
	const group = await vault.inventory('human:owner', 'services');
	assert.deepEqual(group.entries, [{ id: 'services/client', kind: 'entry' }]);
	assert.equal(
		(await vault.reveal('services/client', 'human:owner')).password,
		'SYNTHETIC-GROUP-CANARY'
	);
	await assert.rejects(() => vault.createGroup('../outside', 'human:owner'), {
		code: 'invalid_handle'
	});
	await vault.lock();
});
test('Disabling entry execution denies agents while the human owner can still reveal and restore', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-entry-policy-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: ['human:owner'], executors: ['agent:worker'] });
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('sample', { password: 'SYNTHETIC-OWNED-VALUE' }, 'agent:worker');
	await vault.revokeEntryExecution('sample', 1, 'human:owner');
	await assert.rejects(() => vault.resolveForExecution('sample', 'agent:worker', (x) => x), {
		code: 'access_denied'
	});
	assert.equal((await vault.reveal('sample', 'human:owner')).password, 'SYNTHETIC-OWNED-VALUE');
	assert.equal((await vault.metadata('sample', 'agent:worker')).execution_disabled, true);
	await vault.restoreEntryExecution('sample', 2, 'human:owner');
	assert.equal(await vault.resolveForExecution('sample', 'agent:worker', (x) => x.version), 3);
	await vault.lock();
});
test('Human reveal/copy returns only the selected field and access audit excludes values even while locked', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-vault-audit-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: ['human:owner'], executors: ['agent:worker'] });
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create(
		'sample',
		{ password: 'SYNTHETIC-SELECTED-CANARY', api_key: 'SYNTHETIC-OTHER-CANARY' },
		'agent:worker'
	);
	assert.equal(
		await vault.revealField('sample', 'password', 'human:owner'),
		'SYNTHETIC-SELECTED-CANARY'
	);
	assert.equal(await vault.copyField('sample', 'api_key', 'human:owner'), 'SYNTHETIC-OTHER-CANARY');
	await vault.lock('human:owner');
	const history = await vault.audit('human:owner', { limit: 100 });
	assert.ok(history.entries.some((x) => x.action === 'human_reveal' && x.entry_id === 'sample'));
	assert.ok(history.entries.some((x) => x.action === 'human_copy' && x.entry_id === 'sample'));
	assert.ok(!JSON.stringify(history).includes('SYNTHETIC-'));
	await assert.rejects(() => vault.audit('agent:worker'), { code: 'access_denied' });
});
test('Global Vault eligibility does not grant another agent access to a credential entry', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-entry-grants-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, {
		owners: ['human:owner'],
		executors: ['agent:one', 'agent:two']
	});
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('sample', { password: 'SYNTHETIC-SCOPED' }, 'agent:one');
	await assert.rejects(() => vault.resolveForExecution('sample', 'agent:two', (x) => x), {
		code: 'access_denied'
	});
	await vault.grantEntryExecutors('sample', 1, ['agent:two'], 'human:owner');
	assert.equal(await vault.resolveForExecution('sample', 'agent:two', (x) => x.version), 2);
	await assert.rejects(() => vault.resolveForExecution('sample', 'agent:one', (x) => x), {
		code: 'access_denied'
	});
	assert.equal(await vault.revealField('sample', 'password', 'human:owner'), 'SYNTHETIC-SCOPED');
	await vault.lock();
});

test('An unprovisioned Vault reports that it is not set up instead of failing as unavailable storage', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-unprovisioned-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: ['human:owner'], executors: [] });
	assert.equal(vault.initialized, false);
	// The operator-visible failure was an opaque vault_unavailable, which reads as broken storage.
	await assert.rejects(() => vault.unlock('human:owner'), { code: 'not_initialized' });
	await assert.rejects(() => vault.audit('human:owner'), { code: 'not_initialized' });
	assert.deepEqual(await vault.lock(), { locked: true });
	await vault.initialize('human:owner');
	assert.equal(vault.initialized, true);
	await vault.unlock('human:owner');
	assert.equal(vault.locked, false);
	await assert.rejects(() => vault.initialize('human:owner'), { code: 'already_initialized' });
	await vault.lock();
});

test('Startup brings a fresh Vault up ready to use and repeats without effect', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-ready-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const vault = new Vault(directory, { owners: [], executors: [] });
	assert.equal(vault.initialized, false);
	assert.deepEqual(await vault.ready(), { initialized: true, locked: false });
	await vault.create('startup', { password: 'SYNTHETIC-READY-CANARY' }, 'human:anyone');
	// A restart re-enters ready() against an existing database; it must not fail as already_initialized.
	assert.deepEqual(await vault.ready(), { initialized: true, locked: false });
	assert.equal(
		await vault.revealField('startup', 'password', 'human:anyone'),
		'SYNTHETIC-READY-CANARY'
	);
	await vault.lock();
});

test('Reaching the Gateway is the human credential and configured executors reconcile on start', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-actors-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	// A fresh install leaves vaultOwners empty; the operator must not meet a dead Vault page.
	const vault = new Vault(directory, { owners: [], executors: [] });
	await vault.ready();
	await vault.create('shared', { api_key: 'SYNTHETIC-GATEWAY-CANARY' }, 'human:unlisted');
	assert.equal(
		await vault.revealField('shared', 'api_key', 'human:unlisted'),
		'SYNTHETIC-GATEWAY-CANARY'
	);
	// Agents hold no session, so they stay gated on configuration.
	await assert.rejects(() => vault.inventory('agent:worker'), { code: 'access_denied' });
	await vault.lock();

	// Adding the executor to config must take effect on the next start, not require a recovery.
	const reconfigured = new Vault(directory, { owners: [], executors: ['agent:worker'] });
	await reconfigured.ready();
	assert.ok(!JSON.stringify(await reconfigured.inventory('agent:worker')).includes('SYNTHETIC'));
	assert.deepEqual(JSON.parse(fs.readFileSync(directory + '/policy.json', 'utf8')).executors, [
		'agent:worker'
	]);
	await reconfigured.lock();
});
