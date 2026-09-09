// Compares this plugin's declared host compatibility against a resolved OpenClaw SDK.
// Run against the pinned SDK in CI and against `latest` on a schedule: an exact pin where a
// floor belongs installs nowhere but one host version, and that is invisible to typecheck.
import * as fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const failures = [];

const declared = pkg.openclaw?.compat?.pluginApi;
if (typeof declared !== 'string' || !declared.startsWith('>='))
	failures.push(
		`openclaw.compat.pluginApi must be a semver floor such as ">=2026.9.3"; found ${JSON.stringify(declared)}. An exact version is evaluated as a range and matches only that host.`
	);

// The SDK does not export ./package.json, so read the linked install directly.
let sdk;
try {
	sdk = JSON.parse(
		fs.readFileSync(new URL('../node_modules/openclaw/package.json', import.meta.url), 'utf8')
	);
} catch {
	console.error('openclaw is not resolvable; link or install the SDK before running this check.');
	process.exit(2);
}

const parts = (value) => String(value).split('.').map(Number);
const compare = (a, b) => {
	const left = parts(a),
		right = parts(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff) return diff;
	}
	return 0;
};

const floor = declared?.replace(/^>=/, '');
if (floor && compare(sdk.version, floor) < 0)
	failures.push(
		`Declared floor ${declared} excludes the resolved SDK ${sdk.version}. A host running that version refuses to install this plugin.`
	);

if (pkg.engines?.node !== sdk.engines?.node)
	failures.push(
		`engines.node is ${JSON.stringify(pkg.engines?.node)} but OpenClaw ${sdk.version} requires ${JSON.stringify(sdk.engines?.node)}. Upgrade Node before OpenClaw: the upstream release notes warn of SQLite text truncation in the other order.`
	);

const peer = pkg.peerDependencies?.openclaw;
if (typeof peer === 'string' && !/^[<>~^]/.test(peer))
	failures.push(
		`peerDependencies.openclaw is the exact pin ${JSON.stringify(peer)}; use a range so a supported newer host resolves.`
	);

if (failures.length) {
	console.error(`SDK compatibility check failed against openclaw ${sdk.version}:`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log(
	`SDK compatibility check passed against openclaw ${sdk.version} (pluginApi ${declared}, node ${pkg.engines?.node}).`
);
