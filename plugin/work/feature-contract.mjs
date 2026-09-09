import { Type } from '../schema.mjs';
import { defineFeatureContract } from 'openclaw/plugin-sdk/feature-contract';
const Str = (max = 12000) => Type.String({ minLength: 1, maxLength: max });
const Obj = (properties) => Type.Object(properties, { additionalProperties: false });
const Opt = Type.Optional;
const Id = Str(128),
	Reason = Str(1000),
	Sources = Type.Array(
		Obj({
			kind: Str(64),
			ref: Str(4096),
			label: Opt(Str(8192)),
			captured_at: Opt(Type.Integer({ minimum: 0 })),
			locator: Opt(Str(8192)),
			snapshot_ref: Opt(Str(8192)),
			content_hash: Opt(Str(8192))
		}),
		{ maxItems: 50 }
	);
const confidence = Type.Union(
	['tentative', 'supported', 'confirmed'].map((value) => Type.Literal(value))
);
const option = Obj({
	id: Id,
	label: Str(300),
	summary: Opt(Str(4000)),
	risks: Opt(Str(4000)),
	tradeoffs: Opt(Str(4000))
});
const decisionFields = {
	prompt: Str(2000),
	options: Type.Array(option, { minItems: 2, maxItems: 20 }),
	deciders: Type.Array(Id, { minItems: 1, maxItems: 20 }),
	recommendation: Obj({ option_id: Id, rationale: Str(4000) }),
	consequence_of_no_decision: Str(4000)
};
const common = { title: Str(240), description: Opt(Str()), area_id: Opt(Id), project_id: Opt(Id) };
const creates = [
	Obj({ ...common, type: Type.Literal('task'), description: Str(), done_when: Str() }),
	Obj({ ...common, type: Type.Literal('project') }),
	Obj({ ...common, type: Type.Literal('area') }),
	Obj({
		...common,
		type: Type.Literal('milestone'),
		project_id: Id,
		success_condition: Str(),
		order: Opt(Type.Integer())
	}),
	Obj({
		...common,
		type: Type.Literal('question'),
		prompt: Str(2000),
		impact: Str(4000),
		answerable_by: Opt(Type.Array(Id, { maxItems: 20 }))
	}),
	Obj({ ...common, type: Type.Literal('decision'), ...decisionFields }),
	Obj({
		...common,
		type: Type.Literal('finding'),
		conclusion: Str(),
		confidence,
		sources: Sources,
		targets: Opt(Type.Array(Id, { maxItems: 50 }))
	})
];
export const commandInputs = {
	create: Type.Union(creates),
	ready: Obj({}),
	unready: Obj({}),
	start: Obj({ claim: Opt(Type.Boolean()) }),
	wait: Obj({
		waiting_for: Str(2000),
		resume_when: Str(2000),
		follow_up_at: Opt(Str(64)),
		waiting_ref: Opt(
			Obj({
				kind: Type.Union(
					['agent', 'session', 'work', 'external'].map((value) => Type.Literal(value))
				),
				ref: Str(4096),
				agent_id: Opt(Id)
			})
		)
	}),
	resume: Obj({}),
	complete: Obj({ result_id: Opt(Id), content: Opt(Str()) }),
	reopen: Obj({}),
	abandon: Obj({
		versions: Opt(Type.Record(Id, Type.Integer({ minimum: 1 }))),
		dispositions: Opt(
			Type.Record(Id, Type.Union([Type.Literal('abandon'), Type.Literal('detach')]))
		)
	}),
	assign: Obj({ agent_id: Type.Union([Id, Type.Null()]) }),
	revise_definition: Obj({ title: Str(240), description: Str(), done_when: Str(), reason: Reason }),
	revise_plan: Obj({ content: Str(), reason: Reason }),
	checkpoint: Obj({ content: Str(), reason: Reason }),
	revise_change: Obj({
		scope: Str(),
		risk: Str(4000),
		rollback: Str(),
		acceptance: Str(),
		reason: Reason
	}),
	depends_on: Obj({ target: Id }),
	reaffirm_dependency: Obj({ target: Id, reason: Reason }),
	associate: Obj({ milestone_id: Id }),
	achieve: Obj({
		basis: Str(4000),
		sources: Opt(Sources),
		work_refs: Opt(Type.Array(Id, { maxItems: 50 }))
	}),
	edit_question: Obj({
		context: Opt(Str()),
		impact: Opt(Str(4000)),
		answerable_by: Opt(Type.Array(Id, { maxItems: 20 }))
	}),
	supersede_decision: Obj({
		successor_id: Id,
		successor_version: Type.Integer({ minimum: 1 }),
		reason: Reason
	}),
	answer: Obj({ answer: Str(), confidence, sources: Opt(Sources) }),
	hypothesis: Obj({ text: Str(), confidence, sources: Sources }),
	withdraw: Obj({ reason: Reason }),
	revise_decision: Obj({ ...decisionFields, reason: Reason }),
	decide: Obj({ option_id: Id, rationale: Str(4000), sources: Opt(Sources) }),
	defer: Obj({ reason: Str(2000), until: Str(64) }),
	retract: Obj({ reason: Reason, sources: Opt(Sources) }),
	supersede: Obj({ successor_id: Id, reason: Reason }),
	archive: Obj({}),
	restore: Obj({}),
	edit_area: Obj({ title: Str(240), description: Str() }),
	ask: Obj({
		requirement: Str(200),
		intended_command: Str(100),
		thread: Obj({ session_key: Str(256), agent_id: Id }),
		prompt: Str(2000)
	}),
	dismiss_ask: Obj({ ask_id: Id, reason: Reason }),
	remove_dependency: Obj({ target: Id, reason: Reason }),
	dissociate: Obj({ target: Id, reason: Reason }),
	place: Obj({ project_id: Type.Union([Id, Type.Null()]), area_id: Id, reason: Reason }),
	review_target: Obj({ artifact_id: Id }),
	authorize: Obj({ change_id: Id, plan_id: Opt(Id), conditions: Str(4000), sources: Sources }),
	revoke_authorization: Obj({ reason: Reason }),
	reaffirm_plan: Obj({ plan_id: Id, reason: Reason })
};
const commandRequest = Type.Union(
	Object.entries(commandInputs).map(([command, input]) =>
		Obj({
			command: Type.Literal(command),
			id: command === 'create' ? Opt(Id) : Id,
			expected_version:
				command === 'create' ? Opt(Type.Integer({ minimum: 1 })) : Type.Integer({ minimum: 1 }),
			idempotency_key: Id,
			input,
			ask_id: Opt(Id)
		})
	)
);
const stamp = { epoch: Str(64), revision: Type.Integer({ minimum: 0 }) };
const attention = Type.Array(Type.Object({ code: Str(100) }, { additionalProperties: true }), {
	maxItems: 10
});
const row = Type.Object(
	{
		id: Opt(Id),
		type: Opt(Str(30)),
		title: Opt(Str(240)),
		status: Opt(Str(30)),
		version: Opt(Type.Integer()),
		agent_id: Opt(Type.Union([Id, Type.Null()])),
		project_id: Opt(Type.Union([Id, Type.Null()])),
		attention: Opt(attention),
		attention_total: Opt(Type.Integer()),
		signals: Opt(Type.Array(Str(100), { maxItems: 20 })),
		follow_up_due: Opt(Type.Boolean()),
		actionability: Opt(Str(40)),
		progress: Opt(Obj({ achieved: Type.Integer(), total: Type.Integer() })),
		current_milestone: Opt(Type.Union([Id, Type.Null()]))
	},
	{ additionalProperties: false }
);
const listInput = Obj({
	type: Opt(
		Type.Union(
			['task', 'project', 'milestone', 'area', 'question', 'decision', 'finding'].map((value) =>
				Type.Literal(value)
			)
		)
	),
	agent_id: Opt(Id),
	search: Opt(Type.String({ maxLength: 500 })),
	limit: Opt(Type.Integer({ minimum: 1, maximum: 100 })),
	offset: Opt(Type.Integer({ minimum: 0 })),
	fields: Opt(Type.Array(Str(40), { minItems: 1, maxItems: 20 })),
	include_terminal: Opt(Type.Boolean())
});
export const workFeature = defineFeatureContract({
	pluginId: 'falcon-dash-preview',
	operations: {
		work_list: {
			kind: 'query',
			description: 'Read compact canonical Work with explicit fields and pagination.',
			input: listInput,
			output: Obj({
				...stamp,
				total: Type.Integer({ minimum: 0 }),
				items: Type.Array(row, { maxItems: 100 }),
				next_offset: Type.Union([Type.Integer(), Type.Null()])
			})
		},
		work_queue: {
			kind: 'query',
			description: 'Read bounded server-computed attention buckets without N+1 calls.',
			input: Obj({
				agent_id: Opt(Id),
				limit: Opt(Type.Integer({ minimum: 1, maximum: 25 })),
				offset: Opt(Type.Integer({ minimum: 0 }))
			}),
			output: Obj({
				...stamp,
				buckets: Type.Record(
					Str(64),
					Obj({
						total: Type.Integer({ minimum: 0 }),
						items: Type.Array(row, { maxItems: 25 }),
						next_offset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
					})
				)
			})
		},
		work_command: {
			kind: 'action',
			description:
				'Commit one exact versioned semantic operation. Runtime permissions remain OpenClaw-owned.',
			input: commandRequest,
			output: Type.Object(
				{
					...stamp,
					command: Str(100),
					target: Id,
					prior_version: Type.Union([Type.Integer(), Type.Null()]),
					version: Type.Integer({ minimum: 1 }),
					outcome: Type.Union(
						['committed', 'committed_with_warnings', 'noop'].map((value) => Type.Literal(value))
					),
					noop: Type.Boolean(),
					warnings: Type.Array(Type.Object({ code: Str(100) }, { additionalProperties: true }))
				},
				{ additionalProperties: false }
			)
		}
	},
	events: { falcon_work_changed: Obj(stamp) }
});
