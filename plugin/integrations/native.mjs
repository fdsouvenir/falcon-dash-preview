import { Type, Check } from '../schema.mjs';
import { requireValue } from '../errors.mjs';
import { connectionAuthority, humanIdentity } from '../authority.mjs';
const S = Type.String({ minLength: 1, maxLength: 512 }),
	O = (p) => Type.Object(p, { additionalProperties: false });
export const integrationInputs = {
	create: O({
		id: S,
		provider: Type.Union(['highlevel', 'cloudflare', 'schwab'].map((value) => Type.Literal(value))),
		purpose: S,
		vault_handle: S,
		account_id: S,
		actors: Type.Array(S, { maxItems: 100 })
	}),
	rebind: O({ connection_id: S, vault_handle: S, expected_version: Type.Integer({ minimum: 1 }) }),
	reconnect: O({ connection_id: S, expected_version: Type.Integer({ minimum: 1 }) }),
	consent: O({
		connection_id: S,
		redirect_uri: S,
		scopes: Type.Array(S, { minItems: 1, maxItems: 50 })
	}),
	complete: O({ state: S, code: Type.String({ minLength: 1, maxLength: 4096 }) })
};
export async function nativeIntegration(service, oauth, params, client, ready) {
	const identity = humanIdentity(client);
	requireValue(
		client?.connId &&
			!client.invalidated &&
			!client.internal?.syntheticClient &&
			identity?.kind === 'operator',
		'identity_required',
		'Verified human connection required'
	);
	const actor = `human:${identity.profileId}`,
		base = connectionAuthority(client),
		guard = {
			signal: base.signal,
			assert() {
				ready();
				base.assert();
			}
		};
	guard.assert();
	requireValue(
		params &&
			Object.keys(params).every((k) => ['action', 'input'].includes(k)) &&
			Object.hasOwn(integrationInputs, params.action) &&
			Check(integrationInputs[params.action], params.input),
		'invalid_input',
		'Invalid integration operation'
	);
	if (params.action === 'create') {
		service.vault.authorize(actor, true);
		guard.assert();
		return service.create(
			{ ...params.input, owner: 'falcon', actors: [...new Set([actor, ...params.input.actors])] },
			actor
		);
	}
	if (params.action === 'rebind') {
		service.vault.authorize(actor, true);
		await service.vault.metadata(params.input.vault_handle, actor, guard);
		guard.assert();
		return service.rebind(
			params.input.connection_id,
			params.input.vault_handle,
			params.input.expected_version,
			actor,
			guard
		);
	}
	if (params.action === 'reconnect')
		return service.reconnect(
			params.input.connection_id,
			params.input.expected_version,
			actor,
			guard
		);
	requireValue(oauth, 'unavailable', 'Configure an approved OAuth callback URI before consent');
	const result = await (params.action === 'consent'
		? oauth.begin(params.input, actor, guard)
		: oauth.complete(params.input, actor, guard));
	guard.assert();
	return result;
}
