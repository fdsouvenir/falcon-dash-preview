import { compactContract } from './compact-contract.mjs';
import { commandInputs, workFeature } from './work/feature-contract.mjs';
import { TYPES, TASK_STATES, DomainError } from './work/store.mjs';
export const workCommands = Object.keys(commandInputs);

/**
 * Collapse the tool's two payload spellings into the one shape the Work store accepts.
 *
 * `request.input_json` exists only so constrained decoders can express a payload at all; it is
 * never a second contract. Resolving it here keeps `execute` seeing exactly the documented keys,
 * so its own `exact` check and its idempotency digest stay identical no matter which spelling the
 * caller used for the same logical command.
 */
export function resolveCommandRequest(request) {
	if (!request || typeof request !== 'object') return request;
	const { input_json: encoded, ...rest } = /** @type {Record<string, unknown>} */ (request);
	if (encoded === undefined || encoded === '') return rest;
	if (typeof encoded !== 'string')
		throw new DomainError('invalid_input', 'request.input_json must be JSON text');
	let parsed;
	try {
		parsed = JSON.parse(encoded);
	} catch {
		throw new DomainError('invalid_input', 'request.input_json is not valid JSON');
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new DomainError('invalid_input', 'request.input_json must encode a JSON object');
	// A strict decoder fills every declared property, so an empty `input` alongside real
	// `input_json` is the expected shape rather than a conflict.
	if (rest.input !== undefined && Object.keys(/** @type {object} */ (rest.input)).length > 0)
		throw new DomainError(
			'invalid_input',
			'Send the command payload in request.input or request.input_json, not both'
		);
	return { ...rest, input: parsed };
}

export const tools = {
	falcon_work: {
		description:
			'Read bounded canonical Work or execute an explicit versioned semantic command. Dependencies warn; Milestone closure guards enforce domain consistency, not runtime permissions. For a command, put the payload in request.input; if your tool arguments are constrained to the declared schema and you cannot express it there, send the identical JSON object as text in request.input_json instead. Both are validated against the same per-command contract published above.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: ['action'],
			properties: {
				action: {
					type: 'string',
					enum: ['list', 'get', 'queue', 'brief', 'history', 'related', 'command']
				},
				id: { type: 'string' },
				full: { type: 'boolean' },
				collection: {
					type: 'string',
					enum: ['relationships', 'asks', 'associated_work', 'artifacts', 'history', 'participants']
				},
				query: {
					type: 'object',
					additionalProperties: false,
					properties: {
						type: { type: 'string', enum: TYPES },
						limit: { type: 'integer', minimum: 1, maximum: 100 },
						offset: { type: 'integer', minimum: 0 },
						agent_id: { type: 'string' },
						search: { type: 'string' },
						fields: { type: 'array', items: { type: 'string' } },
						include_terminal: { type: 'boolean' }
					}
				},
				request: {
					type: 'object',
					additionalProperties: false,
					required: ['command', 'idempotency_key', 'input'],
					properties: {
						command: { type: 'string', enum: workCommands },
						id: { type: 'string' },
						expected_version: { type: 'integer' },
						idempotency_key: { type: 'string', maxLength: 128 },
						ask_id: { type: 'string' },
						input: { type: 'object' },
						// `input` carries no declared properties, because its real shape is the
						// per-command union already published in this plugin's injected contract.
						// Providers that constrain tool arguments to the declared schema — every
						// native OpenAI route, where OpenClaw resolves strict tools to true — can
						// therefore only ever emit `{}`, which fails the command contract and makes
						// every Work mutation impossible from those models. Redeclaring the union
						// here would duplicate ~24KB already present in the prompt, so accept the
						// same payload as JSON text, which a constrained decoder can express.
						input_json: { type: 'string', maxLength: 24000 }
					}
				}
			}
		}
	},
	falcon_integrations: {
		description:
			'Read redacted connection health or request deterministic validation/maintenance. Native-owned credentials have no Falcon refresh path.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: ['action'],
			properties: {
				action: {
					type: 'string',
					enum: ['list', 'history', 'test', 'refresh', 'pause', 'resume', 'disconnect']
				},
				id: { type: 'string' },
				query: {
					type: 'object',
					additionalProperties: false,
					properties: {
						offset: { type: 'integer', minimum: 0 },
						limit: { type: 'integer', minimum: 1, maximum: 100 }
					}
				}
			}
		}
	},
	falcon_documents: {
		description:
			'Read or edit explicitly authorized text workspaces. Credential paths and symlinks are unavailable. Writes require the exact read version; creation uses null.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: ['action'],
			properties: {
				action: {
					type: 'string',
					enum: [
						'list',
						'read',
						'write',
						'mkdir',
						'rename',
						'download',
						'upload',
						'trash',
						'restore',
						'trash_list',
						'roots',
						'copy_path'
					]
				},
				root_id: { type: 'string' },
				sort: { type: 'string', enum: ['name', 'name_desc'] },
				limit: { type: 'integer', minimum: 1, maximum: 200 },
				offset: { type: 'integer', minimum: 0 },
				destination: { type: 'string' },
				trash_id: { type: 'string' },
				confirmed: { type: 'boolean' },
				path: { type: 'string' },
				content: { type: 'string', maxLength: 262144 },
				expected_version: { type: ['string', 'null'] },
				search: { type: 'string' }
			}
		}
	},
	falcon_vault: {
		description:
			'Read opaque Vault inventory and lock state only. Credential creation/reveal/resolution are never general tool operations.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: ['action'],
			properties: {
				action: { type: 'string', enum: ['status', 'inventory', 'metadata'] },
				id: { type: 'string' }
			}
		}
	}
};
export function domainContract(enabled) {
	return {
		plugin: workFeature.pluginId,
		version: '4.4.1',
		...(enabled.includes('work')
			? { work: { types: TYPES, task_states: TASK_STATES, feature: workFeature } }
			: {}),
		operations: Object.fromEntries(
			Object.entries(tools).filter(([name]) => enabled.includes(name.slice(7)))
		),
		ownership: {
			runtime: 'OpenClaw',
			work: 'Falcon Dash',
			credentials: 'KeePassXC; opaque handles in ordinary payloads'
		},
		ui: {
			mode: 'sandboxed read-only preview',
			writes: 'Unavailable pending authenticated iframe bridge decision'
		}
	};
}
export function buildContract(enabled) {
	return JSON.stringify(compactContract(domainContract(enabled)));
}
