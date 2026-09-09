# v4 acceptance map and external decisions

Current authority: [#364](https://github.com/fdsouvenir/falcon-dash/issues/364),
[#365](https://github.com/fdsouvenir/falcon-dash/issues/365),
[#347](https://github.com/fdsouvenir/falcon-dash/issues/347) and
[#363](https://github.com/fdsouvenir/falcon-dash/issues/363). Issue bodies, not superseded comments,
remain specifications.

Native UI approval is resolved and 4.0 is released. Release is not a blanket security
certification: the boundaries below are what the evidence actually covers. The coordination agent
and its four Work contract changes are [4.1](../ROADMAP.md).

## Implemented acceptance

| Scope                     | Implemented behavior                                                                                                                                                                                                                                                                                                                                                                      | Verification and boundary                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #364 package/runtime      | One manifest/entry; Work, Integrations, Vault and Documents; typed scoped operations, composed system context, native UI and deterministic maintenance. No standalone server or retired module in the archive.                                                                                                                                                                            | Real pinned OpenClaw 2026.9.3 installed archive, four registrations, managed SecretRef and synthetic-provider inference proof. Linux, Node >=24.16.0 <25 or >=26.1.0, flock and KeePassXC are explicit prerequisites; not broad platform certification.               |
| #363 Work                 | Seven retained types; immutable Task Definition/Plan/Result/change artifacts, assignment/waiting, warning-only dependency pins, review targets, authorization metadata, transactional contextual Asks, derived Project/Milestone outcomes and explicit abandonment dispositions.                                                                                                          | Unit/contract/concurrency/conversion tests. Work authorization metadata does not enforce OpenClaw runtime permissions. Unsettled semantic decisions are not guessed below.                                                                                            |
| Work read/UI completion   | Full saved-text recovery labeled for historical applicability; paginated history and related Work/Asks/artifacts/relationships; bounded attention drill-down/counts; participant provenance; optional typed waiting references. Host agent/session and bounded searchable Work-reference suggestions preserve missing identities. Explicit Ask resolution resubmits the semantic command. | Native forms share schemas and deterministic server validation. Long-content/history, keyboard forms, 320px reflow and reduced-motion browser cases extend the original desktop/narrow matrix. Reflow is not represented as an actual browser-zoom experiment.        |
| #365 Documents            | Authorized roots/breadcrumbs, filename search/sort/paging, text edit/create/folder/upload/download, path copy, file rename, sandboxed Markdown, conflict recovery, selected-file recoverable trash and durable trash discovery/restore after reload.                                                                                                                                      | Traversal/protected-content/actor denial, bounded FIFO/symlink reads, optimistic conflict, corruption and retained browser workflows. Partial selected-file trash has explicit per-item outcomes.                                                                     |
| #347 Vault                | Real encrypted storage and serialized rotation; protected entry, deliberate human/agent-created reveal/copy, groups, field changes, policy/SecretRef grants, redacted access history, exact-path relocation/removal and empty-group removal. Old/recycled entries are execution-disabled and cannot resolve through fuzzy title lookup.                                                   | Current connection/owner/epoch fences reach private workers/publication/return; no general secret tool or browser background read. Entry move/removal retains private encrypted recovery snapshots. Policy writes also require the private publication authorization. |
| Vault recovery            | Consistent private database/key/policy/audit snapshots and hash-checked offline restore into a new private destination, with zero automatic execution grants. No legacy conversion: the existing KeePassXC database is opened as-is.                                                                                                                                                      | Real synthetic KeePassXC readback, old-handle denial, no-clobber/corruption/owner checks and source-preserving conversion tests. No in-place overwrite, browser key download, automatic legacy adoption or invented owner mapping.                                    |
| #347 connection framework | Actor-owned records, durable claims/retries/restart recovery, fenced rotation, explicit pause/reconnect/rebind, scoped audit, expiry/freshness and safe failure guidance, account/usage/opaque credential references, provider handoffs and deduplicated ordinary Work attention. Human credential changes conservatively pause dependent connections.                                    | HTTP fixtures and real encrypted lifecycle races, including refusal to replay an uncertain refresh until a new credential revision/binding or completed consent. Fresh access-token expiry does not itself imply fresh consent.                                       |
| #347 adapters             | HighLevel human-bound OAuth/atomic rotating pairs/location validation; Cloudflare token plus exact account-read validation; Schwab account-hash/refresh with explicit non-extendable renewal cutoff.                                                                                                                                                                                      | Shared framework, fixture HTTP and encrypted storage. Cloudflare claims account.read only. Provider portal handoff plus protected Vault renewal/rebind remains available; no invented Schwab consent contract or universal seven-day lifetime.                        |
| #364 release/placement    | Full CI gates publication/release; tag/package/manifest/lockfile/registry guards; prerelease distribution labeling; reviewed archive/checksum attachment; package-content tests; packaged-artifact placement guards.                                                                                                                                                                      | Installed code/data/rollback must be outside development checkouts. Offline tests reject active/enabled legacy service evidence, bad hashes, overlapping paths and incomplete restore/mapping evidence. Recorded offline evidence is not live service attestation.    |

## Supported limits, not silent success

- Documents is a bounded text workspace surface. Directory relocation, binary/media editing and
  atomic multi-file transactions are unsupported; errors/outcomes remain explicit. Trash restoration
  never overwrites a current file. Same-UID hostile writers are outside the documented concurrency
  model; ordinary credential text embedded in prose is not universally detectable.
- Vault group relocation uses explicit entry moves into a newly created group, followed by removal
  of the empty old group. The supported CLI does not supply a proven safe whole-group rename here.
  Recovery stays offline and private; copied values and upstream cached/provider tokens are not
  retroactively erased by local revocation.
- Native-managed credentials retain their upstream owner. This candidate does not invent a native
  MCP/OAuth adoption API or offer Falcon refresh for those references. Static tokens use explicit
  Vault rotation rather than an unsupported Refresh button.
- Browser/clipboard evidence is the required isolated Chromium desktop/narrow matrix, not every
  browser, arbitrary zoom setting or a pixel-identical recreation of the historical standalone shell.

## Genuine external decisions / authorization boundaries

1. **#363 explicitly unresolved semantics:** required versus supporting Milestones; reordering or
   mutation after execution; changed underlying achievement proof; the remaining Area/Finding/Tag
   cardinality rules; richer structured Plan/Result schemas and durable authorization policy. Existing
   bounded narrative artifacts and accepted lifecycle rules work. New semantics need an authoritative
   issue decision, not an implementation guess or another copied v3 rule.
2. **Current packaged Vault skill authoring:** the repository's historical skill is excluded because
   it targets the retired standalone paths/protocol. The mandated Skill Workshop could not resolve
   this repository skill by name or exact path, so it cannot safely revise/package it through the
   available authoring path. No global live skill was published or direct skill-file write used as a
   workaround. The product needs an owner-supplied/current repository skill or a supported authoring
   target; ordinary current operator/API documentation is provided separately.
3. **Live provider/Schwab application contract:** real app credentials, registered redirect/consent
   configuration and vendor access are not authorized here. The public Schwab documentation fetch
   exposed only its portal shell and search was challenged; no unverified automated consent flow was
   invented. Existing refresh/validation fixtures and explicit protected manual handoffs are labeled
   honestly. Permission/revoke capabilities not verified by an adapter are not advertised as proven.
4. **Deployment:** Vault key custody requires operator review. Publication, live registry
   installation and Gateway configuration remain separately authorized. There is no data cutover —
   4.0 installs onto a machine with no earlier Falcon Dash present.

See [installation/recovery acceptance](plugin-v4-installation.md),
[native UI boundary](plugin-v4-native-ui.md), [E2E procedures](plugin-native-e2e.md), and
[backend semantics](plugin-v4-backend.md). Historical counts/proofs in earlier documents identify
those older checkpoints; only exact-head CI and inspected screenshots support current acceptance.
