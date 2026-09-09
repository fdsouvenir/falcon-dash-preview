import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { connectionAuthority } from '../authority.mjs';
import { Integrations } from '../integrations/service.mjs';
import { adapters } from '../integrations/adapters.mjs';
import { Vault } from '../vault/service.mjs';
import { protectedProcess, liveGroupMembers } from '../vault/process.mjs';
const gate = () => {
	let release;
	const promise = new Promise((r) => (release = r));
	return { promise, release };
};
for (const revoke of ['connection', 'disconnect'])
	test(`No provider request after ${revoke} while secret resolution waits`, async (t) => {
		const dir = fs.mkdtempSync(tmpdir() + '/falcon-authority-'),
			prepared = gate(),
			resume = gate(),
			client = { connId: 'original', invalidated: false };
		let requests = 0,
			writes = 0;
		const vault = {
			async resolveForExecution(_id, _actor, fn) {
				prepared.release();
				await resume.promise;
				return fn({ version: 1, material: {} });
			},
			async rotate() {
				writes++;
			}
		};
		const service = new Integrations(dir + '/integrations.db', vault, {
			fixture: {
				async test() {
					requests++;
					return { health: 'healthy' };
				}
			}
		});
		t.after(async () => {
			await service.close();
			fs.rmSync(dir, { recursive: true });
		});
		service.create(
			{
				id: 'one',
				provider: 'fixture',
				purpose: 'Authority race',
				owner: 'falcon',
				vault_handle: 'one',
				actors: ['agent:worker']
			},
			'agent:worker'
		);
		const run = service.run('one', 'test', 'agent:worker', connectionAuthority(client));
		const rejection = assert.rejects(run);
		await prepared.promise;
		if (revoke === 'connection') client.invalidated = true;
		else await service.run('one', 'disconnect', 'agent:worker');
		resume.release();
		await rejection;
		assert.equal(requests, 0);
		assert.equal(writes, 0);
		if (revoke === 'disconnect') assert.equal(service.get('one').disconnected, true);
	});
for (const revoke of ['connection', 'lock'])
	test(`Physical adapter dispatch rechecks ${revoke} after awaited preparation`, async (t) => {
		const dir = fs.mkdtempSync(tmpdir() + '/falcon-io-'),
			prepared = gate(),
			resume = gate(),
			client = { connId: 'original', invalidated: false };
		let locked = false,
			requests = 0;
		const stock = adapters(async () => {
			requests++;
			return { ok: true, json: async () => ({ location: { id: 'one' } }) };
		});
		const vault = {
			async resolveForExecution(_id, _actor, fn) {
				return fn(
					{ version: 1, material: { access_token: 'SYNTHETIC' } },
					{
						assert() {
							assert.equal(locked, false);
						}
					}
				);
			}
		};
		const service = new Integrations(dir + '/integrations.db', vault, {
			fixture: {
				async test(m, c, guard) {
					prepared.release();
					await resume.promise;
					return stock.highlevel.test(m, c, guard);
				}
			}
		});
		t.after(async () => {
			await service.close();
			fs.rmSync(dir, { recursive: true });
		});
		service.create(
			{
				id: 'one',
				provider: 'fixture',
				purpose: 'I/O race',
				owner: 'falcon',
				vault_handle: 'one',
				account_id: 'one',
				actors: ['agent:worker']
			},
			'agent:worker'
		);
		const run = service.run('one', 'test', 'agent:worker', connectionAuthority(client)),
			rejection = assert.rejects(run);
		await prepared.promise;
		if (revoke === 'connection') client.invalidated = true;
		else locked = true;
		resume.release();
		await rejection;
		assert.equal(requests, 0);
	});
test('Original authority is checked by the real encrypted writer at publication', async (t) => {
	const dir = fs.mkdtempSync(tmpdir() + '/falcon-commit-'),
		vault = new Vault(dir, { owners: ['human:owner'], executors: ['agent:worker'] });
	t.after(() => fs.rmSync(dir, { recursive: true }));
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('entry', { password: 'SYNTHETIC-ORIGINAL' }, 'agent:worker');
	let checks = 0;
	const client = { connId: 'original', invalidated: false },
		base = connectionAuthority(client),
		authority = {
			assert() {
				if (++checks === 2) client.invalidated = true;
				base.assert();
			}
		};
	await assert.rejects(
		() =>
			vault.rotate(
				'entry',
				{ password: 'SYNTHETIC-REPLACEMENT' },
				1,
				'agent:worker',
				undefined,
				authority
			),
		{ code: 'authority_changed' }
	);
	assert.ok(checks >= 2);
	assert.equal(await vault.revealField('entry', 'password', 'human:owner'), 'SYNTHETIC-ORIGINAL');
	await vault.lock();
});
test('Protected return rejects authority lost while an asynchronous consumer prepares a value', async (t) => {
	const dir = fs.mkdtempSync(tmpdir() + '/falcon-return-'),
		vault = new Vault(dir, { owners: ['human:owner'] });
	t.after(() => fs.rmSync(dir, { recursive: true }));
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('entry', { password: 'SYNTHETIC' }, 'human:owner');
	const ready = gate(),
		resume = gate(),
		client = { connId: 'original', invalidated: false };
	const run = vault.resolveForExecution(
			'entry',
			'human:owner',
			async (record) => {
				ready.release();
				await resume.promise;
				return record.material.password;
			},
			{ human: true, authority: connectionAuthority(client) }
		),
		rejection = assert.rejects(run, { code: 'authority_changed' });
	await ready.promise;
	client.invalidated = true;
	resume.release();
	await rejection;
	await vault.lock();
});
test('Timeout terminates an owned grandchild before settling; no delayed writer survives', async (t) => {
	const dir = fs.mkdtempSync(tmpdir() + '/falcon-process-');
	t.after(() => fs.rmSync(dir, { recursive: true }));
	const script = dir + '/parent.mjs';
	fs.writeFileSync(
		script,
		`import {spawn} from 'node:child_process';import fs from 'node:fs';const c=spawn(process.execPath,['-e',${JSON.stringify("process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'unexpected'),1200)")},process.argv[2]],{stdio:['ignore','inherit','inherit']});fs.writeFileSync(process.argv[3],JSON.stringify({group:Number(fs.readFileSync('/proc/self/stat','utf8').split(') ').at(-1).split(' ')[2]),child:c.pid}));setInterval(()=>{},1000);`
	);
	await assert.rejects(
		() =>
			protectedProcess(
				'flock',
				['--exclusive', dir + '/lock', process.execPath, script, dir + '/written', dir + '/pids'],
				{},
				{ timeoutMs: 450 }
			),
		{ code: 'vault_timeout' }
	);
	const pids = JSON.parse(fs.readFileSync(dir + '/pids', 'utf8'));
	assert.deepEqual(liveGroupMembers(pids.group), []);
	await new Promise((r) => setTimeout(r, 1250));
	assert.equal(fs.existsSync(dir + '/written'), false);
});
test('Real Vault lock during provider preparation prevents dispatch', async (t) => {
	const dir = fs.mkdtempSync(tmpdir() + '/falcon-real-lock-'),
		vault = new Vault(dir + '/vault', { owners: ['human:owner'], executors: ['agent:worker'] }),
		ready = gate(),
		resume = gate();
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('entry', { access_token: 'SYNTHETIC' }, 'agent:worker');
	let requests = 0;
	const stock = adapters(async () => {
		requests++;
		return { ok: true, json: async () => ({ location: { id: 'one' } }) };
	});
	const service = new Integrations(dir + '/integrations.db', vault, {
		fixture: {
			async test(m, c, guard) {
				ready.release();
				await resume.promise;
				return stock.highlevel.test(m, c, guard);
			}
		}
	});
	t.after(async () => {
		await service.close();
		await vault.lock();
		fs.rmSync(dir, { recursive: true });
	});
	service.create(
		{
			id: 'one',
			provider: 'fixture',
			purpose: 'Real lock race',
			owner: 'falcon',
			vault_handle: 'entry',
			account_id: 'one',
			actors: ['agent:worker']
		},
		'agent:worker'
	);
	const run = service.run('one', 'test', 'agent:worker'),
		rejection = assert.rejects(run);
	await ready.promise;
	await vault.lock();
	resume.release();
	await rejection;
	assert.equal(requests, 0);
});
test('Human reveal method returns no value after original connection is revoked during resolution', async (t) => {
	const dir = fs.mkdtempSync(tmpdir() + '/falcon-reveal-race-'),
		vault = new Vault(dir, { owners: ['human:owner'] });
	t.after(() => fs.rmSync(dir, { recursive: true }));
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('entry', { password: 'SYNTHETIC' }, 'human:owner');
	const ready = gate(),
		resume = gate(),
		client = { connId: 'human', invalidated: false },
		worker = vault.worker.bind(vault);
	vault.worker = async (request, authority) => {
		const result = await worker(request, authority);
		if (request.action === 'resolve') {
			ready.release();
			await resume.promise;
		}
		return result;
	};
	let delivered = false;
	const run = vault
			.revealField('entry', 'password', 'human:owner', connectionAuthority(client))
			.then(() => {
				delivered = true;
			}),
		rejection = assert.rejects(run, { code: 'authority_changed' });
	await ready.promise;
	client.invalidated = true;
	resume.release();
	await rejection;
	assert.equal(delivered, false);
	await vault.lock();
});
test('Original connection scope loss invalidates authority without relying on invalidated flag', () => {
	const client = { connId: 'human', connect: { scopes: ['operator.read', 'operator.write'] } };
	const guard = connectionAuthority(client);
	guard.assert();
	client.connect.scopes = ['operator.read'];
	assert.throws(() => guard.assert(), { code: 'authority_changed' });
});
test('Local Vault lock at the publication handshake prevents the prepared encrypted replacement', async (t) => {
	const dir = fs.mkdtempSync(tmpdir() + '/falcon-lock-commit-'),
		vault = new Vault(dir, { owners: ['human:owner'], executors: ['agent:worker'] });
	t.after(() => fs.rmSync(dir, { recursive: true }));
	await vault.initialize('human:owner');
	await vault.unlock('human:owner');
	await vault.create('entry', { password: 'SYNTHETIC-ORIGINAL' }, 'agent:worker');
	let checks = 0,
		locking;
	const authority = {
		assert() {
			if (++checks === 2) locking = vault.lock('human:owner');
		}
	};
	await assert.rejects(() =>
		vault.rotate(
			'entry',
			{ password: 'SYNTHETIC-REPLACEMENT' },
			1,
			'agent:worker',
			undefined,
			authority
		)
	);
	await locking;
	await vault.unlock('human:owner');
	assert.equal(await vault.revealField('entry', 'password', 'human:owner'), 'SYNTHETIC-ORIGINAL');
	await vault.lock();
});
