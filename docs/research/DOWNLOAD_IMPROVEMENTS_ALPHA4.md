# Download and loading improvements

Branch in both repositories: `v1.0.0-alpha.4-download-improvements`.

QA round 1 identified and fixed a same-key cancellation/reacquisition race and
cache eviction overcounting. Both have public-API regression tests that failed
before the fixes. See [the QA review and resolution](DOWNLOAD_QA_REVIEW_ALPHA4.md)
for reproduction details and validation results.

## Download popup polish

The popup reuses the settings popup's card, cut corner, heading, close button,
footer and raised action-key styles. Package rows use matching cream keys with
violet stripes. It clears its footer button by 16 pixels on desktop and
12 pixels at a 390-pixel viewport. The footer button inherits the neighboring
buttons' 13px font and 16px horizontal padding. A bold heading and package list
show the preparation set, including completed packages reused from cache.
The pause checkbox sits at the bottom left and Retry at the bottom right.
Outside pointer presses dismiss it; controls inside keep it open. The document
listener is removed when the indicator is destroyed.

Headless Edge verified desktop and mobile geometry, the package list, matching
button dimensions, and checkbox pause/resume against the real shared store.
Both viewports stayed within the screen; console and HTTP failure lists were
empty. Screenshots and measurements are in ignored
`.cache/download-dialog-{desktop,mobile}-final.png` and
`.cache/download-dialog-final-results.json`. Preparation tests cover completed
package reporting and removal of the previous map's package entries.

Changed files for this polish:

- `src/games/fps/client/LobbyAssetPreparation.ts`
- `src/games/fps/client/LobbyDownloadIndicator.ts`
- `src/games/fps/client/styles/LobbyPanel.css`
- `src/games/fps/client/__tests__/LobbyAssetPreparation.test.ts`
- `src/games/fps/client/__tests__/LobbyDownloadIndicator.test.ts`
- `src/games/fps/docs/manual/player/screens.md`
- `docs/changelog/v1.0.0-alpha.4.md`
- `docs/research/DOWNLOAD_IMPROVEMENTS_ALPHA4.md`

Validation: `npx.cmd vitest run src/games/fps/client/__tests__/LobbyAssetPreparation.test.ts`
passed all three tests. `npm.cmd run typecheck`, `npm.cmd run gate:biome`,
`npm.cmd run docs:build` and `npm.cmd --prefix src/games/fps run docs:build`
passed. `npm.cmd run build` also passed. The latest `npm.cmd run test:run`
reported 725 passing files and one failing file: 5,664 tests passed, one skipped,
and one failed. The failure was the existing Firefox/WebGL material-ownership
case in `RemoteWeaponLeak.test.ts:100`, waiting for both remote weapon roots.
Neither that test nor its renderer implementation changed in this polish.
`npx.cmd vitest run src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts src/games/fps/client/__tests__/LobbyDownloadIndicator.test.ts`
then passed all seven tests (the previously failing case completed in 350 ms).
This suggests a timing-sensitive test under load; it does not turn the full
suite run into a pass. No unrelated renderer or timeout changes were made.
The focused preparation/dismissal run also passed all four tests:
`npx.cmd vitest run src/games/fps/client/__tests__/LobbyDownloadIndicator.test.ts src/games/fps/client/__tests__/LobbyAssetPreparation.test.ts`.
Browser command: `node .cache/download-dialog-final.mjs`; geometry and control
assertions completed successfully. The follow-up also verified outside presses
and the close button, and exited successfully. An initial shared-style integration made Retry inherit a
full-width rule; the browser assertion caught it and a scoped width override
fixed it. One Edge launch failed to open its debugging port; the next launch
completed the checks. The Biome gate initially reported one new error; after
formatting checks and a zero-error source scan, the final gate passed at the
unchanged baseline (0 errors, 47 warnings).

Assumption: Ready means the package was acquired successfully for this
preparation set; it does not promise permanent browser storage. No match join
or production rollout was performed for the UI polish.

## Confirmed production incident, 2026-10-24

US match `m_mvmu7qsr_1fjq` started at approximately 20:14:28 UTC.
At 20:16:33 UTC the game server logged:

> Auto-shutdown: nobody has been playing, only watching

It disconnected the human spectator and bots, then exited normally (code 0).
The lobby retained PID 14603 and reported zero systemd restarts. This match
closure was the application's idle policy, not an update restarting the lobby.

The user's screenshot shows reconnect attempts failing, followed by the
20-second resume deadline, a backgrounded-loading notice, and an unreleased
`fps:postload` hold timing out. The frozen bot/spectator view is consistent with
the connection having ended. Download duration and the contribution of browser
backgrounding have not been measured; neither should be asserted as the sole
cause of the long load.

## Source evidence

- `src/games/fps/server/GameServer.ts`: `NO_PLAYERS_SHUTDOWN_MS` is two minutes.
  `checkNoPlayers()` counts active human players and suspended human seats;
  an initially connected human spectator does not count as playing.
- `src/games/fps/client/MatchMapLoader.ts`: the lobby auto-join request happens
  after map setup and held-weapon preloading. A loading human therefore remains
  a spectator during that work.
- `src/engine/network/client/hosts/NetworkGameHost.ts`: exhausted resume attempts
  log that the seat is gone and tell the user to disconnect through the menu.
  This message alone does not establish why the original connection ended.
- `src/games/fps/server/Client.ts`: admission state already distinguishes a
  lobby-issued playing seat from an ordinary spectator connection.

## Proposed implementation order

1. Protect an admitted player finishing the initial load from spectator-only
   cleanup. Keep a finite allowance and preserve cleanup for abandoned clients,
   intentional spectators, empty servers and post-game servers. Decide whether
   explicit loading completion/progress messages are needed before changing
   protocol; do not treat periodic socket activity as download progress.
2. Add server regression coverage for a connected loading human taking longer
   than two minutes, completion, abandonment, and spectator-only cleanup.
3. Make terminal disconnection during loading visible and cancel remaining
   match startup work so the client cannot reveal an apparently playable frozen
   match. Verify loading holds and audio suppression are released on failure.
4. Measure a cold-cache US load: asset URLs, bytes, download times, retries,
   caching and decompression/model/shader time. Optimize the measured bottleneck.
5. Validate headlessly before a cold-cache browser test; run networking and
   renderer regression sets for the corresponding changes. Deploy separately
   after validation.

## Status

Implemented for alpha 4. Validation evidence is recorded below. Production
rollout is separate from the local release and has not been performed here.

Release validation on October 25, 2026 reran the entire unit suite without
concurrent builds or browser probes: 727 files passed, 5,671 tests passed and
one skipped. The earlier remote-weapon timing failure did not recur. This is a
separate complete run; the failed run below remains recorded.

## Shared download service proposal

User preference: automatically prepare common assets and the selected room map.
Do not automatically fetch every released map. Put a compact download indicator
on the Play page's existing version/Devlog/Credits/help row.

### Existing behavior verified in source

- `PK3Loader.ensurePK3FromUrl()` shares pending work by resolved URL, including
  the query string, and reuses mounted sources. Explicit `loadPK3*` calls reload.
- `PackageDownload` tracks active transfers independently of UI instances.
  `PackageDownloadStatus` displays these on loading screens; its destruction
  stops its own polling, not the underlying transfer.
- `waitForMapAsset()` can stop a map consumer waiting without cancelling shared
  asset work. Preserve this separation.
- A package download also parses and mounts its archive. Mounting rebuilds
  global filesystem lookup indexes. Map companion banks have scope-sensitive
  texture/shader ownership, so indiscriminately mounting future map banks in
  the background is unsafe.
- `prepareMapTextureBank()` builds dynamic shared-package URLs with `pk3v`
  derived from index `lastUpdated`. A new cache must preserve freshness and use
  the same identity in background and foreground requests.
- `preloadFPSWeapons()` needs a scene and camera and prepares projectile assets.
  Downloading its packages does not establish GPU readiness.

### Ownership and responsibilities

Proposed names below describe responsibilities, not existing APIs.

1. Engine `PackageStore`: application-lifetime package acquisition, one pending
   job per canonical origin/path/content revision, byte progress, finite retries,
   cache lookup, integrity checks, and bounded storage. Store downloaded archives
   independently of the active filesystem. PK3Loader remains responsible for
   mounting and precedence. A scene or panel must not own this store.
2. Engine scheduler around acquisition: foreground/background demand and a small
   concurrency limit. A foreground request promotes the existing job. An active
   HTTP body cannot be magically reprioritized; stop starting optional work and
   reserve capacity for required work. Start with one background transfer and
   at most two active transfers overall, then measure.
3. Game `LobbyAssetPreparation`: chooses common package requirements from the
   game's asset definitions and the selected map. SHAG must not contain Washoi
   package names. Remove stale queued map requests when room selection changes.
4. Shared dependency planning: map dependency discovery must be reusable without
   constructing a scene or changing map scope. The published index does not
   provide a complete ready-made map dependency graph: companion manifests,
   shaders, overrides and game models need accounting. Extract the resolver or
   publish its dependency result; do not duplicate partial lists in lobby UI.
5. UI subscribers: the Play indicator and connection overlay read the same job
   state. Neither starts its own fetch or clears global transfer state on hide.

### Join, cancellation and failure rules

- Joining requests the current match's requirements at foreground priority and
  attaches to any matching pending work at its existing byte position. Downloads
  finish once, and only the active map's packages are mounted into its scope.
- Panel destruction only unsubscribes. A match cancellation releases its demand,
  not another consumer's demand. Removing a queued job is safe when no consumers
  need it; aborting an active request is allowed only when no consumers remain.
- Pause suspends optional queued work. It must not stop assets required to join.
  For version one, finish an already active optional archive rather than promise
  resumable HTTP transfers that do not exist.
- Background failure produces a quiet retry state, never blocks lobby use and
  does not retry forever. Joining can request another bounded attempt. Required
  failure offers Retry or Back to lobby, with startup work cancelled and loading
  holds/audio released. It must not reveal a frozen match as playable.
- Preloading cannot substitute for fixing server loading admission and timeout
  behavior. A cold-cache first visit must work even with zero lobby wait time.

### Compact indicator

Examples: `↓ Preparing assets · 24 / 86 MB`, `↓ Selected map · 48%`,
`✓ Downloads ready`, `Downloads paused`, `Download interrupted · Retry`.
Unknown totals use received bytes and an indeterminate indicator. A small
expandable details panel can show packages, transfer speed and pause/retry.
Keep status available without hover and avoid announcing every byte update to
screen readers. "Downloads ready" only means the selected preparation set is
cached, not that map geometry, models and shaders are ready to render. The
connection overlay retains separate Downloading and Preparing stages.

### Repeated-download investigation and persistent cache

The user reports apparent downloads on every connection. Source inspection
establishes in-memory reuse; it does not establish the cause of this report.
On 2026-10-24 at 20:27 UTC, public US HEAD checks returned:

- `washoi_weapons.pk3`: 85,923,291 bytes.
- `tex_washoi_dm11.pk3`: 48,548,353 bytes.
- Both packages: `Cache-Control: public, max-age=3600, must-revalidate`, ETag and
  Last-Modified. `pk3_index.json` also had validators and that cache policy.

These headers allow HTTP caching, but do not prove a browser stores these large
responses. No browser network trace has yet established repeated body transfers.
Separate real network bytes, cache reads, ZIP parsing, model decoding and shader
compilation in the measurements. Also test with DevTools cache disabling off.

Proposed reliable reuse across page reloads: an origin-scoped persistent package
cache (Cache Storage, accessed explicitly by PackageStore; no service worker
needed). Cache only completed validated archives, retain a bounded in-memory
working set, and evict old unused persistent entries under a storage budget.
Quota, eviction or denied storage must fall back to ordinary downloading.
Different page origins do not automatically share this cache, even if their
packages came from the same mirror.

Before persisting archives, define stable content identity. Prefer per-package
content hashes produced by the existing media-index build, unchanged by a
code-only release. Do not use wall-clock timestamps as package content versions.
Keep old published metadata compatible via HTTP validation rather than trusting
an unversioned persistent entry indefinitely. Mirror lookup and origin fallback
must retain identical content identity. Bytes in this cache must not change
filesystem scope until requested by the active map.

### Implementation and acceptance sequence

1. Measure repeated same-map joins in one page, a full page reload, and a second
   origin; log actual request source and network/cache/preparation durations.
2. Fix initial-load timeout and terminal connection failure independently.
3. Implement shared acquisition and content identity/cache; migrate ordinary
   foreground mounting through it, retaining existing ordering and reload tests.
4. Add background common/map planning, priority promotion and the Play indicator.
5. Verify one HTTP body across lobby-to-join, reuse after reload, changed-package
   invalidation, map switches, cancellation with two consumers, corrupt/cache
   failures, quota denial, slow first joins and disconnected startup cleanup.
6. Run the required headless gates/regressions, then test real cold/warm browser
   loads and interrupted transfers before a separately authorized rollout.

The proposal above records the intended behavior. Implementation choices and
verified limits follow.


## Implementation and validation receipt

Implemented locally, unreleased. Both repositories remain on
`v1.0.0-alpha.4-download-improvements`; no commits or pushes were made.

- Application-owned PackageStore shares acquisition, promotes queued required
  work, permits two active jobs with at most one optional job, and suspends new
  optional jobs during foreground map preparation. Existing optional bodies
  finish. Map selection changes drop obsolete queued background work; a promoted
  foreground consumer is retained.
- Download-only preparation does not mount map texture banks. Game-owned common
  packages are prepared first, followed by the chosen map archive/companion and
  shared packages declared by its media manifest. The ordinary map loader still
  resolves any additional assets. The indicator does not promise that every
  custom-map dependency or GPU resource is ready.
- Optional work respects browser Save-Data, and offers pause/resume/retry. UI
  destruction only removes UI polling. Completed packages with SHA-256 metadata
  use origin-scoped Cache Storage (512 MiB budget), with a parsed working-set
  budget of 128 MiB. Hashes are stable across code-only builds. Missing hashes
  keep legacy HTTP behavior; unavailable storage falls back to HTTP. There is
  no partial HTTP range-resume implementation.
- Admitted humans receive 15 minutes for initial loading; explicit play/spectate
  ends the allowance. Existing spectator cleanup then applies. No network wire
  format change was needed. Terminal resume failure cancels setup and displays
  a return-to-lobby action. Loading holds/audio are released on cancellation.

### Checks

- `npm run typecheck`: pass.
- `npm run test:run`: 725 files pass, 5,661 tests pass, one skipped. The first full
  run found seven failures in the PVS test fixture's old explicit-reload mock;
  the fixture now mocks ordinary ensure acquisition. The full suite then passed.
- `npm run gate:biome`: pass, zero errors and the existing 47 warnings.
- `npm run build`: pass; generates per-package hashes with the media index.
- `npm --prefix src/games/fps run test:simulation`: pass.
- `npm --prefix src/games/fps run test:physics`: pass, existing position warning.
- `npm --prefix src/games/fps run server:tick`: pass.
- `npm --prefix src/games/fps run server:fuzz -- --ticks 1000`: pass.
- `npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"`:
  pass, 7,475 faces.
- `npm run docs:build` and `npm --prefix src/games/fps run docs:build`: pass.
- Focused acquisition/loading/PVS regression run: 15 files, 123 tests pass.

Browser validation used the repository browser-probe procedure with isolated
headless Edge and GPU enabled, on local Vite previews, without starting matches.
The real 85,923,291-byte weapon archive produced one GET when background and
foreground consumers requested it together. After a full page reload, loading
that archive produced zero package requests and reused Cache Storage. Local
acquisition timings were approximately 406 ms cold and 162 ms cached; these are
localhost observations, not US network performance measurements. Browser logs
and failed-response lists were empty on the corrected probe. The first scratch
probe used a nested JSON document with relative asset paths; correcting the
probe's root path fixed its metadata lookup.

Desktop and 390-pixel viewport checks covered the Play-row indicator and expanded
controls. Visual QA caught and corrected a mobile popover anchoring issue. Raw
results/screenshots and command logs live under ignored `.cache/download-*`.

### Remaining verification limits

The new code has not been deployed to EU or US. A real throttled cold-cache
remote lobby-to-match join, with bots and a backgrounded tab, remains a release
smoke test. The accelerated server tests cover the loading allowance and its
expiry; no 15-minute wall-clock production experiment was performed. Persistent
cache eviction/denial can cause future downloads; different website origins
retain separate caches. Model decoding and GPU compilation still occur at join.
The earlier user's repeated-transfer cause was not reconstructed from their
browser network trace, so it is not asserted as proven.

### Exact changed files

- `docs/changelog/v1.0.0-alpha.4.md`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/research/DOWNLOAD_IMPROVEMENTS_ALPHA4.md`
- `src/cli/pk3-index-build.ts`
- `src/engine/__tests__/NetworkGameHostWatchdog.test.ts`
- `src/engine/loader/bsp/__tests__/PVSCuller.test.ts`
- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/pk3/PK3PublishedIndex.ts`
- `src/engine/loader/pk3/PackageStore.ts`
- `src/engine/loader/pk3/Pk3Mirror.ts`
- `src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts`
- `src/engine/loader/pk3/__tests__/PackageStore.test.ts`
- `src/engine/loader/pk3/__tests__/Pk3Mirror.test.ts`
- `src/engine/network/client/hosts/NetworkGameHost.ts`
- `src/engine/ui/MapLoadingOverlay.ts`
- `src/engine/ui/components/MatchLobbyView.ts`
- `src/games/fps/Game.ts`
- `src/games/fps/client/LobbyAssetPreparation.ts`
- `src/games/fps/client/LobbyDownloadIndicator.ts`
- `src/games/fps/client/LobbyPanel.ts`
- `src/games/fps/client/MatchConnectionFailure.ts`
- `src/games/fps/client/MatchMapLoader.ts`
- `src/games/fps/client/__tests__/LobbyAssetPreparation.test.ts`
- `src/games/fps/client/__tests__/MatchMapLoader.test.ts`
- `src/games/fps/client/styles/LobbyPanel.css`
- `src/games/fps/docs/manual/developer/server-commands.md`
- `src/games/fps/docs/manual/player/screens.md`
- `src/games/fps/server/Client.ts`
- `src/games/fps/server/GameServer.ts`
- `src/games/fps/server/__tests__/AutoShutdown.test.ts`
