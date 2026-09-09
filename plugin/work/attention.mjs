import { dependencySatisfied } from './knowledge.mjs';
/** @typedef {{code:string,target?:string,kind?:string,requirement?:string,waiting_for?:string,follow_up_due?:boolean}} Attention */
/** @returns {Attention[]} */
export function technicalAttention(x, { object, artifact, targets = [], pins = [] }) {
	/** @type {Attention[]} */
	const warnings = [];
	for (const id of targets) {
		const target = object(id);
		if (!target || !dependencySatisfied(target))
			warnings.push({ code: target ? 'dependency_unresolved' : 'missing_reference', target: id });
	}
	for (const kind of ['plan', 'result', 'change', 'authorization'])
		if (x[`${kind}_id`]) {
			const revision = artifact(x[`${kind}_id`]);
			if (!revision || revision.definition_id !== x.definition_id)
				warnings.push({ code: 'stale_artifact', kind, target: x[`${kind}_id`] });
		}
	for (const pin of pins) {
		const target = object(pin.target);
		if (
			pin.source_definition !== x.definition_id ||
			(pin.target_definition && pin.target_definition !== target?.definition_id)
		)
			warnings.push({ code: 'stale_dependency', target: pin.target });
	}
	if (x.change_id && !x.authorization_id)
		warnings.push({ code: 'authorization_required', target: x.change_id });
	if (x.authorization_id) {
		const auth = artifact(x.authorization_id);
		if (
			!auth ||
			auth.revokes ||
			auth.change_id !== x.change_id ||
			(auth.plan_id && auth.plan_id !== x.plan_id)
		)
			warnings.push({ code: 'authorization_invalid', target: x.authorization_id });
	}
	if (x.result_id && x.review_target) {
		const result = artifact(x.result_id);
		if (
			(result?.review_target?.artifact_id ?? result?.review_artifact_id) !==
			x.review_target.artifact_id
		)
			warnings.push({ code: 'review_result_stale', target: x.result_id });
	}
	return warnings;
}

export function resultApplies(task, result) {
	return (
		result.task_id === task.id &&
		result.kind === 'result' &&
		result.definition_id === task.definition_id &&
		(result.review_target?.artifact_id ?? null) === (task.review_target?.artifact_id ?? null)
	);
}
