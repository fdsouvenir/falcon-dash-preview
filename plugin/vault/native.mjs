import { Type, Check } from '../schema.mjs';
import { requireValue } from '../errors.mjs';
import { connectionAuthority, humanIdentity } from '../authority.mjs';
const S = Type.String({ minLength: 1, maxLength: 512 }),
	O = (p) => Type.Object(p, { additionalProperties: false });
export const protectedInputs = {
	relocate: O({
		id: S,
		destination: S,
		expected_version: Type.Integer({ minimum: 1 }),
		confirmed: Type.Literal(true)
	}),
	remove_entry: O({
		id: S,
		expected_version: Type.Integer({ minimum: 1 }),
		confirmed: Type.Literal(true)
	}),
	group_remove: O({ id: S, confirmed: Type.Literal(true) }),
	backup: O({}),
	recovery_list: O({}),
	audit: O({
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		before: Type.Optional(Type.Integer({ minimum: 0 }))
	}),
	grant_refs: O({ ids: Type.Array(S, { minItems: 1, maxItems: 100 }) }),
	revoke_refs: O({ ids: Type.Array(S, { minItems: 1, maxItems: 100 }) }),
	inventory: O({ group: Type.String({ maxLength: 512 }) }),
	inventory_all: O({}),
	// The four fields a KeePassXC entry has. A person managing their own vault writes these, not the
	// arbitrary material map an agent credential carries.
	add_entry: O({
		id: S,
		fields: Type.Object(
			{
				password: Type.Optional(Type.String({ maxLength: 65536 })),
				username: Type.Optional(Type.String({ maxLength: 4096 })),
				url: Type.Optional(Type.String({ maxLength: 4096 })),
				notes: Type.Optional(Type.String({ maxLength: 65536 }))
			},
			{ additionalProperties: false }
		)
	}),
	edit_entry: O({
		id: S,
		expected_version: Type.Integer({ minimum: 1 }),
		fields: Type.Object(
			{
				password: Type.Optional(Type.String({ maxLength: 65536 })),
				username: Type.Optional(Type.String({ maxLength: 4096 })),
				url: Type.Optional(Type.String({ maxLength: 4096 })),
				notes: Type.Optional(Type.String({ maxLength: 65536 }))
			},
			{ additionalProperties: false }
		)
	}),
	create: O({
		id: S,
		material: Type.Record(
			Type.String({ pattern: '^[a-z_]{1,80}$' }),
			Type.String({ maxLength: 65536 }),
			{ minProperties: 1, maxProperties: 20 }
		)
	}),
	rotate: O({
		id: S,
		expected_version: Type.Integer({ minimum: 1 }),
		material: Type.Record(
			Type.String({ pattern: '^[a-z_]{1,80}$' }),
			Type.String({ maxLength: 65536 }),
			{ minProperties: 1, maxProperties: 20 }
		)
	}),
	group: O({ id: S }),
	reveal: O({ id: S, field: S }),
	copy: O({ id: S, field: S }),
	grant: O({
		id: S,
		expected_version: Type.Integer({ minimum: 1 }),
		executors: Type.Array(S, { maxItems: 100 })
	}),
	revoke: O({ id: S, expected_version: Type.Integer({ minimum: 1 }) }),
	restore: O({ id: S, expected_version: Type.Integer({ minimum: 1 }) })
};
// Deliberately not a tool or feature query: selected-value reads require an explicit human call.
export async function protectedVault(vault, params, client, ready) {
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
		original = connectionAuthority(client),
		authority = {
			signal: original.signal,
			assert() {
				ready();
				original.assert();
			}
		};
	authority.assert();
	requireValue(
		params &&
			Object.keys(params).every((k) => ['action', 'input'].includes(k)) &&
			Object.hasOwn(protectedInputs, params.action) &&
			Check(protectedInputs[params.action], params.input),
		'invalid_input',
		'Invalid protected operation'
	);
	const p = params.input;
	if (
		vault.beforeHumanChange &&
		['rotate', 'edit_entry', 'relocate', 'remove_entry', 'revoke', 'grant'].includes(params.action)
	) {
		const metadata = await vault.metadata(p.id, actor, authority);
		authority.assert();
		requireValue(
			metadata.version === p.expected_version,
			'version_conflict',
			'Credential changed; refresh before retrying'
		);
		vault.beforeHumanChange(p.id, authority);
	}
	let result;
	switch (params.action) {
		case 'relocate':
		case 'remove_entry':
		case 'group_remove':
			vault.authorize(actor, true);
			result = await vault.worker({ action: params.action, ...p, actor }, authority);
			break;
		case 'backup':
		case 'recovery_list':
			result = await vault.worker({ action: params.action, actor }, authority);
			break;
		case 'audit':
			result = await vault.audit(actor, p, authority);
			break;
		case 'grant_refs':
			result = await vault.grantSecretRefs(p.ids, actor, authority);
			break;
		case 'revoke_refs':
			result = await vault.revokeSecretRefs(p.ids, actor, authority);
			break;
		case 'inventory':
			result = await vault.inventory(actor, p.group, authority);
			break;
		case 'inventory_all':
			result = await vault.inventoryAll(actor, authority);
			break;
		case 'add_entry':
			result = await vault.createEntry(p.id, p.fields, actor, authority);
			break;
		case 'edit_entry':
			result = await vault.updateEntry(p.id, p.fields, p.expected_version, actor, authority);
			break;
		case 'create':
			result = await vault.create(p.id, p.material, actor, authority);
			break;
		case 'rotate':
			result = await vault.rotate(
				p.id,
				p.material,
				p.expected_version,
				actor,
				undefined,
				authority
			);
			break;
		case 'group':
			result = await vault.createGroup(p.id, actor, authority);
			break;
		case 'reveal':
			result = { value: await vault.revealField(p.id, p.field, actor, authority) };
			break;
		case 'copy':
			result = { value: await vault.copyField(p.id, p.field, actor, authority) };
			break;
		case 'grant':
			result = await vault.grantEntryExecutors(
				p.id,
				p.expected_version,
				p.executors,
				actor,
				authority
			);
			break;
		case 'revoke':
			result = await vault.revokeEntryExecution(p.id, p.expected_version, actor, authority);
			break;
		case 'restore':
			result = await vault.restoreEntryExecution(p.id, p.expected_version, actor, authority);
			break;
	}
	authority.assert();
	return result;
}
