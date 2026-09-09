import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Integrations } from '../integrations/service.mjs';
import { adapters } from '../integrations/adapters.mjs';
test('Provider fixtures retain omitted refresh tokens and disallow redirects', async () => {
	let options;
	const adapter = adapters(async (url, opts) => {
		options = opts;
		assert.equal(url, 'https://services.leadconnectorhq.com/oauth/token');
		return { ok: true, json: async () => ({ access_token: 'SYNTHETIC-NEXT', expires_in: 3600 }) };
	});
	const out = await adapter.highlevel.refresh({
		client_id: 'synthetic',
		client_secret: 'SYNTHETIC-SECRET',
		refresh_token: 'SYNTHETIC-REFRESH'
	});
	assert.deepEqual(out.material, { access_token: 'SYNTHETIC-NEXT' });
	assert.equal(options.redirect, 'error');
});
test('Refresh concurrency, restart ambiguity, and native owner separation', async (t) => {
	const dir = mkdtempSync(tmpdir() + '/falcon-integrations-');
	t.after(() => rmSync(dir, { recursive: true }));
	let release;
	const wait = new Promise((r) => (release = r));
	let calls = 0;
	const vault = {
		resolveForExecution: async (id, actor, fn) => fn({ version: 1, material: {} }),
		rotate: async () => {}
	};
	const service = new Integrations(dir + '/integrations.db', vault, {
		fixture: {
			refresh: async () => {
				calls++;
				await wait;
				return { material: { access_token: 'SYNTHETIC' } };
			}
		}
	});
	t.after(() => service.close());
	service.create(
		{
			id: 'test',
			provider: 'fixture',
			purpose: 'Synthetic contract test',
			owner: 'falcon',
			vault_handle: 'test',
			actors: ['agent:test']
		},
		'agent:test'
	);
	const running = service.run('test', 'refresh', 'agent:test');
	await assert.rejects(() => service.run('test', 'refresh', 'agent:test'), {
		code: 'maintenance_busy'
	});
	release();
	await running;
	assert.equal(calls, 1);
	const c = service.get('test');
	c.phase = 'refreshing';
	c.operation_pid = 2147483647;
	c.operation_start = 'dead-process';
	service.save(c);
	service.recover();
	assert.equal(service.get('test').health, 'reauthorization_required');
	await assert.rejects(() => service.run('test', 'refresh', 'agent:test'), {
		code: 'reauthorization_required'
	});
	assert.equal(calls, 1, 'uncertain refresh must not replay the previous credential');
	service.adapters.fixture.test = async () => ({ health: 'healthy' });
	await service.run('test', 'test', 'agent:test');
	await assert.rejects(() => service.run('test', 'refresh', 'agent:test'), {
		code: 'reauthorization_required'
	});
	assert.equal(calls, 1, 'access validation cannot clear uncertain refresh lineage');
	service.create(
		{
			id: 'native',
			provider: 'fixture',
			purpose: 'Native owner test',
			owner: 'native',
			actors: ['agent:test']
		},
		'agent:test'
	);
	await assert.rejects(() => service.run('native', 'refresh', 'agent:test'), {
		code: 'native_owner'
	});
});
test('A disconnect during refresh cannot rotate credentials or resurrect the connection', async (t) => {
	const dir = mkdtempSync(tmpdir() + '/falcon-disconnect-');
	let release, started;
	const barrier = new Promise((r) => (release = r)),
		ready = new Promise((r) => (started = r));
	let rotations = 0;
	const vault = {
		resolveForExecution: async (id, actor, fn) => fn({ version: 1, material: {} }),
		rotate: async () => {
			rotations++;
		}
	};
	const service = new Integrations(dir + '/integrations.db', vault, {
		fixture: {
			refresh: async () => {
				started();
				await barrier;
				return { material: { access_token: 'SYNTHETIC-NEW' } };
			}
		}
	});
	t.after(async () => {
		await service.close();
		rmSync(dir, { recursive: true });
	});
	service.create(
		{
			id: 'race',
			provider: 'fixture',
			purpose: 'Disconnect race',
			owner: 'falcon',
			vault_handle: 'race',
			actors: ['agent:test']
		},
		'agent:test'
	);
	const refresh = service.run('race', 'refresh', 'agent:test');
	await ready;
	await service.run('race', 'disconnect', 'agent:test');
	release();
	await assert.rejects(() => refresh, { code: 'authority_changed' });
	assert.equal(rotations, 0);
	assert.equal(service.get('race').disconnected, true);
	assert.equal(service.get('race').paused, true);
});
test('Another service does not recover an operation whose owning process is alive', async (t) => {
	const dir = mkdtempSync(tmpdir() + '/falcon-active-lease-');
	let release, started;
	const barrier = new Promise((r) => (release = r)),
		ready = new Promise((r) => (started = r));
	const vault = {
		resolveForExecution: async (id, actor, fn) => fn({ version: 1, material: {} }),
		rotate: async () => {}
	};
	const adapters = {
		fixture: {
			refresh: async () => {
				started();
				await barrier;
				return { material: { access_token: 'SYNTHETIC' } };
			}
		}
	};
	const one = new Integrations(dir + '/integrations.db', vault, adapters),
		two = new Integrations(dir + '/integrations.db', vault, adapters);
	t.after(async () => {
		await one.close();
		await two.close();
		rmSync(dir, { recursive: true });
	});
	one.create(
		{
			id: 'active',
			provider: 'fixture',
			purpose: 'Live lease',
			owner: 'falcon',
			vault_handle: 'active',
			actors: ['agent:test']
		},
		'agent:test'
	);
	const refresh = one.run('active', 'refresh', 'agent:test');
	await ready;
	two.recover();
	assert.equal(two.get('active').phase, 'refreshing');
	release();
	await refresh;
});
test('Oversized provider replies are rejected without returning provider content', async () => {
	const adapter = adapters(async () => new Response('X'.repeat(262145)));
	await assert.rejects(
		() =>
			adapter.highlevel.refresh({
				client_id: 'synthetic',
				client_secret: 'SYNTHETIC',
				refresh_token: 'SYNTHETIC'
			}),
		{ code: 'provider_response_invalid' }
	);
});
test('HighLevel readiness validates the documented API version and exact configured sub-account', async () => {
	let version;
	const good = adapters(async (url, options) => {
		assert.equal(url, 'https://services.leadconnectorhq.com/locations/synthetic-location');
		version = options.headers.Version;
		return { ok: true, json: async () => ({ location: { id: 'synthetic-location' } }) };
	});
	assert.equal(
		(await good.highlevel.test({ access_token: 'SYNTHETIC' }, { account_id: 'synthetic-location' }))
			.health,
		'healthy'
	);
	assert.equal(version, 'v3');
	const wrong = adapters(async () => ({
		ok: true,
		json: async () => ({ location: { id: 'another-location' } })
	}));
	await assert.rejects(
		() => wrong.highlevel.test({ access_token: 'SYNTHETIC' }, { account_id: 'synthetic-location' }),
		{ code: 'provider_response_invalid' }
	);
});

test('Connection explanations preserve safe expiry/usage, scoped audit and explicit unvalidated reconnection', async (t) => {
	const dir = mkdtempSync(tmpdir() + '/falcon-explanation-');
	const service = new Integrations(
		dir + '/integrations.db',
		{},
		{ fixture: { supports_refresh: false } }
	);
	t.after(async () => {
		await service.close();
		rmSync(dir, { recursive: true });
	});
	service.create(
		{
			id: 'metadata',
			provider: 'fixture',
			purpose: 'Review connection access',
			owner: 'falcon',
			vault_handle: 'opaque',
			actors: ['human:owner'],
			account_id: 'synthetic-account'
		},
		'human:owner'
	);
	let c = service.get('metadata');
	c.health = 'healthy';
	c.last_success = Date.now();
	c.expires_at = Date.now() + 1000;
	service.save(c);
	const row = service.list('human:owner')[0];
	assert.equal(row.health, 'expiring');
	assert.equal(row.agent_use, 'not_currently_validated');
	assert.equal(row.account_id, 'synthetic-account');
	assert.equal(row.vault_handle, undefined);
	await service.run(c.id, 'disconnect', 'human:owner');
	c = service.get(c.id);
	assert.throws(() => service.reconnect(c.id, c.version, 'agent:other'), { code: 'access_denied' });
	service.reconnect(c.id, c.version, 'human:owner');
	assert.equal(service.get(c.id).health, 'unavailable');
	assert.equal(service.get(c.id).paused, true);
	assert.ok(
		service.history(c.id, 'human:owner').entries.some((e) => e.action === 'prepare_reconnection')
	);
	assert.throws(() => service.history(c.id, 'human:other'), { code: 'access_denied' });
});

test('Actionable connection attention creates one ordinary review Task and preserves its lifecycle', async (t) => {
	const { WorkStore } = await import('../work/store.mjs');
	const { recordConnectionAttention } = await import('../integrations/attention.mjs');
	const dir = mkdtempSync(tmpdir() + '/falcon-connection-attention-');
	const work = new WorkStore(dir + '/work.db');
	t.after(() => {
		work.close();
		rmSync(dir, { recursive: true });
	});
	const connection = { id: 'fixture', provider: 'cloudflare', health: 'broken', version: 3 };
	const id = recordConnectionAttention(work, connection);
	assert.equal(work.get(id).status, 'ready');
	assert.equal(recordConnectionAttention(work, { ...connection, version: 4 }), id);
	assert.equal(work.all().length, 1);
	assert.equal(work.get(id).agent_id, undefined);
	assert.equal(JSON.stringify(work.detail(id)).includes('access_token'), false);
});

test('Human credential changes pause dependent maintenance and discard stale expiry/validation', async (t) => {
	const dir = mkdtempSync(tmpdir() + '/falcon-invalidate-'),
		service = new Integrations(dir + '/integrations.db', {}, { fixture: {} });
	t.after(async () => {
		await service.close();
		rmSync(dir, { recursive: true });
	});
	for (const id of ['changed', 'unrelated'])
		service.create(
			{
				id,
				provider: 'fixture',
				purpose: 'Scoped credential lifecycle',
				owner: 'falcon',
				vault_handle: id,
				actors: ['human:owner']
			},
			'human:owner'
		);
	const before = service.get('changed');
	before.health = 'healthy';
	before.last_success = Date.now();
	before.expires_at = Date.now() + 3600000;
	service.save(before);
	assert.throws(
		() =>
			service.invalidateCredential('changed', {
				assert() {
					throw Error('retired');
				}
			}),
		/retired/
	);
	assert.equal(service.get('changed').paused, false);
	service.invalidateCredential('changed', { assert() {} });
	const after = service.get('changed');
	assert.equal(after.paused, true);
	assert.equal(after.health, 'unavailable');
	assert.equal(after.expires_at, null);
	assert.ok(after.version > before.version);
	assert.equal(service.get('unrelated').paused, false);
	service.rebind('changed', 'replacement', after.version, 'human:owner', { assert() {} });
	assert.equal(service.get('changed').vault_handle, 'replacement');
	assert.equal(service.get('changed').health, 'unavailable');
});
