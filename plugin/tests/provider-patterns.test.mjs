import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapters } from '../integrations/adapters.mjs';
import { humanIdentity, connectionAuthority } from '../authority.mjs';
test('Cloudflare validation proves only the configured account-read capability', async () => {
	const urls = [],
		id = 'a'.repeat(32),
		provider = adapters(async (url) => {
			urls.push(url);
			return {
				ok: true,
				json: async () =>
					url.endsWith('/verify')
						? { success: true, result: { status: 'active' } }
						: { success: true, result: { id } }
			};
		}).cloudflare;
	assert.deepEqual(await provider.test({ api_token: 'SYNTHETIC' }, { account_id: id }), {
		health: 'healthy',
		validated_capabilities: ['account.read']
	});
	assert.equal(urls.length, 2);
	assert.equal(urls[1], `https://api.cloudflare.com/client/v4/accounts/${id}`);
});
test('Schwab refuses an absent or elapsed renewal cutoff before provider I/O', async () => {
	let requests = 0;
	const provider = adapters(async () => {
		requests++;
	}).schwab;
	for (const reauthorize_at of [undefined, 'invalid', new Date(0).toISOString()])
		await assert.rejects(provider.refresh({ reauthorize_at }, {}), {
			code: 'reauthorization_required'
		});
	assert.equal(requests, 0);
});
test('Schwab refresh preserves omitted refresh material and never extends the explicit renewal cutoff', async () => {
	const cutoff = Date.now() + 60000;
	let endpoint;
	const provider = adapters(async (url, options) => {
		endpoint = url;
		assert.equal(options.method, 'POST');
		assert.equal(options.body.get('grant_type'), 'refresh_token');
		return { ok: true, json: async () => ({ access_token: 'SYNTHETIC-NEW', expires_in: 1800 }) };
	}).schwab;
	const result = await provider.refresh(
		{
			client_id: 'SYNTHETIC-ID',
			client_secret: 'SYNTHETIC-SECRET',
			refresh_token: 'SYNTHETIC-REFRESH',
			reauthorize_at: new Date(cutoff).toISOString()
		},
		{}
	);
	assert.equal(endpoint, 'https://api.schwabapi.com/v1/oauth/token');
	assert.deepEqual(result.material, { access_token: 'SYNTHETIC-NEW' });
	assert.equal(result.next_at, cutoff);
});
test('Schwab validation checks the configured hash and does not return account numbers', async () => {
	const provider = adapters(async () => ({
		ok: true,
		json: async () => [{ hashValue: 'hash', accountNumber: 'SYNTHETIC-PRIVATE' }]
	})).schwab;
	const result = await provider.test(
		{ access_token: 'SYNTHETIC', reauthorize_at: new Date(Date.now() + 60000).toISOString() },
		{ account_id: 'hash' }
	);
	assert.deepEqual(result.validated_capabilities, ['account_numbers.read']);
	assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PRIVATE'));
	await assert.rejects(
		provider.test(
			{ access_token: 'SYNTHETIC', reauthorize_at: new Date(Date.now() + 60000).toISOString() },
			{ account_id: 'wrong' }
		),
		{ code: 'scope_failure' }
	);
});
test('Real Gateway profile fields establish a human principal but owner, synthetic and conflicting identities do not', () => {
	const client = {
		connId: 'one',
		authenticatedUserId: 'person@fixture.invalid',
		authenticatedUserProfile: { profileId: 'profile-one' },
		connect: { scopes: ['operator.write'] }
	};
	assert.equal(humanIdentity(client).profileId, 'profile-one');
	const guard = connectionAuthority(client);
	client.authenticatedUserProfile.profileId = 'profile-two';
	assert.throws(() => guard.assert(), { code: 'authority_changed' });
	assert.equal(humanIdentity({ ...client, internal: { syntheticClient: true } }), null);
	assert.equal(
		humanIdentity({ ...client, internal: { operatorRoleActor: { kind: 'system' } } }),
		null
	);
	assert.equal(
		humanIdentity({ ...client, authenticatedUserProfile: { profileId: 'gateway-owner' } }),
		null
	);
	assert.equal(
		humanIdentity({
			...client,
			internal: { operatorRoleActor: { kind: 'operator', profileId: 'conflict' } }
		}),
		null
	);
});
test('A closed real transport retires authority even when no synthetic invalidated flag exists', () => {
	const client = {
		connId: 'one',
		socket: { readyState: 1 },
		authenticatedUserId: 'person@fixture.invalid',
		authenticatedUserProfile: { profileId: 'one' },
		connect: { role: 'operator', scopes: ['operator.write'] }
	};
	const guard = connectionAuthority(client);
	guard.assert();
	client.socket.readyState = 3;
	assert.throws(() => guard.assert(), { code: 'authority_changed' });
	assert.equal(humanIdentity({ ...client, connect: { role: 'node' } }), null);
});
