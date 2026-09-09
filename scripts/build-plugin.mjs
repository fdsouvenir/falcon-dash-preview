import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';
await build({
	stdin: {
		contents: "export {Type} from 'typebox'; export {Check} from 'typebox/value';",
		resolveDir: process.cwd(),
		sourcefile: 'schema-runtime.mjs'
	},
	outfile: 'plugin/schema.mjs',
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node22',
	legalComments: 'inline'
});
copyFileSync('node_modules/typebox/license', 'plugin/typebox-license.txt');
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function check(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) check(path);
		else if (path.endsWith('.mjs')) {
			const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
			if (result.status !== 0) process.exit(1);
		}
	}
}
check('plugin');
await build({
	entryPoints: ['plugin/native/control-ui.mjs'],
	outdir: 'dist/control-ui/falcon',
	entryNames: 'index',
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	loader: { '.woff2': 'dataurl' },
	minify: true,
	legalComments: 'inline'
});

const manifest = JSON.parse(readFileSync('openclaw.plugin.json'));
const pkg = JSON.parse(readFileSync('package.json'));
// Either channel, but the manifest id and package name must agree on the same one.
const CHANNEL_IDS = {
	'@fdsouvenir/falcon-dash': 'falcon-dash',
	'@fdsouvenir/falcon-dash-preview': 'falcon-dash-preview'
};
if (manifest.id !== CHANNEL_IDS[pkg.name] || pkg.openclaw.extensions.length !== 1)
	throw new Error('Expected one Falcon Dash plugin');
console.log('Plugin JavaScript and single-entry package validated');
