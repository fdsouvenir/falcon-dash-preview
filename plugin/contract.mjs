import { compactContract } from './compact-contract.mjs';
import { commandInputs, workFeature } from './work/feature-contract.mjs';
import { TYPES, TASK_STATES } from './work/store.mjs';
export const workCommands = Object.keys(commandInputs);

export const tools = {
	falcon_work: {
		description:
			'Read bounded canonical Work or execute an explicit versioned semantic command. Dependencies warn; Milestone closure guards enforce domain consistency, not runtime permissions.',
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
						input: { type: 'object' }
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
		plugin: 'falcon-dash',
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
