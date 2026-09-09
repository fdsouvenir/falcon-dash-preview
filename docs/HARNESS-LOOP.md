# Agent Loop

This repo includes a local recursive work loop so agents can iterate against artifact files instead
of requiring pasted console logs.

## Goal

Each run should:

1. execute the narrowest useful checks
2. write logs to `artifacts/run-latest/`
3. archive the same run under `artifacts/history/<timestamp>/`
4. write a short summary and machine-readable status file

## Command

```bash
npm run agent:loop -- <mode>
```

## Modes

- `check` — harness, docs, skills, typecheck, lint
- `unit` — Vitest unit tests
- `console` — browser console sweep across offline-safe routes
- `smoke` — Playwright smoke suite if Playwright is installed
- `settings` — settings-only smoke check if Playwright is installed
- `app` — `check`, `unit`, `console`, then `smoke`

Default mode: `check`

## Artifacts

Every run writes:

- `artifacts/run-latest/status.json`
- `artifacts/run-latest/summary.md`
- per-step logs such as `check.txt`, `lint.txt`, `unit.txt`, or `smoke.txt`
- console findings under `artifacts/run-latest/console/`

The same files are copied into:

- `artifacts/history/<timestamp>/`

## Expected Usage

During implementation, the agent should:

1. make a change
2. run the smallest appropriate `agent:loop` mode
3. inspect `status.json` and the failed step logs
4. fix the issue
5. repeat

This keeps the feedback loop repo-local and inspectable.

## Browser Behavior

Browser steps are optional. If Playwright is unavailable in the current environment, the loop marks
those steps as `skipped` and records the reason instead of failing the whole run.
