import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkStore } from '../work/store.mjs';

function fixture(t) {
	const dir = mkdtempSync(tmpdir() + '/falcon-work-');
	const store = new WorkStore(dir + '/work.db');
	t.after(() => {
		store.close();
		rmSync(dir, { recursive: true });
	});
	let n = 0;
	const call = (command, id, input = {}) =>
		store.execute(
			{
				command,
				id,
				expected_version: id ? store.get(id).version : undefined,
				idempotency_key: `request-${++n}`,
				input
			},
			'agent:test'
		);
	const create = (type = 'task', more = {}) =>
		call('create', undefined, {
			type,
			title: 'Implement scoped document editing',
			...(type === 'task'
				? {
						description: 'Keep the workspace and credential boundaries intact',
						done_when: 'Security regression tests pass'
					}
				: {}),
			...more
		}).target;
	return { store, call, create, dir };
}
test('Definitions are immutable and stale Plans never silently repin', (t) => {
	const { store, call, create } = fixture(t),
		id = create();
	call('revise_plan', id, { content: 'Test then implement', reason: 'Approach' });
	const old = store.get(id).definition_id;
	call('revise_definition', id, {
		title: 'Implement safe browsing',
		description: 'Browsing without exposed credential files',
		done_when: 'Traversal tests pass',
		reason: 'Narrow scope'
	});
	assert.equal(store.artifact(old).title, 'Implement scoped document editing');
	assert.equal(store.detail(id).plan, undefined);
	assert.equal(store.warnings(store.get(id))[0].code, 'stale_artifact');
});
test('Unassigned start asks; accepted claim and waiting are atomic', (t) => {
	const { store, call, create } = fixture(t),
		id = create();
	call('ready', id);
	assert.throws(() => call('start', id), { code: 'input_required' });
	assert.equal(store.get(id).status, 'ready');
	call('start', id, { claim: true });
	call('wait', id, { waiting_for: 'Review response', resume_when: 'Review received' });
	call('resume', id);
	assert.equal(store.get(id).status, 'in_progress');
	assert.equal(store.get(id).agent_id, 'test');
});
test('Dependencies warn on truthful completion and cycles reject', (t) => {
	const { store, call, create } = fixture(t),
		a = create(),
		b = create();
	call('depends_on', a, { target: b });
	assert.throws(() => call('depends_on', b, { target: a }), { code: 'cycle' });
	const result = call('complete', a, {
		content: 'Implemented, upstream dependency still unresolved'
	});
	assert.equal(result.outcome, 'committed_with_warnings');
	assert.equal(store.get(a).status, 'completed');
});
test('Milestone closure cannot override unfinished associated Work', (t) => {
	const { store, call, create } = fixture(t),
		p = create('project'),
		m = create('milestone', { project_id: p, success_condition: 'Checks pass' }),
		a = create('task', { project_id: p });
	call('associate', a, { milestone_id: m });
	assert.throws(() => call('achieve', m, { basis: 'Looks good' }), { code: 'unresolved_work' });
	call('complete', a, { content: 'All checks pass' });
	call('achieve', m, { basis: 'Checks passed' });
	assert.equal(store.detail(p).status, 'completed');
	call('reopen', m);
	assert.equal(store.detail(p).status, 'open');
});
test('Idempotency and concurrent version conflicts preserve history', (t) => {
	const { store, create } = fixture(t),
		id = create();
	const request = {
		command: 'ready',
		id,
		expected_version: 1,
		idempotency_key: 'fixed',
		input: {}
	};
	store.execute(request, 'agent:test');
	assert.equal(store.execute(request, 'agent:test').noop, true);
	assert.throws(() => store.execute({ ...request, idempotency_key: 'new' }, 'agent:test'), {
		code: 'version_conflict'
	});
	assert.throws(() => store.execute(request, 'agent:other'), { code: 'idempotency_conflict' });
});
test('Abandonment requires every disposition and detach preserves lifecycle', (t) => {
	const { store, call, create } = fixture(t),
		p = create('project'),
		a = create('task', { project_id: p }),
		b = create('task', { project_id: p });
	assert.throws(() => call('abandon', p, { dispositions: { [a]: 'detach' } }), {
		code: 'input_required'
	});
	assert.equal(store.get(p).status, 'open');
	call('abandon', p, {
		dispositions: { [a]: 'detach', [b]: 'abandon' },
		versions: { [a]: store.get(a).version, [b]: store.get(b).version }
	});
	assert.equal(store.get(a).status, 'open');
	assert.equal(store.get(a).project_id, undefined);
	assert.equal(store.get(b).status, 'abandoned');
});
test('Repeated completion is a no-op, preserving accepted checkpoint and version', (t) => {
	const { store, call, create } = fixture(t),
		id = create();
	call('complete', id, { content: 'Validated' });
	const before = store.get(id);
	const result = call('complete', id, { content: 'Repeated report' });
	assert.equal(result.noop, true);
	assert.deepEqual(store.get(id), before);
});
test('Separate database connections see committed state and reject stale versions', (t) => {
	const { store, create, dir } = fixture(t),
		id = create();
	const other = new WorkStore(dir + '/work.db');
	t.after(() => other.close());
	store.execute(
		{ command: 'ready', id, expected_version: 1, idempotency_key: 'writer-one', input: {} },
		'agent:one'
	);
	assert.equal(other.get(id).status, 'ready');
	assert.throws(
		() =>
			other.execute(
				{ command: 'ready', id, expected_version: 1, idempotency_key: 'writer-two', input: {} },
				'agent:two'
			),
		{ code: 'version_conflict' }
	);
});
test('Observer errors cannot invalidate a committed command and external writers trigger canonical invalidation', (t) => {
	const { store, create, dir } = fixture(t);
	const seen = [];
	store.subscribe((stamp) => {
		seen.push(stamp);
		throw new Error('Synthetic observer failure');
	});
	const id = create();
	assert.equal(store.get(id).status, 'open');
	assert.equal(seen.length, 1);
	assert.deepEqual(Object.keys(seen[0]).sort(), ['epoch', 'revision']);
	const other = new WorkStore(dir + '/work.db');
	t.after(() => other.close());
	other.execute(
		{ command: 'ready', id, expected_version: 1, idempotency_key: 'external-notify', input: {} },
		'agent:external'
	);
	assert.equal(store.checkExternalChanges(), true);
	assert.equal(store.get(id).status, 'ready');
	assert.equal(seen.length, 2);
	assert.equal(store.checkExternalChanges(), false);
});

test('Work collection pages expose every linked record and immutable artifact without silent caps', (t) => {
	const { store, call, create } = fixture(t);
	const project = create('project');
	for (let i = 0; i < 105; i++)
		create('task', { project_id: project, title: `Review synthetic linked item ${i}` });
	const detail = store.detail(project);
	assert.equal(detail.pages.associated_work.total, 105);
	let offset = 0,
		ids = [];
	do {
		const page = store.related(project, 'associated_work', { offset, limit: 30 });
		ids.push(...page.items.map((x) => x.id));
		offset = page.next_offset;
	} while (offset !== null);
	assert.equal(new Set(ids).size, 105);
	assert.throws(() => store.related(project, 'unknown'), { code: 'invalid_filter' });
	assert.throws(() => store.related(project, 'associated_work', { offset: -1 }), {
		code: 'invalid_filter'
	});
	const task = create();
	for (let i = 0; i < 105; i++)
		call('checkpoint', task, { content: `Meaningful result ${i}`, reason: 'Evidence checkpoint' });
	assert.equal(store.detail(task, true).pages.artifacts.total, 106);
	assert.equal(store.related(task, 'artifacts', { offset: 100 }).items.length, 6);
});

test('Waiting preserves explicit typed references without fabricating upstream availability', (t) => {
	const { store, call, create } = fixture(t),
		id = create();
	call('ready', id);
	call('wait', id, {
		waiting_for: 'Independent review',
		resume_when: 'Reviewer returns findings',
		waiting_ref: { kind: 'session', ref: 'agent:retired:session:preserved', agent_id: 'retired' }
	});
	assert.equal(store.detail(id).wait.waiting_ref.agent_id, 'retired');
	call('resume', id);
	assert.ok(
		store
			.history(id)
			.items.some((e) => JSON.stringify(e).includes('agent:retired:session:preserved'))
	);
	assert.throws(
		() =>
			call('wait', id, {
				waiting_for: 'Review',
				resume_when: 'Done',
				waiting_ref: { kind: 'invented', ref: 'anything' }
			}),
		{ code: 'invalid_input' }
	);
});

test('Attention pages are bounded and participants derive from events rather than assignment lists', (t) => {
	const { store, call, create } = fixture(t);
	const ids = [];
	for (let i = 0; i < 6; i++) {
		const id = create();
		call('ready', id);
		ids.push(id);
	}
	const first = store.queue({ limit: 2 });
	assert.equal(first.buckets.actionable_now.total, 6);
	assert.equal(first.buckets.actionable_now.next_offset, 2);
	const second = store.queue({ limit: 2, offset: 2 });
	assert.equal(second.buckets.actionable_now.items.length, 2);
	assert.equal(
		first.buckets.actionable_now.items.some((a) =>
			second.buckets.actionable_now.items.some((b) => a.id === b.id)
		),
		false
	);
	assert.ok(store.related(ids[0], 'participants').items.some((x) => x.actor === 'agent:test'));
	assert.throws(() => store.queue({ offset: -1 }), { code: 'invalid_filter' });
});
