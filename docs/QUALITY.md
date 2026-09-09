# Quality Guide

This document defines the minimum validation standard for Falcon Dash changes.

## Default Commands

- `npm run check:harness`
- `npm run check:docs`
- `npm run check`
- `npm run lint`
- `npm run test`
- `npm run test:e2e`

Run the smallest subset that proves the change. Do not skip validation silently.

## Validation by Change Type

### Store, parser, or utility changes

- add or update adjacent `*.test.ts`
- run `npm run test`
- run `npm run check` if types or public interfaces changed

### Route or component changes

- run `npm run check`
- run `npm run lint`
- add or update Playwright coverage for user-critical flows when practical
- verify desktop and narrow-viewport behavior if the route supports both shells

### Server route or gateway-facing changes

- run `npm run check`
- run `npm run test`
- add or update Playwright coverage when the UI contract changes
- document live-gateway prerequisites if a check cannot run locally

## Manual Verification Standard

If automation is incomplete, record:

1. route or command
2. prerequisite state
3. action
4. expected result

"Tested manually" by itself is not an acceptable verification note.

## Documentation Freshness

When changing stable behavior, update the matching doc in `docs/` in the same change when
possible. At minimum, update the doc if you changed:

- system architecture or request flow
- shell or navigation behavior
- route-level UX patterns
- verification expectations
- plan-writing or operator workflow

CI also runs a docs ownership check for high-signal directories. If a change touches frontend
surfaces, stores, Work flows, Vault behavior, or gateway-facing integration without touching every
required owner group, the build should fail and force an explicit documentation decision. The
harness separately rejects broken local links and orphaned files under `docs/`.

## Plugin validation

`check`, `test`, `test:coverage` and `build` all target the plugin; it is the only runtime in this
repo. CI installs the exact 2026.9.3 SDK into a runner-temporary prefix and KeePassXC for synthetic
credential tests, with explicit isolated OpenClaw state/config paths. See
[checkpoint evidence](Technical/plugin-v4-evidence.md) for failed and unavailable gates, and
[backend continuation](Technical/plugin-v4-backend.md) for contract coverage.

Plugin source coverage excludes only the generated TypeBox bundle and test files from the
coverage percentage.

`test:managed-runtime` is a separate isolated native-install gate, not a replacement for unit
tests. It covers the managed owner lifecycle and a real provider-bound request using
synthetic credentials; it does not claim live vendor authentication or native UI acceptance.

Native DOM interaction tests run the actual browser bundle in Happy DOM, including real WorkStore commands and secret cleanup outside the view container. They do not count as rendered desktop/narrow or real-shell acceptance; that gate is currently blocked by browser navigation policy.

The required `native-e2e` job in CI launches the packaged plugin in a real pinned isolated Gateway and tests its native Control UI in Chromium. It is not a success skip or a standalone server. See [the acceptance harness](Technical/plugin-native-e2e.md).
