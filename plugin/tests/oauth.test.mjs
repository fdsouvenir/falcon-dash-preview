import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Integrations } from '../integrations/service.mjs';
import { HighLevelOAuth } from '../integrations/oauth.mjs';
import { adapters } from '../integrations/adapters.mjs';
test('HighLevel callback is human-bound, one-use, and stores tokens only in protected execution', async (t) => {
	const directory = mkdtempSync(tmpdir() + '/falcon-oauth-');
	let exchanges = 0,
		stored;
	const vault = {
		resolveForExecution: async (id, actor, fn) =>
			fn({
				version: 1,
				material: { client_id: 'synthetic-client', client_secret: 'SYNTHETIC-CLIENT-SECRET' }
			}),
		rotate: async (id, material) => {
			stored = material;
		}
	};
	const provider = adapters(async (url, options) => {
		exchanges++;
		assert.equal(url, 'https://services.leadconnectorhq.com/oauth/token');
		assert.equal(options.redirect, 'error');
		assert.equal(options.body.get('grant_type'), 'authorization_code');
		return {
			ok: true,
			json: async () => ({ access_token: 'SYNTHETIC-ACCESS', refresh_token: 'SYNTHETIC-REFRESH' })
		};
	});
	const service = new Integrations(directory + '/integrations.db', vault, provider);
	t.after(async () => {
		await service.close();
		rmSync(directory, { recursive: true });
	});
	service.create(
		{
			id: 'connection',
			provider: 'highlevel',
			purpose: 'Synthetic OAuth',
			owner: 'falcon',
			vault_handle: 'client',
			actors: ['human:owner']
		},
		'human:owner'
	);
	const oauth = new HighLevelOAuth(service, { redirectUris: ['http://127.0.0.1/callback'] });
	const start = await oauth.begin(
		{
			connection_id: 'connection',
			redirect_uri: 'http://127.0.0.1/callback',
			scopes: ['locations.readonly']
		},
		'human:owner'
	);
	assert.ok(!start.authorization_url.includes('SYNTHETIC-CLIENT-SECRET'));
	const state = new URL(start.authorization_url).searchParams.get('state');
	await assert.rejects(() => oauth.complete({ state, code: 'SYNTHETIC-CODE' }, 'human:other'), {
		code: 'invalid_oauth_state'
	});
	const result = await oauth.complete({ state, code: 'SYNTHETIC-CODE' }, 'human:owner');
	assert.equal(result.health, 'unavailable');
	assert.ok(!JSON.stringify(result).includes('SYNTHETIC'));
	assert.equal(stored.refresh_token, 'SYNTHETIC-REFRESH');
	await assert.rejects(() => oauth.complete({ state, code: 'SYNTHETIC-CODE' }, 'human:owner'), {
		code: 'invalid_oauth_state'
	});
	assert.equal(exchanges, 1);
	const audit = service.db.prepare('SELECT * FROM audit').all();
	assert.ok(!JSON.stringify(audit).includes('SYNTHETIC'));
});
