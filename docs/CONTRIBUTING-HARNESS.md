# Harness Contribution Guide

This repo uses a lightweight harness-engineering model. The goal is to keep repo-local knowledge
accurate enough that agents and humans can rely on it during implementation.

## What the Checks Mean

- `npm run check:harness` verifies required harness files, local documentation links, and that every
  file under `docs/` is reachable from `docs/README.md`.
- `npm run check:docs` verifies that high-signal code changes touch every owning documentation
  group required by the path map.
- `npm run check:skills` verifies that repo-local skills remain structurally valid.

These checks are intentionally lightweight. They do not prove semantic perfection. They force an
explicit maintenance decision in the areas the repo relies on most.

## How To Satisfy a Docs-Freshness Failure

When `check:docs` fails:

1. read the reported rule
2. read the changed paths that triggered it
3. update at least one document from every reported owner group when behavior, architecture, UX, or
   validation expectations changed
4. if the code change is narrower than the rule, keep the code narrow or tune the rule in the same PR

Do not add meaningless doc churn just to satisfy the check. Make a real update or tighten the
policy.

## When "Docs Updated: Not Needed" Is Acceptable

That answer is acceptable when:

- the change is purely internal and does not alter stable behavior
- the affected path does not fall under a high-signal docs-freshness rule
- the existing docs remain accurate after the change

It is not acceptable when:

- shell behavior changed
- route behavior changed
- store semantics changed in a user-visible or agent-relevant way
- validation expectations changed
- gateway, Work, Vault, channel, agent-context, or canvas behavior changed materially

## How To Triage a Skill Failure

When `check:skills` fails:

- make sure every skill directory contains a valid `SKILL.md` frontmatter with `name` and `description`
- fix broken relative markdown links in `SKILL.md` or reference files
- add `agents/openai.yaml` if an `agents/` directory exists

Skills should stay narrow. Put durable repo truth in `docs/`, then point skills to it.

## Preferred Sequence for Cross-Cutting Changes

1. update code
2. update the matching docs
3. update the matching skill only if the workflow itself changed
4. add or update tests and manual rerun steps
