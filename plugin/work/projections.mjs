import { technicalAttention } from './attention.mjs';
import { exact, requireValue, TYPES } from './store.mjs';
export const FIELDS = [
	'id',
	'type',
	'title',
	'status',
	'version',
	'agent_id',
	'project_id',
	'attention',
	'attention_total',
	'progress',
	'current_milestone',
	'actionability',
	'signals',
	'follow_up_due'
];
export const BUCKETS = [
	'actionable_now',
	'operator_attention',
	'waiting_on_agent',
	'waiting_on_external',
	'blocked_risk',
	'reviews_and_asks',
	'change_control',
	'reconciliation'
];
export function boundedText(value, limit = 2000) {
	let truncated = false;
	const sizes = [];
	function walk(v, path) {
		if (typeof v === 'string' && v.length > limit) {
			truncated = true;
			sizes.push({ path, original_size: v.length, returned_size: limit });
			return v.slice(0, limit);
		}
		if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}.${i}`));
		if (v && typeof v === 'object')
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, `${path}.${k}`)]));
		return v;
	}
	return { value: walk(value, '$'), truncated, sizes };
}
export function snapshot(store, run) {
	store.db.exec('BEGIN');
	try {
		const records = store.all(),
			byId = new Map(records.map((x) => [x.id, x]));
		const links = store.db.prepare('SELECT source,target,kind FROM links').all();
		const artifacts = new Map(
			store.db
				.prepare(
					"SELECT id,definition_id,json_extract(body,'$.change_id') AS change_id,json_extract(body,'$.plan_id') AS plan_id,json_extract(body,'$.revokes') AS revokes,json_extract(body,'$.review_target.artifact_id') AS review_artifact_id FROM artifacts"
				)
				.all()
				.map((a) => [a.id, a])
		);

		const asks = store.db
			.prepare("SELECT body FROM asks WHERE state='open'")
			.all()
			.map((x) => JSON.parse(String(x.body)));
		const dependencyPins = store.db.prepare('SELECT * FROM dependency_pins').all();
		const stamp = store.stamp();
		return run({ records, byId, links, artifacts, asks, stamp, dependencyPins });
	} finally {
		store.db.exec('COMMIT');
	}
}
export function rowsFrom(state) {
	const { records, byId, links, artifacts, asks, dependencyPins } = state;
	const milestones = new Map(),
		dependencies = new Map(),
		subjectAsks = new Map();
	for (const x of records)
		if (x.type === 'milestone') {
			const group = milestones.get(x.project_id) ?? [];
			group.push(x);
			milestones.set(x.project_id, group);
		}
	for (const group of milestones.values())
		group.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	for (const l of links)
		if (l.kind === 'depends_on') {
			const group = dependencies.get(l.source) ?? [];
			group.push(String(l.target));
			dependencies.set(l.source, group);
		}
	for (const ask of asks) {
		const group = subjectAsks.get(ask.subject) ?? [];
		group.push(ask);
		subjectAsks.set(ask.subject, group);
	}
	const terminal = (x) =>
		[
			'completed',
			'abandoned',
			'answered',
			'decided',
			'withdrawn',
			'achieved',
			'retired',
			'superseded',
			'retracted',
			'archived'
		].includes(x.status) || x.type === 'finding';
	return records.map((x) => {
		const gates = milestones.get(x.id) ?? [],
			status =
				x.type === 'project' && x.status !== 'abandoned'
					? gates.length && gates.every((g) => g.status === 'achieved')
						? 'completed'
						: 'open'
					: x.status;
		const attention = technicalAttention(x, {
			object: (id) => byId.get(id),
			artifact: (id) => artifacts.get(id),
			targets: dependencies.get(x.id) ?? [],
			pins: dependencyPins.filter((p) => p.source === x.id)
		});

		for (const a of subjectAsks.get(x.id) ?? [])
			attention.push({ code: 'ask', target: a.id, requirement: a.requirement });
		if (x.status === 'waiting')
			attention.push({
				code: 'waiting',
				waiting_for: x.wait?.waiting_for,
				follow_up_due: !!x.wait?.follow_up_at && Date.parse(x.wait.follow_up_at) <= Date.now()
			});
		if (x.type === 'question' && x.status === 'open')
			attention.push({ code: 'unanswered_question' });
		if (
			x.type === 'decision' &&
			(x.status === 'pending' ||
				(x.status === 'deferred' && Date.parse(x.deferred?.until) <= Date.now()))
		)
			attention.push({ code: 'decision_required' });
		if (x.review_target && !terminal(x))
			attention.push({ code: 'review_task', target: x.review_target.artifact_id });
		return {
			id: x.id,
			type: x.type,
			title: x.title,
			status,
			version: x.version,
			agent_id: x.agent_id ?? null,
			project_id: x.project_id ?? null,
			attention: attention.slice(0, 10),
			attention_total: attention.length,
			signals: [...new Set(attention.map((a) => a.code))],
			follow_up_due: attention.some((a) => a.follow_up_due),
			actionability:
				x.type === 'task' && ['ready', 'in_progress'].includes(status)
					? attention.length
						? 'with_warnings'
						: 'actionable'
					: 'not_actionable',
			...(x.type === 'project'
				? {
						progress: {
							achieved: gates.filter((g) => g.status === 'achieved').length,
							total: gates.length
						},
						current_milestone: gates.find((g) => g.status !== 'achieved')?.id ?? null
					}
				: {})
		};
	});
}
export function listProjection(store, query = {}) {
	exact(query, ['type', 'limit', 'offset', 'agent_id', 'search', 'fields', 'include_terminal']);
	const {
		type,
		agent_id,
		search = '',
		limit = 50,
		offset = 0,
		fields = FIELDS,
		include_terminal = true
	} = query;
	requireValue(!type || TYPES.includes(type), 'invalid_filter', 'Unsupported Work type');
	requireValue(
		typeof search === 'string' &&
			search.length <= 500 &&
			Number.isInteger(limit) &&
			limit >= 1 &&
			limit <= 100 &&
			Number.isInteger(offset) &&
			offset >= 0 &&
			Array.isArray(fields) &&
			fields.length > 0 &&
			fields.every((x) => FIELDS.includes(x)) &&
			typeof include_terminal === 'boolean',
		'invalid_filter',
		'Invalid filter, fields or pagination'
	);
	return snapshot(store, (state) => {
		const rows = rowsFrom(state).filter(
			(x) =>
				(!type || x.type === type) &&
				(!agent_id || x.agent_id === agent_id) &&
				x.title.toLowerCase().includes(search.toLowerCase()) &&
				(include_terminal ||
					![
						'completed',
						'abandoned',
						'answered',
						'decided',
						'withdrawn',
						'achieved',
						'archived',
						'superseded',
						'retracted'
					].includes(x.status))
		);
		return {
			...state.stamp,
			total: rows.length,
			items: rows
				.slice(offset, offset + limit)
				.map((row) => Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]]))),
			next_offset: offset + limit < rows.length ? offset + limit : null
		};
	});
}
export function queueProjection(store, query = {}) {
	exact(query, ['agent_id', 'limit', 'offset']);
	const limit = query.limit ?? 5,
		offset = query.offset ?? 0;
	requireValue(
		Number.isInteger(offset) && offset >= 0,
		'invalid_filter',
		'Queue offset must be nonnegative'
	);
	requireValue(
		Number.isInteger(limit) && limit >= 1 && limit <= 25,
		'invalid_filter',
		'Queue limit must be 1–25'
	);
	return snapshot(store, (state) => {
		const rows = rowsFrom(state).filter((x) => !query.agent_id || x.agent_id === query.agent_id),
			buckets = Object.fromEntries(
				BUCKETS.map((x) => [x, { total: 0, items: [], next_offset: null }])
			);
		const seen = Object.fromEntries(BUCKETS.map((key) => [key, new Set()]));
		const add = (bucket, row) => {
			if (seen[bucket].has(row.id)) return;
			seen[bucket].add(row.id);
			buckets[bucket].total++;
			if (buckets[bucket].total > offset && buckets[bucket].items.length < limit)
				buckets[bucket].items.push(row);
		};
		for (const row of rows) {
			if (row.type === 'task' && ['ready', 'in_progress'].includes(row.status)) {
				add('actionable_now', row);
				if (row.agent_id) add('waiting_on_agent', row);
			}
			if (row.status === 'waiting') add('waiting_on_external', row);
			const codes = row.signals;
			if (
				codes.some((c) =>
					[
						'decision_required',
						'unanswered_question',
						'ask',
						'authorization_required',
						'authorization_invalid'
					].includes(c)
				) ||
				row.follow_up_due
			)
				add('operator_attention', row);
			if (codes.includes('dependency_unresolved')) add('blocked_risk', row);
			if (codes.includes('authorization_required') || codes.includes('authorization_invalid'))
				add('change_control', row);
			if (codes.some((c) => ['review_task', 'ask'].includes(c))) add('reviews_and_asks', row);
			if (codes.includes('stale_artifact') || codes.includes('stale_dependency')) {
				add('reconciliation', row);
				if (row.attention.some((a) => a.kind === 'change')) add('change_control', row);
			}
		}
		for (const bucket of Object.values(buckets))
			bucket.next_offset =
				offset + bucket.items.length < bucket.total ? offset + bucket.items.length : null;
		return { ...state.stamp, buckets };
	});
}
