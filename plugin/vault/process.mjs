import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DomainError } from '../errors.mjs';
import { internalAuthority } from '../authority.mjs';
export function liveGroupMembers(group) {
	const members = [];
	for (const name of readdirSync('/proc')) {
		if (!/^\d+$/.test(name)) continue;
		try {
			const fields = readFileSync(`/proc/${name}/stat`, 'utf8').split(') ').at(-1).split(' ');
			if (Number(fields[2]) === group && !['Z', 'X'].includes(fields[0]))
				members.push(Number(name));
		} catch {
			/* process exited */
		}
	}
	return members;
}
// Detached means a dedicated process group, never a group shared with the Gateway.
export function protectedProcess(
	command,
	args,
	input,
	{ authority = internalAuthority, timeoutMs = 60000, maxBytes = 1048576 } = {}
) {
	authority.assert();
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
		let output = '',
			size = 0,
			failure,
			control = '';
		const stop = (code) => {
			failure ??= new DomainError(code, 'Protected operation cancelled; no success is claimed');
			if (child.pid) {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch (error) {
					if (error.code !== 'ESRCH')
						failure = new DomainError(
							'cleanup_unsettled',
							'Protected process group cleanup could not be confirmed'
						);
				}
			}
		};
		const abort = () => stop('authority_changed');
		const timer = setTimeout(() => stop('vault_timeout'), timeoutMs);
		authority.signal?.addEventListener('abort', abort, { once: true });
		if (authority.signal?.aborted) abort();
		child.stdout.on('data', (chunk) => {
			size += chunk.length;
			if (size > maxBytes) stop('vault_output_limit');
			else output += chunk;
		});
		child.stderr.resume();
		child.stdio[3].on('data', (chunk) => {
			control += chunk.toString();
			if (control.length > 1024) {
				stop('vault_unavailable');
				return;
			}
			while (control.includes('\n')) {
				const i = control.indexOf('\n'),
					request = control.slice(0, i);
				control = control.slice(i + 1);
				try {
					if (request !== 'commit' || failure) throw new Error('invalid');
					authority.assert();
					/** @type {import('node:stream').Duplex} */ (child.stdio[3]).write('1');
				} catch {
					stop('authority_changed');
				}
			}
		});
		child.stdio[3].on('error', () => {});
		child.stdin.on('error', () => {});
		child.on('error', () => {
			failure ??= new DomainError('vault_unavailable', 'Protected storage is unavailable');
		});
		child.on('close', async (code, signal) => {
			if (child.pid && liveGroupMembers(child.pid).length) {
				stop(failure?.code ?? 'cleanup_unsettled');
				while (liveGroupMembers(child.pid).length) {
					stop(failure.code);
					await new Promise((r) => setTimeout(r, 10));
				}
			}
			clearTimeout(timer);
			authority.signal?.removeEventListener('abort', abort);
			if (failure) {
				reject(failure);
				return;
			}
			try {
				authority.assert();
				if (signal) throw new Error('failed');
				if (code !== 0) {
					let data;
					try {
						data = JSON.parse(output);
					} catch {
						/* malformed */
					}
					if (typeof data?.error !== 'string') throw new Error('failed');
				}
				resolve(output);
			} catch {
				reject(
					new DomainError(
						'authority_changed',
						'Protected operation did not settle under its original authority'
					)
				);
			}
		});
		child.stdin.end(JSON.stringify({ ...input, commit_channel: true }));
	});
}
