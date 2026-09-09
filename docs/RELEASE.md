# Release workflow

Falcon Dash ships from two repositories to two ClawHub listings. This document is the canonical
description of both paths. The generic `release` skill still governs commit grouping, SemVer
selection and GitHub verification; everything here is what is specific to Falcon Dash.

## The two channels

|                | Preview                           | Production                         |
| -------------- | --------------------------------- | ---------------------------------- |
| Repository     | `fdsouvenir/falcon-dash-preview`  | `fdsouvenir/falcon-dash`           |
| Package        | `@fdsouvenir/falcon-dash-preview` | `@fdsouvenir/falcon-dash`          |
| Manifest id    | `falcon-dash-preview`             | `falcon-dash`                      |
| Data directory | `<state>/falcon-dash-preview`     | `<state>/falcon-dash`              |
| Installed on   | the dev gateway                   | Verl's gateway                     |
| Tags           | every release                     | only the ones chosen for promotion |

**Preview is the working repository.** Day-to-day development happens there and increments the
preview version. Production is **generated** from a preview tag; it has no source of its own, so it
cannot drift.

**Verl's gateway never runs preview.** The agent does real work against the live vault and Work
store, so its runtime stays on the production package. Preview is exercised on the dev gateway.

## Versions are one line

Both channels use the same version numbers. Promoting preview `4.7.0` produces production `4.7.0`.
Production simply skips the versions that were never promoted, so its tag list is a subset of
preview's:

```
preview      4.5.0   4.6.0   4.7.0   4.8.0   4.9.0
production                   4.7.0                   4.10.0
```

A shared line means a production listing's version is enough to identify exactly which preview
build it came from. Never publish a production version that does not exist as a preview tag.

## Path 1 — preview release

The everyday path. Run it from the preview repository.

1. **Settle the tree.** Anything uncommitted is reviewed and committed in logical pieces, per the
   `release` skill. A release never sweeps unrelated work in with `git add -A`; the agent workspace
   files in particular are gitignored and must stay that way.
2. **Choose the version** from the committed diff, not from what anyone called it.
3. **Validate locally.** `npm run check`, `lint`, `format:check`, `check:docs`, `check:harness`,
   `test`, and `test:e2e` when the change touches the native UI. Real-Gateway acceptance has caught
   defects that every other gate passed; do not skip it for UI work.
4. **Bump and commit** the version metadata last: `package.json`, `openclaw.plugin.json`,
   `package-lock.json`, `plugin/contract.mjs` and the `CHANGELOG.md` entry.
5. **Tag and push** the branch first, then the tag. CI, Release and Publish run from the tag.
6. **Verify GitHub**: branch CI, the tag release workflow, the package publish workflow, and that
   the release exists and is not a draft.
7. **Replace the release notes.** Auto-generated notes are a compare link. Write real ones.
8. **Publish to ClawHub** and report:

   ```sh
   clawhub package validate .
   clawhub package publish . --family code-plugin --dry-run
   clawhub package publish . --family code-plugin
   ```

   Do not wait for the listing to become publicly installable. New releases are held pending
   automated security checks; report the pending attempt and its state rather than blocking.

## Path 2 — production release

Promotion. This runs a **complete preview release first**, then generates production from it, so a
single command updates both listings at the same version.

1. Run **Path 1** end to end. If any step fails, stop — production is never released from a preview
   that did not ship.
2. **Generate the production tree** from that preview tag by applying the identity delta below.
   Nothing else is edited: no cherry-picking, no hand-merging, no production-only fixes. A fix
   belongs in preview and reaches production through the next promotion.
3. Commit to the production repository with the same version, tag it, push branch then tag.
4. Verify GitHub for the production release exactly as in Path 1.
5. Write production release notes. These are for operators, not developers: what changed for
   someone running it, and anything they must do at upgrade.
6. **Publish to ClawHub** and report, as above.

## The identity delta

The only differences between the two trees. A promotion rewrites exactly these and nothing else.

| Location                                    | Production                | Preview                              |
| ------------------------------------------- | ------------------------- | ------------------------------------ |
| `package.json` `name`                       | `@fdsouvenir/falcon-dash` | `@fdsouvenir/falcon-dash-preview`    |
| `package.json` repository / homepage / bugs | `…/falcon-dash`           | `…/falcon-dash-preview`              |
| `openclaw.plugin.json` `id`                 | `falcon-dash`             | `falcon-dash-preview`                |
| `openclaw.plugin.json` `name`               | `Falcon Dash`             | `Falcon Dash Preview`                |
| `openclaw.plugin.json` `icon`               | `…/falcon-dash/main/…`    | `…/falcon-dash-preview/main/…`       |
| `plugin/index.mjs` plugin id                | `falcon-dash`             | `falcon-dash-preview`                |
| `plugin/index.mjs` default data dir         | `falcon-dash`             | `falcon-dash-preview`                |
| `README.md` badges, links, install command  | `falcon-dash`             | `falcon-dash-preview`, plus a banner |

The two manifest ids are deliberately different. ClawHub requires an id to be unique within a
publisher's packages, and distinct ids mean a dev gateway can hold both without one silently
adopting the other's data directory.

## Bootstrap

Performed once, in this order, and not repeated:

1. Release the cleaned production baseline from `fdsouvenir/falcon-dash`.
2. Seed `fdsouvenir/falcon-dash-preview` from that tree as a single squashed initial commit — the
   preview repository is public and does not need the full internal history.
3. Apply the identity delta to preview and release it.
4. Move day-to-day development to the preview repository.

After bootstrap, production is only ever written by a promotion.
