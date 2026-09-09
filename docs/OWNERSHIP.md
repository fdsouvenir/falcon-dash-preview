# Documentation Ownership Map

Documentation changes are part of implementation, not cleanup to defer. Before editing a
high-signal code area, read the smallest matching current document below. If behavior, boundaries,
configuration, or rerun steps changed, update that document in the same change.

## Code-to-document map

| Change area                             | Paths that usually trigger it                                                                         | Current docs that own the truth                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Work domain, projections, agent context | `plugin/work/**`                                                                                      | `docs/Technical/plugin-v4-backend.md`, `docs/End User/work.md`                            |
| Integrations lifecycle, adapters, OAuth | `plugin/integrations/**`                                                                              | `docs/Technical/plugin-v4-backend.md`                                                     |
| Vault and SecretRefs                    | `plugin/vault/**`, `bin/keepassxc-secret-resolver.cjs`                                                | `docs/End User/passwords.md`, `docs/secretrefs.md`, `docs/Technical/plugin-v4-backend.md` |
| Documents browser and durable trash     | `plugin/documents/**`                                                                                 | `docs/End User/documents.md`, `docs/Technical/plugin-v4-backend.md`                       |
| Native Control UI surface               | `plugin/native/**`, `plugin/ui.mjs`                                                                   | `docs/Technical/plugin-v4-native-ui.md`                                                   |
| Plugin registration, contracts, storage | `plugin/index.mjs`, `plugin/contract.mjs`, `plugin/authority.mjs`, `plugin/storage.mjs`, the manifest | `docs/Technical/plugin-v4.md`, `docs/Technical/plugin-v4-scope.md`                        |
| Package, build, release, installation   | `package.json`, `.github/workflows/**`, `scripts/build-plugin.mjs`                                    | `docs/Technical/deployment.md`, `docs/Technical/plugin-v4-installation.md`                |
| Browser acceptance                      | `e2e-native/**`, `playwright*.config.ts`, `scripts/run-native-e2e.mjs`                                | `docs/Technical/plugin-native-e2e.md`                                                     |
| Roadmap or product boundary             | approved epic or explicit product decision                                                            | `docs/ROADMAP.md`; change `docs/PURPOSE.md` only with its owner's explicit direction      |
| Validation or harness behavior          | `scripts/**`, test configuration                                                                      | `docs/HARNESS.md`, `docs/QUALITY.md`, and the specific workflow doc                       |

## Update rules

1. End-user docs describe only behavior a user can reach in the current build.
2. Technical docs describe current code paths, storage, and failure boundaries.
3. Future behavior belongs in `ROADMAP.md` and must carry a version label.
4. The Work domain contract is issue #363's body. Amend the technical docs when the implementation
   changes; do not restate the contract in a way that can drift from it.
5. 4.0 documents no migration, conversion or legacy-detection behavior, because none exists.
6. A code change may legitimately require no doc edit, but the reason must be specific; touching an
   unrelated doc is not evidence of freshness.

`npm run check:docs` enforces this map for changed high-signal paths. The check is a guardrail, not a
replacement for reading the owning document.
