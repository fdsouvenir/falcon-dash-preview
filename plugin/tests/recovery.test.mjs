import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkStore } from '../work/store.mjs';
import { Vault } from '../vault/service.mjs';

test('SQLite snapshot restores revisioned Work, event history and idempotency receipts', (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-recovery-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const source = new WorkStore(path.join(directory, 'source.db'));
	t.after(() => source.close());
	const request = {
		command: 'create',
		idempotency_key: 'restored-receipt',
		input: {
			type: 'task',
			title: 'Verify offline recovery',
			description: 'Synthetic data only; preserve revision and history',
			done_when: 'Restored values equal source values'
		}
	};
	const result = source.execute(request, 'agent:synthetic');
	const backup = path.join(directory, 'backup.db');
	source.db.prepare('VACUUM INTO ?').run(backup);
	fs.chmodSync(backup, 0o600);
	const restored = new WorkStore(backup);
	t.after(() => restored.close());
	assert.deepEqual(restored.detail(result.target, true), source.detail(result.target, true));
	assert.equal(restored.execute(request, 'agent:synthetic').noop, true);
	assert.equal(restored.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
});

test('Quiesced encrypted Vault and private key backup restores synthetic owner access', async (t) => {
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-vault-recovery-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const owners = ['human:synthetic'];
	const source = new Vault(path.join(directory, 'source'), { owners });
	await source.initialize(owners[0]);
	await source.unlock(owners[0]);
	await source.create('sample', { password: 'SYNTHETIC-RESTORE-CANARY' }, owners[0]);
	await source.lock();
	const target = path.join(directory, 'restored');
	fs.mkdirSync(target, { mode: 0o700 });
	for (const file of ['credentials.kdbx', 'unlock.key', 'policy.json', 'audit.db']) {
		fs.copyFileSync(
			path.join(directory, 'source', file),
			path.join(target, file),
			fs.constants.COPYFILE_EXCL
		);
		fs.chmodSync(path.join(target, file), 0o600);
	}
	const restored = new Vault(target, { owners });
	await restored.unlock(owners[0]);
	assert.equal((await restored.reveal('sample', owners[0])).password, 'SYNTHETIC-RESTORE-CANARY');
	await restored.lock();
});

test('Private Vault snapshot restores only into a new offline destination and rejects corruption', async (t) => {
	const { restoreVaultSnapshot } = await import('../vault/recovery.mjs');
	const directory = fs.mkdtempSync(tmpdir() + '/falcon-private-recovery-');
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const owners = ['human:recovery'];
	const source = new Vault(path.join(directory, 'source'), { owners });
	await source.initialize(owners[0]);
	await source.unlock(owners[0]);
	await source.create('sample', { password: 'SYNTHETIC-RECOVERY-ONLY' }, owners[0]);
	const snapshot = await source.worker({ action: 'backup', actor: owners[0] });
	assert.equal(JSON.stringify(snapshot).includes('SYNTHETIC-RECOVERY-ONLY'), false);
	const from = path.join(source.directory, 'recovery', snapshot.id),
		target = path.join(directory, 'restored');
	assert.throws(() => restoreVaultSnapshot(from, target));
	assert.equal(restoreVaultSnapshot(from, target, { quiesced: true }).locked, true);
	assert.throws(() => restoreVaultSnapshot(from, target, { quiesced: true }));
	const restored = new Vault(target, { owners });
	await restored.unlock(owners[0]);
	assert.equal((await restored.reveal('sample', owners[0])).password, 'SYNTHETIC-RECOVERY-ONLY');
	await restored.lock();
	fs.appendFileSync(path.join(from, 'credentials.kdbx'), 'corrupt');
	assert.throws(
		() => restoreVaultSnapshot(from, path.join(directory, 'corrupt-restore'), { quiesced: true }),
		/integrity/
	);
	assert.equal(fs.existsSync(path.join(directory, 'corrupt-restore')), false);
	await source.lock();
});
