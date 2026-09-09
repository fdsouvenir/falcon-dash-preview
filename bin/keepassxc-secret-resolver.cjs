#!/usr/bin/env node
/**
 * keepassxc-secret-resolver.cjs
 *
 * OpenClaw exec secrets provider for KeePassXC vault.
 *
 * Protocol (OpenClaw exec provider v1)
 * ------------------------------------
 * stdin:  { "protocolVersion": 1, "provider": "keepassxc", "ids": ["Group/Entry", ...] }
 * stdout: { "protocolVersion": 1, "values": { "Group/Entry": "secret_value" } }
 *         Optional per-id errors:
 *         { "protocolVersion": 1, "values": {}, "errors": { "id": { "message": "..." } } }
 *
 * ID format
 * ---------
 * "Group/Entry"               → returns the entry's Password field
 * "Group/Entry:Password"      → same as above (explicit)
 * "Group/Entry:UserName"      → returns the UserName field
 * "Group/Entry:URL"           → returns the URL field
 * "Group/Entry:Notes"         → returns the Notes field
 *
 * Vault config
 * ------------
 * DB:      ~/.openclaw/passwords.kdbx
 * Keyfile: ~/.openclaw/vault.key
 * Auth:    --no-password --key-file
 *
 * Gateway config example
 * ----------------------
 *   secrets.providers.keepassxc = {
 *     source: "exec",
 *     command: "/usr/lib/node_modules/@fdsouvenir/falcon-dash/bin/keepassxc-secret-resolver.cjs",
 *     passEnv: ["PATH", "HOME"],
 *     jsonOnly: true
 *   }
 *
 * SecretRef usage
 * ---------------
 *   { source: "exec", provider: "keepassxc", id: "Providers/anthropic/apiKey" }
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { join } = require('path');
const { homedir } = require('os');

const execFileAsync = promisify(execFile);

const KDBX = join(homedir(), '.openclaw', 'passwords.kdbx');
const KEY_FILE = join(homedir(), '.openclaw', 'vault.key');
const CLI = 'keepassxc-cli';

const KNOWN_FIELDS = new Set(['Password', 'UserName', 'URL', 'Notes', 'Title', 'Uuid']);

/**
 * Run keepassxc-cli show --show-protected for an entry.
 */
async function showEntry(entryPath) {
	const args = [
		'show',
		'--no-password',
		'--key-file',
		KEY_FILE,
		'--show-protected',
		KDBX,
		entryPath
	];
	const { stdout } = await execFileAsync(CLI, args, { timeout: 10000, maxBuffer: 1024 * 1024 });
	return stdout;
}

/**
 * Parse keepassxc-cli show output and extract a named attribute.
 */
function extractField(output, field) {
	const lines = output.split('\n');
	const line = lines.find((l) => l.startsWith(`${field}: `));
	return line ? line.slice(field.length + 2).trim() : '';
}

/**
 * Parse an id into entry path and field name.
 * "Group/Entry" → { entryPath: "Group/Entry", field: "Password" }
 * "Group/Entry:UserName" → { entryPath: "Group/Entry", field: "UserName" }
 */
function parseId(id) {
	const colonIdx = id.lastIndexOf(':');
	if (colonIdx !== -1) {
		const possibleField = id.slice(colonIdx + 1);
		if (KNOWN_FIELDS.has(possibleField)) {
			return { entryPath: id.slice(0, colonIdx), field: possibleField };
		}
	}
	return { entryPath: id, field: 'Password' };
}

async function main() {
	let input = '';

	await new Promise((resolve, reject) => {
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => (input += chunk));
		process.stdin.on('end', resolve);
		process.stdin.on('error', reject);
	});

	let parsed;
	try {
		parsed = JSON.parse(input.trim());
	} catch {
		process.stderr.write('keepassxc-secret-resolver: invalid JSON input\n');
		process.exit(1);
	}

	const isV1 = parsed.protocolVersion === 1;
	const ids = parsed.ids || parsed.keys;
	if (!Array.isArray(ids)) {
		process.stderr.write('keepassxc-secret-resolver: "ids" (or "keys") must be an array\n');
		process.exit(1);
	}

	const values = {};
	const errors = {};
	const entryCache = new Map();

	for (const id of ids) {
		try {
			const { entryPath, field } = parseId(id);

			let output;
			if (entryCache.has(entryPath)) {
				output = entryCache.get(entryPath);
			} else {
				output = await showEntry(entryPath);
				entryCache.set(entryPath, output);
			}

			const value = extractField(output, field);
			if (!value) {
				errors[id] = { message: `field "${field}" is empty or not found` };
			} else {
				values[id] = value;
			}
		} catch (err) {
			errors[id] = { message: err.message };
		}
	}

	let response;
	if (isV1) {
		response = { protocolVersion: 1, values };
		if (Object.keys(errors).length > 0) {
			response.errors = errors;
		}
	} else {
		// Legacy flat format: { "key": "value" }
		response = values;
	}

	process.stdout.write(JSON.stringify(response) + '\n');

	// Exit 0 for partial success (values returned + per-id errors).
	// Exit 1 only if zero values resolved and there were errors.
	if (Object.keys(values).length === 0 && Object.keys(errors).length > 0) {
		process.exit(1);
	}
}

main().catch((err) => {
	process.stderr.write(`keepassxc-secret-resolver: fatal: ${err.message}\n`);
	process.exit(1);
});
