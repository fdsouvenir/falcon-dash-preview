# Native Control UI implementation

## Approval and boundary

Native trusted Control UI code is approved in the current bodies of #364, #365, #330 and #347.
There is no remaining UI-trust design decision. One `falcon-dash` package now declares the
prebuilt native entry `dist/control-ui/falcon/index.js` and its stylesheet. The four native
pages use the supported `defineControlUiPlugin`, host page/navigation/dialog APIs and authenticated
host requests. Work commands and queries use `createFeatureClient(workFeature, host)`.

Enable **Settings → Labs → Custom plugin UI**, or
`gateway.controlUi.experimental.customPlugins: true`, in an approved installation and reload
following the required Gateway restart. The synthetic managed-install harness enables this only
in its own generated runtime config. Production config/restart is not performed. With the opt-in
off, upstream gates native assets and the retained authenticated read-only fallback explains
how to enable the native pages; backend operations remain available.

The native surface is self-contained under `plugin/native/`. `style.css` loads its Geist faces from
`plugin/native/fonts/`, and the build inlines them as data URLs, so the bundle has no dependency on
a separate static asset directory.

## Implemented interactions

- Work: attention buckets, Projects, Browse/search, canonical detail, associated Project/Milestone
  work, relationships and open Asks with native conversation links. Create and contextual actions
  use schema-derived labeled forms, source/option arrays, nullable values and typed dispositions.
  History loads on demand. Definition/result/change/authorization remain separate sections.
- Vault: the page reports `Vault ready` and opens straight into credential management, because the
  plugin provisions and unlocks at startup. There is no Set up, Unlock or Lock control — those are
  host lifecycle, not operator choices, and the actions are absent from the protected RPC. A page
  reporting `Vault unavailable` means startup failed and points at service health rather than
  offering a step the operator cannot complete. The page is a password manager, laid out as a group
  rail, a dense entry list and an inspector for the selected entry. A search box over the whole
  vault is the primary retrieval path: `inventory_all` returns every group and entry in one call,
  so searching never walks group by group. The list carries the entry title and its group only.
  KeePassXC exposes no modification timestamp, and reading any field costs one `keepassxc-cli`
  subprocess per entry, so neither a Modified nor a Username column is buildable at list scale;
  the username belongs to the inspector, which loads `metadata` on selection. The inspector shows
  Password/Username/URL/Notes on a single label-value-actions baseline, masked until revealed, and
  offers a control only for the fields the record reports carrying. Reveal is one toggle rather
  than a Reveal button beside a standing Hide. The four KeePassXC fields always appear so an empty
  one reads as "not set"; an agent credential carries arbitrary field names of its own, and those
  are listed after the four rather than being dropped. Removal asks the operator to type the entry name and
  keeps the control disabled until it matches exactly, because `message` deliberately discards
  error text and a thrown mismatch would surface as a generic failure. Otherwise: protected entry,
  groups, versioned field rotation and executor policy.
  The protected RPC is not a general agent tool or background feature query. It requires an actual
  connection-bound human owner and original authority through async worker activity and return.
  No plaintext browser persistence or secret-bearing URLs are used. Revealed values clear on
  Hide, a 15-second deadline, lock/epoch/ownership loss, disconnection, loss of write access,
  presentation loss or disposal. Cleanup includes host dialogs rendered outside the mount node.
  Explicit Copy writes the selected value to the system clipboard; the UI does not promise to
  erase the clipboard later or undo a value already copied by the human.
- Integrations: health/freshness, connection creation with server-derived human identity, Test,
  Refresh, Pause/Resume, Disconnect and HighLevel consent/completion backed by the existing
  version-fenced OAuth implementation. `oauthRedirectUris` explicitly allowlists callback URIs.
  Consent codes use protected human fields, not chat. No real vendor consent or validation was
  performed. The connection's named service/agents must also have Vault execution grants.
- Documents: authorized roots, breadcrumbs, filename search/sort, text viewing/editing, create
  file/folder, text upload/download, rename, copy path, targeted recoverable trash, bounded selected
  file trash and per-item undo. Stale writes retain edits; Compare latest version lets the human
  review the saved content before explicitly using its version for the next Save. Markdown uses
  the existing unified/remark/rehype sanitization libraries and an empty-sandbox iframe with a
  deny-by-default CSP. No script, network image, form or embedded active document capability is
  granted to file content.

## Verification and exact limitation

`plugin/tests/native-ui.test.mjs` evaluates the actual bundled native module in an offline
Happy DOM fixture. It tests registrations/typed transport, real WorkStore creation, stale reply
retirement, protected input outside the mount container, Reveal/Hide, authority-loss cleanup and
non-executing document content. `native-vault.test.mjs` additionally runs real KeePassXC with
synthetic human/agent entries and original-authority races. `native-integrations.test.mjs` tests
connection derivation and consent authority. These are **not screenshots or real Control UI E2E**.

The configured managed browser is healthy (CDP and page readiness both true), but the browser tool
explicitly denied `http://127.0.0.1:28971` with `browser navigation blocked by policy`. Installed
`docs/tools/browser.md` distinguishes this from browser startup failure and says navigation policy
is separate from healthy local CDP. No alternate URL, direct CDP/Playwright navigation or proxy was
used to bypass the denial. The local browser limitation does not block the separately authorized real-Gateway CI browser
suite on its own runner. Use that required gate and its screenshots for desktop/narrow acceptance;
do not bypass the local browser policy or infer acceptance from offline DOM tests. The initial
native checkpoint was not release-ready; current acceptance is tracked in the E2E evidence.

The baseline at `215111f` passed all 20 required real-Gateway cases in
[CI 34047399891](https://github.com/fdsouvenir/falcon-dash/actions/runs/34047399891): both widths,
registered navigation, persisted writes, reconnect, clipboard, access denial, structured Work
details and hostile Markdown. These are actual rendered CI fixtures, distinct from offline DOM
or host-only tests. Independent re-review confirmed the four scoped repair findings closed.
This is not comprehensive visual-design, keyboard/focus/zoom/reduced-motion acceptance or full
Work/domain/provider completion. See [scope and remaining work](plugin-v4-scope.md).

## Historical local checkpoint evidence (not current totals)

- `artifacts/plugin-v4/native-all-tests.txt`: 99 plugin tests passed, including the retained 80.
- `artifacts/plugin-v4/native-historical-tests.txt`: 402 retained historical tests passed.
- `artifacts/plugin-v4/managed-install-4120649/combined-proof.json`: current archive installed,
  runtime loaded, native assets declared, isolated opt-in on, managed revocation/lock checks and
  real synthetic-provider request passed; original system Node unchanged.
- `artifacts/plugin-v4/native-browser-policy.json`: healthy browser control and denied isolated
  navigation; **no rendered evidence or screenshots**.
- `artifacts/plugin-v4/native-types.txt`, `native-lint.txt`, `native-format.txt`, `native-docs.txt`,
  `native-harness.txt`, `native-skills.txt`: source/package quality checks.

The local browser-policy limitation is unchanged. A required, separately authorized CI browser job now exercises the real isolated Gateway on its own runner; see [native E2E](plugin-native-e2e.md). Host-only proof is already local; browser acceptance must be reported from actual CI results, not inferred from the test implementation.

Native Work forms now retain one idempotency key across an uncertain reply and expose explicit
review/reapply controls after a version conflict. Updating the reviewed command version does not
silently repin Plan, Result or authorization references. Closed real transport sockets also retire
server-side authority, even if a synthetic `invalidated` flag was never attached.

Review repairs retire pending Reveal/Copy responses on Hide as well as existing lifecycle
cleanup. Renaming a dirty document keeps its edit buffer and reviewed version. Native select
fields choose their first declared option when no initial value is supplied.

Rendered review found the host light theme's generic `.field` selector overriding the dark
native input backgrounds. Native field classes are now namespaced to avoid this collision;
actual desktop/narrow screenshots remain the acceptance evidence for contrast and layout.

Native form controls explicitly expose their field label through `aria-label`, so a select's
accessible name does not accidentally include all of its option text.

## Operator connection presentation

Connection cards show health/freshness, maintenance state, last validated/failure times, the
stored due time and verified capabilities before actions. Unix milliseconds are formatted with
the browser locale and explicit IANA timezone/offset label. Missing history says Not recorded;
missing due time says Not scheduled; malformed timestamps say Unknown (invalid timestamp).
Paused connections label the stored due time without promising execution; native-owned
maintenance is explicitly Managed by OpenClaw. Owner/id/version/phase remain in initially
collapsed Technical details rather than occupying the primary mobile layout.

The Work action menu also exposes the existing Project resume and Question/Decision withdraw
commands. Server validation remains authoritative; this does not add lifecycle rules or runtime
permissions. Remaining UI/domain gaps are listed in the scope checklist, not implied closed by
menu coverage or the 20-case browser matrix.

Rendered follow-up caught flush-to-border summary/Technical details rows. They now use the
existing card content inset; the real browser case checks that inset at both widths.

Work now exposes full saved-content recovery with explicit historical-artifact labeling, history
pagination and additional related collection pages. Resolve request uses the shared semantic form
and original Ask id; it does not acknowledge a request without committing its validated action.
Agent/session fields suggest the current host roster; missing identities remain visible. Typed
waiting references are optional and never replace the required waiting/resume explanation.

## Continued operator workflows

- Work collections/attention pages have totals and continuation controls; participants derive from
  event and linked-session provenance. Reference fields offer host-owned identity suggestions and
  bounded title search rather than requiring CLI syntax. Missing identities remain visible.
- The Vault's narrow-viewport rules are declared after its base rules on purpose. A media query
  adds no specificity, so overrides placed earlier in the stylesheet lose to later base rules and
  the three-pane grid would keep its desktop track sizes at 320px, overflowing the shell.
- Vault supports protected SecretRef grants, redacted access history, private recovery snapshots,
  guarded entry relocation/removal and removal of empty groups. Grants stay reachable from the
  command bar because they are the only way to authorize a SecretRef, but they are not a browsing
  surface: every entry is one kind of record, and the page never badges or filters by whether an
  agent can read it. Recovery material is not a browser
  download. Moving an entry invalidates old handles; changing a credential pauses dependent Falcon
  connections until explicit review/resume/test.
- Integrations includes collapsible account/usage/expiry/failure/audit detail, provider portal
  handoffs, explicit credential rebinding, paused reconnection preparation and native Work review
  links. Static tokens do not offer Refresh, and native-owned references do not offer Falcon
  maintenance. Sign-in, rebinding and refresh are not represented as successful validation.
- Documents' Browse trash reads durable server metadata and restores without overwriting current
  files, even after the prior view's Undo state is gone. Folder/upload/download/path-copy workflows
  are exercised in the real shell.

The expanded browser matrix also checks long Work text/history, keyboard dialog interaction,
320px reflow and reduced-motion presentation. These are not claims of every browser, actual
browser zoom, or live provider consent. Exact-head results and inspected captures remain required.

## Fallback header

The read-only fallback in `plugin/ui.mjs` renders the module name and the product name only. It
previously appended a development-status caveat to every page; that string reached operators who
had simply not enabled custom plugin UI, and said nothing useful to them.
