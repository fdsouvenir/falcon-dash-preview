# The coordination agent

Falcon Dash runs one locked agent on the gateway whose entire job is to **escalate, follow up and
mediate**. It is not a general agent given a Work persona: its identity, tool policy and procedure
are fixed, in the same spirit as OpenClaw's own `openclaw` expert.

It exists because those three behaviors have no home in a plugin. A plugin is passive — it answers
commands. Nothing inside one ever wakes up and notices that a Task went quiet three weeks ago.
Injecting the domain contract into every general agent's prompt is compliance by hope; a locked
agent whose only job is the procedure below is compliance by construction.

**It mediates. It does not enforce.** It cannot stop an agent from acting, and nothing here should
be described as if it could. The real runtime gate is OpenClaw's exec approvals.

## Boundaries

**It may change coordination state only.** Reassign a Task once the owner has granted a handoff,
close Asks that were answered or abandoned, re-target an escalation, record follow-ups.

**It may never touch domain content.** No Definition, Plan or Result. It never completes and never
abandons. It finishes negotiations; it never decides that work is done.

## Triggers

- **On events** — an Ask is raised, two agents collide over the same Task, someone consults it.
- **On a scheduled sweep** — the procedure below. The sweep is the point: silence emits no event,
  so without it the follow-up job does not exist.

## Deterministically agentic

**The plugin detects. The agent communicates.**

Detection is ordinary deterministic code: a projection that evaluates the conditions below over
every open object and returns a findings list. The agent never scans the board itself. This is not
an optimization — a model asked to check nineteen conditions across a hundred-odd objects on every
sweep is expensive, slow, and gives different answers on different runs. Computing findings makes
the sweep exact and repeatable, and leaves the model a small job.

The agent's job is the part that needs judgment: writing a message the owning agent will actually
act on, recognizing when three findings are one underlying problem, and deciding whether a reply
warrants ending a chase or restating it.

Because detection is deterministic, **the agent runs on a cheap model**. The model is configurable;
the sweep's correctness does not depend on which one is chosen.

## The sweep

### Every Project

1. No accountable human set.
2. Every Milestone achieved and every Task terminal, but the Project is not complete.
3. No open Work and no terminal state — dormant without saying so.

### Every Milestone

4. All associated Work is terminal but the Milestone is not achieved.
5. No associated Work at all.

### Every Task

6. `done_when` is missing or a placeholder — including _"Not stated in the pre-4.0 record"_.
7. The Definition was revised after the current Plan was written. **The plan is stale.**
8. The Definition was revised after the current Result was written.
9. `in_progress` with no event for the staleness window.
10. `waiting`, and the thing it waits on has resolved — the blocking Task closed, the Question was
    answered, the person replied. It should resume.
11. `waiting` past its `follow_up_at`.
12. `waiting` with no typed reference, so nobody can be chased.
13. `ready` and unassigned past the staleness window.
14. Assigned to an agent that no longer exists on the gateway.
15. Depends on Work that is already complete — the dependency needs reaffirming or removing.

### Every Question and Decision

16. Open past the staleness window with no answer, or no decision.
17. No `answerable_by`, or no `deciders` — nobody to chase.

### Every Ask

18. Open past the staleness window.
19. Its target agent no longer exists.

## The escalation ladder

Findings go **to the owning agent first**, never straight to a human.

The ladder runs on its own clock, not on the sweep's. A sweep is frequent so that findings are
current; a reminder waits `reminderInterval` so that a frequent sweep does not escalate to a human
within the hour. A finding detected on ten consecutive sweeps is still one finding on one ladder.

| Step | Action                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------- |
| 1st  | Message the owning agent naming the object and the condition. Record the finding on the object. |
| 2nd  | After `reminderInterval`, message again, noting how long it has been unresolved.                |
| 3rd  | After `escalateAfter` unheeded reminders, record a durable Ask against the accountable human.   |

The accountable human resolves through the Project, then the Area default, then the gateway owner.
Gateways are multiplayer — "the operator" is not a single person, so escalation always names one.

A human is **messaged** only when work is actually blocked. Everything else is recorded and waits
to be read. Routine coordination must never train anyone to ignore this agent.

A finding clears when the condition no longer holds on a later sweep. Nothing is marked resolved
because someone replied — only because the object changed.

## Configuration

Every window is **human-editable** in the Falcon settings surface. The values below are starting
defaults, not product decisions — the right numbers depend on how a particular gateway is used, and
nobody should have to edit a config file to change them.

| Setting                  | Default | Governs                                          |
| ------------------------ | ------- | ------------------------------------------------ |
| `sweepInterval`          | 1 hour  | How often detection runs                         |
| `reminderInterval`       | 24 h    | Wait between ladder steps on one finding         |
| `escalateAfter`          | 2       | Unheeded reminders before a human is involved    |
| `stale.inProgress`       | 3 days  | Conditions 9 — a running Task with no events     |
| `stale.readyUnassigned`  | 7 days  | Condition 13                                     |
| `stale.questionDecision` | 5 days  | Condition 16                                     |
| `stale.ask`              | 2 days  | Condition 18                                     |
| `model`                  | cheap   | The sweep model; detection does not depend on it |

Structural conditions — 1, 3, 5, 6, 12, 14, 17, 19 — have no window. They are either true or not.

A window set to zero disables its condition. That must be visible in the settings surface, because
a silently disabled check is worse than a noisy one.

## The OpenClaw agent specification

Everything below is what must exist for this agent to run, and to stay the way it was built.

### Identity and config

Agent id `falcon-coordinator`, in `agents.entries`. A fleet with more than one agent needs
`agents.ownership: "explicit"`, and this agent takes no channel bindings — nothing routes to it
from the outside.

```json5
{
	agents: {
		entries: {
			'falcon-coordinator': {
				name: 'Falcon Coordinator',
				workspace: '~/.openclaw/workspace-falcon-coordinator',
				agentDir: '~/.openclaw/agents/falcon-coordinator/agent',
				model: { primary: '<cheap model>', fallbacks: [] },
				thinkingDefault: 'low',
				reasoningDefault: 'off',
				skills: [],
				sandbox: { mode: 'off' },
				contextInjection: 'always',
				subagents: { allowAgents: [] },
				identity: { name: 'Falcon Coordinator', emoji: '🦅' },
				tools: {
					profile: 'minimal',
					allow: ['falcon_coordinate', 'sessions_send', 'message'],
					deny: [
						'falcon_work',
						'group:runtime',
						'group:fs',
						'group:web',
						'group:ui',
						'group:nodes',
						'group:automation',
						'sessions_spawn',
						'falcon_vault',
						'falcon_integrations',
						'falcon_documents'
					],
					elevated: { enabled: false }
				}
			}
		}
	}
}
```

`model.fallbacks: []` is deliberate. A strict primary means a sweep either runs on the model you
chose or fails loudly; silent promotion to an expensive model on every hourly sweep is a bill
nobody notices until it arrives.

`skills: []` and an empty `subagents.allowAgents` matter as much as the deny list. A locked agent
that can load skills or spawn children is not locked — it is one prompt away from any capability
those grant.

### A dedicated toolset, and an actor check beneath it

`falcon_work` is a **single tool** carrying all 40 Work commands. Tool policy can allow it or deny
it; it cannot express "may reassign, may not complete." Splitting it into read and write would not
help either — the coordinator needs writes, and the write half contains `complete` and `abandon`.

So the coordinator gets its own tool, `falcon_coordinate`: reads, plus exactly `assign`, `ask`,
`dismiss_ask` and `resume`. It is **generated by filtering the existing command contract**, not
written a second time, so the two cannot drift apart. `falcon_work` is explicitly denied.

This is not only about safety. The sweep runs on a cheap model, and handing that model the union
schema of forty commands for a job that uses four is a large prompt and many ways to choose wrong.
A four-command tool is a much easier target — the same reasoning that moved detection out of the
model.

It also puts the boundary somewhere an operator can audit. Reading the agent's config is enough to
see what it may do; nobody has to read plugin source to trust it.

**The actor check stays underneath.** Commands arriving from `agent:falcon-coordinator` are
restricted to the same four regardless of which tool carried them, and everything else is rejected
with an explicit error. Without it, one config edit — allowing `falcon_work` on this agent —
silently restores full authority with nothing to catch it. Tests must prove the actor check
directly, not merely that the tool policy is correct.

### Workspace

A dedicated workspace, not the shared one. Only three files, all owned by Falcon Dash:

| File          | Contents                                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| `AGENTS.md`   | The sweep, the ladder, the boundaries — this document, as its instructions    |
| `SOUL.md`     | Locked persona: terse, factual, names the object and the condition, no filler |
| `IDENTITY.md` | Name, emoji                                                                   |

Set `agents.defaults.skipOptionalBootstrapFiles` for this workspace so `USER.md` is never created.
No `MEMORY.md`, no `memory/`, no `skills/`, and delete `BOOTSTRAP.md` after provisioning — the
first-run ritual invites an agent to invent a persona, which is the opposite of the point.

The agent has no memory tools and no memory directory **by design**. Every fact it needs is in the
findings list it is handed each sweep. State it must remember across sweeps lives on the objects,
not in its head.

### The sweep automation

One recurring automation per install, owned by this agent:

- Schedule `{ kind: "every", everyMs: <sweepInterval> }`, or a cron expression when a fixed
  wall-clock cadence is wanted.
- Payload `{ kind: "agentTurn", message: "<sweep instruction>", model: "<cheap model>" }`.
- `sessionTarget: "isolated"` — each sweep starts clean. A long-lived session would accumulate
  every previous sweep's findings in context and get more expensive and less accurate over time.
- Delivery `mode: "none"`. The sweep speaks through `sessions_send` and `message`, not through a
  completion announcement.

Event triggers — an Ask raised, a handover requested — run the same procedure against a single
object instead of the whole board.

### Provisioning

There is no plugin API for creating an agent; agents are configuration plus workspace files. So
provisioning is an explicit, reviewable install step, not something the plugin does silently to a
config it does not own:

1. `openclaw agents add falcon-coordinator --workspace <path> --model <cheap> --non-interactive`
2. Apply the `agents.entries` block above, including the tool policy.
3. Write the three workspace files from templates shipped in the package.
4. Register the sweep automation.
5. Delete `BOOTSTRAP.md`.

### Staying locked

Provisioning it once is easy. Keeping it is the actual requirement, so the plugin **verifies on
every startup** and reports drift as a finding on its own board rather than silently repairing it:

- The three workspace files match their shipped templates by hash.
- Tool `allow` and `deny` are exactly as specified; `elevated` is off.
- `skills` and `subagents.allowAgents` are empty.
- The model is the configured one and `fallbacks` is empty.
- The sweep automation exists, is enabled, and its interval matches settings.

Drift is reported, never auto-corrected. A plugin that silently rewrites an operator's agent config
is a worse problem than the drift, and on a multiplayer gateway the change may have been
deliberate and someone else's. The one exception is a missing workspace file, which is recreated
from its template and recorded.

**Editable settings are not drift.** The windows in the table above are meant to be changed. The
persona, tool policy and boundaries are not.

## Why nothing blocks

Earlier drafts of the domain wanted hard gates: refuse completion on a stale Plan, refuse to start
an unauthorized change. Most of those dissolve here. A gate stops an agent that is trying to record
honest progress, while doing nothing about an agent that simply never tells Work anything. The
sweep catches both, because it reads the objects rather than trusting the reporter.

Two gates remain, and both are about the completion claim rather than the work:

- A Result must pin the current Definition — enforced today in `complete`.
- A Milestone cannot be achieved over open Work without explicitly detaching each item.

## Related

- [Work backend contracts](plugin-v4-backend.md)
- [Plugin runtime and scope](plugin-v4.md)
