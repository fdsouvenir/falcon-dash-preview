import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Vault } from '../plugin/vault/service.mjs';
import { pluginId } from './plugin-identity.mjs';
const [entry, root] = process.argv.slice(2);
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
if (
	!entry ||
	!path.isAbsolute(entry) ||
	!root ||
	!root.startsWith(artifacts) ||
	fs.realpathSync(root) !== root
)
	throw Error('Use a canonical isolated artifacts root');
if (
	JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'))).version !== '2026.9.3'
)
	throw Error('Pinned OpenClaw required');
const executable = fs.lstatSync(process.execPath);
if (executable.isSymbolicLink() || executable.uid !== process.getuid() || executable.mode & 0o022)
	throw Error('Run this harness with a user-owned, non-writable-by-others Node executable');
const configFile = path.join(root, 'config.json'),
	original = fs.readFileSync(configFile),
	config = JSON.parse(original),
	installed = path.join(root, 'state/extensions/falcon-dash'),
	parked = path.join(root, 'managed-test-removed-plugin');
if (!fs.existsSync(path.join(installed, 'openclaw.plugin.json')) || fs.existsSync(parked))
	throw Error('Expected installed isolated plugin without parked state');
const directory = path.join(root, 'managed-vault'),
	vault = new Vault(directory, { owners: ['human:fixture'] });
const sentinel = 'SYNTHETIC-MANAGED-PRESET-ONLY';
await vault.ready();
if (!(await vault.inventory('human:fixture')).entries.some((x) => x.id === 'fixture'))
	await vault.create('fixture', { password: sentinel }, 'human:fixture');
await vault.grantSecretRefs(['entries/fixture/password'], 'human:fixture');
config.secrets = {
	providers: {
		'falcon-vault': {
			source: 'exec',
			pluginIntegration: { pluginId, integrationId: 'keepassxc' }
		}
	}
};
config.models = {
	providers: {
		fixture: {
			baseUrl: 'http://127.0.0.1:28972/v1',
			api: 'openai-completions',
			apiKey: { source: 'exec', provider: 'falcon-vault', id: 'entries/fixture/password' },
			models: [{ id: 'fixture', name: 'Synthetic fixture', contextWindow: 200000, maxTokens: 2048 }]
		}
	}
};
const env = {
	PATH: '/usr/bin:/bin',
	HOME: root,
	OPENCLAW_STATE_DIR: path.join(root, 'state'),
	OPENCLAW_CONFIG_PATH: configFile,
	FALCON_VAULT_DIRECTORY: directory
};
const save = () => fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
async function audit(name) {
	const child = spawn(process.execPath, [entry, 'secrets', 'audit', '--allow-exec', '--json'], {
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let out = '',
		err = '';
	child.stdout.on('data', (b) => (out += b));
	child.stderr.on('data', (b) => (err += b));
	const code = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('close', resolve);
	});
	if ((out + err).includes(sentinel)) throw Error('Synthetic value leaked');
	let report;
	try {
		report = JSON.parse(out);
	} catch {
		throw Error(`Native audit did not produce JSON (${name}, exit ${code})`);
	}
	fs.writeFileSync(path.join(root, `managed-${name}.json`), JSON.stringify(report, null, 2));
	return report;
}
const clean = (r) =>
	r.status === 'clean' &&
	r.resolution.refsChecked === 1 &&
	r.summary.unresolvedRefCount === 0 &&
	r.summary.plaintextCount === 0;
const denied = (r) => r.summary.unresolvedRefCount === 1 && r.summary.plaintextCount === 0;
try {
	config.plugins.entries[pluginId].enabled = true;
	save();
	if (!clean(await audit('enabled'))) throw Error('Managed preset did not resolve');
	config.plugins.entries[pluginId].enabled = false;
	save();
	if (!denied(await audit('disabled')))
		throw Error('Disabled owner did not revoke managed resolution');
	config.plugins.entries[pluginId].enabled = true;
	save();
	fs.renameSync(installed, parked);
	if (!denied(await audit('removed')))
		throw Error('Removed owner did not revoke managed resolution');
	fs.renameSync(parked, installed);
	if (!clean(await audit('restored'))) throw Error('Restored managed owner did not resolve');
	await vault.lock();
	if (!denied(await audit('locked'))) throw Error('Vault lock did not deny managed resolution');
	const proof = {
		openclaw: '2026.9.3',
		node: process.execPath,
		nodeUid: executable.uid,
		processUid: process.getuid(),
		managed: true,
		enabled: true,
		disabledDenied: true,
		removedDenied: true,
		restored: true,
		lockedDenied: true,
		manualFallback: false,
		secretLeak: false
	};
	fs.writeFileSync(path.join(root, 'managed-preset-proof.json'), JSON.stringify(proof, null, 2));
	console.log(JSON.stringify(proof, null, 2));
} finally {
	if (fs.existsSync(parked)) fs.renameSync(parked, installed);
	fs.writeFileSync(configFile, original);
	await vault.lock();
}
