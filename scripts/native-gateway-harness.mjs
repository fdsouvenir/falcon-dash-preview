// Disposable real-Gateway test host. Never imports or edits operator state.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pluginId } from './plugin-identity.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = process.env.FALCON_E2E_ROOT;
if (
	!root ||
	!path.isAbsolute(root) ||
	!root.startsWith(path.join(repo, 'artifacts/plugin-v4/native-e2e-')) ||
	fs.existsSync(root)
)
	throw Error('Use a fresh isolated E2E artifact root');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const entry = fs.realpathSync(path.join(repo, 'node_modules/openclaw/openclaw.mjs'));
if (
	JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'))).version !== '2026.9.3'
)
	throw Error('Pinned OpenClaw 2026.9.3 required');
const binary = path.join(root, 'runtime/node');
fs.mkdirSync(path.dirname(binary), { mode: 0o700 });
fs.copyFileSync(process.execPath, binary, fs.constants.COPYFILE_EXCL);
if (fs.lstatSync(binary).uid !== process.getuid() || fs.lstatSync(binary).isSymbolicLink())
	throw Error('Unsafe fixture runtime');
fs.chmodSync(binary, 0o700);
const digest = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
	systemDigest = digest(process.execPath),
	systemMode = fs.statSync(process.execPath).mode,
	systemUid = fs.statSync(process.execPath).uid;
if (digest(binary) !== systemDigest) throw Error('Copied runtime mismatch');
const state = path.join(root, 'state'),
	configFile = path.join(root, 'config.json'),
	workspace = path.join(root, 'workspace'),
	gatewayPort = 28981,
	proxyPort = 28982,
	baseURL = `http://127.0.0.1:${proxyPort}`;
fs.mkdirSync(workspace, { recursive: true });
const ownerEmail = 'owner@fixture.invalid',
	secondOperatorEmail = 'second@fixture.invalid';
let identity = ownerEmail,
	offline = false,
	gateway,
	client,
	closing = false,
	ready = false,
	profileId;
const config = {
	gateway: {
		mode: 'local',
		bind: 'loopback',
		port: gatewayPort,
		trustedProxies: ['127.0.0.1'],
		auth: {
			mode: 'trusted-proxy',
			trustedProxy: {
				userHeader: 'x-fixture-user',
				allowUsers: [ownerEmail, secondOperatorEmail],
				allowLoopback: true,
				requiredHeaders: ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'],
				deviceAutoApprove: {
					enabled: true,
					scopes: [
						'operator.read',
						'operator.write',
						'operator.approvals',
						'operator.questions',
						'operator.admin'
					]
				}
			}
		},
		controlUi: { allowedOrigins: [baseURL], experimental: { customPlugins: true } }
	},
	agents: { defaults: { workspace } },
	plugins: {
		allow: [pluginId],
		entries: {
			[pluginId]: {
				enabled: true,
				config: {
					dataDir: path.join(root, 'data'),
					vaultExecutors: ['agent:fixture'],
					vaultOwners: [],
					// Exercise the explicit database/key configuration; the default is the operator's
					// own KeePassXC vault beside the rest of their gateway state.
					vaultDatabase: path.join(root, 'data/vault/credentials.kdbx'),
					vaultKeyFile: path.join(root, 'data/vault/unlock.key'),
					documentRoots: []
				}
			}
		}
	},
	logging: { file: path.join(root, 'gateway.log') }
};
const env = {
	PATH: process.env.PATH,
	HOME: root,
	OPENCLAW_STATE_DIR: state,
	OPENCLAW_CONFIG_PATH: configFile
};
const saveConfig = () =>
	fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
saveConfig();
async function run(name, exe, args) {
	const child = spawn(exe, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] }),
		log = fs.createWriteStream(path.join(root, `${name}.log`), { mode: 0o600 });
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	const code = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('close', resolve);
	});
	log.end();
	if (code !== 0) throw Error(`${name} failed; inspect the isolated log`);
}
async function freePort(port) {
	await new Promise((resolve, reject) => {
		const server = http.createServer();
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => server.close(resolve));
	});
}
await freePort(gatewayPort);
await freePort(proxyPort);
await run('pack', 'npm', ['pack', '--ignore-scripts', '--pack-destination', root]);
const archive = fs.readdirSync(root).find((p) => p.endsWith('.tgz'));
await run('install', binary, [
	entry,
	'plugins',
	'install',
	path.join(root, archive),
	'--force',
	'--accept-capabilities'
]);
// Installation records remain authoritative; merge fixture configuration into its result.
const installedConfig = JSON.parse(fs.readFileSync(configFile));
Object.assign(config, installedConfig);
config.gateway.controlUi.experimental.customPlugins = true;
saveConfig();
const sockets = new Set();
function forwardHeaders(req) {
	const headers = { ...req.headers };
	for (const key of Object.keys(headers))
		if (
			key === 'forwarded' ||
			key.startsWith('x-forwarded-') ||
			key === 'x-real-ip' ||
			key === 'x-fixture-user' ||
			key === 'x-openclaw-scopes'
		)
			delete headers[key];
	return {
		...headers,
		host: `127.0.0.1:${gatewayPort}`,
		'x-forwarded-for': '192.0.2.10',
		'x-forwarded-host': `127.0.0.1:${proxyPort}`,
		'x-forwarded-proto': 'http',
		'x-fixture-user': identity
	};
}
const proxy = http.createServer(async (req, res) => {
	if (req.url === '/__fixture/ready') {
		res.writeHead(ready ? 200 : 503, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		});
		res.end(JSON.stringify({ ready, profileId }));
		return;
	}
	if (req.url?.startsWith('/__fixture/') && req.method === 'POST') {
		try {
			let body = '';
			for await (const chunk of req) {
				body += chunk;
				if (body.length > 10000) throw Error('Oversized control');
			}
			const input = body ? JSON.parse(body) : {};
			switch (req.url) {
				case '/__fixture/disconnect':
					offline = true;
					for (const socket of sockets) socket.destroy();
					break;
				case '/__fixture/reconnect':
					offline = false;
					break;
				case '/__fixture/identity':
					if (![ownerEmail, secondOperatorEmail].includes(input.email))
						throw Error('Unknown fixture identity');
					identity = input.email;
					for (const socket of sockets) socket.destroy();
					break;
				case '/__fixture/work': {
					const task = await client.request('falcon.work.read', { action: 'get', id: input.id });
					await client.request('falcon.work.write', {
						action: 'command',
						request: {
							command: 'revise_definition',
							id: input.id,
							expected_version: task.version,
							idempotency_key: `fixture-external-${Date.now()}`,
							input: {
								title: 'Externally revised Work',
								description: 'Another writer updated this Definition.',
								done_when: 'Review the external change before reapplying.',
								reason: 'Synthetic concurrency fixture'
							}
						}
					});
					break;
				}
				case '/__fixture/document':
					fs.writeFileSync(
						path.join(workspace, 'Operating notes.md'),
						'# Changed by another writer\nExternal fixture edit.\n'
					);
					break;
				case '/__fixture/restart':
					await stopGateway();
					await startGateway();
					break;
				case '/__fixture/ui':
					config.gateway.controlUi.experimental.customPlugins = input.enabled === true;
					saveConfig();
					await stopGateway();
					await startGateway();
					break;
				default:
					throw Error('Unknown fixture control');
			}
			res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			res.end('{"ok":true}');
		} catch {
			res.writeHead(500);
			res.end('Fixture control failed');
		}
		return;
	}
	if (offline) {
		res.writeHead(503);
		res.end('Fixture transport offline');
		return;
	}
	const upstream = http.request(
		{
			hostname: '127.0.0.1',
			port: gatewayPort,
			path: req.url,
			method: req.method,
			headers: forwardHeaders(req)
		},
		(response) => {
			res.writeHead(response.statusCode, response.headers);
			response.pipe(res);
		}
	);
	upstream.on('error', () => {
		if (!res.headersSent) res.writeHead(502);
		res.end('Fixture Gateway unavailable');
	});
	req.pipe(upstream);
});
proxy.on('upgrade', (req, socket, head) => {
	if (offline) {
		socket.destroy();
		return;
	}
	sockets.add(socket);
	socket.on('close', () => sockets.delete(socket));
	const upstream = http.request({
		hostname: '127.0.0.1',
		port: gatewayPort,
		path: req.url,
		method: req.method,
		headers: forwardHeaders(req)
	});
	upstream.on('upgrade', (response, target, upstreamHead) => {
		socket.write(
			`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n` +
				Object.entries(response.headers)
					.map(([key, value]) => `${key}: ${value}`)
					.join('\r\n') +
				'\r\n\r\n'
		);
		if (head.length) target.write(head);
		if (upstreamHead.length) socket.write(upstreamHead);
		target.pipe(socket);
		socket.pipe(target);
		socket.on('error', () => target.destroy());
		target.on('error', () => socket.destroy());
		socket.on('close', () => target.destroy());
	});
	upstream.on('response', () => socket.destroy());
	upstream.on('error', () => socket.destroy());
	upstream.end();
});
await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
async function startGateway() {
	const log = fs.createWriteStream(path.join(root, 'gateway-console.log'), {
		flags: 'a',
		mode: 0o600
	});
	gateway = spawn(binary, [entry, 'gateway', 'run', '--allow-unconfigured'], {
		cwd: repo,
		env,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	gateway.stdout.pipe(log, { end: false });
	gateway.stderr.pipe(log, { end: false });
	gateway.on('close', () => log.end());
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline) {
		if (gateway.exitCode !== null) throw Error('Isolated Gateway exited');
		try {
			if ((await fetch(`http://127.0.0.1:${gatewayPort}/health`)).ok) return;
		} catch {
			/* The isolated listener may not be ready yet. */
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw Error('Isolated Gateway startup timed out');
}
async function stopGateway() {
	if (!gateway || gateway.exitCode !== null) return;
	const processToStop = gateway;
	const closed = new Promise((r) => processToStop.once('close', r));
	process.kill(-processToStop.pid, 'SIGTERM');
	await Promise.race([closed, new Promise((r) => setTimeout(r, 8000))]);
	if (processToStop.exitCode === null) {
		process.kill(-processToStop.pid, 'SIGKILL');
		await closed;
	}
}
async function connectOwner() {
	const { GatewayClient } = await import('openclaw/plugin-sdk/gateway-runtime');
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(Error('Fixture identity connection timed out')), 45000);
		client = new GatewayClient({
			url: `ws://127.0.0.1:${proxyPort}`,
			origin: baseURL,
			env,
			clientName: 'openclaw-control-ui',
			clientDisplayName: 'Isolated acceptance fixture',
			clientVersion: '2026.9.3',
			mode: 'webchat',
			role: 'operator',
			scopes: [
				'operator.admin',
				'operator.read',
				'operator.write',
				'operator.approvals',
				'operator.questions'
			],
			onHelloOk: () => {
				clearTimeout(timer);
				resolve(client);
			},
			onConnectError: (error) => {
				fs.writeFileSync(
					path.join(root, 'connect-error.txt'),
					String(error.message).replace(/(?:token|password)\s*[:=]\s*\S+/gi, '[REDACTED]')
				);
			}
		});
		client.start();
	});
}
async function cleanup() {
	if (closing) return;
	closing = true;
	ready = false;
	await client?.stopAndWait({ timeoutMs: 2000 });
	for (const socket of sockets) socket.destroy();
	proxy.closeAllConnections();
	proxy.close();
	await stopGateway();
	if (
		digest(process.execPath) !== systemDigest ||
		fs.statSync(process.execPath).mode !== systemMode ||
		fs.statSync(process.execPath).uid !== systemUid
	)
		throw Error('Original runtime changed');
}
process.once('SIGTERM', () => cleanup().then(() => process.exit(0)));
process.once('SIGINT', () => cleanup().then(() => process.exit(0)));
try {
	await startGateway();
	await connectOwner();
	const self = await client.request('users.self', {});
	profileId = self.profile?.id;
	if (!profileId || profileId === 'gateway-owner')
		throw Error('Verified personal fixture identity missing');
	await client.stopAndWait({ timeoutMs: 2000 });
	await stopGateway();
	const actor = `human:${profileId}`;
	Object.assign(config.plugins.entries[pluginId].config, {
		vaultOwners: [actor],
		documentRoots: [{ id: 'workspace', path: workspace, actors: [actor], writable: true }]
	});
	saveConfig();
	const { Vault } = await import('../plugin/vault/service.mjs'),
		{ WorkStore } = await import('../plugin/work/store.mjs'),
		{ Integrations } = await import('../plugin/integrations/service.mjs'),
		{ adapters } = await import('../plugin/integrations/adapters.mjs');
	const vault = new Vault(path.join(root, 'data/vault'), {
		owners: [actor],
		executors: ['agent:fixture']
	});
	// An earlier Gateway start may already have provisioned this directory, so seed through the same
	// idempotent startup path the plugin uses. The next start unlocks it again.
	await vault.ready();
	await vault.create('agent-created', { api_key: 'SYNTHETIC-AGENT-UI-CANARY' }, 'agent:fixture');
	await vault.lock(actor);
	const work = new WorkStore(path.join(root, 'data/work.db'));
	let counter = 0,
		firstTask;
	const command = (name, input, id) =>
		work.execute(
			{
				command: name,
				input,
				id,
				expected_version: id ? work.get(id).version : undefined,
				idempotency_key: `seed-${++counter}`
			},
			actor
		);
	const project = command('create', {
		type: 'project',
		title: 'Deliver the quarterly operations review',
		description: 'A bounded outcome with a clear review trail.'
	}).target;
	command('create', {
		type: 'milestone',
		project_id: project,
		title: 'Review accepted',
		success_condition: 'The owner accepts the complete review.',
		order: 1
	});
	for (let i = 0; i < 14; i++) {
		const id = command('create', {
			type: 'task',
			title:
				i === 0
					? 'Review the migration plan'
					: `Prepare operating review item ${i + 1} — a realistic long title with clear ownership and acceptance`,
			description: 'Preserve original records and make the next action understandable.',
			done_when: 'The review is recorded and its source is linked.',
			project_id: project
		}).target;
		if (i === 0) firstTask = id;
		if (i % 3 === 0) command('assign', { agent_id: 'main' }, id);
		command('ready', {}, id);
	}
	command('create', {
		type: 'question',
		title: 'Confirm the maintenance window',
		prompt: 'Which maintenance window is confirmed?',
		impact: 'Scheduling depends on the answer.'
	});
	command('create', {
		type: 'decision',
		title: 'Choose the review window',
		prompt: 'When should the review take place?',
		options: [
			{ id: 'morning', label: 'Morning review', summary: 'Leaves time for follow-up.' },
			{ id: 'afternoon', label: 'Afternoon review', summary: 'Allows more preparation.' }
		],
		deciders: [actor],
		recommendation: { option_id: 'morning', rationale: 'Keep time for follow-up.' },
		consequence_of_no_decision: 'The final review cannot be scheduled.'
	});

	const longTask = command('create', {
		type: 'task',
		title: 'Inspect full history and saved evidence',
		description:
			'A detailed observation with its supporting context. '.repeat(55) + 'FULL-SAVED-CONTENT-END',
		done_when: 'The complete saved text and every history page can be read.'
	}).target;
	for (let i = 0; i < 31; i++)
		command(
			'checkpoint',
			{
				content: `Saved checkpoint ${i + 1} for the review trail`,
				reason: 'Preserve a meaningful fixture checkpoint'
			},
			longTask
		);
	command('ready', {}, longTask);
	work.close();
	const integrations = new Integrations(path.join(root, 'data/integrations.db'), vault, adapters());
	integrations.create(
		{
			id: 'cloudflare-fixture',
			provider: 'cloudflare',
			purpose: 'Synthetic connection — not live authentication',
			owner: 'falcon',
			vault_handle: 'agent-created',
			actors: [actor],
			account_id: 'a'.repeat(32)
		},
		actor
	);
	await integrations.run('cloudflare-fixture', 'pause', actor);
	await integrations.close();
	fs.writeFileSync(
		path.join(workspace, 'Operating notes.md'),
		'# Operating notes\n\nA safe workspace document for the quarterly review.\n'
	);
	fs.writeFileSync(
		path.join(workspace, 'Untrusted sample.md'),
		'# Safe heading\n\n<script>window.documentEscaped=true</script>\n<img src="https://invalid.example/track" onerror="alert(1)">\n'
	);
	await startGateway();
	await connectOwner();
	await client.request('falcon.identity', {});
	const session = await client.request('sessions.create', {
		agentId: 'main',
		label: 'Review follow-up'
	});
	const sessionKey = session.key ?? session.sessionKey;
	if (!sessionKey) throw Error('Native session key missing');
	const currentTask = await client.request('falcon.work.read', { action: 'get', id: firstTask });
	await client.request('falcon.work.write', {
		action: 'command',
		request: {
			command: 'ask',
			id: firstTask,
			expected_version: currentTask.version,
			idempotency_key: 'native-ask-fixture',
			input: {
				requirement: 'Owner review',
				intended_command: 'complete',
				thread: { session_key: sessionKey, agent_id: 'main' },
				prompt: 'Please review the completion criteria.'
			}
		}
	});

	const boundedRequest = async (method, input) => {
		let timer;
		try {
			return await Promise.race([
				client.request(method, input),
				new Promise((_, reject) => {
					timer = setTimeout(() => reject(Error('Gateway responsiveness deadline exceeded')), 3000);
				})
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	const documentRoots = await boundedRequest('falcon.documents.read', { action: 'roots' });
	const documentRoot = (documentRoots.roots ?? documentRoots).find((r) => r.id === 'workspace');
	if (!documentRoot) throw Error('Fixture document root missing');
	const swapPath = path.join(workspace, 'Swapped fixture.md');
	for (const kind of ['fifo', 'symlink']) {
		fs.writeFileSync(swapPath, 'Listed regular document');
		await boundedRequest('falcon.documents.read', { action: 'list', root_id: documentRoot.id });
		fs.unlinkSync(swapPath);
		if (kind === 'fifo') await run('mkfifo', 'mkfifo', [swapPath]);
		else fs.symlinkSync('/dev/zero', swapPath);
		let rejected = false;
		try {
			await boundedRequest('falcon.documents.read', {
				action: 'read',
				root_id: documentRoot.id,
				path: 'Swapped fixture.md'
			});
		} catch (error) {
			if (error.message === 'Gateway responsiveness deadline exceeded') throw error;
			rejected = true;
		}
		if (!rejected) throw Error('Unsafe document read was accepted');
		fs.unlinkSync(swapPath);
		await boundedRequest('falcon.ui.status', {});
	}
	const status = await client.request('falcon.ui.status', {});
	const nativeStatus = await client.request('plugins.controlUi.status', {});
	if (status.modules.length !== 4) throw Error('Missing module registrations');
	const proof = {
		root,
		baseURL,
		profileId,
		openclaw: '2026.9.3',
		realGateway: true,
		documentSwapResponsiveness: { fifo: true, symlink: true, deadlineMs: 3000 },
		identity: 'trusted-proxy fixture',
		nativeUiOptIn: true,
		nativeStatus,
		modules: status.modules,
		systemRuntimeUnchanged: true,
		liveProviderAuthentication: false
	};
	fs.writeFileSync(path.join(root, 'host-proof.json'), JSON.stringify(proof, null, 2));
	ready = true;
	console.log(JSON.stringify({ ready: true, baseURL, root }));
	if (process.argv.includes('--host-only')) {
		await cleanup();
		process.exit(0);
	}
} catch (error) {
	fs.writeFileSync(path.join(root, 'harness-error.txt'), String(error.message));
	await cleanup();
	throw error;
}
