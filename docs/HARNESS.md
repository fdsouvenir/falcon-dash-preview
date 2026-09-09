# Harness Guide

This document defines how Falcon Dash should be changed and verified. It is the repo-level
execution model for agents and maintainers.

## Principles

- Keep instructions shallow in `AGENTS.md` and deep in `docs/`.
- Prefer direct inspection of code, tests, screenshots, and logs over chat-only reasoning.
- Leave behind a rerunnable path for the next person.

## Default Execution Loop

1. Read the smallest docs that explain the surface and data flow.
2. Inspect the relevant route, component, store, or server module.
3. Identify the narrowest reliable validation layer.
4. Implement the change.
5. Run the narrowest checks that prove behavior.
6. Record any manual verification steps when automation is incomplete.

## Where Knowledge Lives

- `AGENTS.md` — top-level router
- `docs/PURPOSE.md` — why the product exists
- `docs/ROADMAP.md` — approved future versions, clearly separated from current behavior
- `docs/CONTRIBUTING-HARNESS.md` — how to satisfy harness checks and policies
- `docs/HARNESS-LOOP.md` — local recursive work loop and artifact storage
- `docs/Technical/plugin-v4*.md` — plugin runtime, backend contracts, native UI and installation
- `docs/Technical/deployment.md` — build, runtime and release
- `docs/QUALITY.md` — validation policy
- `docs/RELIABILITY.md` — realtime and failure-mode expectations
- `docs/PLANS.md` — plan-writing guidance
- `docs/OWNERSHIP.md` — mapping from code areas to primary docs

## Validation Ladder

Use the cheapest trustworthy proof:

1. Static check: `npm run check`, `npm run lint`
2. Unit test: store logic, parsing, mapping, utility functions
3. Component or route verification through existing app behavior
4. Playwright: routing, shell integration, approval flows, gateway-sensitive UI
5. Manual gateway verification when a live environment is required

Do not jump to a higher-cost layer if a lower-cost layer can prove the change.

## UI Verification

For operator-facing surfaces:

- verify desktop and narrow-viewport shells when the route exists in both
- verify loading, empty, error, and connected states when relevant
- verify overflow for long content, logs, markdown, and tables
- verify that shared shell elements do not cover or break the page

Prefer screenshot-backed or Playwright-backed checks over prose claims.

## Skills Policy

Use a skill when:

- the task has a reusable procedure
- the procedure benefits from progressive disclosure
- the repo has special operating constraints worth loading on demand

Do not use a skill as a dumping ground for all repo knowledge. Put durable truth in docs first,
then point the skill to those docs.

## Docs Freshness Policy

High-signal code areas should touch matching docs in the same change:

- route and component changes should usually touch frontend, quality, technical component, or end-user docs
- store and realtime wiring changes should usually touch reliability or technical store docs
- Work flow changes should touch the current Work technical and/or end-user docs named by the
  ownership rule
- gateway, Vault, channel, agent, and canvas changes should touch the matching technical or
  end-user docs

This is enforced by CI as a path-based ownership check. Each rule can require more than one owner
group; touching an unrelated end-user guide no longer satisfies a technical change. The harness also
fails broken or orphaned files under `docs/`.

## Manual Verification Format

When automation is not practical, record:

1. route or file under test
2. prerequisite setup
3. exact action
4. expected visible result

That format should appear in PR notes, issue notes, or the relevant spec.

## Plugin runtime

The single-plugin runtime and its explicit validation/release gaps are documented in
[Technical/plugin-v4.md](Technical/plugin-v4.md). `npm run build`, `npm run check` and
`npm run test` all target the plugin; nothing else in this repo is a runtime.
