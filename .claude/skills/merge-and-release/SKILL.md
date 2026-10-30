---
name: merge-and-release
description: Integrate SHAG feature branches through staging, promote staging to main when authorized, and cut releases across both repositories (outer engine and src/games/fps submodule). Covers fps-first merge order, re-pinning, changelogs, versions and tags. Use when asked to merge, push an integration branch, re-pin fps, close a cycle, tag or release, bump versions, or start a changelog.
---

# Merging and releasing SHAG

SHAG is two Git repositories that move together: the outer engine at the
repository root and the FPS game in `src/games/fps`, a submodule. The outer
repository records which fps commit it uses (its "pin"). Every step below exists
to keep that pin pointing at a commit on the matching fps destination branch
(`staging` for integration, `main` for production) and pushed. An outer
commit that pins an unpushed or unmerged fps commit breaks every fresh clone.

Only push when the user asked for it. Merging locally is fine to do on request;
pushing publishes it.

## Staging before production

Feature work must pass through `staging` in both repositories before any merge
to `main`. `main` automatically deploys to production. A request to commit,
merge or push `staging` authorizes only that checkpoint; promote to `main` only
when the owner asks for production promotion or release.

For integration, use the fps-first merge sequence below with destination
`staging` and source `<feature-branch>` in both repositories. Re-pin the outer
repository at fps `staging`, validate the integrated result, then push fps
`staging` before outer `staging` when authorized. If creating `staging` for the
first time, check local and remote branches first and create it from `main` in
each repository. Research-only work can be committed directly on `staging`
when requested; an unchanged fps tree needs a matching branch, not an empty
commit.

For approved production promotion, use source `staging` and destination `main`
in the sequence below. Do not merge a feature branch directly into `main`.
Resolve submodule conflicts using the fps destination branch's tip. Review
media compatibility before publishing production code (see Publishing media).

## Before you start

Run every git command with an absolute `cd` to the repository it is meant for.
The shell's working directory carries over between calls, and in this
two-repository layout a relative command lands in the wrong repo easily:

```bash
cd /c/Users/sundf/Desktop/wash/shag/src/games/fps && git status --short && git branch --show-current
cd /c/Users/sundf/Desktop/wash/shag && git status --short && git branch --show-current
```

(Adjust the root if the checkout lives elsewhere: it is the directory holding
`AGENTS.md`.)

Check both trees are clean apart from work you have been told to leave alone.
If other agents have uncommitted files, leave them out of every commit (see the
`shared-worktree` skill). Both repositories must be on the same feature branch
name.

Run the gates on the feature branch first (`npm run typecheck`, `npm run
test:run`, `npm run gate:biome`, `npm run build`), plus the renderer/networking
regression set when the cycle touched those areas (see the
`regression-check` skill). Merging is the wrong moment to discover a failure.

## Production promotion: always fps first

1. **fps:** commit the reviewed work on `staging`, then merge it into fps `main`:

   ```bash
   cd /c/Users/sundf/Desktop/wash/shag/src/games/fps
   git checkout main && git merge --no-edit staging
   git push origin main            # only when asked to push
   ```

2. **Outer:** merge `staging` into outer `main`, then re-pin fps at its
   merged `main` tip and commit that:

   ```bash
   cd /c/Users/sundf/Desktop/wash/shag
   git checkout main && git merge --no-edit staging
   cd /c/Users/sundf/Desktop/wash/shag/src/games/fps && git checkout main
   cd /c/Users/sundf/Desktop/wash/shag && git add src/games/fps
   git commit -m "chore: pin fps at main (<short summary>)"
   ```

   Skip the pin commit if `git status` shows the pin already matches.

3. **Push the outer `main`**, when asked.

**`UU src/games/fps` during the outer merge** means the branch and `main` pin
different fps commits. Resolve it by checking out the fps `main` tip inside the
submodule, `git add src/games/fps`, and continuing the merge. When main's pin
is an ancestor of the branch's pin, the merge is clean.

Verify after each repository: `git log --oneline -3` and `git status --short`.
The outer `git submodule status` should show the fps `main` commit with no
leading `+`.

## Publishing media

`public/data` is not in Git. Production keeps it at `/srv/washoi/assets/data` on
each region (EU `root@washoi.net`, US `root@us.washoi.net`), and deployment never
writes there. If the cycle rebuilt anything in `public/data` (a pk3 from
`tools:weapon-models`, `tools:map-media` or another packager, or `ktx2cache/`
from `tools:textures`), the release has to upload it. Code that expects new
media breaks without it: a renamed model path, for example, loads nothing until
its package arrives. Production is outward-facing: upload only when the user
asks for this release to be published.

The served copy is not `assets/data` itself. Each deploy builds from it and
copies the build's `data/` into the web root (`releases/game/data`) without
deleting anything, skipping `demos/` and `washoi_textures.pk3`. The build also
regenerates `pk3_index.json` from it. So media uploaded to `assets/data` goes
live together with the code of the next deploy, and the order is:

1. **Find what changed.** Compare checksums of the local and production files:

   ```bash
   cd /c/Users/sundf/Desktop/wash/shag/public/data && sha256sum *.pk3
   ssh root@washoi.net 'cd /srv/washoi/assets/data && sha256sum *.pk3'
   ssh root@us.washoi.net 'cd /srv/washoi/assets/data && sha256sum *.pk3'
   ```

   Upload only packages whose checksum differs, and `ktx2cache/` only when it
   was regenerated. Never upload `pk3_index.json` or `pk3_manifest.json` (the
   build makes them), demos, or `washoi_textures.pk3` (the master source bank,
   which is never served).
2. **Back up what you replace,** on each host, into
   `/srv/washoi/backups/media-v<version>/`.
3. **Upload** into `/srv/washoi/assets/data` on both hosts. Copy to a temporary
   name and rename it into place, so a deploy never reads a half-written file;
   keep the existing files' owner and mode (check with `ls -l` first). Do not
   use `--delete`.
   A package that was renamed or retired is the one deletion: move its old
   name out of `assets/data` into the backup, or the server's regenerated index
   keeps listing it. The web root keeps its stale copy, which nothing requests.
4. **Then push** fps `main` and outer `main` (see the merge steps). The deploy
   timers build and activate the pair with the new media.
5. **Verify** on both regions after activation:
   - a `HEAD` request for each changed file (`https://eu.washoi.net/data/<file>`,
     `https://us.washoi.net/data/<file>`) returns 200 with the new
     `Content-Length`;
   - a map loads, and every weapon shows its model.

Report which files went to which host, and where the backups are.

## The living changelog

Each cycle keeps `docs/changelog/v<version>.md` (the version in
`src/engine/version.txt`, now `v1.0.0-alpha.md`), opening with
`**Release Date:** unreleased — living changelog`. Entries are written for a
player or developer reading later: what changed and what was wrong before, not
which files moved. When merging a branch mid-cycle, mark its entries
*(merged to main)* if the file uses those markers.

## Cutting a release

Only when the user asks to release:

Versions are semver (see "Versions" in `docs/reference/agent-reference.md`). The *next* version of a
pre-release is the next pre-release number (`1.0.0-alpha` → `1.0.0-alpha.2`)
unless the user names the next stage (`1.0.0-beta`, `1.0.0-rc.1`, `1.0.0`);
after 1.0.0 it is the next patch (`1.0.1`). Below, `<version>` is the one being
released and `<next>` the one after it.

1. Finalize the date in `docs/changelog/v<version>.md`: replace the unreleased
   line with the date, and drop any trailing unreleased marker. Give its row in
   `docs/changelog/index.md` the date and a one-line summary.
2. Verify `src/engine/version.txt`, `package.json` and both root version fields
   in `package-lock.json` still equal `<version>`. Keep them at the released
   version so the tagged and deployed build reports the correct version.
3. Create only the next cycle's stub, `docs/changelog/v<next>.md`, with the
   unreleased line, and add its row to `docs/changelog/index.md`.
4. Commit: `chore: release v<version>`.
5. Tag that commit, annotated: `git tag -a v<version> -m "v<version>"`.
6. Push, when asked: `git push origin main && git push origin v<version>`.

Tags are annotated, sit on the release commit, and are made in the outer repo
only. Tag every release; older untagged releases are not backfilled.

## Beginning the next release cycle

When work begins on `<next>`, bump `src/engine/version.txt`, `package.json` and
both root version fields in `package-lock.json` in the **outer repo only** to
`<next>`. Use the prepared changelog stub for that cycle. Commit the bump as
`chore: begin v<next> development`. Creating the stub during a release does not
start the next cycle or authorize publishing its version in that release.

## Report

Say which commits landed on each destination branch, the fps pin, the tag if
any, and whether anything was pushed. If you stopped before pushing, say so plainly.
