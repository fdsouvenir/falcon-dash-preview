import { fileURLToPath } from 'node:url';
import { buildContract } from '../plugin/contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Vault } from '../plugin/vault/service.mjs';
import { WorkStore } from '../plugin/work/store.mjs';
import { pluginId } from './plugin-identity.mjs';
const [entry, root, resolverMode = 'manual'] = process.argv.slice(2);
if (!['manual', 'managed'].includes(resolverMode))
	throw Error('Choose manual or managed resolver mode');
if (
	resolverMode === 'managed' &&
	(fs.statSync(process.execPath).uid !== process.getuid() ||
		fs.statSync(process.execPath).mode & 0o022)
)
	throw Error('Managed proof requires the user-owned Node runtime');
const normalState = path.resolve(process.env.HOME ?? '/nonexistent', '.openclaw');
const artifactRoot = fileURLToPath(new URL('../artifacts/', import.meta.url));
if (
	!entry ||
	!root ||
	!path.isAbsolute(entry) ||
	!path.isAbsolute(root) ||
	path.resolve(root) !== root ||
	fs.realpathSync(root) !== root ||
	root === normalState ||
	root.startsWith(normalState + path.sep) ||
	!root.startsWith(artifactRoot)
)
	throw new Error(
		'Use an explicit pinned entry and canonical isolated root under this repository artifacts directory'
	);
const version = JSON.parse(
	fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8')
).version;
if (version !== '2026.9.3') throw new Error('This harness pins OpenClaw 2026.9.3');
const configFile = path.join(root, 'config.json'),
	original = fs.readFileSync(configFile),
	config = JSON.parse(original.toString());
const installed = path.join(root, 'state/extensions/falcon-dash');
if (!fs.existsSync(path.join(installed, 'plugin/index.mjs')))
	throw new Error('Install the reviewed archive in this isolated state first');
const secret = 'SYNTHETIC-PROVIDER-BOUND-CANARY',
	live = 'FALCON-LIVE-RECORD-MUST-NOT-BE-IN-STATIC-CONTEXT';
const vaultDir = path.join(root, 'prompt-vault'),
	vault = new Vault(vaultDir, { owners: ['human:fixture'] });
await vault.ready();
if (!(await vault.inventory('human:fixture')).entries.some((x) => x.id === 'fixture'))
	await vault.create('fixture', { password: secret }, 'human:fixture');
await vault.grantSecretRefs(['entries/fixture/password'], 'human:fixture');
const work = new WorkStore(path.join(root, 'data/work.db'));
work.execute(
	{
		command: 'create',
		idempotency_key: 'prompt-proof-fixture',
		input: {
			type: 'task',
			title: live,
			description: 'A live record that must not enter the static contract',
			done_when: 'The provider request excludes this live record'
		}
	},
	'agent:fixture'
);
work.close();
config.gateway = {
	...config.gateway,
	mode: 'local',
	bind: 'loopback',
	port: 28971,
	auth: { mode: 'none' }
};
config.agents = {
	defaults: {
		workspace: path.join(root, 'workspace'),
		model: { primary: 'falcon-fixture/fixture' }
	}
};
config.secrets = {
	providers: {
		'falcon-vault': {
			source: 'exec',
			command: path.join(installed, 'plugin/vault/resolve-secrets.mjs'),
			trustedDirs: [installed],
			env: { FALCON_VAULT_DIRECTORY: vaultDir },
			passEnv: ['PATH'],
			timeoutMs: 20000,
			jsonOnly: true
		}
	}
};
if (resolverMode === 'managed')
	config.secrets.providers['falcon-vault'] = {
		source: 'exec',
		pluginIntegration: { pluginId, integrationId: 'keepassxc' }
	};
config.models = {
	providers: {
		'falcon-fixture': {
			baseUrl: 'http://127.0.0.1:28972/v1',
			api: 'openai-completions',
			apiKey: { source: 'exec', provider: 'falcon-vault', id: 'entries/fixture/password' },
			models: [
				{
					id: 'fixture',
					name: 'Synthetic fixture',
					reasoning: false,
					input: ['text'],
					contextWindow: 200000,
					maxTokens: 2048,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
				}
			]
		}
	}
};
config.logging = { file: path.join(root, 'prompt-runtime.log') };
config.plugins.entries[pluginId].hooks = { allowConversationAccess: true };
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
const env = {
	PATH: '/usr/bin:/bin',
	HOME: root,
	OPENCLAW_STATE_DIR: path.join(root, 'state'),
	OPENCLAW_CONFIG_PATH: configFile
};
if (resolverMode === 'managed') env.FALCON_VAULT_DIRECTORY = vaultDir;
let gateway,
	agent,
	requests = [];
const text = (message) =>
	typeof message.content === 'string'
		? message.content
		: (message.content ?? []).map((p) => p.text ?? '').join('\n');
const server = http.createServer(async (req, res) => {
	try {
		let body = '';
		for await (const chunk of req) {
			body += chunk;
			if (Buffer.byteLength(body) > 2000000) throw new Error('Oversized fixture request');
		}
		if (!req.url.endsWith('/chat/completions')) {
			res.writeHead(404);
			res.end();
			return;
		}
		const parsed = JSON.parse(body);
		if (body.includes(secret) || body.includes(live))
			throw new Error('Protected or live data entered provider body');
		const systems = (parsed.messages ?? [])
			.filter((m) => ['system', 'developer'].includes(m.role))
			.map(text)
			.join('\n');
		const users = (parsed.messages ?? [])
			.filter((m) => m.role === 'user')
			.map(text)
			.join('\n');
		requests.push({
			system:
				systems.includes(buildContract(['work', 'integrations', 'vault', 'documents'])) &&
				systems.split(buildContract(['work', 'integrations', 'vault', 'documents'])).length === 2,
			user: users.includes('"plugin":"falcon-dash"'),
			credentialDelivered: req.headers.authorization === `Bearer ${secret}`,
			body: parsed
		});
		if (parsed.stream) {
			res.writeHead(200, { 'Content-Type': 'text/event-stream' });
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixture complete.' }, finish_reason: null }] })}\n\n`
			);
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`
			);
			res.end();
		} else {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					id: 'fixture',
					object: 'chat.completion',
					created: 1,
					model: 'fixture',
					choices: [
						{
							index: 0,
							message: { role: 'assistant', content: 'Fixture complete.' },
							finish_reason: 'stop'
						}
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
				})
			);
		}
	} catch {
		res.writeHead(500);
		res.end('Fixture validation failed');
	}
});
function launch(args) {
	const child = spawn(process.execPath, ['--max-old-space-size=768', entry, ...args], {
		cwd: root,
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout.on('data', (b) => {
		output += b;
		if (output.length > 2000000) child.kill('SIGTERM');
	});
	child.stderr.on('data', (b) => {
		output += b;
		if (output.length > 2000000) child.kill('SIGTERM');
	});
	return {
		child,
		output: () => output,
		done: new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', (code) => resolve(code));
		})
	};
}
try {
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(28972, '127.0.0.1', resolve);
	});
	gateway = launch(['gateway', 'run', '--port', '28971', '--bind', 'loopback', '--auth', 'none']);
	const readyUntil = Date.now() + 30000;
	while (Date.now() < readyUntil && !gateway.output().includes('[gateway] ready')) {
		if (gateway.child.exitCode !== null)
			throw new Error('Isolated Gateway exited before readiness');
		await new Promise((r) => setTimeout(r, 250));
	}
	if (!gateway.output().includes('[gateway] ready'))
		throw new Error('Isolated Gateway did not become ready');
	agent = launch([
		'agent',
		'--agent',
		'main',
		'--session-id',
		randomUUID(),
		'--model',
		'falcon-fixture/fixture',
		'--message',
		'Reply only with Fixture complete. Do not call any tools.',
		'--thinking',
		'off',
		'--timeout',
		'45',
		'--json'
	]);
	const timer = setTimeout(() => agent.child.kill('SIGTERM'), 60000);
	const code = await agent.done;
	clearTimeout(timer);
	if (agent.output().includes(secret) || gateway.output().includes(secret))
		throw new Error('Synthetic credential appeared in runtime output');
	fs.writeFileSync(path.join(root, 'prompt-agent-output.txt'), agent.output());
	if (
		code !== 0 ||
		!requests.length ||
		requests.some((r) => !r.system || r.user || !r.credentialDelivered)
	)
		throw new Error('Provider-bound system/credential assertions did not pass');
	const report = {
		openclaw: version,
		requests: requests.length,
		systemInjection: true,
		userInjection: false,
		secretBodyLeak: false,
		liveRecordLeak: false,
		resolverMode,
		credentialDeliveredToLocalFixture: true
	};
	fs.writeFileSync(
		path.join(root, 'provider-request.json'),
		JSON.stringify(
			requests.map((r) => r.body),
			null,
			2
		)
	);
	fs.writeFileSync(path.join(root, 'provider-bound-proof.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));
} finally {
	agent?.child.kill('SIGTERM');
	if (gateway) {
		gateway.child.kill('SIGTERM');
		await gateway.done;
	}
	await new Promise((resolve) => server.close(resolve));
	await vault.lock();
	fs.writeFileSync(configFile, original);
}
