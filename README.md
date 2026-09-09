# Falcon Dash

> **This is the preview channel.** It ships early and often, and is meant for a test gateway
> rather than one doing work you care about. The production channel is
> [`@fdsouvenir/falcon-dash`](https://github.com/fdsouvenir/falcon-dash).

**An operator console for OpenClaw: shared work tracking, a real credential vault, service
integrations and document workspaces — as one plugin inside the Control UI you already use.**

[![CI](https://github.com/fdsouvenir/falcon-dash-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/fdsouvenir/falcon-dash-preview/actions/workflows/ci.yml)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A5%202026.9.3-8a63d2.svg)](https://docs.openclaw.ai)
[![Node](https://img.shields.io/badge/Node-24.16%2B%20%7C%2026.1%2B-339933.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/Platform-Linux-lightgrey.svg)](#requirements)

Falcon Dash adds four pages to the OpenClaw Control UI. There is no second application, no separate
web server and no other address to visit. OpenClaw keeps owning the shell, chat, agents, sessions,
approvals and Automations; Falcon Dash adds the things it does not have.

## What you get

**Work** — a shared record of what is being done, by people and agents together. Seven object types
(Project, Milestone, Task, Question, Decision, Finding, Area) with immutable revisions, explicit
assignment and waiting states, typed dependencies, and Asks an agent raises when it needs an answer
from you. Agents create and update Work through typed commands; the pages are where you read it,
steer it and answer.

**Vault** — your own KeePassXC database, opened where it already lives, never rewritten. Search
across every entry, browse groups, and reveal or copy a field on purpose. It is also the source for
OpenClaw SecretRefs, so an agent can resolve a credential you stored without the value passing
through a chat message. Values stay masked until revealed and hide themselves again shortly after.

**Integrations** — connection lifecycle, health and audit for the services an agent works through,
with credential rotation, explicit rebinding, and paused reconnection that never reports a sign-in
as a successful validation.

**Documents** — authorized text workspaces with safe path traversal, stale-edit protection,
no-clobber rename and recoverable deletion.

## Install

```sh
openclaw plugins install clawhub:@fdsouvenir/falcon-dash-preview
```

Then enable native plugin UI, which is an operator decision OpenClaw deliberately keeps out of a
plugin's hands:

```sh
openclaw config set gateway.controlUi.experimental.customPlugins true
```

Restart the Gateway and reload any open Control UI page afterwards. Custom plugin UI runs with the
signed-in operator's Gateway permissions, so enable it only for plugins you trust.

You can also install a release archive directly from
[GitHub Releases](https://github.com/fdsouvenir/falcon-dash-preview/releases); each release ships the
package tarball with a `SHA256SUMS` file to verify it against.

## Requirements

- **OpenClaw 2026.9.3 or later**
- **Node 24.16+ or 26.1+**, matching the OpenClaw runtime
- **Linux.** The Vault depends on `keepassxc-cli`, `flock` and descriptor-anchored `/proc/self/fd`
  access, so macOS and Windows are not supported.
- **KeePassXC** installed and on `PATH`

## Configuration

Every setting is optional; the plugin runs with none of them. The Control UI shows the full schema,
and the most useful ones are:

| Setting                          | What it does                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `vaultOwners`                    | Profile IDs recorded in the vault policy for the audit trail. **Not** an access allowlist — see Security. |
| `vaultDatabase` / `vaultKeyFile` | Point the Vault at an existing KeePassXC database instead of the default in the Gateway state directory.  |
| `dataDir`                        | Where Falcon Dash keeps its own Work, integration and audit databases.                                    |
| `documentRoots`                  | Directories the Documents page may read and write, and who may reach them.                                |
| `modules`                        | Turn individual pages off.                                                                                |

## Security

- Credentials live in KeePassXC. Falcon Dash records its policy and access history beside your
  database and **never rewrites your entries** — the entries you created stay ordinary KeePassXC
  entries, so anything already resolving them keeps working.
- **Reaching an authenticated Gateway connection is the credential.** Any operator who can sign in
  to your Control UI can reveal any entry; there is no per-person allowlist inside the plugin.
  Restrict Gateway sign-in accordingly.
- Reading a value requires a verified human connection and an explicit, per-field action. **Agents
  cannot reveal values at all** — no raw-value Gateway method exists for them to call. An agent may
  create an entry, and may be granted executor rights to use one, but revealing is denied.
- Revealed values clear on disconnect, on losing authority and on navigating away.
- Removal and relocation take a private recovery snapshot first, and access history is recorded
  with values redacted.
- `flock` serializes vault operations, so concurrent work cannot corrupt the database.

Report vulnerabilities through [SECURITY.md](SECURITY.md) rather than a public issue, and never
post credentials or private account data in one.

## Current limitations

- **Linux only**, for the reasons under [Requirements](#requirements).
- **Native UI is an operator opt-in.** Until `customPlugins` is enabled and the Gateway restarted,
  the pages are not rendered.
- **Provider adapters are exercised against fixtures**, not live vendor credentials. A passing test
  is never reported here as proven live authentication.
- **Work is recorded, not chased.** Falcon Dash faithfully records what is happening; noticing that
  nothing has happened is not part of this release.

## Documentation

- [Work](docs/End%20User/work.md) — the objects, states and how agents drive them
- [Vault](docs/End%20User/passwords.md) — storage, access, recovery and who can see a value
- [Documents](docs/End%20User/documents.md) — workspaces, editing and trash

## License

[CC BY-NC 4.0](LICENSE) — attribution required, non-commercial use only, adaptations permitted.
Bundled dependency licenses remain with their respective code; TypeBox ships with its own license
file.
