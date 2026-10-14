---
name: shared-worktree
description: Safe git and commit practice in the SHAG checkout, which is two repositories (outer engine + the src/games/fps submodule) often edited by several agents at once. Use this before any git add, commit, stash, reset, checkout or branch switch in this repository, whenever another agent's work may be uncommitted in the tree, when the user says "commit your work" or "commit the other agent's work", and when git status shows files you did not edit.
---

# Working in a shared SHAG tree

Several agents often work in this checkout at the same time, and the checkout
is two repositories. Most git accidents here come from two things: a command
running in the wrong repository, and a commit sweeping up someone else's
unfinished files.

## Know which repository you are in

The shell's working directory persists between commands. After a `cd
src/games/fps`, the next "outer" git command silently runs in the submodule.
Start every git command with an absolute `cd`:

```bash
cd /c/Users/sundf/Desktop/wash/shag && git status --short            # outer
cd /c/Users/sundf/Desktop/wash/shag/src/games/fps && git status --short   # fps
```

The root is the directory holding `AGENTS.md`. Note that the project slug
`c--Users-sundf-Desktop-wash-shag` maps to `wash/shag`, two directories, not
`wash-shag`.

In the outer repo, `m src/games/fps` means the submodule has uncommitted
changes; `M src/games/fps` means its checked-out commit differs from the pin.

## Commit only what you mean to

- **Stage explicit paths.** `git add -A` and `git add .` pick up other agents'
  in-progress files. Name the files you changed.
- **Look before committing:** `git diff --cached --stat` should list exactly
  your files.
- **Shared files** such as `docs/changelog/v0.9.X.md` can hold another agent's
  uncommitted hunk next to yours. Stage only your hunks (`git add -p`, or a
  patch applied with `git apply --cached`).
- **Commit your own work only**, unless the user asks you to commit another
  agent's. When they do, still review it, run the gates on it, and commit it
  separately with a message describing that work.
- **Leave others' files alone:** don't revert, stash, reformat or "clean up"
  files you did not change, and don't run `git checkout -- .`, `git reset
  --hard`, `git clean` or `git stash` across the tree. If a commit swept in the
  wrong files and is not pushed, undo it with `git reset --soft HEAD~1`, unstage,
  and recommit only yours.
- **Pre-commit hook:** it runs `gate:biome`. If another agent's half-finished
  file makes it fail, unstage nothing of theirs and wait or ask; never bypass
  the hook with `--no-verify`.

## Branches

Both repositories carry the same branch name for a piece of work, created from
`main` in each. Don't switch branches in a tree where another agent has
uncommitted work without checking with the user: their files follow the switch
or block it. Merging and pushing follow the `merge-and-release` skill; push only when
asked.

## After each commit

```bash
git log --oneline -1 && git status --short
```

Confirm the commit is in the repository you intended and that only other
agents' files remain uncommitted. Say in your report which commits you made, in
which repository, and which files you deliberately left uncommitted.
