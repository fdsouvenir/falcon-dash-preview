#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const artifactsRoot = path.join(root, 'artifacts');
const latestDir = path.join(artifactsRoot, 'run-latest');
const historyRoot = path.join(artifactsRoot, 'history');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const historyDir = path.join(historyRoot, timestamp);

const mode = process.argv[2] ?? 'check';

const modeSteps = {
	check: [
		{ id: 'harness', command: 'npm', args: ['run', 'check:harness'] },
		{ id: 'docs', command: 'npm', args: ['run', 'check:docs'] },
		{ id: 'skills', command: 'npm', args: ['run', 'check:skills'] },
		{ id: 'typecheck', command: 'npm', args: ['run', 'check'] },
		{ id: 'lint', command: 'npm', args: ['run', 'lint'] }
	],
	unit: [{ id: 'unit', command: 'npm', args: ['run', 'test'] }],
	console: [{ id: 'console', command: 'npm', args: ['run', 'console:sweep'] }],
	smoke: [{ id: 'smoke', command: 'npx', args: ['playwright', 'test', 'e2e/smoke.spec.ts'] }],
	settings: [
		{
			id: 'settings',
			command: 'npx',
			args: ['playwright', 'test', 'e2e/smoke.spec.ts', '--grep', 'settings route smoke']
		}
	],
	app: [
		{ id: 'harness', command: 'npm', args: ['run', 'check:harness'] },
		{ id: 'docs', command: 'npm', args: ['run', 'check:docs'] },
		{ id: 'skills', command: 'npm', args: ['run', 'check:skills'] },
		{ id: 'typecheck', command: 'npm', args: ['run', 'check'] },
		{ id: 'lint', command: 'npm', args: ['run', 'lint'] },
		{ id: 'unit', command: 'npm', args: ['run', 'test'] },
		{ id: 'console', command: 'npm', args: ['run', 'console:sweep'] },
		{ id: 'smoke', command: 'npx', args: ['playwright', 'test', 'e2e/smoke.spec.ts'] }
	]
};

function nowIso() {
	return new Date().toISOString();
}

async function pathExists(targetPath) {
	try {
		await access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function writeArtifact(relPath, content) {
	const latestPath = path.join(latestDir, relPath);
	const historyPath = path.join(historyDir, relPath);

	await mkdir(path.dirname(latestPath), { recursive: true });
	await mkdir(path.dirname(historyPath), { recursive: true });
	await writeFile(latestPath, content);
	await writeFile(historyPath, content);
}

async function copyIfExists(relPath) {
	const latestPath = path.join(latestDir, relPath);
	const historyPath = path.join(historyDir, relPath);

	if (!(await pathExists(latestPath))) return;

	await mkdir(path.dirname(historyPath), { recursive: true });
	await copyFile(latestPath, historyPath);
}

async function ensureArtifactDirs() {
	await mkdir(artifactsRoot, { recursive: true });
	await mkdir(historyRoot, { recursive: true });
	await rm(latestDir, { recursive: true, force: true });
	await mkdir(latestDir, { recursive: true });
	await mkdir(historyDir, { recursive: true });
}

function buildSkippedResult(step, reason) {
	return {
		id: step.id,
		command: [step.command, ...step.args].join(' '),
		status: 'skipped',
		exitCode: null,
		startedAt: nowIso(),
		finishedAt: nowIso(),
		logFile: `${step.id}.txt`,
		reason
	};
}

async function shouldSkip(step) {
	if (step.command !== 'npx' || step.args[0] !== 'playwright') return null;
	const hasPlaywright = await pathExists(path.join(root, 'node_modules', '@playwright', 'test'));
	if (!hasPlaywright) {
		return 'Playwright is not installed in node_modules for this workspace.';
	}
	return null;
}

async function runStep(step) {
	const skipReason = await shouldSkip(step);
	if (skipReason) {
		const result = buildSkippedResult(step, skipReason);
		await writeArtifact(result.logFile, `${result.command}\n\nSKIPPED: ${skipReason}\n`);
		return result;
	}

	const startedAt = nowIso();
	const logChunks = [`$ ${step.command} ${step.args.join(' ')}\n\n`];

	const child = spawn(step.command, step.args, {
		cwd: root,
		env: {
			...process.env,
			AGENT_LOOP_LATEST_DIR: path.relative(root, latestDir),
			AGENT_LOOP_HISTORY_DIR: path.relative(root, historyDir)
		}
	});

	child.stdout.on('data', (chunk) => {
		const text = chunk.toString();
		process.stdout.write(text);
		logChunks.push(text);
	});

	child.stderr.on('data', (chunk) => {
		const text = chunk.toString();
		process.stderr.write(text);
		logChunks.push(text);
	});

	const exitCode = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('close', resolve);
	});

	const finishedAt = nowIso();
	const logFile = `${step.id}.txt`;
	await writeArtifact(logFile, logChunks.join(''));

	return {
		id: step.id,
		command: [step.command, ...step.args].join(' '),
		status: exitCode === 0 ? 'passed' : 'failed',
		exitCode,
		startedAt,
		finishedAt,
		logFile,
		reason: null
	};
}

function buildSummary(modeName, results) {
	const lines = [
		'# Agent Loop Summary',
		'',
		`- mode: \`${modeName}\``,
		`- generated: \`${nowIso()}\``,
		`- overall: \`${results.every((result) => result.status !== 'failed') ? 'success' : 'failed'}\``,
		''
	];

	for (const result of results) {
		lines.push(`## ${result.id}`);
		lines.push('');
		lines.push(`- status: \`${result.status}\``);
		lines.push(`- command: \`${result.command}\``);
		lines.push(`- log: [${result.logFile}](./${result.logFile})`);
		if (result.reason) lines.push(`- reason: ${result.reason}`);
		if (result.exitCode !== null) lines.push(`- exit code: \`${result.exitCode}\``);
		lines.push('');
	}

	return `${lines.join('\n')}\n`;
}

async function main() {
	if (!(mode in modeSteps)) {
		console.error(`Unknown agent-loop mode: ${mode}`);
		console.error(`Expected one of: ${Object.keys(modeSteps).join(', ')}`);
		process.exit(1);
	}

	await ensureArtifactDirs();

	const startedAt = nowIso();
	const results = [];

	for (const step of modeSteps[mode]) {
		const result = await runStep(step);
		results.push(result);
		if (result.status === 'failed') break;
	}

	const finishedAt = nowIso();
	const overallStatus = results.every((result) => result.status !== 'failed')
		? 'success'
		: 'failed';

	const status = {
		mode,
		startedAt,
		finishedAt,
		overallStatus,
		historyDir: path.relative(root, historyDir),
		latestDir: path.relative(root, latestDir),
		results
	};

	await writeArtifact('status.json', `${JSON.stringify(status, null, 2)}\n`);
	await writeArtifact('summary.md', buildSummary(mode, results));

	const readme = [
		'# Latest Run',
		'',
		`- mode: \`${mode}\``,
		`- status: \`${overallStatus}\``,
		`- history copy: \`${path.relative(root, historyDir)}\``,
		'',
		'See `summary.md` and `status.json` for details.'
	].join('\n');

	await writeArtifact('README.md', `${readme}\n`);

	await copyIfExists('status.json');
	await copyIfExists('summary.md');
	await copyIfExists('README.md');

	if (overallStatus === 'failed') {
		process.exit(1);
	}
}

await main();
