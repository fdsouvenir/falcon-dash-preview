import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineFeaturePlugin } from 'openclaw/plugin-sdk/feature-plugin';
import { workFeature } from '../work/feature-contract.mjs';
import { WorkStore } from '../work/store.mjs';
const PLUGIN_ID = JSON.parse(
	fs.readFileSync(new URL('../../openclaw.plugin.json', import.meta.url), 'utf8')
).id;
test('Pinned SDK validates the same operation contracts on session actions', async (t) => {
	const directory = mkdtempSync(tmpdir() + '/falcon-feature-');
	const store = new WorkStore(directory + '/work.db');
	t.after(() => {
		store.close();
		rmSync(directory, { recursive: true });
	});
	const actions = new Map();
	defineFeaturePlugin({
		contract: workFeature,
		name: 'Contract test',
		description: 'Synthetic backend test',
		setup: () => ({
			work_list: (input) => store.list(input),
			work_queue: (input) => store.queue(input),
			work_command: (input) => store.execute(input, 'agent:synthetic')
		})
	}).register({
		id: PLUGIN_ID,
		registerService: () => {},
		registerSessionAction: (action) => actions.set(action.id, action)
	});
	assert.deepEqual(actions.get('work_command').requiredScopes, ['operator.write']);
	assert.deepEqual(actions.get('work_list').requiredScopes, ['operator.read']);
	const invalid = await actions.get('work_list').handler({ payload: { limit: 1000 } });
	assert.equal(invalid.ok, false);
	assert.equal(invalid.code, 'INVALID_INPUT');
	const request = {
		command: 'create',
		idempotency_key: 'typed-once',
		input: {
			type: 'task',
			title: 'Typed operation proof',
			description: 'The shared SDK validates this request and response',
			done_when: 'A committed and replay response both pass'
		}
	};
	const first = await actions.get('work_command').handler({ payload: request });
	assert.equal(first.ok, true);
	const replay = await actions.get('work_command').handler({ payload: request });
	assert.equal(replay.ok, true);
	assert.equal(replay.result.noop, true);
	assert.equal((await actions.get('work_list').handler({ payload: {} })).result.total, 1);
});
