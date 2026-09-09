# Backend continuation after the initial checkpoint

This is the current backend status for [PR #366](https://github.com/fdsouvenir/falcon-dash/pull/366).
Native feature-plugin UI is approved and implemented; there is no remaining UI-trust decision.
The baseline real-shell matrix passed at `215111f`; the complete build remains incomplete for
the concrete [scope gaps](plugin-v4-scope.md), not an unresolved native-UI approval.

## Regression recovery

All **402 historical tests** now pass. The three previously failing suites were transformed as
browser code despite importing server-only modules. Vite now gives server regressions a Node
project and retains happy-dom for browser regressions. Test mode never installs the dev Gateway
WebSocket proxy or Sentry upload plugin, so regression execution does not read normal Gateway
credentials or establish live proxy connections. No historical tests were removed.

## Work domain and contracts

- Retained Question answers/hypotheses, Decision packages/outcomes, Finding validity and Area
  lifecycles follow the surviving v3 validation rules. Hypotheses never answer Questions;
  supported/confirmed answers and Findings require sources. Decided commitments cannot be
  rewritten through a package edit. Source references are bounded and unknown fields reject.
- Task dependencies pin both Definition revisions; explicit reaffirmation records the new pin in immutable event history rather than silently repinning. Milestone achievement snapshots explicitly selected supporting Work/result revisions.
- Task change-control revisions now carry scope, risk, rollback and acceptance. Authorization
  pins current Definition/change and optional Plan. Verified human principals grant/revoke;
  agent-provided identity/source assertions do not become human authority. This is Work
  metadata, not OpenClaw runtime permission enforcement.
- Review Tasks pin exact immutable artifact identities. Contextual Asks retain one subject,
  requirement, intended command and native session/agent reference. Resolution resubmits the
  actual semantic command and closes the Ask inside the same transaction only after validation.
- Artifact/event update/delete triggers and cross-Task Definition-pin checks protect immutable
  storage. Work schema version 3 upgrades only the isolated plugin schema; old unversioned Work
  databases require explicit conversion. Preflight checks existing databases read-only before
  changing permissions or journal mode.
- List projections support explicit fields/pagination and server-derived Project progress/current
  Milestone. Queue/brief use a constant-query read transaction with bounded bucket rows and exact
  totals; all attention causes remain classified even when displayed causes are truncated.
  Detail text exposes size metadata and an explicit full read. History has pagination.
- One TypeBox command schema serves the store and supported `defineFeatureContract` /
  `defineFeaturePlugin` backend operations: `work_list`, `work_queue`, `work_command`.
  The real pinned SDK validates inputs **and outputs** in tests. These contract tests alone do not prove rendered native behavior.
- The SDK's session-action context supplies a connection id/scopes, not a verified human profile.
  `falcon.identity` therefore binds the real Gateway principal to that connection, with revocation
  cleanup. Feature mutations fail closed until bound; they never infer a human from payload fields
  or use an agent id as the human principal.

The current [acceptance map](plugin-v4-scope.md) separates implemented read/history/participant/
reference workflows from #363's explicitly unsettled Milestone/Area/Tag/structured-content
semantics. Those decisions remain external; no implicit new domain rule is invented.

## Documents

The authorized text backend now supports browse/read/create/edit/mkdir, text upload/download,
no-clobber rename, explicitly confirmed trash and restore. Trash stays in a private, inaccessible
workspace subdirectory; normal Documents traversal cannot browse it. Restore verifies content and
never overwrites another file. Unknown operations remain errors. All operations retain root/actor
checks, symlink/hardlink restrictions and text-size limits. Read/download content is untrusted.

Directory moves, atomic bulk transactions and richer binary/media handling are unsupported.
Native Markdown, selected-file trash with per-item outcomes, and real browser editor acceptance
are now implemented; see the native UI and current scope documents. Same-UID hostile filesystem writers remain
outside the stated trusted-workspace concurrency model; atomic rename is not cross-process CAS.

## KeePassXC and SecretRefs

- Real KeePassXC group creation, nested handles and redacted per-group inventory are implemented.
- Lock/unlock state and authority generations persist under the same `flock` as credential
  operations. A stale service instance cannot mutate after another instance locks/unlocks.
  Awaiting `lock()` is the durable completion boundary; local reveal results are also fenced.
- OAuth rotations can carry a connection guard. The private worker acquires the Integrations
  SQLite write lock, rechecks the connection's version/actor/phase, and holds it across the
  encrypted file's atomic publication. Tests exercise disconnect while real rotation is queued.
- `plugin/vault/resolve-secrets.mjs` implements the real OpenClaw exec-provider v1 protocol.
  `secretProviderIntegrations.keepassxc` declares the supported manifest preset, not a copied
  resolver path. It has no HOME fallback. Configure the nonsecret `FALCON_VAULT_DIRECTORY`
  path explicitly. The human owner grants exact `entries/<handle>/<field>` IDs; the resolver
  cannot use the broader executor inventory as a blanket grant. Disabled/removed plugin preset
  handling remains owned by OpenClaw.
- Resolver values travel only on the native private exec-provider pipe, never general tools,
  Gateway detail/list methods, audit payloads or error messages. Tests use synthetic credentials
  and check denial, durable lock and the real child process protocol.

Protected human entry/reveal/copy now has an approved native implementation; see
[its tests and real-shell acceptance](plugin-v4-native-ui.md). Per-entry
execution-policy refinement, revocation/removal workflows and complete key recovery need further
review. Filesystem key protection is not an external key-management service.

## Integrations and OAuth

- Maintenance is activated as a deterministic plugin service, not agent Automations. Only
  connections explicitly granting `service:falcon-integrations` are eligible, and Vault access
  still requires its own configured permission/unlock. Work is serialized with bounded catch-up.
- Durable phase/version claims, PID plus process-start identity, retries/backoff, explicit
  pause/disconnect and compare-and-swap finalization prevent competing refreshes and stale
  completion writes. Shutdown drains in-flight work. A second service does not steal a live
  process's claim. Ambiguous crashed exchanges require reauthorization instead of token replay.
- Successful token refresh does not itself mark a connection healthy; validation is scheduled
  separately. Native-owned credentials still reject Falcon refresh ownership.
- `HighLevelOAuth` implements human-bound, expiring, one-use state, configured redirect allowlists,
  confidential-client exchange, connection/Vault-version revalidation and guarded token storage.
  Raw authorization codes are neither persisted nor logged. Callback success says connected but
  unvalidated, and replay is denied. The OAuth URL is a protected human-flow output, never an
  ordinary agent tool response. The native UI now exposes the protected consent/completion handoff; no public callback HTTP route is deployed.
- OAuth tests are **provider HTTP fixtures**, not actual HighLevel consent/authentication.
  Cloudflare now tests the configured account-read capability, and Schwab has bounded account-hash validation/refresh fixtures. These do not establish live provider authorization.

The current public Schwab guide was read at
[OAuth restart vs refresh](https://developer.schwab.com/user-guides/apis-and-apps/oauth-restart-vs-refresh-token).
It requires restarting consent for scope/account changes, revocation, changed account credentials
or TFA, and compromised/malfunctioning refresh tokens; normal access-token expiry uses `expires_in`
and refresh. It does **not** establish an indefinite renewable session or a universal seven-day
policy. Do not invent either from third-party examples.

## No prior-version awareness

Falcon Dash 4.0 carries no migration, conversion, legacy detection or compatibility code. The Work
store initializes empty on a fresh installation. Any earlier Falcon Dash data is exported and
removed out of band before 4.0 is installed, so the plugin never reads a pre-4.0 database, never
infers an earlier schema and has no dual-write or downgrade path.

### Native resolver verification and managed-preset limitation

The pinned native `secrets audit --allow-exec` resolved one synthetic reference successfully with
zero unresolved/plaintext findings using the supported **manual exec provider** pointed at the
user-owned executable resolver. The nonsecret directory comes from that provider's explicit env
configuration; the launch environment omitted the convenience variable. After durable Vault lock,
the same native audit reported one unresolved reference with no value leakage or fallback.

The managed preset rejects a Gateway launched with root-owned `/usr/bin/node` under uid 1000.
Current SDK source confirms that manifest `command` must be `${node}` and materializes directly
to `process.execPath`; an executable script wrapper cannot replace it in a managed preset.
`trustedDirs` does not override the current-user ownership check.

**A supported managed path is now verified:** launch the isolated Gateway with a non-symlink,
user-owned, non-group/world-writable Node executable. The test used a byte-identical copy of Node
22.23.2 under `artifacts/plugin-v4/owned-runtime/node` (uid 1000, mode 0755), leaving system Node
unchanged. This is an isolated compatibility fixture, not a production Node installer.
`scripts/verify-managed-secretref.mjs` verifies managed resolution, denial after plugin disable
and removal, restoration, and denial after Vault lock. `scripts/verify-plugin-prompt.mjs` in
`managed` mode verifies the actual Gateway inference path. Neither test substitutes a manual
exec provider or weakens the ownership guard. The nonsecret `FALCON_VAULT_DIRECTORY` is supplied
through the manifest's declared environment allowlist.

This is not an unavoidable plugin/API blocker. Production deployment must select an appropriately
owned Node runtime; no production runtime was changed. Ordinary system-Node installations remain
incompatible with this preset on the pinned host. The old manual proof remains distinct and is
not a substitute for plugin-managed revocation. Revocation checks cover new native resolution;
previously issued values and cache lifetimes are not retroactively erased.

Sources: installed OpenClaw 2026.9.2 `docs/plugins/manifest.md` (SecretRef section),
`docs/gateway/secrets.md` (exec ownership), `dist/manifest-ByRdkf9X.js` (preset normalization), and
`dist/resolve-224YoYfx.js` (materialization and path validation).

TypeBox 1.3.18 is now bundled with its license by the build; the installed runtime has no npm
runtime dependency installation step. This also avoids the installed host's npm `edgesOut` failure
when updating a plugin that already has a linked OpenClaw peer. The SDK itself remains host-owned.

## Historical 64-test continuation checkpoint

- 64 plugin tests cover the current backend; all 402 retained historical tests pass in their
  corrected Node/happy-dom projects. No historical suite was removed to obtain that result.
- The public contract structurally factors repeated schemas into local JSON Pointer definitions.
  Expansion is tested equal to the original artifact. This reduces serialized contract size by
  roughly a quarter without omitting fields; it is not a v2 tokenizer benchmark.
- Work invalidations contain only process epoch and monotonic revision. Post-commit observer
  failures cannot undo a mutation; external database commits are detected. The supported SDK
  watch implementation is exercised for coalescing, stale responses, reconnect and disposal.
- Technical attention derivations are shared by mutation responses and bounded queues, and
  queue rows are deduplicated when multiple causes apply. Missing Task authorization is visible
  without claiming runtime enforcement. Review checkpoints pin the reviewed artifact and cannot
  be accepted for a different target.
- Vault execution grants are per-entry in addition to global eligibility; the creator does not
  retain agent access after the human owner replaces that grant. The owner can still reveal an
  owned value after execution access is disabled. Field-specific reveal/copy returns only the
  selected field. Append-only access audit excludes values and remains owner-readable while
  locked. Audit state is included in synthetic restore tests.
- Vault lock and local grant revocation prevent new resolutions. They do **not** retract copied
  values, revoke provider tokens, or promise to evict credentials already cached by OpenClaw.
  Native credential-owner/cache lifecycle and provider revocation are separate boundaries.
- Documents now includes actor-scoped root discovery, stable sorting/pagination and authorized
  path copying. Registered workspaces below OpenClaw state are allowed; state/credential roots
  are excluded. Root replacement, duplicate root ids, known credential containers,
  credential-shaped JSON and private-key content fail closed. These checks do not discover
  every possible secret embedded in ordinary prose. Non-cooperating concurrent filesystem
  writers, including external editors, are not covered by a cross-process CAS guarantee.
- HighLevel's probe follows the current documented `Version: v3` endpoint and verifies the
  configured sub-account identity. A whole-service fixture exercises validation, real encrypted
  storage, refresh and revalidation; requested scopes are not represented as verified grants.
  Source: [current Get Location contract](https://marketplace.gohighlevel.com/docs/ghl/locations/get-location/).

The reviewed provider-request harness remains limited to the pinned core OpenAI-compatible path
against a local fixture. It is not live HighLevel/Cloudflare/Schwab authentication, proof for every
agent harness, or rendered UI acceptance. The actual operator dataset, legacy credential import, remaining domain/connection refinements,
Cloudflare permission coverage and production deployment compatibility remain acceptance work.
Schwab fixtures, native UI and the supported isolated managed-SecretRef path were subsequently
implemented and verified; the current scope checklist separates those from live proof. The original request and
source issues must remain open.

## Parent review: authority and worker lifetime

The review found a real gap: an integration could begin physical I/O after secret preparation
finished under a revoked connection. Original connection identity/scopes, retirement signal and
service lifetime now travel as a guard rather than being reduced to an actor string. Integration
leases are checked after secret resolution and immediately before adapter dispatch; owned
adapters check again at `fetch`. Credential epoch guards and cancellation propagate into that
path. OAuth uses the same boundary. Gateway replies and field-specific human returns recheck
the original authority; Documents checks immediately before filesystem mutation.

The encrypted writer now requests a private parent authorization at its publication point. It
then acquires/rechecks the connection transaction immediately before replacement. It never waits
for parent IPC while holding the connection write lock. This prevents a queued stale operation
from publishing, but does not retract a request or commit already authorized before revocation.

Vault subprocesses now have a dedicated owned process group. Timeout, output overflow and
cancellation terminate the group, not just `flock`; failure does not settle while runnable group
members remain. Vault lock cancels its owned credential operations. The native resolver reuses
this cleanup and forwards graceful termination. Abrupt host death still depends on host process
supervision; no claim is made that a killed JavaScript supervisor can run cleanup afterward.

Deterministic races exercise revocation/disconnect during secret preparation, revocation and real
Vault lock during provider preparation, direct encrypted publication denial, a real Gateway
Documents mutation with delayed preparation, protected human return cancellation, scope loss,
and the exact `flock → Node → delayed writer` timeout chain. The latter checks both group liveness
at settlement and absence of the delayed write. These are not only static ownership assertions.

## Additional domain and conversion refinements

Default Task detail now uses the same Result applicability check as completion: a checkpoint for
an old review target is not displayed as current applicable proof, while full history retains it.
An explicit regression verifies dependency removal cascades to its Definition pins and removes
the associated attention rather than leaving phantom dependencies.

Offline conversion rejects a live nonempty snapshot WAL (the main-file digest alone can miss
committed WAL changes), detects changes during inspection, and revalidates the archive digest
before reporting conversion success. A changed archive removes only the new conversion target.
Legacy-id lookup cannot resolve inherited Object properties. These are resolved implementation
gaps, not deferred product decisions or reasons to migrate live data without approval.

## Third provider and native runtime refinements

- Cloudflare validates both token activity and the exact configured account via its account-read
  endpoint. A healthy result claims only `account.read`, not Workers deployment, DNS write, or
  every permission on the token. Protected field: `api_token`.
- Schwab uses its token and account-number mapping endpoints, verifies the expected account hash,
  and returns no account numbers/balances. Protected fields: `access_token`, `refresh_token`,
  `client_id`, `client_secret`, and an explicit ISO `reauthorize_at` cutoff. Missing/elapsed cutoff
  refuses provider I/O. Refresh preserves an omitted refresh token and never advances this cutoff.
  This is an explicit local renewal boundary, **not** an invented universal provider lifetime.
  Earlier provider revocation still requires consent; it stops automatic retries.
- The current public Schwab portal is a client-rendered shell to the lightweight fetcher. Endpoint
  and Basic-auth conventions were cross-checked against maintained `schwab-py` auth/client source
  and documentation; these are secondary implementation references, not proof that a live account
  is authorized. No indefinite-session or seven-day guarantee is asserted.
- Real Gateway profile fields are now used at native RPC boundaries. The earlier tests' explicit
  internal role actor alone did not cover ordinary trusted-proxy connections. The host-only
  installation proof establishes a real profile through `users.self` and binds `falcon.identity`.

See [required real-Gateway native E2E](plugin-native-e2e.md) for CI/runtime/browser distinctions.

## Continuing Work read-path acceptance

Work detail now reports explicit collection totals/cursors. The scoped `related` read traverses
relationships, active Asks, associated Work, immutable artifacts and history in bounded pages;
unknown collections/filters reject. Native detail exposes shortened-text guidance and an explicit
full saved-content disclosure labeled as including historical—not necessarily applicable—artifacts.
History and capped collections can be traversed without silently stopping at the first page.

Waiting may carry an optional typed agent/session/Work/external reference alongside the required
human explanation and resume condition. Upstream identities remain owned by OpenClaw: the UI
suggests current host agent/session rows and identifies absent assigned agents without reassignment.
An Ask's Resolve request form resubmits its original supported semantic command with its Ask id;
the existing server transaction revalidates and closes it only after successful mutation.

## Continued lifecycle and recovery acceptance

Integrations now exposes scoped audit pages, account/usage/opaque credential references, typed
failure guidance, expiry and next action, and explicit paused/unvalidated reconnect/rebinding.
Sustained failures and scope/reauthorization failures create one deduplicated ordinary Work review
Task through semantic commands. They do not become an agent Automation. Human credential changes
pause dependent connections; failed storage operations may conservatively leave them paused.
Uncertain refresh/restart outcomes cannot replay the same credential revision; a new reviewed
revision/binding or completed consent is required. Expired access alone is not treated as proof
that provider consent must restart.

Vault adds protected audit/grant controls, recoverable relocation/removal and empty-group removal.
Exact flattened entry paths prevent KeePassXC title-search fallback from resurrecting old/recycled
handles. Private snapshots and fresh-destination offline restore are tested with the real CLI.
There is no legacy Vault converter: the existing KeePassXC database is opened as-is, and no
execution grants are inferred for entries the operator has not explicitly granted. See the
installation guide.

Documents exposes bounded durable trash discovery with corruption/unavailable counts and
no-clobber restore. Native UI restoration survives reload; the earlier in-memory Undo remains
only a convenience, not the sole recovery route.
