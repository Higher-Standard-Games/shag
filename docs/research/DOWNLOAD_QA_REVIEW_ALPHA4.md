# Download improvements: QA review round 1

Date: 2026-10-25 (Europe/Helsinki).
Scope: uncommitted download-improvement changes in the engine and FPS feature
branches. This round reviewed source and ran focused headless checks. No
application code, production files, services, assets or Git history were changed.

Original verdict: hold merge for two confirmed PackageStore defects. Both are
now fixed locally; validation results are recorded in the resolution below.

## P1: cancelling and reacquiring a package can strand the replacement request

Location: `src/engine/loader/pk3/PackageStore.ts`, `runQueued`, lines 133-149.

`dropQueuedBackground()` removes a queued job and wakes its coroutine so it can
return. However, `runQueued()` checks only whether the key exists after waking,
not whether that key still belongs to its own job. A replacement job can occupy
the same key before the cancelled coroutine resumes. The cancelled coroutine
then performs acquisition and deletes the replacement job in its `finally`.
It also decrements slot counters for a slot it never acquired.

Reproduction, using fake HTTP and the public store API:

1. Occupy both foreground slots with two deferred responses.
2. Pause optional work and enqueue a background request for `retry.pk3`.
3. Drop queued background work and synchronously acquire `retry.pk3` again at
   foreground priority, before the cancelled coroutine resumes.
4. Allow the cancelled coroutine to run, then finish both original responses.

Observed: a third HTTP request started while both slots were occupied. The new
foreground promise remained pending after both original jobs finished, although
`pendingCount` was zero. This can strand a loading screen waiting for required
assets; merely resuming the queue does not restore the deleted replacement.

Fix direction: compare job identity (`jobs.get(key) === job`) after waking and
before deleting a map entry; slot accounting must apply only to jobs that
actually acquired a slot. Add a regression that cancels and reacquires the
**same key in the same turn under saturated concurrency**. The existing test
waits for cancellation and uses different keys, so it cannot catch this race.

## P2: eviction continues counting bytes it already removed

Location: `src/engine/loader/pk3/PackageStore.ts`, `persist`, lines 209-214.

The loop adds each stored entry to `total`, then deletes it if that exceeds the
budget. Deleted entries remain in `total`, so every older entry is also deleted
once the first oversized combination occurs, even if those entries would fit.

Reproduction used fake cache entries with valid declared sizes: an older 10 MiB
package and a newer 500 MiB package, then a 20 MiB incoming package. After
dropping the 500 MiB entry, the old 10 MiB package and new 20 MiB package fit
comfortably within 512 MiB. Actual result: both existing entries were removed;
only the new package remained.

Impact: near the budget, an update can discard unrelated reusable packages and
bring back the repeated downloads this feature is intended to prevent.

Fix direction: count retained entries only (or subtract an evicted entry's size)
and add a test verifying that smaller older entries survive when they still fit.

## Verification this round

- `node node_modules/vite-node/vite-node.mjs .cache/download-qa-probe.ts`
  reproduced both defects using fake HTTP and fake Cache Storage. The scratch
  probe prints observations; its exit code is not a passing correctness gate.
- `npx vitest run src/engine/loader/pk3/__tests__/PackageStore.test.ts src/games/fps/client/__tests__/LobbyAssetPreparation.test.ts src/games/fps/client/__tests__/MatchMapLoader.test.ts src/engine/__tests__/NetworkGameHostWatchdog.test.ts src/games/fps/server/__tests__/AutoShutdown.test.ts`
  passed: five files, 35 tests. These passing tests omit the two cases above.

The previously recorded full-suite/build/manual results are not a substitute
for regressions covering these defects. Full gates were not repeated for this
review-only round. Browser/remote throttling tests were not run this round.

Changes made during the original review: this report and the ignored scratch
reproduction script only. At that point the findings had not been fixed.

## Resolution

Both findings were reproduced by new public-API regression tests before the
implementation was changed: two tests failed and the original six passed.
`runQueued` now checks job identity after waking and before removing the job,
so a cancelled coroutine cannot run or remove its replacement. Cache eviction
now adds only retained entries to the running byte total.

The two new tests cover same-turn cancellation/reacquisition with both transfer
slots occupied, replacement completion and queue cleanup, and retention of a
small older cache entry after a large newer entry is evicted. All eight store
tests pass after the fixes.

Assumptions: the fixes preserve the existing two-transfer concurrency limit and
512 MiB cache budget. HTTP and Cache Storage in the new tests are controlled
fakes; existing published package sizes supply the eviction accounting.

Exact files changed for this fix round:

- `src/engine/loader/pk3/PackageStore.ts`
- `src/engine/loader/pk3/__tests__/PackageStore.test.ts`
- `docs/changelog/v1.0.0-alpha.4.md`
- `docs/research/DOWNLOAD_IMPROVEMENTS_ALPHA4.md`
- `docs/research/DOWNLOAD_QA_REVIEW_ALPHA4.md`

Validation commands (from the outer root; PowerShell uses `npm.cmd`):

| Command | Result |
| --- | --- |
| `npx.cmd vitest run src/engine/loader/pk3/__tests__/PackageStore.test.ts` | Pass: 8 tests; before fixes, the 2 new tests failed |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run gate:biome` | Pass: baseline 0 errors, 47 warnings |
| `npm.cmd run build` | Pass |
| `npm.cmd run test:run` | Pass: 725 files, 5,663 tests passed, 1 skipped |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Pass: 7,475 faces |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run docs:build` | Pass |
| `git diff --check` and `git -C src/games/fps diff --check` | Pass |

The initial post-fix focused-test attempt was blocked at startup by an esbuild
`spawn EPERM` sandbox error; rerunning with subprocess permission passed.
Checks logged through `.cache/download-checks.mjs` record subprocess exit codes
directly. No browser testing was repeated for these two algorithm fixes.
Remote throttled lobby-to-match testing remains unverified. This receipt records
the local pre-release checks; production rollout is a separate step.
