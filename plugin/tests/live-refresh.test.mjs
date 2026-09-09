import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createFeatureClient } from 'openclaw/plugin-sdk/feature-contract';
import { workFeature } from '../work/feature-contract.mjs';
const PLUGIN_ID = JSON.parse(
	fs.readFileSync(new URL('../../openclaw.plugin.json', import.meta.url), 'utf8')
).id;
const turn = () => new Promise((resolve) => setImmediate(resolve));
test('Supported feature watch coalesces invalidations, rejects stale responses, reloads after reconnect, and stops on disposal', async () => {
	const abort = new AbortController(),
		events = new Map(),
		listeners = new Set(),
		pending = [],
		seen = [];
	const host = {
		pluginId: PLUGIN_ID,
		signal: abort.signal,
		connection: { connected: true },
		request: async () => new Promise((resolve) => pending.push(resolve)),
		onEvent: (event, listener) => {
			events.set(event, listener);
			return () => events.delete(event);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
	const feature = createFeatureClient(workFeature, host);
	const dispose = feature.watch(
		'work_list',
		{},
		{
			events: ['falcon_work_changed'],
			onChange: (result) => seen.push(result),
			onError: (error) => {
				throw error;
			}
		}
	);
	await turn();
	events.get(`plugin.${PLUGIN_ID}.falcon_work_changed`)({ epoch: 'new', revision: 3 });
	events.get(`plugin.${PLUGIN_ID}.falcon_work_changed`)({ epoch: 'old', revision: 1 });
	await turn();
	assert.equal(pending.length, 2);
	pending[1]({ ok: true, result: { revision: 3 } });
	await turn();
	pending[0]({ ok: true, result: { revision: 1 } });
	await turn();
	assert.deepEqual(seen, [{ revision: 3 }]);
	host.connection.connected = false;
	for (const listener of listeners) listener();
	host.connection.connected = true;
	for (const listener of listeners) listener();
	await turn();
	assert.equal(pending.length, 3);
	dispose();
	pending[2]({ ok: true, result: { revision: 4 } });
	await turn();
	assert.deepEqual(seen, [{ revision: 3 }]);
	assert.equal(events.size, 0);
});
