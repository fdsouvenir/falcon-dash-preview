import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkStore } from '../work/store.mjs';
const sources = [{ kind: 'human-statement', ref: 'synthetic:statement:1' }];
function fixture(t) {
	const directory = mkdtempSync(tmpdir() + '/falcon-domain-');
	const store = new WorkStore(directory + '/work.db');
	t.after(() => {
		store.close();
		rmSync(directory, { recursive: true });
	});
	let n = 0;
	const call = (command, id, input = {}, actor = 'agent:synthetic', extra = {}) =>
		store.execute(
			{
				command,
				id,
				expected_version: id ? store.get(id).version : undefined,
				idempotency_key: `operation-${++n}`,
				input,
				...extra
			},
			actor
		);
	const create = (type, more = {}) =>
		call('create', undefined, {
			type,
			title: `Synthetic ${type} ${n}`,
			...(type === 'task'
				? {
						description: 'Distinct meaningful scope for this fixture',
						done_when: 'Observable acceptance is verified'
					}
				: {}),
			...more
		}).target;
	return { store, call, create };
}
test('Question hypotheses never answer; authoritative answers require source and answerer', (t) => {
	const { store, call, create } = fixture(t);
	const id = create('question', {
		prompt: 'Which protocol does the provider support?',
		impact: 'Blocks choosing the adapter',
		answerable_by: ['human:owner']
	});
	call('hypothesis', id, { text: 'Possibly OAuth', confidence: 'tentative', sources });
	assert.equal(store.get(id).status, 'open');
	assert.throws(() => call('answer', id, { answer: 'OAuth', confidence: 'confirmed', sources }), {
		code: 'authority_required'
	});
	assert.throws(
		() => call('answer', id, { answer: 'OAuth', confidence: 'confirmed' }, 'human:owner'),
		{ code: 'invalid_sources' }
	);
	call('answer', id, { answer: 'OAuth', confidence: 'confirmed', sources }, 'human:owner');
	const answer = store.get(id).answer_id;
	call('reopen', id);
	assert.equal(store.artifact(answer).answer, 'OAuth');
});
const pack = {
	prompt: 'Which supported provider should we choose?',
	options: [
		{ id: 'one', label: 'First provider' },
		{ id: 'two', label: 'Second provider' }
	],
	deciders: ['human:owner'],
	recommendation: { option_id: 'one', rationale: 'Matches required scopes' },
	consequence_of_no_decision: 'Implementation waits'
};
test('Decision-ready validation, immutable package/outcome, and no agent authority laundering', (t) => {
	const { store, call, create } = fixture(t);
	assert.throws(
		() =>
			create('decision', {
				...pack,
				options: [
					{ id: 'one', label: 'Same' },
					{ id: 'two', label: 'same' }
				]
			}),
		{ code: 'invalid_options' }
	);
	const id = create('decision', pack);
	assert.throws(() => call('decide', id, { option_id: 'one', rationale: 'Select it', sources }), {
		code: 'authority_required'
	});
	call('decide', id, { option_id: 'one', rationale: 'Select it', sources }, 'human:owner');
	assert.equal(store.get(id).status, 'decided');
	assert.throws(() => call('revise_decision', id, { ...pack, reason: 'Rewrite commitment' }), {
		code: 'invalid_transition'
	});
	assert.throws(
		() =>
			store.db
				.prepare('UPDATE artifacts SET body=? WHERE id=?')
				.run('{}', store.get(id).outcome_id),
		/immutable_artifact/
	);
});
test('Finding provenance and terminal validity are preserved', (t) => {
	const { store, call, create } = fixture(t);
	assert.throws(() => create('finding', { conclusion: 'No proof', confidence: 'confirmed' }), {
		code: 'invalid_input'
	});
	const a = create('finding', {
			conclusion: 'Observed behavior',
			confidence: 'supported',
			sources
		}),
		b = create('finding', {
			conclusion: 'Corrected observation',
			confidence: 'confirmed',
			sources
		});
	call('supersede', a, { successor_id: b, reason: 'Additional evidence' });
	assert.throws(() => call('retract', a, { reason: 'Remove history' }), {
		code: 'invalid_transition'
	});
	assert.equal(store.get(a).superseded_by, b);
});
test('Area closure counts Questions and Decisions, not only Tasks', (t) => {
	const { store, call, create } = fixture(t);
	const area = create('area');
	const q = create('question', {
		area_id: area,
		prompt: 'What remains unknown?',
		impact: 'Need a factual answer'
	});
	assert.throws(() => call('archive', area), { code: 'unresolved_work' });
	call('withdraw', q, { reason: 'No longer relevant' });
	call('archive', area);
	assert.throws(() => create('task', { area_id: area }), { code: 'invalid_parent' });
	call('restore', area);
	assert.equal(store.get(area).status, 'active');
});
test('Task authorization pins exact Definition/change/optional Plan and never survives material revision', (t) => {
	const { store, call, create } = fixture(t);
	const id = create('task');
	call('revise_change', id, {
		scope: 'Only isolated state',
		risk: 'Incorrect scope could change protected data',
		rollback: 'Restore the verified snapshot',
		acceptance: 'Synthetic restoration checks pass',
		reason: 'Consequential boundary'
	});
	assert.throws(
		() =>
			call('authorize', id, {
				change_id: store.get(id).change_id,
				conditions: 'Within approved scope',
				sources
			}),
		{ code: 'authority_required' }
	);
	call(
		'authorize',
		id,
		{ change_id: store.get(id).change_id, conditions: 'Within approved scope', sources },
		'human:owner'
	);
	call('revise_definition', id, {
		title: 'Changed isolated scope',
		description: 'Materially different behavior to review',
		done_when: 'Updated requirements pass',
		reason: 'Scope changed'
	});
	assert.ok(store.warnings(store.get(id)).some((w) => w.kind === 'authorization'));
});
test('Review Task pins an immutable target and does not create a Review Work type', (t) => {
	const { store, call, create } = fixture(t);
	const subject = create('task'),
		review = create('task');
	call('checkpoint', subject, {
		content: 'Candidate result for independent review',
		reason: 'Ready for review'
	});
	const artifact = store.get(subject).result_id;
	call('review_target', review, { artifact_id: artifact });
	call('checkpoint', subject, { content: 'Updated candidate', reason: 'Another checkpoint' });
	assert.equal(store.get(review).review_target.artifact_id, artifact);
});
test('Ask resolution revalidates its intended operation and commits atomically', (t) => {
	const { store, call, create } = fixture(t);
	const id = create('task');
	call('ready', id);
	call('ask', id, {
		requirement: 'claim',
		intended_command: 'start',
		thread: { session_key: 'agent:synthetic:test', agent_id: 'synthetic' },
		prompt: 'Accept accountability for this Task?'
	});
	const ask = store.get(id).last_ask_id;
	assert.throws(() => call('start', id, {}, 'agent:synthetic', { ask_id: ask }), {
		code: 'input_required'
	});
	assert.equal(store.db.prepare('SELECT state FROM asks WHERE id=?').get(ask).state, 'open');
	call('start', id, { claim: true }, 'agent:synthetic', { ask_id: ask });
	assert.equal(store.db.prepare('SELECT state FROM asks WHERE id=?').get(ask).state, 'resolved');
});
test('Bounded detail/full escape, exact field validation, and aggregate totals', (t) => {
	const { store, call, create } = fixture(t);
	const id = create('task', { description: 'Context '.repeat(500) });
	assert.equal(store.detail(id).truncation.truncated, true);
	assert.equal(store.detail(id, true).definition.description.length, 3999);
	for (let i = 0; i < 9; i++) call('ready', create('task'));
	const queue = store.queue({ limit: 2 });
	assert.equal(queue.buckets.actionable_now.total, 9);
	assert.equal(queue.buckets.actionable_now.items.length, 2);
	assert.deepEqual(Object.keys(store.list({ fields: ['id'] }).items[0]), ['id']);
	assert.throws(() => store.list({ fields: ['not_a_field'] }), { code: 'invalid_filter' });
});
test('Database rejects cross-Task artifact Definition pins and event rewrites', (t) => {
	const { store, create } = fixture(t);
	const a = create('task'),
		b = create('task');
	assert.throws(
		() =>
			store.db
				.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?)')
				.run('bad', a, 'plan', 1, store.get(b).definition_id, '{}'),
		/invalid_definition_pin/
	);
	assert.throws(() => store.db.prepare('DELETE FROM events').run(), /immutable_event/);
});
test('Aggregate causes beyond the detail cap remain classified and offsetless dates are rejected', (t) => {
	const { store, call, create } = fixture(t),
		subject = create('task');
	for (let i = 0; i < 12; i++) call('depends_on', subject, { target: create('task') });
	call('ask', subject, {
		requirement: 'scope',
		intended_command: 'start',
		thread: { session_key: 'agent:synthetic:test', agent_id: 'synthetic' },
		prompt: 'Clarify the exact scope'
	});
	const row = store.list().items.find((x) => x.id === subject);
	assert.equal(row.attention.length, 10);
	assert.equal(row.attention_total, 13);
	assert.ok(row.signals.includes('ask'));
	assert.equal(store.queue().buckets.operator_attention.total, 1);
	call('ready', subject);
	assert.throws(
		() =>
			call('wait', subject, {
				waiting_for: 'A reviewer',
				resume_when: 'Review arrives',
				follow_up_at: '2026-09-06T10:00'
			}),
		{ code: 'invalid_input' }
	);
});
test('Dependency pins surface changed Definitions and cannot silently repin on repeated linking', (t) => {
	const { store, call, create } = fixture(t),
		a = create('task'),
		b = create('task');
	call('depends_on', a, { target: b });
	const old = store.get(a).version;
	assert.equal(call('depends_on', a, { target: b }).noop, true);
	assert.equal(store.get(a).version, old);
	call('revise_definition', b, {
		title: 'Changed upstream scope',
		description: 'Different boundaries require reconciliation',
		done_when: 'New observable criteria are met',
		reason: 'Material change'
	});
	assert.ok(store.warnings(store.get(a)).some((w) => w.code === 'stale_dependency'));
	call('reaffirm_dependency', a, { target: b, reason: 'Reviewed the changed upstream Definition' });
	assert.ok(!store.warnings(store.get(a)).some((w) => w.code === 'stale_dependency'));
});
test('Milestone proof records selected immutable result context rather than treating association as proof', (t) => {
	const { store, call, create } = fixture(t),
		project = create('project'),
		milestone = create('milestone', {
			project_id: project,
			success_condition: 'Observed output is validated'
		}),
		task = create('task', { project_id: project });
	call('associate', task, { milestone_id: milestone });
	call('complete', task, { content: 'Validated output' });
	const result = store.get(task).accepted_result_id;
	call('achieve', milestone, { basis: 'Observed the required output', work_refs: [task] });
	call('reopen', task);
	assert.equal(store.get(milestone).achievement.supporting_work[0].result_id, result);
	assert.equal(store.get(milestone).achievement.supporting_work[0].version, 3);
});
test('Filler and punctuation-only repetition cannot create a hollow Task', (t) => {
	const { create } = fixture(t);
	assert.throws(
		() =>
			create('task', {
				title: 'Ship the change',
				description: 'Ship the change.',
				done_when: 'It works'
			}),
		{ code: 'invalid_definition' }
	);
	assert.throws(() => create('task', { done_when: 'TBD' }), { code: 'invalid_definition' });
});
test('Project abandonment does not act on a child that changed after its disposition was chosen', (t) => {
	const { store, call, create } = fixture(t),
		project = create('project'),
		task = create('task', { project_id: project });
	const version = store.get(task).version;
	call('revise_definition', task, {
		title: 'Different requested action',
		description: 'Scope materially changed after review',
		done_when: 'Changed acceptance is verified',
		reason: 'New scope'
	});
	assert.throws(
		() =>
			call('abandon', project, {
				dispositions: { [task]: 'abandon' },
				versions: { [task]: version }
			}),
		{ code: 'version_conflict' }
	);
	assert.equal(store.get(project).status, 'open');
	assert.equal(store.get(task).status, 'open');
});
test('Abandoned predecessors warn even though terminal associated Work does not block Milestone closure', (t) => {
	const { store, call, create } = fixture(t),
		project = create('project'),
		milestone = create('milestone', {
			project_id: project,
			success_condition: 'An independently observed outcome'
		}),
		predecessor = create('task', { project_id: project }),
		dependent = create('task');
	call('depends_on', dependent, { target: predecessor });
	call('associate', predecessor, { milestone_id: milestone });
	call('abandon', predecessor);
	assert.ok(store.warnings(store.get(dependent)).some((w) => w.code === 'dependency_unresolved'));
	call('achieve', milestone, {
		basis: 'The outcome was independently observed despite abandoned implementation work'
	});
	assert.equal(store.get(milestone).status, 'achieved');
});
test('Decision supersession requires a recorded replacement, verified human decider and matching version', (t) => {
	const { store, call, create } = fixture(t),
		a = create('decision', pack),
		b = create('decision', pack);
	call('decide', a, { option_id: 'one', rationale: 'Original choice', sources }, 'human:owner');
	assert.throws(
		() =>
			call(
				'supersede_decision',
				a,
				{ successor_id: b, successor_version: 1, reason: 'A proposal is not a commitment' },
				'human:owner'
			),
		{ code: 'invalid_transition' }
	);
	call(
		'decide',
		b,
		{ option_id: 'two', rationale: 'New committed choice', sources },
		'human:owner'
	);
	call(
		'supersede_decision',
		a,
		{ successor_id: b, successor_version: store.get(b).version, reason: 'Replacement commitment' },
		'human:owner'
	);
	assert.equal(store.get(a).superseded_by, b);
	assert.equal(store.get(b).supersedes, a);
});
test('Task-scoped authority gaps are visible without pretending to enforce runtime execution', (t) => {
	const { store, call, create } = fixture(t),
		task = create('task');
	call('revise_change', task, {
		scope: 'Scoped change',
		risk: 'A consequential failure',
		rollback: 'Restore previous state',
		acceptance: 'Verify explicit outcomes',
		reason: 'Needs a boundary'
	});
	assert.ok(store.warnings(store.get(task)).some((w) => w.code === 'authorization_required'));
	assert.equal(store.queue().buckets.change_control.total, 1);
	const result = call('complete', task, {
		content: 'Truthful reported completion; authority record is missing'
	});
	assert.equal(result.outcome, 'committed_with_warnings');
});
test('A review checkpoint cannot be accepted for a different target artifact', (t) => {
	const { store, call, create } = fixture(t),
		first = create('task'),
		second = create('task'),
		review = create('task');
	call('checkpoint', first, { content: 'First candidate', reason: 'Ready' });
	call('checkpoint', second, { content: 'Second candidate', reason: 'Ready' });
	call('review_target', review, { artifact_id: store.get(first).result_id });
	call('checkpoint', review, {
		content: 'Reviewed the first candidate',
		reason: 'Review checkpoint'
	});
	const checkpoint = store.get(review).result_id;
	call('review_target', review, { artifact_id: store.get(second).result_id });
	assert.equal(store.detail(review).result, undefined);
	assert.equal(store.detail(review, true).result.id, checkpoint);
	assert.ok(store.detail(review).attention.some((a) => a.code === 'review_result_stale'));
	assert.throws(() => call('complete', review, { result_id: checkpoint }), {
		code: 'stale_artifact'
	});
	assert.equal(store.get(review).status, 'open');
});

test('Removing a dependency removes its pins and no longer derives stale dependency attention', (t) => {
	const { store, call, create } = fixture(t),
		task = create('task'),
		upstream = create('task');
	call('depends_on', task, { target: upstream });
	assert.equal(
		store.db.prepare('SELECT COUNT(*) AS count FROM dependency_pins WHERE source=?').get(task)
			.count,
		1
	);
	call('remove_dependency', task, {
		target: upstream,
		reason: 'The prerequisite is no longer part of this Task'
	});
	assert.equal(
		store.db.prepare('SELECT COUNT(*) AS count FROM dependency_pins WHERE source=?').get(task)
			.count,
		0
	);
	assert.ok(
		!store
			.warnings(store.get(task))
			.some((a) => ['dependency_unresolved', 'stale_dependency'].includes(a.code))
	);
});
