import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../vault/service.mjs';
import { protectedVault } from '../vault/native.mjs';
const client = () => ({
	connId: 'fixture-owner',
	connect: { scopes: ['operator.read', 'operator.write'] },
	internal: { operatorRoleActor: { kind: 'operator', profileId: 'owner' } }
});
test('Protected native path denies profileless and synthetic callers before worker activity', async () => {
	let calls = 0;
	const vault = {
		owners: new Set(['human:owner']),
		inventory() {
			calls++;
		}
	};
	for (const c of [{}, { ...client(), internal: { ...client().internal, syntheticClient: true } }])
		await assert.rejects(protectedVault(vault, { action: 'inventory', input: {} }, c, () => {}));
	assert.equal(calls, 0);
});
// Provisioning and unlocking belong to plugin startup. Reaching them from a client surface would
// hand an operator a step they cannot meaningfully perform, so the actions do not exist here.
test('Protected native path exposes no Vault lifecycle actions', async () => {
	let calls = 0;
	const vault = {
		owners: new Set(['human:owner']),
		initialize: () => calls++,
		unlock: () => calls++,
		lock: () => calls++
	};
	for (const action of ['initialize', 'unlock', 'lock'])
		await assert.rejects(
			protectedVault(vault, { action, input: {} }, client(), () => {}),
			{
				code: 'invalid_input'
			}
		);
	assert.equal(calls, 0);
});
test('Protected entry and owner reveal/copy cover human and agent-created entries without inventory disclosure', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-native-vault-')),
		vault = new Vault(dir, { owners: ['human:owner'], executors: ['agent:worker'] });
	t.after(async () => {
		await vault.lock();
		fs.rmSync(dir, { recursive: true });
	});
	const c = client(),
		run = (action, input = {}) => protectedVault(vault, { action, input }, c, () => {});
	await vault.ready();
	await run('create', { id: 'human', material: { api_key: 'SYNTHETIC-HUMAN-CANARY' } });
	await vault.create('agent', { api_key: 'SYNTHETIC-AGENT-CANARY' }, 'agent:worker');
	for (const id of ['human', 'agent']) {
		const expected = `SYNTHETIC-${id.toUpperCase()}-CANARY`;
		assert.equal((await run('reveal', { id, field: 'api_key' })).value, expected);
		assert.equal((await run('copy', { id, field: 'api_key' })).value, expected);
		assert.ok(!JSON.stringify(await vault.metadata(id, 'human:owner')).includes(expected));
	}
	assert.ok(!JSON.stringify(await vault.inventory('human:owner')).includes('CANARY'));
	const metadata = await vault.metadata('human', 'human:owner');
	await run('rotate', {
		id: 'human',
		expected_version: metadata.version,
		material: { password: 'SYNTHETIC-SECOND-FIELD' }
	});
	assert.equal(
		(await run('reveal', { id: 'human', field: 'api_key' })).value,
		'SYNTHETIC-HUMAN-CANARY'
	);
	assert.equal(
		(await run('reveal', { id: 'human', field: 'password' })).value,
		'SYNTHETIC-SECOND-FIELD'
	);
	await vault.lock();
	await assert.rejects(run('reveal', { id: 'agent', field: 'api_key' }), { code: 'vault_locked' });
});
test('Original native owner authority survives asynchronous management preparation', async () => {
	const c = client();
	let resume;
	const gate = new Promise((r) => (resume = r));
	let writes = 0;
	const vault = {
		owners: new Set(['human:owner']),
		async create(_id, _material, _actor, authority) {
			await gate;
			authority.assert();
			writes++;
		}
	};
	const result = protectedVault(
		vault,
		{ action: 'create', input: { id: 'one', material: { api_key: 'SYNTHETIC' } } },
		c,
		() => {}
	);
	c.invalidated = true;
	resume();
	await assert.rejects(result, { code: 'authority_changed' });
	assert.equal(writes, 0);
});
test('Protected selected-value return is discarded after connection revocation', async () => {
	const c = client(),
		vault = {
			owners: new Set(['human:owner']),
			async revealField() {
				c.invalidated = true;
				return 'SYNTHETIC';
			}
		};
	await assert.rejects(
		protectedVault(
			vault,
			{ action: 'reveal', input: { id: 'one', field: 'api_key' } },
			c,
			() => {}
		),
		{ code: 'authority_changed' }
	);
});

test('Owner credential relocation and removal fence old handles and retain private recovery snapshots', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-manage-vault-')),
		vault = new Vault(dir, { owners: ['human:owner'], executors: ['agent:worker'] });
	t.after(async () => {
		await vault.lock();
		fs.rmSync(dir, { recursive: true });
	});
	const c = client(),
		run = (action, input = {}) => protectedVault(vault, { action, input }, c, () => {});
	await vault.ready();
	await run('group', { id: 'team' });
	await run('create', { id: 'first', material: { api_key: 'SYNTHETIC-MOVABLE' } });
	await run('create', { id: 'occupied', material: { api_key: 'SYNTHETIC-OTHER' } });
	await assert.rejects(
		run('relocate', { id: 'first', destination: 'occupied', expected_version: 1, confirmed: true })
	);
	const moved = await run('relocate', {
		id: 'first',
		destination: 'team/renamed',
		expected_version: 1,
		confirmed: true
	});
	assert.ok(moved.recovery_id);
	await assert.rejects(run('reveal', { id: 'first', field: 'api_key' }));
	assert.equal(
		(await run('reveal', { id: 'team/renamed', field: 'api_key' })).value,
		'SYNTHETIC-MOVABLE'
	);
	await assert.rejects(run('group_remove', { id: 'team', confirmed: true }));
	await run('remove_entry', {
		id: 'team/renamed',
		expected_version: moved.version,
		confirmed: true
	});
	await assert.rejects(run('reveal', { id: 'team/renamed', field: 'api_key' }));
	await run('group_remove', { id: 'team', confirmed: true });
	const snapshots = await run('recovery_list');
	assert.ok(snapshots.snapshots.length >= 3);
	assert.equal(JSON.stringify(snapshots).includes('SYNTHETIC-MOVABLE'), false);
});
