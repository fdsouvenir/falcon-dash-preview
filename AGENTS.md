# Falcon Dash Agent Guide

Use this file as a router. Keep repo truths in `docs/` and verification in tests and scripts.

`AGENTS.md` is the canonical agent guide. `CLAUDE.md` must remain a symlink to this file so every
agent receives the same instructions.

## Start Here

- Falcon Dash 4.0 is **one installable OpenClaw plugin** with internal Work, Integrations,
  KeePassXC Vault and Documents modules. There is no standalone web application, no second runtime,
  and no CLI.
- 4.0 carries **no awareness of any prior version**: no migration, conversion, legacy detection or
  compatibility code. Pre-4.0 data is handled out of band before installation.
- Read [docs/Technical/plugin-v4-backend.md](docs/Technical/plugin-v4-backend.md) for the backend
  contracts. Current issue bodies #326/#347/#363/#364/#365 govern scope.
- Read [docs/PURPOSE.md](docs/PURPOSE.md) for product intent and audience. It is owner-protected and
  still contains superseded standalone direction; issue bodies win.
- Read [docs/ROADMAP.md](docs/ROADMAP.md) when a change affects release scope.
- Read [docs/HARNESS.md](docs/HARNESS.md) for the repo-level execution and validation model.
- Read the smallest technical doc that matches the task.

## Product and Sources of Truth

- OpenClaw changes rapidly. For upstream behavior, consult the current official documentation at
  `docs.openclaw.ai`, its `llms-full.txt`, and the public `github.com/openclaw/openclaw` repository.
- The Work domain contract is issue #363's **body**. Its comments are chronological history
  including reversals; do not quote them as current.
- Repository docs, code, and tests should agree. When they do not, investigate the discrepancy and
  reconcile them in the same change instead of silently treating either one as correct.

## Task Routing

### Product and UX intent

- [docs/PURPOSE.md](docs/PURPOSE.md) — product purpose, audience, and design philosophy
- [docs/ROADMAP.md](docs/ROADMAP.md) — release scope and what OpenClaw now owns instead
- [docs/End User/](docs/End%20User) — user-facing behavior by feature

### Architecture and implementation

- [docs/Technical/plugin-v4.md](docs/Technical/plugin-v4.md) — plugin runtime, scope and open gaps
- [docs/Technical/plugin-v4-backend.md](docs/Technical/plugin-v4-backend.md) — Work, Vault,
  Integrations and Documents backend contracts
- [docs/Technical/plugin-v4-native-ui.md](docs/Technical/plugin-v4-native-ui.md) — native Control UI
- [docs/Technical/plugin-v4-scope.md](docs/Technical/plugin-v4-scope.md) — acceptance map by issue
- [docs/Technical/plugin-v4-installation.md](docs/Technical/plugin-v4-installation.md) — installed
  artifacts and private Vault recovery
- [docs/Technical/plugin-native-e2e.md](docs/Technical/plugin-native-e2e.md) — real-Gateway browser
  acceptance
- [docs/Technical/deployment.md](docs/Technical/deployment.md) — build, runtime, and release
- [docs/secretrefs.md](docs/secretrefs.md) — KeePassXC vault as a SecretRef provider

### Repo operating rules

- [docs/CONTRIBUTING-HARNESS.md](docs/CONTRIBUTING-HARNESS.md) — how to satisfy harness and doc checks
- [docs/HARNESS-LOOP.md](docs/HARNESS-LOOP.md) — recursive local work loop and artifacts
- [docs/QUALITY.md](docs/QUALITY.md) — required validation levels and rerun paths
- [docs/RELEASE.md](docs/RELEASE.md) — preview and production release paths; production is generated
  from a preview tag, never hand-edited
- [docs/RELIABILITY.md](docs/RELIABILITY.md) — state, realtime, and failure-mode expectations
- [docs/PLANS.md](docs/PLANS.md) — how to write and maintain execution plans in this repo
- [docs/OWNERSHIP.md](docs/OWNERSHIP.md) — which docs should usually move with which code areas
- [docs/LEARNINGS.md](docs/LEARNINGS.md) — durable lessons that span the product roadmap

## Project Structure

- `plugin/index.mjs` — the single OpenClaw plugin entry
- `plugin/work/` — Work domain store, projections, contracts and agent context
- `plugin/integrations/` — provider adapters, OAuth and connection lifecycle
- `plugin/vault/` — KeePassXC worker, service, SecretRef resolution and recovery
- `plugin/documents/` — workspace file browser and durable trash
- `plugin/native/` — native Control UI, its stylesheet and fonts
- `plugin/tests/` — Node test-runner suites for all of the above
- `bin/keepassxc-secret-resolver.cjs` — exec SecretRef provider; an installed OpenClaw config may
  point at this path, so do not move or delete it without updating that config
- `e2e-native/` — Playwright acceptance against a real isolated Gateway
- `scripts/` — build, validation and isolated-proof harnesses
- `docs/` — system-of-record docs

## Commands

Use Node 24.16+ (or 26.1+), matching OpenClaw 2026.9.3. `npm run build` runs automatically before `check`, `test` and the e2e harnesses.

- `npm install` — install dependencies
- `npm run build` — bundle the schema dependency, validate plugin JavaScript, build the native UI
- `npm run check` — check plugin JavaScript against the pinned SDK types
- `npm run lint` — run ESLint
- `npm run format` / `npm run format:check` — apply or verify Prettier
- `npm run test` — run plugin and security tests
- `npm run test:coverage` — run plugin tests with Node coverage
- `npm run test:e2e` — real-Gateway native browser acceptance
- `npm run test:managed-runtime` — isolated managed-install and SecretRef proof
- `npm run check:harness` — verify the harness doc map
- `npm run check:docs` — verify high-signal code changes touched matching docs
- `npm run agent:loop -- <mode>` — run recursive local checks and write artifacts

Local development needs the OpenClaw SDK resolvable as `node_modules/openclaw`. It is an optional
peer dependency, so install or link the pinned version explicitly; CI does this in `ci.yml`.

## Coding Rules

- Plugin code is JavaScript ESM (`.mjs`) checked with `tsc --checkJs` against the pinned SDK types.
- Use tabs, single quotes, no trailing commas, and `printWidth` 100.
- Use `camelCase` for functions and stores.
- Prefer `rg` for file and text search.

## Testing Rules

- Prefer Node test-runner unit tests for the store, services, projections and contracts.
- Use Playwright for native UI, gateway, and cross-surface flows.
- When full automation is not practical, leave explicit manual rerun steps.
- Do not say "tested manually" without route, setup, action, and expected result.

## Change Discipline

- Keep `AGENTS.md` short. Put durable repo knowledge in `docs/`.
- When planning work, find the relevant GitHub issue and keep its scope, status, discoveries, and
  acceptance criteria current. Create an issue when the work needs tracking and no suitable issue
  exists. Follow `SECURITY.md` instead of opening public issues for vulnerabilities.
- Use [docs/OWNERSHIP.md](docs/OWNERSHIP.md) before completing a behavior change and update every
  owning current document in the same change.
- Document durable behavior, architecture, decisions, verification paths, and operational gotchas.
  Add a lesson to `docs/LEARNINGS.md` only when it is expected to remain useful across the full
  product roadmap; use code, tests, current technical docs, issues, or Git history for narrower facts.
- Commit early and often. Prefer small, coherent commits and never include unrelated user changes.
- Do not commit secrets or machine-specific config.
- Do not assume a gateway is running or use a hardcoded gateway port. Inspect the current same-host
  environment and follow the gateway and deployment docs for configuration and authentication.
