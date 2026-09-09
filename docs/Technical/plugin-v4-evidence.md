# Plugin v4 checkpoint evidence

This records the first checkpoint. See [backend continuation](plugin-v4-backend.md) for newer coverage; the historical suites have since been repaired and all 402 tests pass.

This records a **partial implementation**, not completion of #364 or its source issues.
See [scope and gaps](plugin-v4.md). No production cutover or package publication was performed.

## Passing checks

- `npm test`: **19 tests passed**. These cover Work revision/idempotency/concurrency semantics,
  dependency warnings and Milestone guards, project dispositions, Documents safety/stale writes,
  real KeePassXC synthetic owner access and atomic pair updates, integration HTTP fixtures,
  registration/scopes, SQLite snapshot restore, and quiesced encrypted Vault/key restore.
- `npm run check`: plugin JavaScript type-checked against the installed SDK declarations.
- `npm run lint` and `npm run format:check`: repository checks, excluding generated isolated-runtime assets.
- `npm run build`: plugin JavaScript/package validation.
- `npm run check:harness`, `npm run check:docs`, `npm run check:skills`.
- Historical Svelte check: **0 errors, 53 warnings**. This is not plugin UI acceptance.
- Local archive creation and installation in fresh, explicitly isolated OpenClaw state.
- `plugins inspect falcon-dash --runtime --json`: **loaded**, four named optional tools, seven
  scoped Gateway methods, one service, four HTTP routes, and one typed `before_prompt_build` hook;
  no diagnostics after granting conversation-hook permission in **isolated config only**.
- Isolated Gateway startup on loopback and successful real `falcon.work.read` / `falcon.vault.read`
  calls. Work returned nine synthetic fixture records; Vault reported locked.
- Authenticated-route HTML response: 200, `Cache-Control: no-store`, restrictive CSP, escaped
  synthetic script markup, and no retiring terminal endpoint.
- The isolated Gateway process was stopped and its listener verified absent after inspection.

## Not passing or not proven

- Historical standalone unit suite: **361 tests passed, three suites failed to import** with
  `No such built-in module: node:` (`work3/contract`, `project-proof-sources`, and `work3/ui`).
  This remains a failed check; it is not hidden by the separate canonical plugin suite.

- `openclaw plugins validate`: the pinned command rejects ordinary `definePluginEntry` entries
  lacking newer tool/feature **authoring metadata**. It is not a substitute for the successful
  runtime inspection/install checks, and is not reported as passed.
- Provider-bound system/developer prompt capture is **not tested**. Hook presence is only
  registration evidence; default external installs block conversation hooks until owner grant.
- Browser tool navigation to the isolated loopback Gateway was **denied by policy**. No alternate
  browser path was used to bypass it. **No desktop/narrow screenshots or rendered acceptance**.
- Interactive iframe writes, protected human Vault entry/reveal/copy, and Documents editor UI are
  blocked on the host bridge decision described in the scope document.
- Provider tests are mock HTTP fixtures. **No live HighLevel/Cloudflare/Schwab authentication**.
  Schwab is not implemented; Cloudflare permission proof is not claimed from token verification.
- Complete Work conversion/domain/UI, typed aggregate projections, SecretRef resolver integration,
  activated durable maintenance and asynchronous revocation races remain implementation gates.
- Synthetic backup tests do not prove production conversion or production backup recovery.

## Local evidence paths

The ignored directory `artifacts/plugin-v4/` contains:

- `unit-tests.txt`, `typecheck.txt`, `build.txt`
- `checks/check-harness.txt`, `checks/check-docs.txt`, `checks/check-skills.txt`, `checks/lint.txt`
- `checks/types-svelte.txt`, `checks/historical-unit.txt` (historical, non-plugin suite)
- `install.txt`, `runtime-inspect.json`, `gateway-work-read.json`, `gateway-vault-status.json`
- `gateway.log`, `package.txt`, `fdsouvenir-falcon-dash-4.0.0-alpha.0.tgz`
- `isolated/` holds only test configuration, workspaces, synthetic data and installed artifact.

The pinned executable used was the installed OpenClaw **2026.9.2 (`3928bad`)** entry, always with
explicit `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` directed into `isolated/`.
`docs/PURPOSE.md` and the live standalone worktree were not edited.
