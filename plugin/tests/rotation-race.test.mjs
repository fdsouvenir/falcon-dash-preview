import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { Vault } from '../vault/service.mjs';
import { Integrations } from '../integrations/service.mjs';
function hold(file) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			'flock',
			[
				'--exclusive',
				file,
				process.execPath,
				'-e',
				"process.stdin.resume();process.stdout.write('ready');process.stdin.on('end',()=>process.exit(0));"
			],
			{ stdio: ['pipe', 'pipe', 'pipe'] }
		);
		child.stderr.resume();
		child.once('error', reject);
		child.stdout.once('data', () => resolve(() => child.stdin.end()));
	});
}
test(
	'Queued real KeePassXC rotation rechecks connection authority inside its commit lock',
	{ timeout: 20000 },
	async (t) => {
		const directory = mkdtempSync(tmpdir() + '/falcon-rotation-fence-');
		const vault = new Vault(directory + '/vault', {
			owners: ['human:owner'],
			executors: ['agent:worker']
		});
		await vault.initialize('human:owner');
		await vault.unlock('human:owner');
		await vault.create(
			'token',
			{ access_token: 'SYNTHETIC-OLD', refresh_token: 'SYNTHETIC-OLD-REFRESH' },
			'agent:worker'
		);
		let release, rotationStarted;
		const started = new Promise((r) => (rotationStarted = r));
		const original = vault.rotate.bind(vault);
		vault.rotate = (...args) => {
			rotationStarted();
			return original(...args);
		};
		const integrations = new Integrations(directory + '/integrations.db', vault, {
			fixture: {
				refresh: async () => {
					release = await hold(directory + '/vault/transaction.lock');
					return {
						material: { access_token: 'SYNTHETIC-NEW', refresh_token: 'SYNTHETIC-NEW-REFRESH' }
					};
				}
			}
		});
		t.after(async () => {
			release?.();
			await integrations.close();
			await vault.lock();
			rmSync(directory, { recursive: true });
		});
		integrations.create(
			{
				id: 'connection',
				provider: 'fixture',
				purpose: 'Actual cross-store race',
				owner: 'falcon',
				vault_handle: 'token',
				actors: ['agent:worker']
			},
			'agent:worker'
		);
		const pending = integrations.run('connection', 'refresh', 'agent:worker');
		await started;
		await integrations.run('connection', 'disconnect', 'agent:worker');
		release();
		await assert.rejects(() => pending, { code: 'authority_changed' });
		assert.equal((await vault.reveal('token', 'human:owner')).access_token, 'SYNTHETIC-OLD');
		assert.equal(integrations.get('connection').disconnected, true);
	}
);
