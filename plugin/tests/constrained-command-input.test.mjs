import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkStore } from '../work/store.mjs';
import { tools, resolveCommandRequest } from '../contract.mjs';

// Providers that constrain tool arguments to the declared schema can only emit an object's
// declared properties. request.input declares none, so those models could previously send nothing
// but {} and every Work mutation failed with invalid_input. request.input_json is the escape
// hatch; these tests hold it to being the same contract, not a second one.
const payload = { type: 'project', title: 'Constrained decoder project' };

function fixture(t) {
	const dir = mkdtempSync(tmpdir() + '/falcon-constrained-');
	const store = new WorkStore(dir + '/work.db');
	t.after(() => {
		store.close();
		rmSync(dir, { recursive: true });
	});
	return store;
}

test('The tool declares a payload spelling a constrained decoder can actually express', () => {
	const request = tools.falcon_work.parameters.properties.request.properties;
	assert.equal(request.input_json.type, 'string');
	// The object spelling stays for callers that can send one; it is why input_json is needed.
	assert.equal(request.input.type, 'object');
	assert.equal(request.input.properties, undefined);
});

test('A strict decoder payload commits the same record as the object spelling', (t) => {
	const store = fixture(t);
	// Exactly what a strict decoder emits: every declared property present, input necessarily {}.
	const committed = store.execute(
		resolveCommandRequest({
			command: 'create',
			id: '',
			ask_id: '',
			idempotency_key: 'constrained-1',
			input: {},
			input_json: JSON.stringify(payload)
		}),
		'human:test'
	);
	assert.equal(committed.outcome, 'committed');
	const record = store.detail(committed.target, false);
	assert.equal(record.title, payload.title);
	assert.equal(record.type, 'project');
});

test('Both spellings of one command share an idempotency receipt rather than conflicting', (t) => {
	const store = fixture(t);
	const base = { command: 'create', id: '', ask_id: '', idempotency_key: 'constrained-2' };
	const first = store.execute(resolveCommandRequest({ ...base, input: payload }), 'human:test');
	// Same logical request, other spelling. It must replay the receipt, which only holds if
	// normalization happens before execute digests the request.
	const replay = store.execute(
		resolveCommandRequest({ ...base, input: {}, input_json: JSON.stringify(payload) }),
		'human:test'
	);
	assert.equal(replay.target, first.target);
	assert.equal(replay.noop, true);
});

test('Ambiguous or malformed payloads are refused instead of silently committing', (t) => {
	const store = fixture(t);
	const base = { command: 'create', id: '', ask_id: '', idempotency_key: 'constrained-3' };
	assert.throws(
		() =>
			resolveCommandRequest({
				...base,
				input: payload,
				input_json: JSON.stringify({ type: 'project', title: 'Different' })
			}),
		{ code: 'invalid_input' }
	);
	assert.throws(() => resolveCommandRequest({ ...base, input: {}, input_json: '{"type":' }), {
		code: 'invalid_input'
	});
	assert.throws(() => resolveCommandRequest({ ...base, input: {}, input_json: '[]' }), {
		code: 'invalid_input'
	});
	// A decoded payload still faces the real per-command contract; input_json is not a bypass.
	assert.throws(
		() =>
			store.execute(
				resolveCommandRequest({ ...base, input: {}, input_json: '{"type":"project"}' }),
				'human:test'
			),
		{ code: 'invalid_input' }
	);
});

test('Omitted input_json leaves the object spelling untouched', () => {
	const request = {
		command: 'ready',
		id: 'x',
		expected_version: 1,
		idempotency_key: 'k',
		input: {}
	};
	assert.deepEqual(resolveCommandRequest(request), request);
	assert.deepEqual(resolveCommandRequest({ ...request, input_json: '' }), request);
});
