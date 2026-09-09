#!/usr/bin/env node
// Rewrite a checkout's channel identity in place.
//
// Preview and production are the same tree apart from the fields below. Promotion generates
// production from a preview tag rather than merging, so production has no source of its own and
// cannot drift. See docs/RELEASE.md.
//
//   node scripts/apply-channel-identity.mjs <preview|production> [--check]
//
// --check reports what would change and exits non-zero if anything would, without writing.
//
// Every rewrite canonicalises to the production form first and only then applies the target. The
// production strings are prefixes of the preview ones ('falcon-dash' inside 'falcon-dash-preview'),
// so a naive one-way replace run twice produces 'falcon-dash-preview-preview'. Normalising first
// makes the rewrite idempotent regardless of the checkout's starting channel.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [channel, ...flags] = process.argv.slice(2);
const check = flags.includes('--check');
if (!['preview', 'production'].includes(channel)) {
	console.error('Usage: apply-channel-identity.mjs <preview|production> [--check]');
	process.exit(2);
}

// [production form, preview form] for each file.
const REWRITES = {
	'package.json': [
		['"name": "@fdsouvenir/falcon-dash"', '"name": "@fdsouvenir/falcon-dash-preview"'],
		['fdsouvenir/falcon-dash.git', 'fdsouvenir/falcon-dash-preview.git'],
		['fdsouvenir/falcon-dash#readme', 'fdsouvenir/falcon-dash-preview#readme'],
		['fdsouvenir/falcon-dash/issues', 'fdsouvenir/falcon-dash-preview/issues']
	],
	// The lockfile records the package name at the root and under packages[''].
	'package-lock.json': [
		['"name": "@fdsouvenir/falcon-dash"', '"name": "@fdsouvenir/falcon-dash-preview"']
	],
	'openclaw.plugin.json': [
		['"id": "falcon-dash"', '"id": "falcon-dash-preview"'],
		['"name": "Falcon Dash"', '"name": "Falcon Dash Preview"'],
		['/fdsouvenir/falcon-dash/main/', '/fdsouvenir/falcon-dash-preview/main/']
	],
	// The Work feature contract declares its own plugin id, and the feature-events service id is
	// derived from it. Missing this leaves a preview build registering 'falcon-dash:feature-events',
	// which both mismatches its own plugin id and collides with production on a shared gateway.
	'plugin/work/feature-contract.mjs': [
		["pluginId: 'falcon-dash'", "pluginId: 'falcon-dash-preview'"]
	],
	// The registered plugin id, and the default data directory. The data directory is a literal, not
	// derived from the id, so two channels on one gateway would share a Work store unless it is
	// rewritten here too.
	'plugin/index.mjs': [
		["id: 'falcon-dash'", "id: 'falcon-dash-preview'"],
		["ctx.stateDir, 'falcon-dash'", "ctx.stateDir, 'falcon-dash-preview'"]
	],
	// Badges, links and the install command all address a specific repository and package.
	'README.md': [
		['fdsouvenir/falcon-dash/', 'fdsouvenir/falcon-dash-preview/'],
		['clawhub:@fdsouvenir/falcon-dash\n', 'clawhub:@fdsouvenir/falcon-dash-preview\n']
	]
};

const PREVIEW_BANNER =
	'> **This is the preview channel.** It ships early and often, and is meant for a test gateway\n' +
	'> rather than one doing work you care about. The production channel is\n' +
	'> [`@fdsouvenir/falcon-dash`](https://github.com/fdsouvenir/falcon-dash).\n\n';

const changes = [];
for (const [file, pairs] of Object.entries(REWRITES)) {
	const abs = path.join(repo, file);
	if (!fs.existsSync(abs)) throw new Error(`missing ${file}`);
	const original = fs.readFileSync(abs, 'utf8');
	let next = original;
	// Canonicalise: preview form -> production form. Safe in this direction because the preview
	// string is the longer, more specific one.
	for (const [production, preview] of pairs) next = next.split(preview).join(production);
	if (channel === 'preview')
		for (const [production, preview] of pairs) next = next.split(production).join(preview);

	if (file === 'README.md') {
		next = next.replace(PREVIEW_BANNER, '');
		if (channel === 'preview') next = next.replace(/^(# .*\n\n)/, `$1${PREVIEW_BANNER}`);
	}
	if (next === original) continue;
	changes.push(file);
	if (!check) fs.writeFileSync(abs, next);
}

if (check) {
	if (changes.length) {
		console.error(`Not on the ${channel} channel; these would change:`);
		for (const f of changes) console.error(`  ${f}`);
		process.exit(1);
	}
	console.log(`Identity matches the ${channel} channel.`);
} else {
	console.log(
		changes.length
			? `Rewrote for ${channel}: ${changes.join(', ')}`
			: `Already on the ${channel} channel; nothing to change.`
	);
}
