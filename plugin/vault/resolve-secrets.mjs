#!/usr/bin/env node
// OpenClaw exec-provider protocol v1. stdout is exclusively the protected resolver pipe.
// No HOME/state fallback and no general tool registration. The owner grants exact IDs.
import { protectedProcess } from './process.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
let input = '';
try {
	for await (const chunk of process.stdin) {
		input += chunk;
		if (Buffer.byteLength(input) > 16384) throw new Error();
	}
	const request = JSON.parse(input);
	if (
		request.protocolVersion !== 1 ||
		!Array.isArray(request.ids) ||
		request.ids.length > 50 ||
		Object.keys(request).some((k) => !['protocolVersion', 'provider', 'ids'].includes(k))
	)
		throw new Error();
	const directory = process.env.FALCON_VAULT_DIRECTORY;
	if (!directory || !path.isAbsolute(directory)) throw new Error();
	const controller = new AbortController(),
		cancel = () => controller.abort();
	process.once('SIGTERM', cancel);
	process.once('SIGINT', cancel);
	let output;
	try {
		output = await protectedProcess(
			'flock',
			[
				'--exclusive',
				'--timeout',
				'10',
				path.join(directory, 'transaction.lock'),
				process.execPath,
				fileURLToPath(new URL('./worker.mjs', import.meta.url)),
				directory
			],
			{ action: 'resolve_refs', ids: request.ids },
			{
				timeoutMs: 12000,
				authority: {
					signal: controller.signal,
					assert() {
						if (controller.signal.aborted) throw new Error('cancelled');
					}
				}
			}
		);
	} finally {
		process.removeListener('SIGTERM', cancel);
		process.removeListener('SIGINT', cancel);
	}
	const response = JSON.parse(output);
	if (response.protocolVersion !== 1) throw new Error();
	process.stdout.write(JSON.stringify(response));
} catch {
	process.stdout.write(
		JSON.stringify({ protocolVersion: 1, values: {}, errors: { request: { code: 'NOT_FOUND' } } })
	);
	process.exitCode = 1;
}
