#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';

function runGit(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '--base') options.base = argv[i + 1];
		if (argv[i] === '--head') options.head = argv[i + 1];
	}
	return options;
}

function getChangedPaths(base, head) {
	if (base && head && !/^0+$/.test(base)) {
		const output = runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', base, head]);
		return output ? output.split('\n').filter(Boolean) : [];
	}
	const output = execFileSync(
		'git',
		['status', '--porcelain=v1', '--untracked-files=all', '--no-renames', '-z'],
		{ encoding: 'utf8' }
	);
	if (!output) return [];
	return output
		.split('\0')
		.filter(Boolean)
		.map((line) => line.slice(3));
}

function matches(path, matcher) {
	return matcher.endsWith('/')
		? path.startsWith(matcher)
		: path === matcher || path.startsWith(`${matcher}/`);
}

function touches(paths, matchers) {
	return paths.some((path) => matchers.some((matcher) => matches(path, matcher)));
}

const ignoredMatchers = ['docs/', 'scripts/', 'package-lock.json'];

// A release bump rewrites the version string in the package, the plugin manifest and the generated
// contract. Those are high-signal files, but a version field carries no behaviour to document, so
// requiring a doc edit here would only produce a meaningless one. The exemption is deliberately
// narrow: a file qualifies only when every changed line in it is a version field.
const versionLine = /^[+-]\s*(?:"version":\s*"[^"]*",?|version:\s*'[^']*',?)\s*$/;
function isVersionOnlyChange(base, head, path) {
	const range = base && head && !/^0+$/.test(base) ? [base, head] : ['HEAD'];
	let diff;
	try {
		diff = runGit(['diff', '--unified=0', ...range, '--', path]);
	} catch {
		return false;
	}
	const changes = diff
		.split('\n')
		.filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
	return changes.length > 0 && changes.every((line) => versionLine.test(line));
}

// Every required group must have at least one matching changed document. Keep rules narrow: touching
// an unrelated end-user guide must never satisfy a Work, Vault, Integrations, or deployment change.
const rules = [
	{
		name: 'Work domain and agent interface',
		matchers: ['plugin/work/'],
		requiredDocGroups: [['docs/Technical/plugin-v4-backend.md'], ['docs/End User/work.md']]
	},
	{
		name: 'Integrations lifecycle and provider adapters',
		matchers: ['plugin/integrations/'],
		requiredDocGroups: [['docs/Technical/plugin-v4-backend.md']]
	},
	{
		name: 'built-in vault and SecretRefs',
		matchers: ['plugin/vault/', 'bin/keepassxc-secret-resolver.cjs'],
		requiredDocGroups: [['docs/End User/passwords.md'], ['docs/secretrefs.md']]
	},
	{
		name: 'documents',
		matchers: ['plugin/documents/'],
		requiredDocGroups: [['docs/End User/documents.md']]
	},
	{
		name: 'native Control UI surface',
		matchers: ['plugin/native/', 'plugin/ui.mjs'],
		requiredDocGroups: [['docs/Technical/plugin-v4-native-ui.md']]
	},
	{
		name: 'plugin registration, contracts and storage',
		matchers: [
			'plugin/index.mjs',
			'plugin/contract.mjs',
			'plugin/compact-contract.mjs',
			'plugin/authority.mjs',
			'plugin/storage.mjs',
			'openclaw.plugin.json'
		],
		requiredDocGroups: [['docs/Technical/plugin-v4.md']]
	},
	{
		name: 'native browser acceptance',
		matchers: ['e2e-native/', 'playwright.config.ts', 'playwright.native.config.ts'],
		requiredDocGroups: [['docs/Technical/plugin-native-e2e.md']]
	},
	{
		name: 'package and runtime deployment',
		matchers: ['package.json', '.github/workflows/'],
		requiredDocGroups: [['docs/Technical/deployment.md']]
	}
];

const { base, head } = parseArgs(process.argv.slice(2));
const changedPaths = getChangedPaths(base, head);
if (changedPaths.length === 0) {
	console.log('Doc freshness check skipped: no changed paths detected.');
	process.exit(0);
}

const highSignalPaths = changedPaths.filter(
	(path) =>
		!ignoredMatchers.some((matcher) => matches(path, matcher)) &&
		path !== 'AGENTS.md' &&
		!isVersionOnlyChange(base, head, path)
);
if (highSignalPaths.length === 0) {
	console.log('Doc freshness check skipped: no high-signal implementation paths changed.');
	process.exit(0);
}

const changedDocs = changedPaths.filter((path) => matches(path, 'docs/'));
const violations = [];

for (const rule of rules) {
	if (!touches(highSignalPaths, rule.matchers)) continue;
	const missingGroups = rule.requiredDocGroups.filter((group) => !touches(changedDocs, group));
	if (missingGroups.length === 0) continue;
	violations.push({
		name: rule.name,
		triggeringPaths: highSignalPaths.filter((path) =>
			rule.matchers.some((matcher) => matches(path, matcher))
		),
		missingGroups
	});
}

if (violations.length > 0) {
	console.error('Doc freshness check failed.');
	console.error('High-signal code changed without every owning documentation group.');
	console.error('');
	for (const violation of violations) {
		console.error(`Rule: ${violation.name}`);
		console.error(`Changed paths: ${violation.triggeringPaths.join(', ')}`);
		for (const group of violation.missingGroups) {
			console.error(`Update at least one of: ${group.join(', ')}`);
		}
		console.error('');
	}
	process.exit(1);
}

console.log(
	`Doc freshness check passed (${highSignalPaths.length} high-signal paths scanned, ${changedPaths.length} total changed paths).`
);
