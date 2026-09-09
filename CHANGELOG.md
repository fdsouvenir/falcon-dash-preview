# Changelog

All notable changes to Falcon Dash will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.4.1] - 2026-09-09

First release of the preview channel, seeded from production `v4.4.0`. Everything below is a fix
that seeding exposed: the tree assumed it was the only channel, and hardcoded the production
identity in places that had never had a reason to vary.

### Fixed

- **The build refused to run.** `scripts/build-plugin.mjs` asserted `manifest.id === 'falcon-dash'`.
  It now accepts either channel, but still requires the manifest id and package name to agree on
  the same one.
- **The release gate rejected the package outright.** `verify-release-metadata.mjs` hardcoded the
  production package name and plugin id. It now validates the pair against a channel table, so a
  preview build cannot claim the production runtime id and a production build cannot be published
  under the preview package. It also checks the lockfile name, which records the package twice and
  was left pointing at production.
- **The Work feature contract kept the production plugin id.** `plugin/work/feature-contract.mjs`
  declares its own `pluginId`, and the feature-events service id derives from it, so a preview build
  registered `falcon-dash:feature-events` while calling itself `falcon-dash-preview`. That both
  mismatches its own id and collides with production on a shared gateway. The OpenClaw SDK enforces
  the match — "Feature contract must belong to the active browser plugin" — so this failed loudly
  rather than silently.
- **Harness scripts targeted the wrong plugin.** `verify-managed-install`, `verify-managed-secretref`,
  `native-gateway-harness` and `verify-plugin-prompt` all configured isolated gateways against a
  literal `falcon-dash`. They now read the id from the manifest through `scripts/plugin-identity.mjs`.
- **Tests stood in for the host with a hardcoded id**, including the event channel name
  `plugin.falcon-dash.falcon_work_changed`, which is namespaced by plugin id. All derived now.

### Changed

- `scripts/apply-channel-identity.mjs` also rewrites `package-lock.json` and the Work feature
  contract. Its round-trip test is channel-agnostic, since both repositories run the suite.

### Validation

151 unit tests, all passing, plus typecheck, lint, format, doc-freshness and harness gates.

## [4.4.0] - 2026-09-09

Preparation for publishing on ClawHub. No runtime behaviour changed; what changed is the licence,
what the package contains, and what it says about itself.

### Changed

- **Licence is now CC BY-NC 4.0**, replacing CC-BY-NC-ND-4.0. NoDerivatives forbade redistributing
  a modified version, which rules out forks and community patches — not the intent for a plugin
  published to a public registry. Attribution and the non-commercial bar are unchanged; adapted
  material is now permitted. The file is the canonical Creative Commons text rather than the
  previous one with its ND clauses edited out.
- **The README is written for the person installing the plugin**, not the person building it. It
  previously cited a commit SHA, the CI runner, "current PR comments" and a warning that passing
  tests was "not full v4 readiness". It now covers what the four pages do, how to install, what is
  required, how credentials are handled, and what this release does not do.
- **Nothing shipped calls itself an implementation preview.** That string appeared in four files,
  two of them user-visible: the description shown by `openclaw plugins list`, and a caveat printed
  in the fallback UI header on every page. A preview build is now identified by which package was
  installed — `@fdsouvenir/falcon-dash-preview` is a separate package from its own repository.
- **The vault access model is described accurately.** `vaultOwners` reads like an allowlist, but
  `owns()` returns true for any `human:` actor and `policy.owners` is recorded for the audit trail
  only. Reaching an authenticated Gateway connection is the credential, and any operator who can
  sign in to the Control UI can reveal every entry. The README and the setting's own description
  now say so.

### Added

- **Catalog metadata for ClawHub.** The manifest declares `categories: ["agent-orchestration"]` and
  an `icon`, so the listing is classified deliberately rather than by a model defaulting to
  `other`, and shows the Falcon Dash mark. The icon is the existing logo recovered from the pre-4.0
  application, resampled to 256px: 457 KB to 57 KB.
- **Every `configSchema` field carries a description.** ClawHub renders the schema as the listing's
  Configuration tab, so six of the eight would have been blank rows on a public page.
- **A defined release workflow** in `docs/RELEASE.md`, covering the preview and production channels,
  the shared version line, and the identity delta between them. `scripts/apply-channel-identity.mjs`
  performs the rewrite so production is generated from a preview tag rather than hand-maintained.

### Fixed

- **The published archive no longer carries internal material.** Seven engineering documents naming
  internal issues and historical checkpoints shipped to every installer, as did the entire test
  suite — 22 files and 145 KB, because `files` lists `plugin/` wholesale. The archive went from 69
  files to 47, and `plugin/tests/release.test.mjs` asserts both exclusions.
- The OpenClaw agent workspace — `SOUL.md`, `USER.md`, `memory/` and pasted screenshots — is
  gitignored. It had never been committed, but a `git add -A` would have put it in a public
  repository.

### Validation

- 150 unit tests, up from 146, including round-trip, idempotency and drift coverage for the channel
  identity rewrite. That idempotency test caught a real defect: the production strings are prefixes
  of the preview ones, so applying the preview rewrite twice produced an install command reading
  `clawhub:@fdsouvenir/falcon-dash-preview-preview`.

## [4.3.0] - 2026-09-09

### Added

- **Search the whole Vault from one box.** The page now loads every group and entry in a single
  protected call, `inventory_all`, so a search matches entries filed anywhere without walking the
  tree group by group. Matching a group's name finds everything under it. The action returns
  handles and kinds only, never a field value, and reuses the recursive listing the worker already
  reads to validate handles, so it costs no extra `keepassxc-cli` invocation.

### Changed

- **The Vault page is laid out as a password manager rather than a stack of cards.** A group rail
  with entry counts, a dense entry list, and an inspector for the selected entry replace one card
  per entry with four peer buttons. Past a couple of dozen entries the old page could only be
  scrolled; retrieval is now the page's primary job.
- **Reveal is one toggle instead of a Reveal button beside a standing Hide.** Whichever of the old
  pair was not the useful control did nothing when pressed.
- **Inspector fields share a single label / value / actions baseline.** Field rows previously
  rendered with the label and its controls on different baselines. A field the record does not
  carry now reads "not set" and offers no control, rather than a button that could only fail.
- **Removing an entry asks for its name** and keeps the control disabled until it matches exactly.
  Destructive actions no longer look identical to Copy: the palette gains `--danger`, `--ok` and
  `--warn` roles, having previously had no role for risk at all.
- Adding an entry is a single form over the four fields KeePassXC actually has, with a group
  picker. There is no create-time choice of record shape: the plain/envelope distinction is
  internal to storage and never surfaced.
- Controls keep a 44px minimum touch target, compacting to 32px only under `@media (pointer: fine)`.
- The entry list deliberately shows only title and group. KeePassXC records no modification
  timestamp for an entry, and reading any single field costs one `keepassxc-cli` subprocess per
  entry — roughly 3.4s across 75 entries — so neither a "Modified" nor a "Username" column is
  buildable at list scale. The username is shown in the inspector, which loads on selection.

### Fixed

- **The search field was constructed and wired but never added to the command bar**, so the control
  the flat listing exists to serve was absent from the rendered page. Adding coverage for
  cross-group search caught it.
- **An emptied group looked occupied.** `keepassxc-cli ls` prints a placeholder for a childless
  group, and the recursive listing prints it under its own group as `<group>/[empty]` rather than
  as a bare `[empty]`. The flat listing reported it as an entry, so the group's removal control
  never appeared and the list offered a row whose `metadata` call could only fail.
- **Agent credentials rendered with nothing readable.** The inspector hard-coded the four KeePassXC
  fields, so a credential carrying its own field names showed none of them. The four still always
  appear, and any other field the record holds is listed after them.
- **The Vault overflowed a 320px shell.** Its narrow-viewport rules were declared before the base
  rules they override, and a media query adds no specificity, so the desktop three-pane grid kept
  its track sizes. They are now declared after those rules.

### Validation

- 146 unit tests, up from 143, and 30 real-Gateway Playwright cases across desktop and narrow
  shells. New coverage for the flat listing agreeing with a group-by-group walk, for the emptied
  group placeholder, for cross-group search including group-path matches and the no-match state,
  and for only the fields a record carries offering a reveal control.
- Three of the defects above were invisible to the type checker, the linter and the DOM unit
  tests, and were caught only by the browser acceptance run.
- Secret handling is unchanged: the 15-second reveal hold, clearing on disconnect, authority loss
  and navigation all still hold. The in-flight retirement tests now exercise navigating away,
  because a read in flight holds the page busy and blocks a second control press.

## [4.2.0] - 2026-09-09

### Fixed

- **The Vault stopped managing the operator's own KeePassXC database.** Every release through 3.1.1
  opened `~/.openclaw/passwords.kdbx` with `~/.openclaw/vault.key`; the 4.0 plugin rewrite pointed
  the Vault at a new private database instead, so an operator with an existing vault saw an empty
  page and none of their passwords. `plugin-v4-scope.md` and `plugin-v4-backend.md` both specify
  that "the existing KeePassXC database is opened as-is" — the rewrite implemented the opposite,
  and `plugin-v4-installation.md` and `secretrefs.md` had been written to match the implementation
  rather than the scope. Those documents are now reconciled.
- The Vault opens `<stateDir>/passwords.kdbx` with `<stateDir>/vault.key` by default, overridable
  with the new `vaultDatabase` and `vaultKeyFile` settings. A database already at that path is
  **adopted** — policy is recorded beside it and not one credential is rewritten — and one is
  created only when genuinely absent.
- **Entries whose names contain spaces were invisible.** Inventory filtered names through
  `[a-zA-Z0-9_-]`, so an ordinary vault of 88 entries listed 9. Handles now accept the text
  KeePassXC actually stores, still rejecting path separators, control characters and traversal.
- **A person's entries could not be read at all.** The Vault assumed every entry's Password field
  held its own JSON envelope and threw on anything else. Plain entries are now read and written as
  ordinary KeePassXC entries with their UserName/URL/Notes fields, which is exactly what
  `bin/keepassxc-secret-resolver.cjs` reads. The two shapes coexist and are never converted into
  each other: converting an operator's entries would break every SecretRef that resolves them.
- Agent credentials keep their versioned envelope, executor grants and revocation unchanged.
- **Relocating an entry rewrote it as a JSON envelope**, which would have silently stopped every
  SecretRef that resolved it. A moved entry now keeps its own shape.
- **Recovery snapshots read the database from the private directory**, so rename and remove failed
  outright once the database lived anywhere else. Snapshots now read the configured database and key
  and still store them under their canonical names, so a restored destination stays self-contained.
- **An emptied group looked occupied.** `keepassxc-cli ls` prints an `[empty]` placeholder for a
  childless group; the old restrictive name filter hid it by accident, so relaxing that filter
  exposed it as an entry and the group's removal control never appeared.

### Changed

- **The Vault page is a password manager again.** Entries list under their real titles with
  Reveal/Hide/Copy on the entry itself; **Details** loads the Username, URL and Notes an entry
  carries, plus Edit. Adding an entry asks for Title, Password, Username, URL and Notes instead of
  a credential field name to type. Executor grants appear only for agent credentials, which are the
  only entries that have them.
- Vault tests now start from a pre-existing database holding plain entries with spaces in their
  names. Every previous Vault test built a fresh empty database, which is why this regression
  reached a release.

## [4.1.0] - 2026-09-09

### Changed

- **OpenClaw 2026.9.3 is now the minimum host, and Node moves to `>=24.16.0 <25 || >=26.1.0`.**
  `openclaw.compat.pluginApi` was the exact value `2026.9.2`, but the host evaluates that field as a
  semver range, so a 2026.9.3 gateway refused to install this plugin with `INCOMPATIBLE_PLUGIN_API`
  even though the code typechecked and passed its suites against that SDK. It is now the floor
  `>=2026.9.3`. Upgrade Node before OpenClaw: upstream warns of SQLite text truncation in the other
  order, and Work, Vault audit and Integrations state are all `node:sqlite`.
- A scheduled `SDK compatibility` workflow now typechecks against the newest published SDK and runs
  `scripts/check-sdk-compat.mjs`, which fails on an exact pin where a floor belongs, on a declared
  floor that excludes the resolved SDK, and on a Node range that disagrees with it. It is a monitor
  rather than a merge gate, so an upstream release cannot block unrelated pull requests.

### Fixed

- **The Vault asked operators to perform its setup, then denied them anyway.** A new installation
  showed `Unlock` against a `policy.json` that did not exist yet, so it failed with
  `vault_unavailable` — an error that reads as broken storage. Provisioning and unlocking are host
  lifecycle, not operator ceremony: the plugin now runs `Vault.ready()` at startup, which creates
  the encrypted database when absent, reconciles configured owners and executors into the stored
  policy, and unlocks. `initialize`, `unlock` and `lock` are gone from the protected RPC and the
  Control UI, which opens straight into credential management.
- **A fresh install left the Vault page unusable even for the operator who installed it.** Human
  access was gated on `vaultOwners`, which is empty by default and was written into `policy.json`
  once, at provisioning, so configuring it afterwards had no effect without a recovery. Reaching an
  authenticated Gateway connection is now the human credential; `vaultOwners` is recorded for the
  audit trail rather than consulted as a gate. Agents are unchanged — they hold no session, so they
  still need `vaultExecutors` plus a per-entry grant, and that list is reconciled on every start.
- A Vault that cannot start now reports through service health and leaves Work, Integrations and
  Documents running, instead of taking the plugin down with it.

## [4.0.1] - 2026-09-08

### Fixed

- **Agent tools reached a dead service copy.** The host registers the plugin more than once per
  process, and a tool-discovery registration never starts a service, so every `falcon_work`,
  `falcon_vault`, `falcon_integrations` and `falcon_documents` call failed with
  `unavailable` while the Control UI worked from the activated registration in the same process.
  The started modules are now published on a process-global resolved at invocation, so all
  registrations serve the one live instance. A stopped service still fails closed.
  ([#370](https://github.com/fdsouvenir/falcon-dash/issues/370))

## [4.0.0] - 2026-09-07

Falcon Dash is now **one installable OpenClaw plugin**. There is no standalone web application, no
second runtime, and no CLI.

### Changed

- **Everything ships inside OpenClaw.** Work, Integrations, KeePassXC Vault and Documents are
  internal modules of a single plugin rendering in the Control UI through native feature-plugin
  pages, not a separate site on its own port.
- **The Work domain is reconciled to [#363](https://github.com/fdsouvenir/falcon-dash/issues/363).**
  Task lifecycle is `open | ready | in_progress | waiting | completed | abandoned`; `cancelled`
  becomes reversible `abandoned` and `in_review` is gone. A Task's definition splits into title,
  description and `done_when`, stored as immutable revisions, with Plans and Results pinned to the
  exact definition revision they were written against.
- **Completion requires a Result that pins the current Definition**, so a Task cannot close against
  a result written for a goal that has since changed.
- **Blocked is derived, not declared** — computed from unresolved dependencies, pending Asks,
  unanswered Questions and active waits. Dependencies warn rather than veto: Falcon Dash never
  claims to control runtime permission, which stays with OpenClaw's approvals.

### Removed

- **All prior-version awareness.** No migration, conversion, legacy detection or compatibility
  code. 4.0 installs onto a machine with no earlier Falcon Dash present; pre-4.0 data is handled
  out of band.
- **The standalone SvelteKit application** and its entire dependency tree — 381 source files, the
  `falcon` and `falcon-dash` CLIs, and 42 development dependencies.
- **Channels, Shell, Labs, Apps, Jobs, Ops and Heartbeat.** OpenClaw natively owns channel
  onboarding, agents, approvals, skills, automations and canvas apps.
- **Phase, Review, standalone Change Request and Blocker** as Work types. A review is an ordinary
  Task pointing at the artifact revision it reviews; change control is a revisioned boundary
  carried on a Task.
- Project archive state, the Project Plan artifact, and the canonical current-next pointer.

### Validation

- 127 plugin unit tests
- 30 real-Gateway Chromium acceptance cases at desktop and narrow widths
- An isolated managed-install proof covering SecretRef resolution, disable/remove denial and
  vault-lock denial, with no secret leakage
- A published package containing only `plugin/`, `dist/control-ui/`, the manifest, the build script
  and the plugin technical docs

### Upgrade notes

There is no upgrade path, by design. Export and delete any pre-4.0 Work database before installing;
the KeePassXC vault carries over as an existing file and is opened as-is, never converted or
adopted automatically. Requires OpenClaw 2026.8.1 or later, Node 22.16+, Linux, `keepassxc-cli` and
`flock`.

### Not included

The coordination agent and the four Work contract changes that serve it are 4.1
([#367](https://github.com/fdsouvenir/falcon-dash/issues/367)). Provider adapters are exercised
against fixtures rather than live vendor consent, native UI opt-in has been enabled only in
synthetic runtimes, and no packaged Vault skill ships.

## [3.0.0] - 2026-07-23

### Added

- Work v3's semantic command engine, typed domain objects, lifecycle guards, optimistic
  concurrency, provenance, reconciliation, and append-only Event Log
- Mission Control, Needs Resolution, Projects, Automata, Browse, and type-specific Work detail
  surfaces for operators
- Governance records for Plans, Reviews, Authorizations, and Change Requests
- Agent-native `/api/v3` endpoints with bearer-token identities and a `falcon` CLI supporting TOON
  and JSON output
- OpenClaw-backed Automata composed read-through from the live runtime record (no mirrored
  state or drift semantics), with native run history and recoverable deletion
- Gateway protocol v4 adapters while retaining protocol v3 compatibility

### Changed

- `/work` now serves Work v3 and uses `work3.db` plus `work3-events.db` as its canonical stores
- Work context is supplied through the gateway brief plugin instead of the v2 markdown context
  mirror
- Search now opens the v3 Browse surface

### Breaking

- Removed the Work v2 UI, server module, context and reconciliation schedulers, and
  `/api/work/*` endpoints
- Falcon Dash does not migrate or read v2 Work data in application code. The existing `work.db`
  remains untouched for any one-time operator-managed disposition.

## [0.2.0] - 2026-02-16

### Added

- Docker image and GHCR publishing workflow
- SDLC infrastructure — release workflow, security policy, tests, health checks
- Canvas diagnostics tab in settings
- Improved canvas A2UI loading, bridge status indicators, and content overflow handling
- UX polish — scrollbars, session filtering, theme fix, auto-naming, dividers, skills app, cron polish, settings fallbacks

### Fixed

- PM feature detection so the projects page loads correctly
- Accessibility attributes on SkillsTab modal dialogs

## [0.1.0] - 2026-02-09

### Added

- Real-time chat with streaming responses, thinking blocks, and tool call visualization
- Slash commands, threads, bookmarks, and search in chat
- Markdown rendering with Shiki syntax highlighting, KaTeX math, and Mermaid diagrams
- Project management with domains, focuses, projects, tasks, and subtasks
- Document browser with create, rename, and delete operations
- Cron job management with scheduling and run history
- Heartbeat monitoring with status indicators
- KeePassXC password vault integration
- Settings page with config editor, device management, Discord, live logs, model selection, and skills
- Canvas system with A2UI bridge for agent-rendered UI surfaces
- Gateway WebSocket client with protocol v3 support
- Exponential backoff reconnection with tick-based health monitoring
- Ed25519 device identity and challenge-response authentication
- Gateway canvas bridge plugin for routing canvas commands to operators
- Vitest testing framework with initial unit tests
- GitHub Actions CI workflow
- Husky pre-commit hooks with lint-staged
- ESLint, Prettier, and TypeScript strict mode
