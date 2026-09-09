import { technicalAttention, resultApplies } from './attention.mjs';
import { definition as parseDefinition } from './definition.mjs';
import { privateDatabase } from '../storage.mjs';
import { Check } from '../schema.mjs';
import { commandInputs } from './feature-contract.mjs';
import { taskContext } from './task-context.mjs';
import { listProjection, queueProjection, boundedText } from './projections.mjs';
import { initializeKnowledge, transitionKnowledge, sourceRefs } from './knowledge.mjs';
/**
 * @typedef {object} WorkRecord
 * @property {string} id
 * @property {string} type
 * @property {string} title
 * @property {string} status
 * @property {number} version
 * @property {string} [project_id]
 * @property {string} [area_id]
 * @property {string} [success_condition]
 * @property {number} [order]
 * @property {string[]} [options]
 * @property {string} [prompt]
 * @property {string} [description]
 * @property {Array<object>} [sources]
 */
import { randomUUID, createHash } from 'node:crypto';

export { DomainError, requireValue, exact, text } from '../errors.mjs';
import { DomainError, requireValue, exact, text, timestamp } from '../errors.mjs';
export const TYPES = ['project', 'milestone', 'task', 'question', 'decision', 'finding', 'area'];
export const TASK_STATES = ['open', 'ready', 'in_progress', 'waiting', 'completed', 'abandoned'];
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
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export class WorkStore {
	constructor(path) {
		this.db = privateDatabase(path, { maxVersion: 3 });
		this.db.exec('BEGIN IMMEDIATE');
		try {
			this.db.exec(`
   CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY, type TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES objects(id), kind TEXT NOT NULL, revision INTEGER NOT NULL, definition_id TEXT, body TEXT NOT NULL, UNIQUE(task_id,kind,revision)) STRICT;
   CREATE TABLE IF NOT EXISTS events(revision INTEGER PRIMARY KEY AUTOINCREMENT, object_id TEXT NOT NULL, actor TEXT NOT NULL, command TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY, actor TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS links(source TEXT NOT NULL REFERENCES objects(id), target TEXT NOT NULL REFERENCES objects(id), kind TEXT NOT NULL, PRIMARY KEY(source,target,kind)) STRICT;
   CREATE TABLE IF NOT EXISTS asks(id TEXT PRIMARY KEY,subject TEXT NOT NULL REFERENCES objects(id),state TEXT NOT NULL,body TEXT NOT NULL) STRICT;
   CREATE TRIGGER IF NOT EXISTS artifacts_immutable_update BEFORE UPDATE ON artifacts BEGIN SELECT RAISE(ABORT,'immutable_artifact'); END;
   CREATE TRIGGER IF NOT EXISTS artifacts_immutable_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT,'immutable_artifact'); END;
   CREATE TRIGGER IF NOT EXISTS artifacts_definition_owner BEFORE INSERT ON artifacts
    WHEN NEW.kind IN ('plan','result','change','authorization') AND NOT EXISTS
    (SELECT 1 FROM artifacts WHERE id=NEW.definition_id AND task_id=NEW.task_id AND kind='definition')
    BEGIN SELECT RAISE(ABORT,'invalid_definition_pin'); END;
   CREATE TRIGGER IF NOT EXISTS events_immutable_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable_event'); END;
   CREATE TRIGGER IF NOT EXISTS events_immutable_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable_event'); END;
   CREATE TABLE IF NOT EXISTS dependency_pins(source TEXT NOT NULL,target TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'depends_on',source_definition TEXT NOT NULL REFERENCES artifacts(id),target_definition TEXT REFERENCES artifacts(id),PRIMARY KEY(source,target),FOREIGN KEY(source,target,kind) REFERENCES links(source,target,kind) ON DELETE CASCADE) STRICT;
   PRAGMA user_version=3;
  `);
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			this.db.close();
			throw error;
		}
		this.epoch = randomUUID();
		this.listeners = new Set();
		this.changeTimer = undefined;
		this.dataVersion = this.db.prepare('PRAGMA data_version').get().data_version;
	}
	isTerminal(x) {
		return x.type === 'project'
			? this.projectState(x) === 'completed' || x.status === 'abandoned'
			: terminal(x);
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	notify(stamp) {
		for (const listener of this.listeners) {
			try {
				listener(stamp);
			} catch {
				/* A post-commit observer cannot roll back or misreport committed Work. */
			}
		}
	}
	checkExternalChanges() {
		const version = this.db.prepare('PRAGMA data_version').get().data_version;
		if (version !== this.dataVersion) {
			this.dataVersion = version;
			this.notify(this.stamp());
			return true;
		}
		return false;
	}
	close() {
		if (this.changeTimer) clearInterval(this.changeTimer);
		this.listeners.clear();
		this.db.close();
	}
	stamp() {
		return {
			epoch: this.epoch,
			revision: this.db.prepare('SELECT coalesce(max(revision),0) AS n FROM events').get().n
		};
	}
	get(id) {
		const row = this.db.prepare('SELECT body FROM objects WHERE id=?').get(id);
		requireValue(row, 'not_found', 'Work does not exist', { id });
		return JSON.parse(String(row.body));
	}
	all() {
		return this.db
			.prepare('SELECT body FROM objects ORDER BY rowid')
			.all()
			.map((r) => JSON.parse(String(r.body)));
	}
	save(x) {
		this.db
			.prepare(
				'INSERT INTO objects VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body'
			)
			.run(x.id, x.type, x.version, JSON.stringify(x));
	}
	artifact(id) {
		const row = this.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);
		requireValue(row, 'not_found', 'Artifact does not exist');
		return JSON.parse(String(row.body));
	}
	addArtifact(task, kind, body, actor, reason) {
		const revision = this.db
			.prepare('SELECT coalesce(max(revision),0)+1 AS n FROM artifacts WHERE task_id=? AND kind=?')
			.get(task.id, kind).n;
		const artifact = {
			id: randomUUID(),
			owner_id: task.id,
			...(task.type === 'task' ? { task_id: task.id } : {}),
			kind,
			revision,
			definition_id: kind === 'definition' ? null : (task.definition_id ?? null),
			supersedes: task[`${kind}_id`] ?? null,
			actor,
			at: new Date().toISOString(),
			reason,
			...body,
			...(kind === 'result' ? { review_target: task.review_target ?? null } : {})
		};
		this.db
			.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?)')
			.run(artifact.id, task.id, kind, revision, artifact.definition_id, JSON.stringify(artifact));
		task[`${kind}_id`] = artifact.id;
		return artifact;
	}
	warnings(x) {
		const optional = (fn, id) => {
			try {
				return fn.call(this, id);
			} catch (error) {
				if (error.code === 'not_found') return null;
				throw error;
			}
		};
		const result = technicalAttention(x, {
			object: (id) => optional(this.get, id),
			artifact: (id) => optional(this.artifact, id),
			targets: this.db
				.prepare("SELECT target FROM links WHERE source=? AND kind='depends_on'")
				.all(x.id)
				.map((r) => String(r.target)),
			pins: this.db.prepare('SELECT * FROM dependency_pins WHERE source=?').all(x.id)
		});
		if (x.status === 'waiting') result.push({ code: 'waiting', ...x.wait });
		return result;
	}

	projectState(project) {
		if (project.status === 'abandoned') return 'abandoned';
		const milestones = this.all().filter(
			(x) => x.type === 'milestone' && x.project_id === project.id
		);
		return milestones.length && milestones.every((x) => x.status === 'achieved')
			? 'completed'
			: 'open';
	}
	detail(id, full = false) {
		const x = this.get(id);
		const out = {
			...x,
			status: x.type === 'project' ? this.projectState(x) : x.status,
			attention: this.warnings(x)
		};
		for (const kind of [
			'definition',
			'plan',
			'result',
			'change',
			'authorization',
			'answer',
			'hypothesis',
			'package',
			'outcome'
		])
			if (x[`${kind}_id`]) {
				const a = this.artifact(x[`${kind}_id`]);
				if (x.type === 'task' && kind === 'result' && !full && !resultApplies(x, a)) continue;
				if (
					x.type !== 'task' ||
					kind === 'definition' ||
					a.definition_id === x.definition_id ||
					full
				)
					out[kind] = a;
			}

		out.pages = {};
		for (const collection of [
			'relationships',
			'asks',
			'participants',
			...(['project', 'milestone'].includes(x.type) ? ['associated_work'] : []),
			...(full ? ['artifacts', 'history'] : [])
		]) {
			const page = this.related(id, collection, { limit: collection === 'asks' ? 25 : 100 });
			out[collection] = page.items;
			out.pages[collection] = { total: page.total, next_offset: page.next_offset };
		}
		if (full) return out;
		const projection = boundedText(out);
		return {
			...projection.value,
			truncation: {
				truncated: projection.truncated,
				fields: projection.sizes,
				full: { action: 'get', id, full: true }
			}
		};
	}
	related(id, collection, query = {}) {
		exact(query, ['offset', 'limit']);
		const { offset = 0, limit = 25 } = query,
			x = this.get(id);
		requireValue(
			Number.isInteger(offset) &&
				offset >= 0 &&
				Number.isInteger(limit) &&
				limit >= 1 &&
				limit <= 100,
			'invalid_filter',
			'Invalid collection pagination'
		);
		let sql,
			args = [id],
			kind = 'json';
		switch (collection) {
			case 'participants':
				sql =
					"SELECT actor FROM events WHERE object_id=? UNION SELECT 'agent:'||json_extract(body,'$.thread.agent_id') AS actor FROM asks WHERE subject=? ORDER BY actor";
				args = [id, id];
				kind = 'raw';
				break;
			case 'relationships':
				sql =
					'SELECT source,target,kind FROM links WHERE source=? OR target=? ORDER BY source,target,kind';
				args = [id, id];
				kind = 'raw';
				break;
			case 'asks':
				sql = "SELECT body FROM asks WHERE subject=? AND state='open' ORDER BY id";
				break;
			case 'artifacts':
				sql = 'SELECT body FROM artifacts WHERE task_id=? ORDER BY kind,revision';
				break;
			case 'history':
				sql = 'SELECT * FROM events WHERE object_id=? ORDER BY revision';
				kind = 'history';
				break;
			case 'associated_work':
				requireValue(
					['project', 'milestone'].includes(x.type),
					'invalid_filter',
					'Only Projects and Milestones have associated Work'
				);
				sql =
					x.type === 'project'
						? "SELECT body FROM objects WHERE json_extract(body,'$.project_id')=? ORDER BY coalesce(json_extract(body,'$.order'),0),id"
						: "SELECT o.body FROM objects o JOIN links l ON l.source=o.id WHERE l.target=? AND l.kind='milestone' ORDER BY o.id";
				kind = 'work';
				break;
			default:
				requireValue(false, 'invalid_filter', 'Unknown Work collection');
		}
		const total = Number(this.db.prepare(`SELECT count(*) AS n FROM (${sql})`).get(...args).n);
		const items = this.db
			.prepare(`${sql} LIMIT ? OFFSET ?`)
			.all(...args, limit, offset)
			.map((row) => {
				if (kind === 'raw') return row;
				const body = JSON.parse(String(row.body));
				if (kind === 'history') return { ...row, body };
				if (kind === 'work')
					return {
						id: body.id,
						type: body.type,
						title: body.title,
						status: body.status,
						success_condition: body.success_condition,
						achievement_basis: body.achievement_basis
					};
				return body;
			});
		return {
			items,
			total,
			next_offset: offset + items.length < total ? offset + items.length : null,
			version: x.version
		};
	}

	list(query = {}) {
		return listProjection(this, query);
	}
	queue(query = {}) {
		return queueProjection(this, query);
	}
	history(id, query = {}) {
		exact(query, ['offset', 'limit']);
		const { offset = 0, limit = 25 } = query;
		this.get(id);
		requireValue(
			Number.isInteger(offset) &&
				offset >= 0 &&
				Number.isInteger(limit) &&
				limit >= 1 &&
				limit <= 100,
			'invalid_filter',
			'Invalid history pagination'
		);
		const rows = this.db
			.prepare('SELECT * FROM events WHERE object_id=? ORDER BY revision LIMIT ? OFFSET ?')
			.all(id, limit + 1, offset);
		return {
			items: rows.slice(0, limit).map((r) => ({ ...r, body: JSON.parse(String(r.body)) })),
			next_offset: rows.length > limit ? offset + limit : null
		};
	}

	execute(request, actor) {
		exact(request, ['command', 'id', 'expected_version', 'idempotency_key', 'input', 'ask_id']);
		text(actor, 256);
		text(request.idempotency_key, 128);
		const input = request.input ?? {};
		requireValue(
			Object.hasOwn(commandInputs, request.command),
			'invalid_command',
			'Unsupported semantic command'
		);
		requireValue(
			Check(commandInputs[request.command], input),
			'invalid_input',
			'Input does not match the command contract',
			{ command: request.command }
		);
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const hash = digest(request);
			const old = this.db
				.prepare('SELECT * FROM receipts WHERE key=?')
				.get(request.idempotency_key);
			if (old) {
				requireValue(
					old.actor === actor && old.digest === hash,
					'idempotency_conflict',
					'Key was used for a different request'
				);
				this.db.exec('COMMIT');
				return {
					...JSON.parse(String(old.response)),
					noop: true,
					outcome: 'noop',
					...this.stamp()
				};
			}
			/** @type {WorkRecord} */
			let x;
			let prior = null;
			if (request.command === 'create') {
				exact(input, [
					'type',
					'title',
					'description',
					'done_when',
					'project_id',
					'area_id',
					'success_condition',
					'order',
					'prompt',
					'options',
					'deciders',
					'recommendation',
					'consequence_of_no_decision',
					'impact',
					'answerable_by',
					'conclusion',
					'confidence',
					'sources',
					'targets'
				]);
				requireValue(TYPES.includes(input.type), 'invalid_input', 'Unsupported Work type');
				x = {
					id: randomUUID(),
					type: input.type,
					title: text(input.title, 240),
					status: 'open',
					version: 1
				};
				if (input.project_id) {
					requireValue(
						this.get(input.project_id).type === 'project' &&
							this.get(input.project_id).status !== 'abandoned',
						'invalid_parent',
						'Expected active Project'
					);
					x.project_id = input.project_id;
				}
				if (input.area_id) {
					requireValue(
						this.get(input.area_id).type === 'area' && this.get(input.area_id).status === 'active',
						'invalid_parent',
						'Expected Area'
					);
					x.area_id = input.area_id;
				}
				if (x.type === 'milestone') {
					requireValue(x.project_id, 'input_required', 'Milestones require a Project');
					x.success_condition = text(input.success_condition);
					x.order = input.order ?? 0;
					requireValue(Number.isInteger(x.order), 'invalid_input', 'Order must be an integer');
				}

				if (input.prompt) x.prompt = text(input.prompt);
				if (input.sources) x.sources = sourceRefs(input.sources);
				this.save(x);
				initializeKnowledge(this, x, input, actor);
				if (x.type === 'task') {
					const definition = parseDefinition(input);
					this.addArtifact(x, 'definition', definition, actor, 'Created');
				} else if (input.description) x.description = text(input.description);
			} else {
				x = this.get(request.id);
				prior = x.version;
				requireValue(
					request.expected_version === x.version,
					'version_conflict',
					'Work changed; reread and reapply without discarding your input',
					{ expected: request.expected_version, current: x.version }
				);
				const before = JSON.stringify(x);
				this.transition(x, request.command, input, actor);
				if (
					JSON.stringify(x) === before &&
					!request.ask_id &&
					!['associate'].includes(request.command)
				) {
					const response = {
						command: request.command,
						target: x.id,
						prior_version: prior,
						version: x.version,
						outcome: 'noop',
						noop: true,
						warnings: this.warnings(x)
					};
					this.db
						.prepare('INSERT INTO receipts VALUES(?,?,?,?)')
						.run(request.idempotency_key, actor, hash, JSON.stringify(response));
					this.db.exec('COMMIT');
					return { ...response, ...this.stamp() };
				}
				if (request.ask_id) {
					const row = this.db
						.prepare("SELECT body FROM asks WHERE id=? AND subject=? AND state='open'")
						.get(request.ask_id, x.id);
					requireValue(row, 'not_found', 'Open Ask does not match this subject');
					const ask = JSON.parse(String(row.body));
					requireValue(
						ask.intended_command === request.command,
						'invalid_command',
						'Resubmit the Ask intended operation'
					);
					this.db.prepare("UPDATE asks SET state='resolved' WHERE id=?").run(request.ask_id);
				}
				x.version++;
			}
			this.save(x);
			const warnings = this.warnings(x);
			const response = {
				command: request.command,
				target: x.id,
				prior_version: prior,
				version: x.version,
				outcome: warnings.length ? 'committed_with_warnings' : 'committed',
				noop: false,
				warnings
			};
			this.db.prepare('INSERT INTO events(object_id,actor,command,at,body) VALUES(?,?,?,?,?)').run(
				x.id,
				actor,
				request.command,
				new Date().toISOString(),
				JSON.stringify({
					before_version: prior,
					after: x,
					input,
					warnings,
					...(['depends_on', 'reaffirm_dependency'].includes(request.command)
						? {
								dependency_pin: this.db
									.prepare('SELECT * FROM dependency_pins WHERE source=? AND target=?')
									.get(x.id, input.target)
							}
						: {})
				})
			);
			this.db
				.prepare('INSERT INTO receipts VALUES(?,?,?,?)')
				.run(request.idempotency_key, actor, hash, JSON.stringify(response));
			const stamp = this.stamp();
			this.db.exec('COMMIT');
			this.notify(stamp);
			return { ...response, ...stamp };
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	transition(x, command, input, actor) {
		if (
			taskContext(this, x, command, input, actor) ||
			transitionKnowledge(this, x, command, input, actor)
		)
			return;
		if (command === 'reaffirm_dependency') {
			exact(input, ['target', 'reason']);
			text(input.reason, 1000);
			const target = this.get(input.target);
			const previous = this.db
				.prepare('SELECT * FROM dependency_pins WHERE source=? AND target=?')
				.get(x.id, target.id);
			requireValue(previous, 'not_found', 'Dependency is not present');
			this.db
				.prepare(
					'UPDATE dependency_pins SET source_definition=?,target_definition=? WHERE source=? AND target=?'
				)
				.run(x.definition_id, target.definition_id ?? null, x.id, target.id);
			x.relationship_revision = (x.relationship_revision ?? 0) + 1;
			return;
		}
		if (command === 'depends_on') {
			exact(input, ['target']);
			const dependency = this.get(input.target);
			requireValue(
				x.type === 'task' && ['task', 'question', 'decision'].includes(dependency.type),
				'invalid_relationship',
				'Task dependencies target Tasks, Questions or Decisions'
			);
			requireValue(input.target !== x.id, 'cycle', 'Self dependency is invalid');
			const reaches = (id, seen = new Set()) => {
				if (id === x.id) return true;
				if (seen.has(id)) return false;
				seen.add(id);
				return this.db
					.prepare("SELECT target FROM links WHERE source=? AND kind='depends_on'")
					.all(id)
					.some((r) => reaches(r.target, seen));
			};
			requireValue(!reaches(input.target), 'cycle', 'Dependency would form a cycle');
			const inserted = this.db
				.prepare("INSERT OR IGNORE INTO links VALUES(?,?,'depends_on')")
				.run(x.id, input.target);
			if (inserted.changes) {
				this.db
					.prepare(
						'INSERT INTO dependency_pins(source,target,source_definition,target_definition) VALUES(?,?,?,?)'
					)
					.run(x.id, input.target, x.definition_id, dependency.definition_id ?? null);
				x.relationship_revision = (x.relationship_revision ?? 0) + 1;
			}
			return;
		}
		if (command === 'associate') {
			exact(input, ['milestone_id']);
			const milestone = this.get(input.milestone_id);
			requireValue(
				milestone.type === 'milestone' &&
					milestone.status !== 'achieved' &&
					milestone.project_id === x.project_id,
				'invalid_association',
				'Associate only within the same Project to an open Milestone'
			);
			this.db
				.prepare("INSERT OR IGNORE INTO links VALUES(?,?,'milestone')")
				.run(x.id, milestone.id);
			return;
		}
		if (x.type === 'milestone') {
			if (command === 'achieve') {
				exact(input, ['basis', 'sources', 'work_refs']);
				const unresolved = this.db
					.prepare("SELECT source FROM links WHERE target=? AND kind='milestone'")
					.all(x.id)
					.map((r) => this.get(r.source))
					.filter((y) => !terminal(y));
				requireValue(
					!unresolved.length,
					'unresolved_work',
					'Resolve or explicitly detach associated Work',
					{ objects: unresolved.map((y) => ({ id: y.id, title: y.title })) }
				);
				x.achievement = {
					basis: text(input.basis, 4000),
					supporting_work: (input.work_refs ?? []).map((id) => {
						const item = this.get(id);
						return {
							id: item.id,
							version: item.version,
							definition_id: item.definition_id ?? null,
							result_id:
								item.accepted_result_id ??
								item.result_id ??
								item.answer_id ??
								item.outcome_id ??
								null
						};
					}),
					sources: sourceRefs(input.sources),
					actor,
					at: new Date().toISOString()
				};
				x.status = 'achieved';
				return;
			}
			if (command === 'reopen') {
				exact(input, []);
				x.status = 'open';
				return;
			}
		}
		if (x.type === 'project' && command === 'abandon') {
			exact(input, ['dispositions', 'versions']);
			const children = this.all().filter(
				(y) => y.project_id === x.id && !terminal(y) && y.type !== 'milestone'
			);
			requireValue(
				input.dispositions &&
					Object.keys(input.dispositions).length === children.length &&
					children.every((y) => ['abandon', 'detach'].includes(input.dispositions[y.id])),
				'input_required',
				'Resolve each unfinished item separately',
				{ requirements: children.map((y) => ({ subject: y.id, choices: ['abandon', 'detach'] })) }
			);
			requireValue(
				input.versions && Object.keys(input.versions).length === children.length,
				'input_required',
				'Provide the reviewed version for each child disposition',
				{
					requirements: children.map((y) => ({
						subject: y.id,
						expected_version: y.version,
						choices: ['abandon', 'detach']
					}))
				}
			);
			requireValue(
				children.every((y) => input.versions[y.id] === y.version),
				'version_conflict',
				'A disposition subject changed; reread that Work before abandoning the Project',
				{
					objects: children
						.filter((y) => input.versions[y.id] !== y.version)
						.map((y) => ({ id: y.id, current: y.version }))
				}
			);
			for (const child of children) {
				if (input.dispositions[child.id] === 'abandon')
					child.status = ['question', 'decision'].includes(child.type) ? 'withdrawn' : 'abandoned';
				else {
					delete child.project_id;
					this.db.prepare("DELETE FROM links WHERE source=? AND kind='milestone'").run(child.id);
				}
				child.version++;
				this.save(child);
				this.db
					.prepare('INSERT INTO events(object_id,actor,command,at,body) VALUES(?,?,?,?,?)')
					.run(
						child.id,
						actor,
						'project_disposition',
						new Date().toISOString(),
						JSON.stringify({ disposition: input.dispositions[child.id], after: child })
					);
			}
			x.status = 'abandoned';
			return;
		}
		if (x.type === 'project' && command === 'resume') {
			exact(input, []);
			requireValue(x.status === 'abandoned', 'invalid_transition', 'Project is not abandoned');
			x.status = 'open';
			return;
		}
		requireValue(x.type === 'task', 'invalid_command', 'Unsupported operation for this object');
		if (['revise_definition', 'revise_plan', 'checkpoint', 'revise_change'].includes(command)) {
			requireValue(
				!terminal(x),
				'invalid_transition',
				'Reopen or resume before revising a terminal Task'
			);
			if (command === 'revise_definition') {
				exact(input, ['title', 'description', 'done_when', 'reason']);
				const body = parseDefinition(input);
				this.addArtifact(x, 'definition', body, actor, text(input.reason, 1000));
				x.title = body.title;
			} else {
				exact(input, ['content', 'reason']);
				this.addArtifact(
					x,
					command === 'revise_plan' ? 'plan' : command === 'checkpoint' ? 'result' : 'change',
					{ content: text(input.content) },
					actor,
					text(input.reason, 1000)
				);
			}
			return;
		}
		if (command === 'assign') {
			exact(input, ['agent_id']);
			x.agent_id = input.agent_id === null ? null : text(input.agent_id, 128);
			return;
		}
		if (command === 'ready' || command === 'unready') {
			exact(input, []);
			requireValue(
				['open', 'ready'].includes(x.status),
				'invalid_transition',
				'Only open or ready Tasks can be groomed'
			);
			x.status = command === 'ready' ? 'ready' : 'open';
			return;
		}
		if (command === 'start') {
			exact(input, ['claim']);
			requireValue(
				['open', 'ready'].includes(x.status),
				'invalid_transition',
				'Task is not ready to start'
			);
			if (!x.agent_id) {
				requireValue(
					input.claim === true && actor.startsWith('agent:'),
					'input_required',
					'Explicitly accept accountable assignment before starting',
					{ requirement: 'claim', subject: x.id, offered_agent: actor }
				);
				x.agent_id = actor.slice(6);
			}
			x.status = 'in_progress';
			return;
		}
		if (command === 'wait') {
			exact(input, ['waiting_for', 'resume_when', 'follow_up_at', 'waiting_ref']);
			requireValue(
				['ready', 'in_progress'].includes(x.status),
				'invalid_transition',
				'Only ready or running Tasks can wait'
			);
			if (input.follow_up_at) timestamp(input.follow_up_at);
			x.wait = {
				waiting_for: text(input.waiting_for, 2000),
				...(input.waiting_ref ? { waiting_ref: input.waiting_ref } : {}),
				resume_when: text(input.resume_when, 2000),
				follow_up_at: input.follow_up_at ?? null,
				since: new Date().toISOString(),
				prior: x.status
			};
			x.status = 'waiting';
			return;
		}
		if (command === 'resume') {
			exact(input, []);
			requireValue(
				['waiting', 'abandoned'].includes(x.status),
				'invalid_transition',
				'Task is not waiting or abandoned'
			);
			x.status = x.wait?.prior ?? 'open';
			delete x.wait;
			return;
		}
		if (command === 'complete') {
			exact(input, ['result_id', 'content']);
			requireValue(x.status !== 'abandoned', 'invalid_transition', 'Resume before completion');
			if (x.status === 'completed') return;
			if (input.result_id) {
				const a = this.artifact(input.result_id);
				requireValue(
					resultApplies(x, a),
					'stale_artifact',
					'Result must pin the current Definition and review target'
				);
				x.result_id = a.id;
			} else this.addArtifact(x, 'result', { content: text(input.content) }, actor, 'Completion');
			x.accepted_result_id = x.result_id;
			x.status = 'completed';
			delete x.wait;
			return;
		}
		if (command === 'reopen') {
			exact(input, []);
			requireValue(x.status === 'completed', 'invalid_transition', 'Task is not completed');
			x.status = 'open';
			return;
		}
		if (command === 'abandon') {
			exact(input, []);
			x.status = 'abandoned';
			return;
		}
		throw new DomainError('invalid_command', 'Unsupported Task operation');
	}
}
