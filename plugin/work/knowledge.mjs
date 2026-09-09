// Retained v3 validation/lifecycle rules adapted from objects/{question,decision,finding,area}.ts.
// No obsolete Blocker auto-mutation, Phase containment, or standalone authorization is carried over.
import { exact, requireValue, text, timestamp } from '../errors.mjs';
export function dependencySatisfied(x) {
	return x.type === 'task'
		? x.status === 'completed'
		: x.type === 'question'
			? x.status === 'answered'
			: x.type === 'decision'
				? x.status === 'decided' && !x.superseded_by
				: false;
}
export const CONFIDENCES = ['tentative', 'supported', 'confirmed'];
export function sourceRefs(raw = [], required = false) {
	requireValue(
		Array.isArray(raw) && raw.length <= 50 && (!required || raw.length > 0),
		'invalid_sources',
		'Supply up to 50 source references'
	);
	return raw.map((value) => {
		exact(value, [
			'kind',
			'ref',
			'label',
			'captured_at',
			'locator',
			'snapshot_ref',
			'content_hash'
		]);
		const out = { kind: text(value.kind, 64), ref: text(value.ref, 4096) };
		for (const key of ['label', 'locator', 'snapshot_ref', 'content_hash'])
			if (value[key] !== undefined) out[key] = text(value[key], 8192);
		if (value.captured_at !== undefined) {
			requireValue(
				Number.isSafeInteger(value.captured_at) && value.captured_at >= 0,
				'invalid_sources',
				'captured_at must be a nonnegative millisecond timestamp'
			);
			out.captured_at = value.captured_at;
		}
		return out;
	});
}
export function confidence(raw) {
	requireValue(
		CONFIDENCES.includes(raw),
		'invalid_input',
		'Expected tentative, supported, or confirmed confidence'
	);
	return raw;
}
export function decisionPackage(input) {
	const options = input.options;
	requireValue(
		Array.isArray(options) && options.length >= 2 && options.length <= 20,
		'input_required',
		'A Decision needs 2–20 materially distinct options'
	);
	const parsed = options.map((o) => {
		exact(o, ['id', 'label', 'summary', 'tradeoffs', 'risks']);
		return {
			id: text(o.id, 100),
			label: text(o.label, 300),
			...Object.fromEntries(
				['summary', 'tradeoffs', 'risks']
					.filter((k) => o[k] !== undefined)
					.map((k) => [k, text(o[k], 4000)])
			)
		};
	});
	requireValue(
		new Set(parsed.map((o) => o.id)).size === parsed.length &&
			new Set(parsed.map((o) => o.label.toLowerCase())).size === parsed.length,
		'invalid_options',
		'Option ids and labels must be distinct'
	);
	exact(input.recommendation, ['option_id', 'rationale']);
	requireValue(
		parsed.some((o) => o.id === input.recommendation.option_id),
		'invalid_recommendation',
		'Recommendation must name an option'
	);
	requireValue(
		Array.isArray(input.deciders) && input.deciders.length > 0 && input.deciders.length <= 20,
		'input_required',
		'A Decision needs accountable decider identities'
	);
	return {
		prompt: text(input.prompt, 2000),
		options: parsed,
		deciders: [...new Set(input.deciders.map((v) => text(v, 256)))],
		recommendation: {
			option_id: input.recommendation.option_id,
			rationale: text(input.recommendation.rationale, 4000)
		},
		consequence_of_no_decision: text(input.consequence_of_no_decision, 4000)
	};
}
export function initializeKnowledge(store, x, input, actor) {
	if (x.type === 'area') {
		x.status = 'active';
		return;
	}
	if (x.type === 'question') {
		x.prompt = text(input.prompt, 2000);
		requireValue(
			x.prompt.endsWith('?'),
			'invalid_question',
			'Question must be explicit and end with ?'
		);
		x.impact = text(input.impact, 4000);
		x.answerable_by = (input.answerable_by ?? []).map((v) => text(v, 256));
		return;
	}
	if (x.type === 'decision') {
		x.status = 'pending';
		Object.assign(x, decisionPackage(input));
		store.addArtifact(x, 'package', decisionPackage(input), actor, 'Created decision package');
		return;
	}
	if (x.type === 'finding') {
		x.status = 'current';
		x.conclusion = text(input.conclusion);
		x.confidence = confidence(input.confidence);
		x.sources = sourceRefs(input.sources, true);
		x.targets = (input.targets ?? []).map((id) => {
			store.get(id);
			return id;
		});
	}
}
export function transitionKnowledge(store, x, command, input, actor) {
	if (x.type === 'question') {
		if (command === 'edit_question') {
			exact(input, ['context', 'impact', 'answerable_by']);
			requireValue(
				x.status !== 'withdrawn',
				'invalid_transition',
				'Reopen a withdrawn Question before editing'
			);
			if (input.context !== undefined) x.context = text(input.context);
			if (input.impact !== undefined) x.impact = text(input.impact, 4000);
			if (input.answerable_by !== undefined)
				x.answerable_by = input.answerable_by.map((id) => text(id, 256));
			return true;
		}
		if (command === 'answer') {
			exact(input, ['answer', 'confidence', 'sources']);
			requireValue(
				x.status !== 'withdrawn',
				'invalid_transition',
				'Reopen a withdrawn Question before answering'
			);
			requireValue(
				!x.answerable_by?.length || x.answerable_by.includes(actor),
				'authority_required',
				'This actor is not an authorized answerer'
			);
			const level = confidence(input.confidence);
			store.addArtifact(
				x,
				'answer',
				{
					answer: text(input.answer),
					confidence: level,
					sources: sourceRefs(input.sources, level !== 'tentative')
				},
				actor,
				'Authoritative answer'
			);
			x.status = 'answered';
			return true;
		}
		if (command === 'hypothesis') {
			exact(input, ['text', 'confidence', 'sources']);
			requireValue(x.status === 'open', 'invalid_transition', 'Hypotheses apply to open Questions');
			store.addArtifact(
				x,
				'hypothesis',
				{
					text: text(input.text),
					confidence: confidence(input.confidence),
					sources: sourceRefs(input.sources, true)
				},
				actor,
				'Working hypothesis; not an answer'
			);
			return true;
		}
		if (command === 'reopen') {
			exact(input, []);
			requireValue(
				['answered', 'withdrawn'].includes(x.status),
				'invalid_transition',
				'Question is already open'
			);
			x.status = 'open';
			return true;
		}
	}
	if (x.type === 'decision') {
		if (command === 'supersede_decision') {
			exact(input, ['successor_id', 'successor_version', 'reason']);
			const successor = store.get(input.successor_id);
			requireValue(
				actor.startsWith('human:') && successor.deciders?.includes(actor),
				'authority_required',
				'A replacement decider must record supersession'
			);
			requireValue(
				x.status === 'decided' &&
					successor.type === 'decision' &&
					successor.status === 'decided' &&
					successor.id !== x.id &&
					!x.superseded_by &&
					!successor.supersedes,
				'invalid_transition',
				'Supersession needs distinct recorded decisions with no existing successor link'
			);
			requireValue(
				successor.version === input.successor_version,
				'version_conflict',
				'Replacement Decision changed'
			);
			x.superseded_by = successor.id;
			x.supersede_reason = text(input.reason, 2000);
			successor.supersedes = x.id;
			successor.version++;
			store.save(successor);
			store.db
				.prepare('INSERT INTO events(object_id,actor,command,at,body) VALUES(?,?,?,?,?)')
				.run(
					successor.id,
					actor,
					'decision_supersession_link',
					new Date().toISOString(),
					JSON.stringify({ supersedes: x.id, after: successor })
				);
			return true;
		}
		if (command === 'revise_decision') {
			exact(input, [
				'prompt',
				'options',
				'deciders',
				'recommendation',
				'consequence_of_no_decision',
				'reason'
			]);
			requireValue(
				['pending', 'deferred'].includes(x.status),
				'invalid_transition',
				'Decided commitments require a superseding Decision'
			);
			const pack = decisionPackage(input);
			store.addArtifact(x, 'package', pack, actor, text(input.reason, 1000));
			Object.assign(x, pack);
			return true;
		}
		if (command === 'decide') {
			exact(input, ['option_id', 'rationale', 'sources', 'authority_source']);
			requireValue(
				['pending', 'deferred'].includes(x.status),
				'invalid_transition',
				'Decision is not pending'
			);
			requireValue(
				x.options.some((o) => o.id === input.option_id),
				'invalid_option',
				'Choose a listed option'
			);
			// The actor must be a declared decider. Agent assertions of human authority are retained as
			// provenance, never elevated into a human principal by this synchronous domain method.
			requireValue(
				actor.startsWith('human:') && x.deciders.includes(actor),
				'authority_required',
				'A declared decider must record the commitment'
			);
			const refs = sourceRefs(input.sources);
			store.addArtifact(
				x,
				'outcome',
				{ option_id: input.option_id, rationale: text(input.rationale, 4000), sources: refs },
				actor,
				'Recorded decision'
			);
			x.status = 'decided';
			x.decided_at = new Date().toISOString();
			delete x.deferred;
			return true;
		}
		if (command === 'defer') {
			exact(input, ['reason', 'until']);
			requireValue(
				x.status === 'pending',
				'invalid_transition',
				'Only pending Decisions can defer'
			);
			timestamp(input.until);
			x.status = 'deferred';
			x.deferred = { reason: text(input.reason, 2000), until: input.until };
			return true;
		}
		if (command === 'resume') {
			exact(input, []);
			requireValue(x.status === 'deferred', 'invalid_transition', 'Decision is not deferred');
			x.status = 'pending';
			delete x.deferred;
			return true;
		}
	}
	if (['question', 'decision'].includes(x.type) && command === 'withdraw') {
		exact(input, ['reason']);
		requireValue(
			!['decided', 'withdrawn'].includes(x.status),
			'invalid_transition',
			'Terminal commitment cannot be withdrawn'
		);
		x.status = 'withdrawn';
		x.withdraw_reason = text(input.reason, 2000);
		return true;
	}
	if (x.type === 'finding') {
		if (command === 'retract') {
			exact(input, ['reason', 'sources']);
			requireValue(
				x.status === 'current',
				'invalid_transition',
				'Only current Findings can be retracted'
			);
			x.status = 'retracted';
			x.retraction = { reason: text(input.reason, 2000), sources: sourceRefs(input.sources) };
			return true;
		}
		if (command === 'supersede') {
			exact(input, ['successor_id', 'reason']);
			const successor = store.get(input.successor_id);
			requireValue(
				x.status === 'current' &&
					successor.type === 'finding' &&
					successor.status === 'current' &&
					successor.id !== x.id,
				'invalid_transition',
				'Choose a distinct current Finding'
			);
			x.status = 'superseded';
			x.superseded_by = successor.id;
			x.supersede_reason = text(input.reason, 2000);
			return true;
		}
	}
	if (x.type === 'area') {
		if (command === 'archive') {
			exact(input, []);
			const unresolved = store.all().filter((y) => y.area_id === x.id && !store.isTerminal(y));
			requireValue(
				!unresolved.length,
				'unresolved_work',
				'Area has nonterminal Work; resolve or reassign it',
				{ objects: unresolved.map((y) => y.id) }
			);
			x.status = 'archived';
			return true;
		}
		if (command === 'restore') {
			exact(input, []);
			x.status = 'active';
			return true;
		}
		if (command === 'edit_area') {
			exact(input, ['title', 'description']);
			requireValue(x.status === 'active', 'invalid_transition', 'Restore the Area before editing');
			x.title = text(input.title, 240);
			x.description = text(input.description);
			return true;
		}
	}
	return false;
}
