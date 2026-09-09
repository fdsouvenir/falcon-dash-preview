import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import plugin from '../index.mjs';
import { buildContract } from '../contract.mjs';
const PLUGIN_ID = JSON.parse(
	fs.readFileSync(new URL('../../openclaw.plugin.json', import.meta.url), 'utf8')
).id;
function register(config = {}) {
	const calls = { tools: [], methods: [], tabs: [], routes: [], hooks: [], services: [] };
	plugin.register({
		id: PLUGIN_ID,
		pluginConfig: config,
		registerSessionAction: () => {},
		registerTool: (...a) => calls.tools.push(a),
		registerGatewayMethod: (...a) => calls.methods.push(a),
		session: { controls: { registerControlUiDescriptor: (x) => calls.tabs.push(x) } },
		registerHttpRoute: (x) => calls.routes.push(x),
		registerService: (x) => calls.services.push(x),
		on: (...a) => calls.hooks.push(a)
	});
	return calls;
}
test('One runtime registers four real tabs, scoped methods, four tools and one system hook', () => {
	const c = register();
	assert.deepEqual(
		c.tabs.map((x) => x.id),
		['work', 'integrations', 'vault', 'documents']
	);
	assert.equal(c.tools.length, 4);
	// Derived, because preview and production register under different ids. The feature-events
	// service id follows the plugin id; a mismatch means the feature contract was left behind.
	assert.deepEqual(
		c.services.map((x) => x.id),
		[PLUGIN_ID, `${PLUGIN_ID}:feature-events`]
	);
	assert.equal(c.hooks.length, 1);
	assert.equal(c.hooks[0][0], 'before_prompt_build');
	assert.ok(c.hooks[0][1]().prependSystemContext);
	assert.ok(c.routes.every((x) => x.auth === 'gateway'));
	assert.ok(!c.methods.some(([name]) => /reveal|resolve|password/.test(name)));
});
test('Disabled modules have no tools, routes or advertised static operations', () => {
	const c = register({ modules: { vault: false, integrations: false, documents: false } });
	assert.equal(c.tabs.length, 1);
	const contract = c.hooks[0][1]().prependSystemContext;
	assert.equal(Object.keys(JSON.parse(contract).operations).length, 1);
	assert.equal(JSON.parse(buildContract([])).work, undefined);
	assert.equal(buildContract(['work']), buildContract(['work']));
});
test('Ordinary read Gateway methods reject mutation dispatch', async () => {
	const c = register();
	const method = c.methods.find(([name]) => name === 'falcon.work.read')[1];
	let result;
	await method({ params: { action: 'command' }, client: {}, respond: (...r) => (result = r) });
	assert.equal(result[0], false);
	assert.equal(result[2].details.code, 'access_denied');
});

test('Read-scoped RPCs deny every newly added mutation, including disconnect and file deletion', async () => {
	const c = register();
	for (const [module, actions] of Object.entries({
		integrations: ['disconnect', 'refresh', 'pause'],
		documents: ['rename', 'upload', 'trash', 'restore', 'write', 'mkdir']
	})) {
		const handler = c.methods.find(([name]) => name === `falcon.${module}.read`)[1];
		for (const action of actions) {
			let response;
			await handler({ params: { action }, client: {}, respond: (...r) => (response = r) });
			assert.equal(response[0], false);
			assert.equal(response[2].details.code, 'access_denied');
		}
	}
});
test('Synthetic delegated clients cannot bind a human principal or mint Work authorization', async () => {
	const c = register();
	const client = {
		connId: 'synthetic-connection',
		internal: { syntheticClient: true, operatorRoleActor: { kind: 'operator', profileId: 'owner' } }
	};
	let response;
	await c.methods.find(([name]) => name === 'falcon.identity')[1]({
		client,
		respond: (...r) => (response = r)
	});
	assert.equal(response[0], false);
});
test('Gateway keeps original authority through awaited document preparation', async (t) => {
	const fs = await import('node:fs'),
		{ tmpdir } = await import('node:os'),
		{ Documents } = await import('../documents/service.mjs');
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-gateway-race-'),
		workspace = directory + '/workspace';
	fs.mkdirSync(workspace);
	let release, entered;
	const prepared = new Promise((r) => (entered = r)),
		resume = new Promise((r) => (release = r)),
		original = Documents.prototype.write;
	Documents.prototype.write = async function (input, actor, guard) {
		entered();
		await resume;
		return original.call(this, input, actor, guard);
	};
	const c = register({
		dataDir: directory + '/data',
		modules: { work: false, vault: false, integrations: false },
		documentRoots: [{ id: 'docs', path: workspace, actors: ['human:owner'], writable: true }]
	});
	await c.services[0].start({ stateDir: directory + '/state' });
	t.after(async () => {
		Documents.prototype.write = original;
		await c.services[0].stop();
		fs.rmSync(directory, { recursive: true });
	});
	const client = {
		connId: 'human',
		invalidated: false,
		internal: { operatorRoleActor: { kind: 'operator', profileId: 'owner' } }
	};
	let response;
	const call = c.methods.find(([name]) => name === 'falcon.documents.write')[1]({
		params: {
			action: 'write',
			root_id: 'docs',
			path: 'note.md',
			content: 'not allowed',
			expected_version: null
		},
		client,
		respond: (...r) => (response = r)
	});
	await prepared;
	client.invalidated = true;
	release();
	await call;
	assert.equal(response[0], false);
	assert.equal(fs.existsSync(workspace + '/note.md'), false);
});

test('Tools registered by a load with no service still serve the running one', async (t) => {
	const fs = await import('node:fs'),
		{ tmpdir } = await import('node:os');
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-tool-load-');
	const settings = { dataDir: directory + '/data', modules: { vault: false, integrations: false } };
	const activated = register(settings);
	await activated.services[0].start({ stateDir: directory + '/state' });
	t.after(async () => {
		await activated.services[0].stop();
		fs.rmSync(directory, { recursive: true });
	});
	// The host builds tool registries with activation disabled, so this registration never runs a
	// service. Its tools must still reach the one live instance rather than a dead closure.
	const toolOnly = register(settings);
	assert.equal(toolOnly.services.length, 2);
	const workTool = toolOnly.tools.find(([f]) => f({}).name === 'falcon_work')[0]({
		agentId: 'coordinator'
	});
	const read = await workTool.execute('read', { action: 'queue' });
	assert.ok(!read.isError, JSON.stringify(read.details));
	assert.ok(read.details.buckets);
	const written = await workTool.execute('write', {
		action: 'command',
		request: {
			command: 'create',
			idempotency_key: 'tool-load-1',
			input: {
				type: 'task',
				title: 'Reached the running service',
				description: 'Created through a tool registered by a load that never started a service.',
				done_when: 'The event log attributes this creation to the calling agent.'
			}
		}
	});
	assert.ok(!written.isError, JSON.stringify(written.details));
	// The agent identity must survive the hand-off; a shared runtime must not relabel the actor.
	const history = await workTool.execute('history', {
		action: 'history',
		id: written.details.target
	});
	assert.ok(
		history.details.items.some((entry) => entry.actor === 'agent:coordinator'),
		JSON.stringify(history.details.items)
	);
});

test('Tool loads fail closed once no service is running in this process', async () => {
	const c = register({ modules: { vault: false, integrations: false } });
	const workTool = c.tools.find(([f]) => f({}).name === 'falcon_work')[0]({ agentId: 'orphan' });
	const result = await workTool.execute('read', { action: 'queue' });
	assert.ok(result.isError);
	assert.equal(result.details.code, 'unavailable');
});
