# The single plugin: runtime and scope

**Status: 4.0 is released.** Every gate passes at the release commit — unit tests, real-Gateway
Chromium acceptance at desktop and narrow widths, the isolated managed-install and SecretRef proof,
and a package containing only the plugin.

**What is not in 4.0:** the coordination agent and the four Work contract changes that serve it are
[4.1](../ROADMAP.md). Live provider consent, production native-UI opt-in and a packaged Vault skill
remain outside this release; see [the acceptance map](plugin-v4-scope.md).

**Scope authority:** [issue-by-issue map](plugin-v4-scope.md), with
[backend contracts](plugin-v4-backend.md) and
[native UI acceptance](plugin-v4-native-ui.md) as the current implementation record. Issue bodies
#326, #329, #330, #345, #347, #360, #361, #363 and #365 govern. `PURPOSE.md` remains
owner-protected and knowingly describes the superseded standalone direction.

## Actual package and runtime

The package has exactly one OpenClaw entry, `plugin/index.mjs`, and one `falcon-dash` manifest.
It registers real SDK services, tools, scoped Gateway methods, four tab descriptors, authenticated
HTTP routes, and one `before_prompt_build` hook returning `prependSystemContext`. No Channels,
Shell, Labs, Apps, Jobs, Ops, Heartbeat, channel transport, standalone server, or mirrored
OpenClaw runtime data exists anywhere in this repo. Those modules and the standalone Svelte
application were deleted; Git history retains them.

The generated domain contract carries the release version so an agent can tell which contract it is
holding. That version is a literal in `plugin/contract.mjs`, not read from `package.json`; see
[versioning](deployment.md#versioning) for the four files that move together.

`npm run build`, `npm run check`, and `npm test` target the directly executable JavaScript plugin,
which is the only runtime here. There is no production cutover.
Development dependencies are not runtime plugin dependencies. OpenClaw is an optional peer with a
floor of **>=2026.9.3**; Node **`>=24.16.0 <25 || >=26.1.0`**, Linux `/proc/self/fd`, `flock`, and
KeePassXC CLI are prerequisites.
This Linux-only release must not be advertised as portable or broadly version-compatible.

## Catalog metadata

The manifest declares `categories: ["agent-orchestration"]` and an `icon` URL. ClawHub requires
exactly one category per release, declared in the manifest — the CLI's `--categories` flag is
deprecated and ignored for plugins. Omitting the field hands classification to a model, which falls
back to `other`.

The icon is `assets/falcon-dash-icon.png`, served raw from the default branch. It is the existing
Falcon Dash mark recovered from the pre-4.0 application, resampled to 256px with an adaptive
palette: 457 KB to 57 KB, since a catalog icon renders small. The asset is not packed into the
release archive because the manifest references it by URL.

## Configuration schema

Every field in `configSchema` carries a `description`. ClawHub renders the schema as the listing's
Configuration tab, so an undescribed field is a blank row on a public page; six of the eight were
undescribed before publication.

`vaultOwners` is described as what it is rather than what its name suggests. `owns()` returns true
for any `human:` actor, so the Gateway's own authentication is the access boundary and
`policy.owners` is recorded for the audit trail only. Describing it as an allowlist would tell an
operator their credentials are restricted when any account that can sign in to the Control UI can
read every entry.

## Registered identity

The plugin id is `falcon-dash` and its registered description is user-facing: it appears in
`openclaw plugins list` and on the ClawHub listing. It states what the plugin does rather than its
development status. The description in `plugin/index.mjs`, `openclaw.plugin.json` and
`package.json` are kept consistent by hand; only the version is machine-checked.

Nothing shipped describes the build as a preview. The preview channel is a separate package,
`@fdsouvenir/falcon-dash-preview`, published from its own repository with its own plugin id, so a
preview build is identified by which package was installed rather than by a caveat in a string.

## One process, several registrations

The host registers this plugin more than once in the same process. A tool registry loads it with
activation disabled and tool discovery on, so `services.register` and `start()` are substituted and
never run. That registration still exposes the tools an agent calls. Registration-local state is
therefore not a safe place to hold the service: the discovery load's own copy stays empty forever,
and tools served from it fail with `unavailable` while the activated load answers Gateway methods
from a live store in the same process at the same moment.

`start()` publishes the started modules on `globalThis[Symbol.for('falcon-dash.runtime')]`, and
`invoke()` resolves that value rather than its closure copies, so every registration serves the one
live instance. `stop()` and a failed `start()` both delete it. An absent global still means no
service in this process, so a genuinely stopped service continues to fail closed.

Registration-shape assertions cannot see this: both loads register identical tools. Coverage
belongs in a test that performs two registrations, starts only the first, and then invokes through
the second — asserting it reaches the running store and still records `agent:<agentId>` as the
actor.

## Historical iframe limitation (superseded by approved native UI)

The inspected installed host is OpenClaw 2026.9.2, build `3928bad`.

- `PluginControlUiDescriptor` supports `surface: "tab"`, a plugin HTTP `path`, and required scopes.
- The host renders external tabs in sandboxed iframes; descriptors are real registration, unlike
  the old custom `modules` manifest metadata.
- `authorizeControlUiPluginCookieRequest` in the pinned runtime's `http-auth-utils` accepts only
  **GET and HEAD**. The external tab component contains no general authenticated mutation bridge.
- `dispatchGatewayMethod` is supported only inside declared authenticated HTTP request scope;
  `contracts.gatewayMethodDispatch: ["authenticated-request"]` is declared here.
- Native feature UI offers authenticated `host.request`, but it executes trusted code in the
  Control UI origin and requires the separate Custom plugin UI opt-in. This is a different trust
  boundary, not something an external iframe receives automatically.

The historical checkpoint served read-only iframe content. Native feature-plugin UI was approved
on 2026-09-06 and now provides interactive pages directly—no generic iframe bridge. The old
read-only route remains a useful opt-in-off fallback. No GET mutations, credential-bearing URLs,
permissive CORS or frame bearer tokens are introduced. Untrusted document preview alone remains
sandboxed. See [current native acceptance and unchanged local browser-policy boundary](plugin-v4-native-ui.md).

## Historical initial backend checkpoint (not current capability status)

### Work

Private SQLite storage uses WAL, FULL synchronous mode, busy timeout, STRICT tables, immediate
transactions, optimistic versions, idempotency receipts, immutable Definition/Plan/Result/change
artifact snapshots, and transactional events. Existing unversioned databases are rejected rather
than silently adopted. Task starting requires explicit accountable assignment; waiting preserves
its prior state in the event history. Completion can report truthful results despite dependency
warnings. Milestone achievement rejects unfinished associated Work. Project completion is derived;
reopening its Milestone reopens that projection. Abandonment requires each unfinished item's
explicit abandon/detach disposition and records affected objects individually.

Definition edits mark pinned artifacts stale rather than repinning them. Full reads expose artifact
and event history; lists exclude those bodies. Empty lists and unknown query fields are explicit.
Repeated Task completion is a no-op. Independent connections exercise optimistic conflicts.

This is **not yet the whole #363 domain**: durable contextual Asks, Question/Decision/Finding/Area
semantic transitions, review targets, structured Task authorization/reconciliation, placement
reconciliation, complete aggregate queues, field selection, size-bounded detail/truncation,
benchmarks, and historical data conversion remain incomplete. `revise_change` currently stores
an immutable narrative artifact only; it grants no authority and is not a finished change-control
implementation. No unsupported governance behavior should be inferred from its existence.

### Documents

Explicit root/actor ACLs and write enablement gate text browse/read/create/edit/mkdir. Linux
file-descriptor-anchored directory traversal rejects dot/credential paths, symlink components,
nonregular files, hardlinks, and oversized/binary content. Root paths cannot traverse OpenClaw
state. Content is treated as text, not trusted markup. Saves compare content versions and publish
via same-directory atomic replacement; stale edits reject instead of overwriting silently.

This assumes trusted same-UID workspace writers. Version checking is not a cross-process CAS
against a hostile concurrent filesystem writer. Protected filename filtering does not discover
arbitrary credentials someone embeds in an otherwise authorized document: configure dedicated
noncredential roots. Rename, download/upload UI, recoverable deletion, bulk actions, Markdown
rendering, browser editing and full accessibility acceptance remain incomplete.

### Vault

The backend opens the operator's own KeePassXC database — `<stateDir>/passwords.kdbx` by default,
overridable with `vaultDatabase`/`vaultKeyFile` — adopting one that already exists and creating one
only when genuinely absent. `Vault.ready()` is idempotent and also reconciles configured owners and
executors into the stored policy. Plain operator entries and versioned agent envelopes coexist and
are never converted into each other. The unlock key is protected by filesystem ownership, not an external
key-management system. Existing Vaults are not adopted. Gateway authentication is the human
credential: a `human:` actor is an owner, while agents stay gated on `vaultExecutors` plus
per-entry grants. `flock` serializes
separate worker processes. OAuth access/refresh material is one encrypted JSON Password value;
rotation copies the encrypted database, changes the value through stdin, verifies it, fsyncs,
then atomically publishes. Optimistic versions reject a concurrent loser. An omitted unchanged
refresh token survives a partial rotation. Ordinary inventory returns handles only.

Synthetic tests exercise the **real KeePassXC CLI**, operator- and agent-created entries,
human-owner reveal in the backend, agent reveal denial, locking, and pair rotation. Raw protected
CLI stdout stays inside private service pipes and never enters ordinary tool responses or logs.
Separate tests restore a consistent SQLite snapshot and a quiesced synthetic KeePassXC/key backup. This does **not** prove the human browser path, a complete entry/group UI, revocation races,
SecretRef resolver integration, or production recovery. Those are release gates, not implied
by successful unit tests. No raw-value Gateway method is registered.

### Integrations

One SQLite lifecycle service and adapter interface separate public connection state from Vault
material. HighLevel refresh and location validation plus Cloudflare token validation use fixed
HTTPS endpoints, timeout and redirect rejection. Concurrent refresh rejects rather than
performing another exchange. Interrupted refresh becomes reauthorization-required rather than
blindly reusing a potentially consumed token. Native-owned credentials reject Falcon refresh.

Provider tests are **mock HTTP fixtures, not authenticated provider proof**. Cloudflare token
verification alone is not permission proof and is reported unavailable, not ready. Schwab is
not implemented or registered. HighLevel consent/callback/code exchange, permission verification,
full durable scheduler ownership/recovery, lifecycle service activation, UI actions, redacted audit
projection, shared credential authorization races and end-to-end live validation remain incomplete.
The timer helper is not activated by this prerelease: automatic maintenance must not be claimed.

## Reliability audit (#361)

| Pattern                                                      | Checkpoint disposition                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Shared generated contract                                    | Adopted operation-schema composition; full derivation/guard generation incomplete        |
| Epoch + monotonic revision                                   | Adopted in Work read/mutation responses                                                  |
| Canonical reread/reconnect/stale browser response protection | Pending interactive bridge and UI implementation                                         |
| SQLite hardening                                             | Adopted for new Work database; integrations/WAL permission and recovery audit incomplete |
| Just-in-time authority                                       | Partial checks in credential resolution; asynchronous mutation revocation remains a gate |
| Reported versus independently verified proof                 | Results do not claim independent verification; review Task links pending                 |
| Workboard integration or dispatch                            | Rejected: separate, unsynchronized products; no runtime dependency                       |

Recommend keeping Workboard disabled when using Falcon Work; the plugin never changes its config.

## Validation and isolated rerun

Run `npm run build:plugin`, `npm run test:plugin`, and formatting/lint checks. Tests create and remove
only their own synthetic temporary directories. Preserve all real state and credentials.
For any OpenClaw CLI call, set **both** `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` to the
isolated test directory and invoke the absolute pinned 2026.9.3 binary. Never invoke an unpinned
binary against the operator's normal state. Validate metadata, pack, then install that archive
inside isolated state. Do not publish the package or restart the production Gateway.

Provider-request prompt-injection proof and real interactive Control UI acceptance are still
required. Passing registration spies is not proof of a real installation or provider-bound system
prompt; report each separately.

## Clean installation (no cutover)

4.0 has no cutover procedure because it has no predecessor to cut over from. The standalone
service is already stopped and disabled, its Work database is exported and deleted out of band,
and 4.0 installs onto a machine with no earlier Falcon Dash present. There is no converter, no
dual-write window, no rollback-to-previous-version and no schema downgrade path.

The KeePassXC vault at `~/.openclaw/passwords.kdbx` is the one file that carries over. It is not
converted or adopted automatically; the Vault module opens it as an existing private database.

Synthetic offline SQLite and encrypted Vault/key restoration are tested in
`plugin/tests/recovery.test.mjs`. That covers 4.0's own snapshot/restore of its own data — it is
not a migration path from any earlier version.

## Host validation caveats

The pinned `plugins validate` command accepts the newer tool/feature authoring metadata, not
plain `definePluginEntry` service plugins; it reports that authoring metadata is missing. Use
`plugins inspect falcon-dash --runtime --json`, actual isolated Gateway startup, and scoped RPC
checks as distinct runtime evidence rather than inventing metadata to satisfy that command.
External `before_prompt_build` hooks additionally need the owner-controlled
`plugins.entries.falcon-dash.hooks.allowConversationAccess` grant. Default installation blocks
that hook; a successful registration spy alone must never be reported as injection proof.

The [checkpoint evidence](plugin-v4-evidence.md) distinguishes passing tests, fixture-only checks,
blocked browser acceptance, and the actual runtime installation proof.
