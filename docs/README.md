# Falcon Dash Documentation

`docs/` is the system of record for Falcon Dash product behavior, architecture, operating rules,
and approved contracts. A document must say whether it describes the current product, a future
roadmap target, or a retained contract. Do not present planned behavior as shipped behavior.

Falcon Dash 4.0 is one installable OpenClaw plugin with internal Work, Integrations, Vault and
Documents modules. It carries no awareness of any prior version: no migration, conversion, legacy
detection or compatibility code, and no standalone web application.

## Start here

- [PURPOSE.md](PURPOSE.md) — product intent, audience, and non-negotiable product boundaries
- [ROADMAP.md](ROADMAP.md) — current release scope and what OpenClaw now owns instead
- [HARNESS.md](HARNESS.md) — repo execution and validation model
- [OWNERSHIP.md](OWNERSHIP.md) — code-to-document ownership and update requirements
- [QUALITY.md](QUALITY.md) — validation levels and rerun expectations
- [RELEASE.md](RELEASE.md) — the preview and production release paths, and the channel identity delta
- [LEARNINGS.md](LEARNINGS.md) — only lessons durable across the full roadmap

## Current product documentation

These files describe the implementation that exists now.

### End-user behavior

- [End User/work.md](End%20User/work.md)
- [End User/passwords.md](End%20User/passwords.md)
- [End User/documents.md](End%20User/documents.md)

### Technical implementation

- [Technical/plugin-v4.md](Technical/plugin-v4.md) — plugin runtime, scope and open gaps
- [Technical/plugin-v4-backend.md](Technical/plugin-v4-backend.md) — Work, Vault, Integrations and
  Documents backend contracts
- [Technical/coordination-agent.md](Technical/coordination-agent.md) — the locked gateway agent that
  escalates, follows up and mediates, and its sweep procedure
- [Technical/plugin-v4-native-ui.md](Technical/plugin-v4-native-ui.md) — native Control UI boundary
- [Technical/plugin-v4-scope.md](Technical/plugin-v4-scope.md) — acceptance map by issue
- [Technical/plugin-v4-installation.md](Technical/plugin-v4-installation.md) — installed artifacts
  and private Vault recovery
- [Technical/plugin-v4-evidence.md](Technical/plugin-v4-evidence.md) — recorded validation evidence
- [Technical/plugin-native-e2e.md](Technical/plugin-native-e2e.md) — real-Gateway browser acceptance
- [Technical/deployment.md](Technical/deployment.md) — supported same-host runtime and packaging
- [secretrefs.md](secretrefs.md) — built-in KeePassXC vault as an OpenClaw SecretRef provider

### Repo operation

- [RELIABILITY.md](RELIABILITY.md) — state, realtime, and failure-mode expectations
- [CONTRIBUTING-HARNESS.md](CONTRIBUTING-HARNESS.md) — satisfying harness checks
- [HARNESS-LOOP.md](HARNESS-LOOP.md) — recursive local work loop
- [PLANS.md](PLANS.md) — execution-plan expectations

## Documentation classes

| Class    | Meaning                                           | Update rule                                                   |
| -------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Current  | Describes code and UI that ship now               | Must change with the owning code                              |
| Roadmap  | Describes an approved future target               | Must identify its target version and never imply availability |
| Contract | Preserves an approved semantic or design contract | Amend explicitly; do not silently rewrite history             |

Unclassified historical notes, screenshots, abandoned proposals, and implementation diaries do not
belong in `docs/`. Git history and closed issues retain that information.
