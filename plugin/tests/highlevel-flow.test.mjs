import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Vault } from '../vault/service.mjs';
import { Integrations } from '../integrations/service.mjs';
import { adapters } from '../integrations/adapters.mjs';
test('HighLevel validation and refresh share the real credential/lifecycle services without exposing tokens', async (t) => {
	const directory = mkdtempSync(tmpdir() + '/falcon-highlevel-flow-'),
		actor = 'agent:worker';
	const vault = new Vault(directory + '/vault', { owners: ['human:owner'], executors: [actor] });
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create(
		'highlevel',
		{
			client_id: 'synthetic-client',
			client_secret: 'SYNTHETIC-CLIENT-SECRET',
			access_token: 'SYNTHETIC-ACCESS-ONE',
			refresh_token: 'SYNTHETIC-REFRESH-ONE'
		},
		actor
	);
	let current = 'SYNTHETIC-ACCESS-ONE';
	const provider = adapters(async (url, options) => {
		if (url.endsWith('/oauth/token')) {
			assert.equal(options.body.get('refresh_token'), 'SYNTHETIC-REFRESH-ONE');
			current = 'SYNTHETIC-ACCESS-TWO';
			return {
				ok: true,
				json: async () => ({
					access_token: current,
					refresh_token: 'SYNTHETIC-REFRESH-TWO',
					expires_in: 3600
				})
			};
		}
		assert.equal(url, 'https://services.leadconnectorhq.com/locations/synthetic-location');
		assert.equal(options.headers.Authorization, `Bearer ${current}`);
		assert.equal(options.headers.Version, 'v3');
		return { ok: true, json: async () => ({ location: { id: 'synthetic-location' } }) };
	});
	const service = new Integrations(directory + '/integrations.db', vault, provider);
	t.after(async () => {
		await service.close();
		await vault.lock();
		rmSync(directory, { recursive: true });
	});
	service.create(
		{
			id: 'highlevel',
			provider: 'highlevel',
			purpose: 'Synthetic full service flow',
			owner: 'falcon',
			vault_handle: 'highlevel',
			account_id: 'synthetic-location',
			actors: [actor]
		},
		actor
	);
	const initial = await service.run('highlevel', 'test', actor);
	assert.equal(initial.health, 'healthy');
	assert.deepEqual(initial.validated_capabilities, ['locations.readonly']);
	await service.run('highlevel', 'refresh', actor);
	assert.equal(service.get('highlevel').health, 'unavailable');
	assert.equal(service.get('highlevel').next_action, 'test');
	await service.run('highlevel', 'test', actor);
	const metadata = service.list(actor);
	assert.equal(metadata[0].health, 'healthy');
	assert.ok(!JSON.stringify(metadata).includes('SYNTHETIC-'));
	assert.ok(
		!JSON.stringify(service.db.prepare('SELECT * FROM audit').all()).includes('SYNTHETIC-')
	);
	assert.equal(
		await vault.resolveForExecution('highlevel', actor, (record) => record.material.refresh_token),
		'SYNTHETIC-REFRESH-TWO'
	);
});
