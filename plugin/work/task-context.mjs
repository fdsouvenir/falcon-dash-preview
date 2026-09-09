import { exact, requireValue, text } from '../errors.mjs';
import { sourceRefs } from './knowledge.mjs';
export function taskContext(store, x, command, input, actor) {
	if (command === 'ask') {
		exact(input, ['requirement', 'intended_command', 'thread', 'prompt']);
		exact(input.thread, ['session_key', 'agent_id']);
		const ask = {
			id: crypto.randomUUID(),
			subject: x.id,
			requirement: text(input.requirement, 200),
			intended_command: text(input.intended_command, 100),
			prompt: text(input.prompt, 2000),
			thread: {
				session_key: text(input.thread.session_key, 256),
				agent_id: text(input.thread.agent_id, 128)
			},
			actor,
			created_at: new Date().toISOString(),
			subject_version: x.version
		};
		store.db
			.prepare("INSERT INTO asks VALUES(?,?,'open',?)")
			.run(ask.id, x.id, JSON.stringify(ask));
		x.last_ask_id = ask.id;
		return true;
	}
	if (command === 'dismiss_ask') {
		exact(input, ['ask_id', 'reason']);
		const row = store.db
			.prepare('SELECT * FROM asks WHERE id=? AND subject=?')
			.get(input.ask_id, x.id);
		requireValue(row && row.state === 'open', 'not_found', 'Open Ask not found');
		const ask = JSON.parse(String(row.body));
		ask.dismissal = { actor, reason: text(input.reason, 1000), at: new Date().toISOString() };
		store.db
			.prepare("UPDATE asks SET state='dismissed',body=? WHERE id=?")
			.run(JSON.stringify(ask), input.ask_id);
		x.last_ask_id = null;
		return true;
	}
	if (command === 'remove_dependency' || command === 'dissociate') {
		exact(input, ['target', 'reason']);
		text(input.reason, 1000);
		const kind = command === 'dissociate' ? 'milestone' : 'depends_on';
		const removed = store.db
			.prepare('DELETE FROM links WHERE source=? AND target=? AND kind=?')
			.run(x.id, input.target, kind);
		if (removed.changes) x.relationship_revision = (x.relationship_revision ?? 0) + 1;
		return true;
	}
	if (command === 'place') {
		exact(input, ['project_id', 'area_id', 'reason']);
		text(input.reason, 1000);
		const area = store.get(input.area_id);
		requireValue(
			area.type === 'area' && area.status === 'active',
			'invalid_parent',
			'Placement requires an active Area'
		);
		if (input.project_id !== null) {
			const project = store.get(input.project_id);
			requireValue(
				project.type === 'project' && project.status !== 'abandoned',
				'invalid_parent',
				'Choose an active Project'
			);
		}
		requireValue(
			!['project', 'area', 'milestone'].includes(x.type),
			'invalid_command',
			'This object uses its own placement operation'
		);
		if (x.project_id !== input.project_id)
			store.db.prepare("DELETE FROM links WHERE source=? AND kind='milestone'").run(x.id);
		x.project_id = input.project_id;
		x.area_id = input.area_id;
		return true;
	}
	if (x.type !== 'task') return false;
	if (command === 'review_target') {
		exact(input, ['artifact_id']);
		requireValue(
			!store.isTerminal(x),
			'invalid_transition',
			'Reopen review Task before changing its target'
		);
		const artifact = store.artifact(input.artifact_id);
		requireValue(
			artifact.owner_id !== x.id && artifact.task_id !== x.id,
			'invalid_review',
			'Independent review must target another Work artifact'
		);
		x.review_target = {
			artifact_id: artifact.id,
			owner_id: artifact.owner_id ?? artifact.task_id,
			kind: artifact.kind,
			revision: artifact.revision
		};
		return true;
	}
	if (command === 'revise_change') {
		exact(input, ['scope', 'risk', 'rollback', 'acceptance', 'reason']);
		requireValue(
			!store.isTerminal(x),
			'invalid_transition',
			'Reopen Task before changing its control boundary'
		);
		store.addArtifact(
			x,
			'change',
			{
				scope: text(input.scope),
				risk: text(input.risk, 4000),
				rollback: text(input.rollback),
				acceptance: text(input.acceptance)
			},
			actor,
			text(input.reason, 1000)
		);
		return true;
	}
	if (command === 'authorize') {
		exact(input, ['change_id', 'plan_id', 'conditions', 'sources']);
		requireValue(
			actor.startsWith('human:'),
			'authority_required',
			'A verified human must authorize; agent-supplied identity or source claims cannot grant authority'
		);
		requireValue(
			input.change_id === x.change_id,
			'stale_artifact',
			'Authorize the current change-control revision'
		);
		const change = store.artifact(input.change_id);
		requireValue(
			change.definition_id === x.definition_id,
			'stale_artifact',
			'Reconcile change scope against current Definition'
		);
		if (input.plan_id) {
			requireValue(
				input.plan_id === x.plan_id &&
					store.artifact(input.plan_id).definition_id === x.definition_id,
				'stale_artifact',
				'Authorize only the current applicable Plan'
			);
		}
		store.addArtifact(
			x,
			'authorization',
			{
				change_id: input.change_id,
				plan_id: input.plan_id ?? null,
				conditions: text(input.conditions, 4000),
				sources: sourceRefs(input.sources, true)
			},
			actor,
			'Authorized pinned Task scope'
		);
		return true;
	}
	if (command === 'revoke_authorization') {
		exact(input, ['reason']);
		requireValue(
			actor.startsWith('human:'),
			'authority_required',
			'A verified human must revoke authorization'
		);
		requireValue(x.authorization_id, 'not_found', 'Task has no authorization');
		store.addArtifact(
			x,
			'authorization',
			{ revokes: x.authorization_id, reason: text(input.reason, 1000) },
			actor,
			'Revoked Task scope authorization'
		);
		return true;
	}
	if (command === 'reaffirm_plan') {
		exact(input, ['plan_id', 'reason']);
		requireValue(
			!store.isTerminal(x) && input.plan_id === x.plan_id,
			'stale_artifact',
			'Select the current Plan'
		);
		const old = store.artifact(input.plan_id);
		requireValue(
			old.definition_id !== x.definition_id,
			'invalid_transition',
			'Plan already pins the current Definition'
		);
		store.addArtifact(
			x,
			'plan',
			{ content: old.content, reaffirms: old.id },
			actor,
			text(input.reason, 1000)
		);
		return true;
	}
	return false;
}
