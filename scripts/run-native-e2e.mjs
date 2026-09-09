import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = path.join(repo, 'artifacts/plugin-v4', `native-e2e-${Date.now()}-${process.pid}`);
const env = {
	...process.env,
	FALCON_E2E_ROOT: root,
	OPENCLAW_STATE_DIR: path.join(root, 'state'),
	OPENCLAW_CONFIG_PATH: path.join(root, 'config.json')
};
const hostOnly = process.argv.includes('--host-only');
const args = hostOnly
	? [path.join(repo, 'scripts/native-gateway-harness.mjs'), '--host-only']
	: [
			path.join(repo, 'node_modules/@playwright/test/cli.js'),
			'test',
			'--config',
			path.join(repo, 'playwright.native.config.ts'),
			...process.argv.slice(2)
		];
const child = spawn(process.execPath, args, { cwd: repo, env, stdio: 'inherit' });
child.on('error', () => {
	process.exitCode = 1;
});
child.on('exit', (code) => {
	let secretLogLeak = false;
	for (const name of ['gateway.log', 'gateway-console.log', 'install.log']) {
		const file = path.join(root, name);
		if (fs.existsSync(file)) {
			const text = fs.readFileSync(file, 'utf8');
			if (
				['SYNTHETIC-HUMAN-UI-CANARY', 'SYNTHETIC-AGENT-UI-CANARY'].some((value) =>
					text.includes(value)
				)
			)
				secretLogLeak = true;
		}
	}
	if (fs.existsSync(root))
		fs.writeFileSync(
			path.join(root, 'runner-result.json'),
			JSON.stringify({ exitCode: code, secretLogLeak, hostOnly }, null, 2)
		);
	process.exitCode = secretLogLeak ? 1 : (code ?? 1);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
