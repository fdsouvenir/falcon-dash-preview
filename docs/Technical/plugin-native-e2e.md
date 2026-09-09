# Native plugin Gateway acceptance

## What CI actually runs

The `CI` workflow first runs source/types, plugin unit/DOM/security tests, 402 retained historical
tests, and the managed-SecretRef/provider-bound proof. Its required `native-e2e` job then calls
`e2e.yml`. There is no `if: false`, success skip, standalone app dev server, or Node 20 host in
that acceptance path. A failing real-Gateway browser test fails the CI workflow.

The native job installs OpenClaw **2026.9.3**, Node from `.nvmrc`, KeePassXC and Chromium into its
disposable GitHub runner. `npm run test:native-e2e` builds and packs the plugin, installs that
archive, and starts the actual pinned Gateway with explicit isolated state/config/workspace paths.
It uses a byte-identical user-owned Node copy; no system Node permissions or ownership change.

The harness has a **test-only identity proxy** on runner loopback. It strips incoming forwarded
identity headers and supplies one of two declared synthetic people to the Gateway's documented
trusted-proxy authenticator. The Gateway creates and returns the durable profile through
`users.self`; the harness does not invent profile IDs or inject `client.internal` objects. The
plugin now accepts this Gateway-populated authenticated profile in addition to an explicit
verified role actor, still denying shared system/owner identities, synthetic delegated clients,
conflicting identity fields and authority changes during async work.

Only the isolated config opts into native Custom plugin UI. Test fixtures include encrypted
human/agent credentials, high-density Work, a document workspace and a paused synthetic
connection. No real provider credentials or third-party authentication are used. No trading,
payment or provider write is exercised. Provider HTTP adapters have separate synthetic tests.

Chromium loads the **real Control UI served by that Gateway**, not a hand-built HTML harness or
mock `host.request`. Desktop and narrow projects run serially. Tests cover native navigation,
Work creation through typed operations, owner credential entry/reveal/copy and lock cleanup,
Documents editing/concurrency/Markdown, persisted integration controls, disconnect/reconnect,
nonowner denial and useful native-opt-in-off guidance.

The Vault cases drive the rebuilt page: a row in the entry list opens the inspector, and every
field control is read from a `.vault-field` row identified by its label. Two defects reached this
suite and nothing else, which is why it gates the release. A recursive listing reports a childless
group's `[empty]` placeholder under its group path, so an emptied group looked occupied and its
removal control never appeared. And the narrow-viewport rules were declared before the base Vault
rules, so at 320px the desktop three-pane grid survived and overflowed the shell — neither the
type checker nor the DOM unit tests can see either failure. Screenshots mask protected fields. Trace
and video capture are disabled so credential interactions cannot enter those artifacts.

## Commands and evidence

- `npm run test:native-host`: install/start/verify the real Gateway/profile/modules and stop it;
  no browser navigation. This passed locally with the documented proxy boundary.
- `npm run test:native-e2e`: the real browser suite, where browser navigation is authorized.
- `npm run test:e2e`: alias for native Gateway acceptance, not the retired standalone server.
- `playwright.historical.config.ts` and `e2e/` retain historical standalone tests as source;
  they are not the active CI acceptance target and are not counted as native passing tests.
- `artifacts/plugin-v4/native-e2e-*/host-proof.json`: actual Gateway, profile and module evidence.
- `artifacts/plugin-v4/native-screenshots/`: actual desktop/narrow screenshots after a successful
  browser run, including explicitly masked credential inventory and denial states.
- `artifacts/plugin-v4/native-playwright-report/`: browser assertions and failures.

The model's configured local browser denied loopback navigation. That local restriction is
unchanged and was not bypassed with direct local CDP or another local proxy URL. The separately
authorized CI browser suite runs on its own disposable runner, under that runner's policy.
Do not count a host-only proof or offline Happy DOM test as rendered acceptance. A green E2E
result and its screenshots are required before claiming native acceptance.

## Publication boundaries

`release.yml` already depends on the reusable CI workflow; it now transitively requires native
E2E. `publish.yml` also depends on that complete CI workflow and uses pinned SDK/Node/isolated
state during its package checks. These are workflow edits only: no release tag, publication,
production restart, production configuration change or data cutover was triggered.

Early Model Setup/Back to app navigation attempts did not pass the narrow suite and are not
acceptance evidence. Current enabled tests open the host-generated native `/plugin` route;
the separate required sidebar test verifies real navigation. No model verification record is
fabricated or disabled. Provider-bound inference is a separate real-Gateway synthetic-endpoint gate.

Independent review regressions cover a listed document replaced by a FIFO or symlink in a
child process with a two-second timeout, pending Reveal/Copy followed by Hide, and dirty
rename both with and without a preceding version conflict. Reads open nonblocking, validate
the descriptor as a single-link regular file, and read no more than 262145 bytes.

The required browser suite now reloads and reads the exact created Task, reloads and
reveals/copies the human-created credential as well as the agent-created credential, and
asserts saved integration pause state after each action and navigation reload. It scopes
slotted form controls through the host modal element: the host's shadow dialog and its
light-DOM content are not DOM descendants for nested Playwright locators.

The Documents browser case also renames its unsaved conflict-recovered draft, verifies the
buffer survives, saves it, restores the original path, then reloads and reads the saved text.

Copy acceptance waits for the actual asynchronous clipboard result; a click alone does not
mean the protected Gateway round-trip and clipboard write have completed. Every desktop/narrow case is required for a green run. The matrix reports all cases with zero retries and no success-skips. Use `--max-failures=1`
when diagnosing a shared setup failure.

Acceptance screenshots wait for the native request's `aria-busy` state to settle before
capture. Clicking a record without this wait can capture its preceding list rather than the
requested detail, even though subsequent assertions eventually pass.

Before browser readiness, the real isolated Gateway also lists a regular workspace file,
then reads its FIFO and symlink replacements through Documents RPC. Each unsafe read must
reject and a subsequent Gateway status request must succeed within three seconds. Timeout
fails the harness, whose bounded shutdown kills the isolated process group if necessary.
The host proof records these responsiveness checks separately from child-process unit tests.

Each Copy check first writes a different synthetic clipboard sentinel so a previous test's
clipboard cannot satisfy the readback assertion without this action changing it.

A real-shell hostile Markdown case opens the seeded untrusted document, checks its sandbox
and rendered safe heading, asserts no script/image elements, and verifies no top-window
execution marker. Ask navigation must also change to the host's chat route.

After selecting a native page, the helper dismisses any visible Navigation drawer with Escape
and verifies it closed before interacting with the page behind it. Sidebar controls are selected
from the currently visible native-page shell, not the replaced onboarding/chat header.

Canonical native page acceptance now opens the actual host-generated route observed in its
navigation links (`/plugin?plugin=falcon-dash&id=work`, and the other registered page ids).
This avoids conflating the host's model-onboarding/chat-header transition with plugin acceptance.
The real Gateway still authenticates the connection and enforces custom-plugin opt-in; no setup
verification record is disabled or fabricated. A separate required desktop/narrow sidebar case
opens Integrations using the real registered navigation link, then closes the host drawer.
These routes run only on the authorized isolated CI runner, not through the denied local browser.

The opt-in-off case intentionally uses the plugin's guarded fallback guidance route
(`/plugins/falcon-dash/work`), which remains available when native registrations are disabled.
Enabled native acceptance uses only the canonical host-generated `/plugin` route.

Integrations acceptance asserts persisted Enabled/Paused maintenance state, a formatted due time
with explicit timezone, truthful missing validation history, and closed Technical details.
Date unit tests cover daylight-saving offsets, UTC epoch, missing values and malformed data.
The browser captures both widths after these assertions; this is a focused finish, not a redesign.

Passing browser cases do not certify full v4 scope. See [the current scope checklist](plugin-v4-scope.md).

## Expanded required matrix

Additional cases cover full Work text and multiple history pages, retained Documents folder/
upload/download/copy-path and durable trash restoration after reload, protected Vault entry move/
removal/private recovery listing, safe missing-material connection diagnostics and native Work
attention, and keyboard dialog interaction plus 320px reduced-motion reflow across all modules.
The missing-material fixture fails before provider I/O; it is not a live Cloudflare test. Private
Vault/recovery directories are excluded from evidence uploads. No success-skip closes these cases.

Vault cases drive the page as a person would: the add form fills Title and Password, the entry's
own Reveal/Copy read its password, and an agent credential is read through **Details**, which lists
the field names that entry actually carries. The fixture configures `vaultDatabase`/`vaultKeyFile`
explicitly, exercising the same override an operator uses to point the Vault somewhere other than
the default `<stateDir>/passwords.kdbx`.

Vault cases assert readiness rather than performing it. The plugin provisions and unlocks at
startup, so `vaultReady()` waits for credential management to be present and clicks nothing. It
replaced an earlier `unlock()` helper that clicked `Unlock` only when visible — a conditional step
passes whether or not the control exists, which is exactly the regression these cases must catch.
