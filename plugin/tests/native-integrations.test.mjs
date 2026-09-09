import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeIntegration } from '../integrations/native.mjs';
const client = () => ({
	connId: 'fixture',
	connect: { scopes: ['operator.write'] },
	internal: { operatorRoleActor: { kind: 'operator', profileId: 'owner' } }
});
test('Native connection creation derives its human actor and requires Vault ownership', async () => {
	let saved;
	const service = {
		vault: {
			authorize(actor, human) {
				assert.equal(actor, 'human:owner');
				assert.equal(human, true);
			}
		},
		create(input, actor) {
			saved = { input, actor };
			return { id: input.id };
		}
	};
	await nativeIntegration(
		service,
		null,
		{
			action: 'create',
			input: {
				id: 'one',
				provider: 'cloudflare',
				purpose: 'Synthetic fixture',
				account_id: 'account',
				vault_handle: 'one',
				actors: ['agent:worker']
			}
		},
		client(),
		() => {}
	);
	assert.deepEqual(saved.input.actors, ['human:owner', 'agent:worker']);
	assert.equal(saved.input.owner, 'falcon');
	await assert.rejects(
		nativeIntegration(
			service,
			null,
			{ action: 'create', input: {} },
			{ ...client(), internal: { ...client().internal, syntheticClient: true } },
			() => {}
		),
		{ code: 'identity_required' }
	);
});
test('Native OAuth fails explicitly without a configured callback and rechecks connection after async consent', async () => {
	const params = {
			action: 'consent',
			input: {
				connection_id: 'one',
				redirect_uri: 'https://fixture.invalid/callback',
				scopes: ['locations.readonly']
			}
		},
		c = client();
	await assert.rejects(
		nativeIntegration({}, null, params, c, () => {}),
		{ code: 'unavailable' }
	);
	await assert.rejects(
		nativeIntegration(
			{},
			{
				async begin() {
					c.invalidated = true;
					return { authorization_url: 'https://fixture.invalid' };
				}
			},
			params,
			c,
			() => {}
		),
		{ code: 'authority_changed' }
	);
});

test('Credential rebinding requires Vault ownership before metadata or connection writes', async () => {
	let touched = 0;
	const service = {
		vault: {
			authorize() {
				throw Error('owner required');
			},
			async metadata() {
				touched++;
			}
		},
		rebind() {
			touched++;
		}
	};
	await assert.rejects(
		nativeIntegration(
			service,
			null,
			{
				action: 'rebind',
				input: { connection_id: 'one', vault_handle: 'private', expected_version: 1 }
			},
			client(),
			() => {}
		),
		/owner required/
	);
	assert.equal(touched, 0);
});
test('Credential rebinding retires original connection authority during metadata preparation', async () => {
	let writes = 0;
	const c = client(),
		service = {
			vault: {
				authorize() {},
				async metadata() {
					c.invalidated = true;
					return { version: 1 };
				}
			},
			rebind() {
				writes++;
			}
		};
	await assert.rejects(
		nativeIntegration(
			service,
			null,
			{
				action: 'rebind',
				input: { connection_id: 'one', vault_handle: 'private', expected_version: 1 }
			},
			c,
			() => {}
		),
		{ code: 'authority_changed' }
	);
	assert.equal(writes, 0);
});
