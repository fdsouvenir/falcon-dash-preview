#!/usr/bin/env node

import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const docsRoot = path.join(root, 'docs');
const requiredPaths = [
	'AGENTS.md',
	'docs/README.md',
	'docs/PURPOSE.md',
	'docs/ROADMAP.md',
	'docs/HARNESS.md',
	'docs/OWNERSHIP.md',
	'docs/QUALITY.md',
	'docs/RELIABILITY.md',
	'docs/PLANS.md',
	'docs/Technical/plugin-v4.md',
	'docs/Technical/plugin-v4-backend.md',
	'docs/Technical/plugin-v4-native-ui.md',
	'docs/Technical/plugin-v4-scope.md',
	'docs/Technical/plugin-v4-installation.md',
	'docs/Technical/plugin-native-e2e.md',
	'docs/Technical/deployment.md',
	'docs/secretrefs.md'
];

async function walk(dir) {
	const paths = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) paths.push(...(await walk(absolute)));
		else paths.push(absolute);
	}
	return paths;
}

function localLinkTarget(raw, fromFile) {
	let value = raw.trim();
	if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
	value = value.split(/\s+["']/)[0];
	if (!value || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
	const withoutFragment = value.split('#')[0].split('?')[0];
	if (!withoutFragment) return null;
	let decoded;
	try {
		decoded = decodeURIComponent(withoutFragment);
	} catch {
		decoded = withoutFragment;
	}
	return path.resolve(path.dirname(fromFile), decoded);
}

const missing = [];
for (const relPath of requiredPaths) {
	try {
		await access(path.join(root, relPath));
	} catch {
		missing.push(relPath);
	}
}

const allDocFiles = await walk(docsRoot);
const linksByFile = new Map();
const brokenLinks = [];
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;

for (const file of allDocFiles.filter((candidate) => candidate.endsWith('.md'))) {
	const source = await readFile(file, 'utf8');
	const targets = [];
	for (const match of source.matchAll(markdownLink)) {
		const target = localLinkTarget(match[1], file);
		if (!target) continue;
		targets.push(target);
		try {
			await access(target);
		} catch {
			brokenLinks.push({ file, raw: match[1], target });
		}
	}
	linksByFile.set(file, targets);
}

// Every file in docs must be reachable from docs/README.md through local markdown links. This keeps
// abandoned guides and generated assets from silently surviving outside the documentation map.
const start = path.join(docsRoot, 'README.md');
const reachable = new Set();
const queue = [start];
while (queue.length > 0) {
	const file = queue.shift();
	if (!file || reachable.has(file)) continue;
	reachable.add(file);
	for (const target of linksByFile.get(file) ?? []) {
		if (!reachable.has(target)) queue.push(target);
	}
}

const orphans = allDocFiles.filter((file) => !reachable.has(file));

if (missing.length > 0 || brokenLinks.length > 0 || orphans.length > 0) {
	if (missing.length > 0) {
		console.error('Missing required harness files:');
		for (const relPath of missing) console.error(`- ${relPath}`);
	}
	if (brokenLinks.length > 0) {
		console.error('Broken local documentation links:');
		for (const link of brokenLinks) {
			console.error(`- ${path.relative(root, link.file)}: ${link.raw}`);
		}
	}
	if (orphans.length > 0) {
		console.error('Documentation files not reachable from docs/README.md:');
		for (const file of orphans) console.error(`- ${path.relative(root, file)}`);
	}
	process.exit(1);
}

console.log(
	`Harness docs check passed (${requiredPaths.length} required paths, ${allDocFiles.length} linked docs assets).`
);
