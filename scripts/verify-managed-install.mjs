// Synthetic install/ownership proof. No operator state, credentials, or system mutation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pluginId } from './plugin-identity.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = path.join(repo, 'artifacts/plugin-v4', `managed-install-${process.pid}`);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const entry = fs.realpathSync(path.join(repo, 'node_modules/openclaw/openclaw.mjs'));
if (
	JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'))).version !== '2026.9.3'
)
	throw Error('Pinned SDK required');
const runtime = path.join(root, 'runtime');
fs.mkdirSync(runtime, { mode: 0o700 });
const node = path.join(runtime, 'node'),
	systemStat = fs.statSync(process.execPath);
fs.copyFileSync(process.execPath, node, fs.constants.COPYFILE_EXCL);
const copied = fs.lstatSync(node);
if (copied.uid !== process.getuid() || copied.isSymbolicLink())
	throw Error('Fixture executable is not owned by this user');
// CI toolcache modes may be writable by a group. Tighten only this newly created copy.
fs.chmodSync(node, 0o700);
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const digest = hash(process.execPath),
	ownedStat = fs.lstatSync(node);
if (
	hash(node) !== digest ||
	ownedStat.uid !== process.getuid() ||
	ownedStat.isSymbolicLink() ||
	ownedStat.mode & 0o022
)
	throw Error('Owned runtime identity/permissions mismatch');
const configFile = path.join(root, 'config.json');
fs.writeFileSync(
	configFile,
	JSON.stringify(
		{
			gateway: {
				mode: 'local',
				bind: 'loopback',
				auth: { mode: 'none' },
				port: 28971,
				controlUi: { experimental: { customPlugins: true } }
			},
			agents: { defaults: { workspace: path.join(root, 'workspace') } },
			plugins: {
				allow: [pluginId],
				entries: { [pluginId]: { enabled: true, config: { dataDir: path.join(root, 'data') } } }
			},
			logging: { file: path.join(root, 'runtime.log') }
		},
		null,
		2
	),
	{ mode: 0o600 }
);
const env = {
	PATH: process.env.PATH,
	HOME: root,
	OPENCLAW_STATE_DIR: path.join(root, 'state'),
	OPENCLAW_CONFIG_PATH: configFile
};
async function run(name, command, args) {
	const child = spawn(command, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '';
	child.stdout.on('data', (chunk) => {
		if (stdout.length < 1048576) stdout += chunk.toString();
	});
	const output = fs.createWriteStream(path.join(root, `${name}.log`), { mode: 0o600 });
	let bytes = 0,
		truncated = false;
	const retain = (chunk) => {
		bytes += chunk.length;
		if (bytes <= 1048576) output.write(chunk);
		else if (!truncated) {
			truncated = true;
			output.write('\nHarness log exceeded 1 MiB; remaining log omitted.\n');
		}
	};
	child.stdout.on('data', retain);
	child.stderr.on('data', retain);
	const code = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('close', resolve);
	});
	output.end();
	if (code !== 0) throw Error(`${name} failed; inspect its synthetic log`);
	return stdout;
}
await run('pack', 'npm', ['pack', '--ignore-scripts', '--pack-destination', root]);
const archives = fs.readdirSync(root).filter((p) => p.endsWith('.tgz'));
if (archives.length !== 1) throw Error('Expected one archive');
await run('install', node, [
	entry,
	'plugins',
	'install',
	path.join(root, archives[0]),
	'--accept-capabilities',
	'--force'
]);
const inspection = JSON.parse(
	await run('runtime-inspect', node, [entry, 'plugins', 'inspect', pluginId, '--runtime', '--json'])
);
if (
	inspection.plugin?.status !== 'loaded' ||
	!inspection.plugin.toolNames?.includes('falcon_vault')
)
	throw Error('Packaged runtime registration failed');
await run('managed-audit', node, [
	path.join(repo, 'scripts/verify-managed-secretref.mjs'),
	entry,
	root
]);
await run('managed-provider', node, [
	path.join(repo, 'scripts/verify-plugin-prompt.mjs'),
	entry,
	root,
	'managed'
]);
if (
	hash(process.execPath) !== digest ||
	fs.statSync(process.execPath).uid !== systemStat.uid ||
	fs.statSync(process.execPath).mode !== systemStat.mode
)
	throw Error('System runtime changed');
const proof = {
	root,
	openclaw: '2026.9.3',
	node: process.version,
	nodeSha256: digest,
	systemRuntimeUnchanged: true,
	nativeUiDeclared: JSON.parse(fs.readFileSync(path.join(repo, 'openclaw.plugin.json'))).controlUi,
	isolatedCustomPlugins: true,
	runtimeStatus: inspection.plugin.status,
	copiedRuntimeMode: (copied.mode & 0o777).toString(8),
	fixtureRuntimeMode: (fs.statSync(node).mode & 0o777).toString(8),
	preset: JSON.parse(fs.readFileSync(path.join(root, 'managed-preset-proof.json'))),
	provider: JSON.parse(fs.readFileSync(path.join(root, 'provider-bound-proof.json')))
};
fs.writeFileSync(path.join(root, 'combined-proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
