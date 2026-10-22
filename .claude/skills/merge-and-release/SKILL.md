---
name: merge-and-release
description: Merge a SHAG feature branch to main and cut a release across both repositories (the outer engine and the src/games/fps submodule) - fps-first merge order, re-pinning the submodule, the living changelog, the version bump, and the annotated tag. Use this whenever the user asks to merge a branch, "merge and push", re-pin fps, finish or close a cycle, tag or cut a release, bump the version, or start the next cycle's changelog, even if they only say "merge our branch".
---

# Merging and releasing SHAG

SHAG is two Git repositories that move together: the outer engine at the
repository root and the FPS game in `src/games/fps`, a submodule. The outer
repository records which fps commit it uses (its "pin"). Every step below exists
to keep that pin pointing at a commit that is on fps `main` and pushed. An outer
commit that pins an unpushed or unmerged fps commit breaks every fresh clone.

Only push when the user asked for it. Merging locally is fine to do on request;
pushing publishes it.

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

## Merge: always fps first

1. **fps:** commit, then merge the feature branch into fps `main`:

   ```bash
   cd /c/Users/sundf/Desktop/wash/shag/src/games/fps
   git checkout main && git merge --no-edit <branch>
   git push origin main            # only when asked to push
   ```

2. **Outer:** merge the feature branch into outer `main`, then re-pin fps at its
   merged `main` tip and commit that:

   ```bash
   cd /c/Users/sundf/Desktop/wash/shag
   git checkout main && git merge --no-edit <branch>
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

## The living changelog

Each cycle keeps `docs/changelog/v<version>.md` (the version in
`src/engine/version.txt`, now `v1.0.0-alpha.md`), opening with
`**Release Date:** unreleased — living changelog`. Entries are written for a
player or developer reading later: what changed and what was wrong before, not
which files moved. When merging a branch mid-cycle, mark its entries
*(merged to main)* if the file uses those markers.

## Cutting a release

Only when the user asks to release:

Versions are semver (see "Versions" in `AGENTS.md`). The *next* version of a
pre-release is the next pre-release number (`1.0.0-alpha` → `1.0.0-alpha.2`)
unless the user names the next stage (`1.0.0-beta`, `1.0.0-rc.1`, `1.0.0`);
after 1.0.0 it is the next patch (`1.0.1`). Below, `<version>` is the one being
released and `<next>` the one after it.

1. Finalize the date in `docs/changelog/v<version>.md`: replace the unreleased
   line with the date, and drop any trailing unreleased marker. Give its row in
   `docs/changelog/index.md` the date and a one-line summary.
2. Bump `src/engine/version.txt` and `package.json` (and the two version fields
   at the top of `package-lock.json`) in the **outer repo only** to `<next>`.
3. Commit: `chore: release v<version>, bump version to v<next>`.
4. Tag that commit, annotated: `git tag -a v<version> -m "v<version>"`.
5. Push, when asked: `git push origin main && git push origin v<version>`.
6. Start the next cycle's stub, `docs/changelog/v<next>.md`, with the
   unreleased line, and add its row to `docs/changelog/index.md`.

Because the release and the bump are one commit, `version.txt` at the tag
already reads the next version. That is intended. Tags are annotated, sit on
the release commit, and are made in the outer repo only. Tag every release;
older untagged releases are not backfilled.

## Report

Say which commits landed on each `main`, the fps pin, the tag if any, and
whether anything was pushed. If you stopped before pushing, say so plainly.
