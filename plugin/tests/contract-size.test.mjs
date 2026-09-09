import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainContract, buildContract } from '../contract.mjs';
import { expandContract } from '../compact-contract.mjs';
test('Compacted public contract preserves every schema fact and remains deterministic', () => {
	const enabled = ['work', 'integrations', 'vault', 'documents'],
		raw = JSON.parse(JSON.stringify(domainContract(enabled))),
		compact = buildContract(enabled);
	assert.deepEqual(expandContract(JSON.parse(compact)), raw);
	assert.equal(compact, buildContract(enabled));
	assert.ok(compact.length < JSON.stringify(raw).length * 0.8);
});
