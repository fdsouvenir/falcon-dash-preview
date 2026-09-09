# Work

Work is Falcon Dash's shared record of what is being done, by people and agents together. It lives
inside the OpenClaw Control UI as one of the Falcon Dash pages — there is no separate application
and no separate address to visit.

Creation is agent-driven. Work has no generic "new item" form: agents create and update objects
through typed semantic commands, and the UI is where you read, steer and answer.

## The objects

Seven types, and no others:

| Type          | What it is                                                              |
| ------------- | ----------------------------------------------------------------------- |
| **Project**   | An outcome. Its completion is derived from its Work, never set by hand. |
| **Milestone** | A checkpoint inside a Project, with an explicit success condition.      |
| **Task**      | A unit of work with a title, description and `done_when`.               |
| **Question**  | Something that needs answering, with who can answer it.                 |
| **Decision**  | A choice between recorded options, with deciders and a recommendation.  |
| **Finding**   | Something learned, with a conclusion, confidence and sources.           |
| **Area**      | A long-lived area of responsibility that Projects and Tasks belong to.  |

Phase, Review, standalone Change Request and Blocker are **not** Work types. A review is an ordinary
Task pointing at the exact artifact revision it reviews. Change control is a boundary carried _on_ a
Task — scope, risk, rollback, acceptance — rather than an object with its own lifecycle. Blocked is
not a status anyone sets; see below.

## Task lifecycle

`open` → `ready` → `in_progress` → `completed`, with `waiting` alongside and `abandoned` as a
reversible exit.

- **Starting requires accountable assignment.** An agent either has the Task assigned or explicitly
  claims it. Nothing runs anonymously.
- **Waiting records what it waits on** — a typed reference to an agent, a session, another Work
  object or something external — plus a sentence explaining it and the condition to resume.
- **Abandoned is reversible.** Resume it and carry on; the abandonment stays in the history.
- **Completion needs a Result**, and that Result must pin the Task's current Definition. If the goal
  changed after the result was written, completion is refused rather than silently accepted.

## Blocked is derived, not declared

Nothing sets a Task to "blocked". Blocked is _computed_ from real causes: an unresolved dependency,
a pending Ask, an unanswered Question, or an active wait. When the cause clears, so does the block.

Dependencies **warn rather than veto**. Falcon Dash records that Task B depends on Task A and says
so loudly, but it does not pretend to control what an agent's tools can actually do. Real runtime
permission stays with OpenClaw's approvals.

## Definitions, Plans and Results

A Task's Definition — title, description, `done_when` — is stored as an immutable revision. Editing
it creates a new revision; the Task points at the current one.

Plans and Results are likewise immutable revisions owned by the Task, and each pins the exact
Definition revision it was written against. That is what makes staleness visible: if someone revises
the goal and leaves the plan behind, the mismatch is a fact in the record rather than something you
have to notice.

## Asks

When an agent needs something from a person or another agent before it can proceed, it raises an
**Ask** against the object. The Ask names what it needs and which command it intends to run. When
answered, the agent resubmits that exact command with the resolved Ask, and the Ask closes.

An open Ask makes its subject blocked, which is why nothing needs a separate "waiting on approval"
state.

## Reading Work in the UI

- **Work** — the queue: what needs a person, what is in motion, what is waiting.
- **Projects** — the portfolio, and each Project's milestones, current work and history.
- **Browse** — search and filters across every object type.
- **Needs attention** — objects with an open Ask, an unresolved dependency, or a stale artifact.
- **History** — the full event log for an object, paginated.

Every object detail shows its canonical record, its artifacts and its history. Long content is
truncated in lists and recoverable in full on the object itself. The view refreshes after Work
events while it is open; if the live stream drops, the page stays usable and a reload catches up.

Markdown in Work content is rendered but never trusted — embedded markup is contained rather than
executed.

## What Work does not do

- It does not schedule anything. OpenClaw owns automations; an automation that needs to produce Work
  creates an ordinary Task when it fires.
- It does not enforce runtime permissions. It records intent and authorization; OpenClaw's exec
  approvals are the actual gate.
- It has no tags. Areas and Projects are the classification.

## Related

- [Work backend contracts](../Technical/plugin-v4-backend.md)
- [Native Control UI](../Technical/plugin-v4-native-ui.md)
