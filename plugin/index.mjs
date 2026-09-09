import { recordConnectionAttention } from './integrations/attention.mjs';
import { connectionAuthority, internalAuthority, humanIdentity } from './authority.mjs';
import { defineFeaturePlugin } from 'openclaw/plugin-sdk/feature-plugin';
import { workFeature } from './work/feature-contract.mjs';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import path from 'node:path';
import { WorkStore, DomainError, exact, requireValue } from './work/store.mjs';
import { Documents } from './documents/service.mjs';
import { Vault } from './vault/service.mjs';
import { Integrations } from './integrations/service.mjs';
import { adapters } from './integrations/adapters.mjs';
import { HighLevelOAuth } from './integrations/oauth.mjs';
import { nativeIntegration } from './integrations/native.mjs';
import { tools, buildContract } from './contract.mjs';
import { render } from './ui.mjs';
import { protectedVault } from './vault/native.mjs';

// Shared across every registration of this plugin in one process, including registrations the
// host creates with activation disabled. Registered by symbol so a re-evaluated module still
// resolves the same running service.
const RUNTIME = Symbol.for('falcon-dash.runtime');

export default definePluginEntry({
	id: 'falcon-dash-preview',
	name: 'Falcon Dash',
	description: 'Operator console for OpenClaw: Work, KeePassXC Vault, Integrations and Documents',
	register(api) {
		const config =
			/** @type {{dataDir?: string, modules?: Record<string, boolean>, oauthRedirectUris?:string[], vaultOwners?: string[], vaultExecutors?: string[], vaultDatabase?: string, vaultKeyFile?: string, documentRoots?: Array<{id:string,path:string,actors:string[],writable?:boolean}>}} */ (
				api.pluginConfig ?? {}
			);
		const enabled = ['work', 'integrations', 'vault', 'documents'].filter(
			(m) => config.modules?.[m] !== false
		);
		let work,
			documents,
			vault,
			integrations,
			oauth,
			started = false;
		// The host loads a plugin more than once. Tool registries load with activation disabled, so
		// that registration never runs a service and its own closure state stays empty. Publish the
		// started modules on a process-global so every registration in this process serves the one
		// live instance instead of a dead copy. Absent global means no service here: still fail closed.
		const modules = () =>
			started
				? { work, documents, vault, integrations }
				: /** @type {any} */ (globalThis[RUNTIME] ?? null);
		const ready = () =>
			requireValue(!!modules(), 'unavailable', 'Falcon Dash service is not running');
		async function invoke(name, p, actor, guard = internalAuthority) {
			const original = guard;
			guard = {
				signal: original.signal,
				assert() {
					ready();
					original.assert();
				}
			};
			guard.assert();
			ready();
			const live = modules();
			exact(p, Object.keys(tools[name].parameters.properties));
			if (name === 'falcon_work') {
				if (p.action === 'list') {
					if (p.query)
						exact(p.query, [
							'type',
							'limit',
							'offset',
							'agent_id',
							'search',
							'fields',
							'include_terminal'
						]);
					return live.work.list(p.query);
				}
				if (p.action === 'get') return live.work.detail(p.id, p.full === true);
				if (p.action === 'queue' || p.action === 'brief') return live.work.queue(p.query);
				if (p.action === 'history') return live.work.history(p.id, p.query);
				if (p.action === 'related') return live.work.related(p.id, p.collection, p.query);
				if (p.action === 'command') {
					requireValue(actor, 'identity_required', 'A verified actor is required');
					return live.work.execute(p.request, actor);
				}
			}
			if (name === 'falcon_integrations') {
				requireValue(actor, 'identity_required', 'A verified actor is required');
				if (p.action === 'history') return live.integrations.history(p.id, actor, p.query);
				return p.action === 'list'
					? { connections: live.integrations.list(actor) }
					: live.integrations.run(p.id, p.action, actor, guard);
			}
			if (name === 'falcon_vault') {
				if (p.action === 'status')
					return {
						locked: live.vault.locked,
						initialized: live.vault.initialized,
						protected_ui: 'native',
						epoch: live.vault.generation,
						can_manage: String(actor).startsWith('human:')
					};
				if (p.action === 'metadata') return live.vault.metadata(p.id, actor, guard);
				requireValue(p.action === 'inventory', 'invalid_command', 'Unsupported Vault operation');
				return live.vault.inventory(actor, '', guard);
			}
			if (name === 'falcon_documents') {
				requireValue(actor, 'identity_required', 'A verified workspace actor is required');
				if (p.action === 'roots') return live.documents.rootsFor(actor);
				if (p.action === 'copy_path') return live.documents.copyPath(p, actor);
				requireValue(
					[
						'list',
						'read',
						'write',
						'mkdir',
						'rename',
						'download',
						'upload',
						'trash',
						'restore',
						'trash_list'
					].includes(p.action),
					'invalid_command',
					'Unsupported Documents operation'
				);
				guard.assert();
				return live.documents[p.action](p, actor, guard);
			}
			throw new DomainError('invalid_command', 'Unsupported operation');
		}
		api.registerService({
			id: 'falcon-dash-preview',
			async start(ctx) {
				try {
					const directory = config.dataDir ?? path.join(ctx.stateDir, 'falcon-dash-preview');
					if (enabled.includes('work')) {
						work = new WorkStore(path.join(directory, 'work.db'));
						work.subscribe((stamp) =>
							ctx.gatewayEvents?.emit('falcon_work_changed', stamp, { scope: 'operator.read' })
						);
						work.changeTimer = setInterval(() => {
							try {
								work.checkExternalChanges();
							} catch {
								ctx.serviceHealth?.reportFailure(new Error('Work change tracking is unavailable'));
							}
						}, 1000);
						work.changeTimer.unref();
					}
					if (enabled.includes('vault') || enabled.includes('integrations')) {
						// The credential database defaults to the operator's own KeePassXC vault beside the
						// rest of their state, which is where releases through 3.1.1 kept it. Policy,
						// audit and recovery stay in the plugin's private directory either way.
						vault = new Vault(path.join(directory, 'vault'), {
							owners: config.vaultOwners ?? [],
							executors: config.vaultExecutors ?? [],
							database: config.vaultDatabase ?? path.join(ctx.stateDir, 'passwords.kdbx'),
							key: config.vaultKeyFile ?? path.join(ctx.stateDir, 'vault.key')
						});
						// A missing Vault is provisioned and opened here so no operator ever sees a setup
						// step. A host without KeePassXC, or one needing recovery, must not take the other
						// modules down: it stays unprovisioned and every operation fails with its typed error.
						try {
							await vault.ready();
						} catch (error) {
							ctx.serviceHealth?.reportFailure(
								new Error(
									`Vault is unavailable: ${error instanceof Error ? error.message : String(error)}`
								)
							);
						}
					}
					if (enabled.includes('documents'))
						documents = new Documents(config.documentRoots ?? [], {
							forbiddenRoots: [ctx.stateDir],
							protectedRoots: [
								path.join(ctx.stateDir, 'state'),
								path.join(ctx.stateDir, 'credentials'),
								path.join(ctx.stateDir, 'identity'),
								path.join(directory, 'vault')
							]
						});
					if (enabled.includes('integrations'))
						integrations = new Integrations(
							path.join(directory, 'integrations.db'),
							vault,
							adapters(),
							work ? (connection) => recordConnectionAttention(work, connection) : null
						);
					if (integrations)
						vault.beforeHumanChange = (handle, authority) =>
							integrations.invalidateCredential(handle, authority);
					if (integrations && config.oauthRedirectUris?.length)
						oauth = new HighLevelOAuth(integrations, { redirectUris: config.oauthRedirectUris });
					if (integrations) integrations.start('service:falcon-integrations');
					started = true;
					/** @type {any} */ (globalThis)[RUNTIME] = { work, documents, vault, integrations };
				} catch (error) {
					delete (/** @type {any} */ (globalThis)[RUNTIME]);
					documents?.close();
					await integrations?.close();
					work?.close();
					documents = integrations = work = vault = undefined;
					started = false;
					throw error;
				}
			},
			async stop() {
				started = false;
				delete (/** @type {any} */ (globalThis)[RUNTIME]);
				documents?.close();
				await vault?.lock();
				await integrations?.close();
				work?.close();
				work = documents = integrations = vault = undefined;
				started = false;
			}
		});
		for (const [name, definition] of Object.entries(tools).sort(
			([a], [b]) => enabled.indexOf(a.slice(7)) - enabled.indexOf(b.slice(7))
		)) {
			const module = name.slice(7);
			if (!enabled.includes(module)) continue;
			api.registerTool(
				(ctx) => ({
					name,
					label: name,
					description: definition.description,
					parameters: definition.parameters,
					async execute(_id, params, signal) {
						try {
							const result = await invoke(
								name,
								params,
								ctx.agentId ? `agent:${ctx.agentId}` : null,
								{
									signal,
									assert() {
										requireValue(
											!signal?.aborted,
											'authority_changed',
											'Tool execution was cancelled'
										);
									}
								}
							);
							return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
						} catch (error) {
							const result = safeError(error);
							return {
								isError: true,
								content: [{ type: 'text', text: JSON.stringify(result) }],
								details: result
							};
						}
					}
				}),
				{ names: [name], optional: true }
			);
			for (const mode of ['read', 'write']) {
				if (name === 'falcon_vault' && mode === 'write') continue;
				api.registerGatewayMethod(
					`falcon.${module}.${mode}`,
					async ({ params, client, respond }) => {
						try {
							const readActions = {
								falcon_work: ['list', 'get', 'queue', 'brief', 'history', 'related'],
								falcon_integrations: ['list', 'history'],
								falcon_vault: ['status', 'inventory', 'metadata'],
								falcon_documents: ['list', 'read', 'download', 'roots', 'copy_path', 'trash_list']
							};
							const writes =
								typeof params.action !== 'string' || !readActions[name].includes(params.action);
							requireValue(
								mode === 'write' || !writes,
								'access_denied',
								'Use the scoped write operation'
							);
							requireValue(!client?.invalidated, 'access_denied', 'Connection was revoked');
							const authority = humanIdentity(client);
							const actor =
								authority?.kind === 'operator' && !client?.internal?.syntheticClient
									? `human:${authority.profileId}`
									: null;
							const guard = connectionAuthority(client);
							const result = await invoke(name, params, actor, guard);
							guard.assert();
							respond(true, result);
						} catch (error) {
							respond(false, undefined, {
								code: 'INVALID_REQUEST',
								message: 'Falcon operation failed',
								details: safeError(error)
							});
						}
					},
					{ scope: mode === 'read' ? 'operator.read' : 'operator.write' }
				);
			}
			const route = `/plugins/falcon-dash/${module}`;
			api.session.controls.registerControlUiDescriptor({
				id: module,
				surface: 'tab',
				label: module[0].toUpperCase() + module.slice(1),
				path: route,
				requiredScopes: ['operator.read'],
				order: 10 + enabled.indexOf(module)
			});
			api.registerHttpRoute({
				path: route,
				auth: 'gateway',
				match: 'exact',
				async handler(req, res) {
					res.setHeader('Cache-Control', 'no-store');
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.setHeader('X-Content-Type-Options', 'nosniff');
					res.setHeader(
						'Content-Security-Policy',
						"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
					);
					if (req.method !== 'GET' && req.method !== 'HEAD') {
						res.statusCode = 405;
						res.end();
						return;
					}
					try {
						const { dispatchGatewayMethod } =
							await import('openclaw/plugin-sdk/gateway-method-runtime');
						let data;
						if (module === 'documents')
							data = {
								roots: [],
								error:
									'Use authorized typed Documents operations; browser editing is not yet connected.'
							};
						else {
							const response = await dispatchGatewayMethod(`falcon.${module}.read`, {
								action: module === 'vault' ? 'status' : 'list'
							});
							data = response.ok
								? response.payload
								: { error: 'This view is unavailable or your identity lacks access.' };
						}
						res.end(req.method === 'HEAD' ? '' : render(module, data));
					} catch {
						res.statusCode = 503;
						res.end(
							render(module, { error: 'Module unavailable. Retry after the service is ready.' })
						);
					}
				}
			});
		}
		api.registerGatewayMethod(
			'falcon.ui.status',
			({ respond }) => respond(true, { modules: enabled }),
			{ scope: 'operator.read' }
		);
		if (enabled.includes('vault'))
			api.registerGatewayMethod(
				'falcon.vault.protected',
				async ({ params, client, respond }) => {
					try {
						ready();
						const result = await protectedVault(vault, params, client, ready);
						respond(true, result);
					} catch (error) {
						respond(false, undefined, {
							code: 'INVALID_REQUEST',
							message: 'Protected operation failed',
							details: safeError(error)
						});
					}
				},
				{ scope: 'operator.write' }
			);

		if (enabled.includes('integrations'))
			api.registerGatewayMethod(
				'falcon.integrations.manage',
				async ({ params, client, respond }) => {
					try {
						ready();
						respond(true, await nativeIntegration(integrations, oauth, params, client, ready));
					} catch (error) {
						respond(false, undefined, {
							code: 'INVALID_REQUEST',
							message: 'Integration operation failed',
							details: safeError(error)
						});
					}
				},
				{ scope: 'operator.write' }
			);

		const principals = new Map();
		api.registerGatewayMethod(
			'falcon.identity',
			({ client, respond }) => {
				const principal = humanIdentity(client);
				if (
					!client?.connId ||
					client.invalidated ||
					client.internal?.syntheticClient ||
					principal?.kind !== 'operator'
				) {
					respond(false, undefined, {
						code: 'INVALID_REQUEST',
						message: 'Verified human connection required'
					});
					return;
				}
				principals.set(client.connId, {
					client,
					actor: `human:${principal.profileId}`,
					guard: connectionAuthority(client)
				});
				client.connectionSignal?.addEventListener('abort', () => principals.delete(client.connId), {
					once: true
				});
				respond(true, { bound: true });
			},
			{ scope: 'operator.read' }
		);
		if (enabled.includes('work'))
			defineFeaturePlugin({
				contract: workFeature,
				name: 'Falcon Work',
				description: 'Typed backend operations shared with the Control UI',
				setup: () => ({
					work_list: (input) => {
						ready();
						return work.list(input);
					},
					work_queue: (input) => {
						ready();
						return work.queue(input);
					},
					work_command: (input, context) => {
						ready();
						const bound =
							context.source === 'session-action'
								? principals.get(context.action.client?.connId)
								: null;
						requireValue(
							bound && !bound.client.invalidated && !bound.client.connectionSignal?.aborted,
							'identity_required',
							'Bind this verified connection through falcon.identity first'
						);
						bound.guard.assert();
						return work.execute(input, bound.actor);
					}
				})
			}).register(api);
		api.on('before_prompt_build', () => ({ prependSystemContext: buildContract(enabled) }));
	}
});

function safeError(error) {
	return error instanceof DomainError
		? { code: error.code, message: error.message, details: error.details }
		: {
				code: 'unavailable',
				message: 'Operation unavailable; no private diagnostic data returned'
			};
}
