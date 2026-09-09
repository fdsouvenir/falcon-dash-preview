// The plugin's own identity, read from the manifest rather than hardcoded.
//
// Preview and production ship the same tree under different names, so any script that hardcodes
// 'falcon-dash' silently targets the wrong plugin in the other channel. See docs/RELEASE.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(
	fs.readFileSync(fileURLToPath(new URL('../openclaw.plugin.json', import.meta.url)), 'utf8')
);
const pkg = JSON.parse(
	fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);

export const pluginId = manifest.id;
export const packageName = pkg.name;
export const channel = packageName.endsWith('-preview') ? 'preview' : 'production';
