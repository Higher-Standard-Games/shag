# Ranking matches: public and private

**Status:** Basic ranking implementation through RM-09, gameplay stats, profile history, team mapping fixes and two-player FFA passed 4,545 tests / 532 files, typecheck, Biome, application build and required networking regressions. Localhost Public/Private Duel, Amphi, FFA and short S&D matches, native private bot records, service restart and isolated backup restore checked. Real human bot calibration, deployed browser combat/objective play with normal match lengths and normal release asset packaging remain pending. No production bot strengths are shipped.

## Goal

Two independent rankings, one leaderboard screen:

- **Public** — matches in public lobbies only. The competitive ladder, and the
  default view.
- **Private** — private lobbies only: friends' rooms and matches against bots.
  These matches rank players in the private board, including losses to bots.

A player switches between **Public** and **Private**, left of the gametype
selector. Prefer two labelled keys over an inclusion checkbox: selecting
Private excludes public matches. The selection stays as the player switches
gametype and returns to the screen. Public remains the default.

Bots play only in private lobbies (done earlier in v0.9.28), so public matches
are human-only by construction, and the private flag is what separates the two
rankings.

## Initial alpha release boundary and readiness matrix

### Gameplay stats completion after the ranking foundation commit

The next code slice implements the five concrete gaps identified after the
foundation commits (`04fcd9c` FPS, `47716fe4` engine):

| Gap | Implementation |
| --- | --- |
| Durable gameplay counters | Version-1 per-seat stats: personal score, frags/team frags/deaths, enemy/friendly damage, plants/defuses and active participation ms. Signed result → canonical snapshot → transactional `ranking_stats` projection. Single-match removal retains stats until final reporting. |
| Misleading post-game frags | Reliable standings add actual frags and use whole-match deaths; HUD uses them for post-game chips even before all sim entities disappear. Score remains separately labelled. Older snapshots omit Frags/K/D instead of guessing. |
| Records independent of ratings | Authenticated own-account summary API and Profile totals use recorded results, including pending bot games. Rating/rank are nullable. Missing gameplay coverage is explicit; no fabricated historical zeros. |
| Recent match history | Own-account mode/scope pages in commit-sequence order, with exclusive cursors and a bounded page size. Profile mode keys open recent matches with older/latest navigation. Scope/page sequence guards discard late replies. |
| Rating feedback | History reads saved before/after states and displays their rounded rating difference, including full uncertainty changes. Unrated games show readable stored reasons. No hypothetical recalculation or rating mutation. |

Ranking schema advances to **2** through an additive initialization transaction
from v1. `ranking_stats(sequence, seat_id, stats)` references normalized played
seats and stores canonical versioned stats JSON for extensible counters; SQL
aggregation computes career totals without loading every match into JavaScript.
An account/sequence index supports these reads. Snapshots without stats retain
their original digest and remain stats-unavailable; no result/demo backfill.
Unsupported/partial current schemas fail rather than recreating lost stats.

Totals follow record eligibility rather than skill eligibility. A complete
private bot game with pending calibration adds its verified gameplay totals;
an aborted receipt keeps its captured counters in history but adds no career
record/totals. Scope and mode remain independent. Active time counts occupying
an active roster seat, including a dead S&D player; excludes warmup, freezes,
intermission, spectator and removed time. Native weapon accuracy telemetry only
covers single-ray hitscan today, so it was deliberately not relabelled as
all-weapon accuracy. Assists, weapon breakdowns and analytics graphs are deferred.

Access is through Profile and `stats:get`/`stats:history` on the advertised
`features.playerStats` capability. The lobby derives the account from auth,
bounds/rate-limits requests and never returns admission tickets, keys, raw
snapshots or another account's private rows. New clients validate numeric data,
scope/mode, history ordering and rating deltas; request listeners release on
reply, error, timeout and disconnect. Older lobbies keep the existing Profile
fallback. The subsequent responsive pass below resolves the Profile stage's
former hidden record area below 1100px. Deployed browser acceptance remains open.

Files in this slice (relative to the outer repo; FPS paths are submodule files):

| Area | Exact files |
| --- | --- |
| Canonical stats and result contract | `src/shared/ranking/MatchStats.ts`, `src/engine/server/network/MatchResultReport.ts`, `src/lobby/ResultSnapshot.ts` |
| Persistence and own-account reads | `src/lobby/RatingStore.ts`, `src/lobby/MatchResultStore.ts`, `src/lobby/PlayerStatsStore.ts`, `src/lobby/types.ts`, `src/lobby/LobbyServer.ts`, `src/lobby/LobbyClient.ts` |
| Gameplay lifetime and reliable standings | `src/shared/server/gametype/GametypeTypes.ts`, `src/games/fps/server/gametypes/MatchState.ts`, `src/games/fps/server/GameServer.ts`, `src/games/fps/server/SnapshotBuilder.ts` |
| Profile/history and scoreboard | `src/games/fps/client/LobbyPanel.ts`, `src/games/fps/client/NewUiApi.ts`, `src/games/fps/client/ProfileView.ts`, `src/games/fps/client/RatingFeedback.ts`, `src/games/fps/client/styles/Identity.css`, `src/games/fps/client/HUDState.ts`, `src/games/fps/client/MatchStateManager.ts`, `src/games/fps/client/hud/widgets/Scoreboard.ts` |
| Root tests/fixture | `src/shared/ranking/__tests__/_matchStats.ts`, `src/engine/server/network/__tests__/MatchResultReport.test.ts`, `src/engine/__tests__/DamageHitLocation.test.ts`, `src/lobby/__tests__/RatingStore.test.ts`, `src/lobby/__tests__/ResultSnapshot.test.ts`, `src/lobby/__tests__/LobbyClientConnection.test.ts`, `src/lobby/__tests__/PlayerStatsStore.test.ts`, `src/lobby/__tests__/LobbyBotPreparation.test.ts` |
| FPS tests | `src/games/fps/server/gametypes/__tests__/MatchStats.test.ts`, `src/games/fps/server/__tests__/PlayedMatchResult.test.ts`, `src/games/fps/server/__tests__/SnapshotGolden.test.ts`, `src/games/fps/client/__tests__/ScoreboardPostGame.test.ts`, `src/games/fps/client/__tests__/ProfileGameplayStats.test.ts` |
| Documentation | `docs/research/ranking_matches.md`, `docs/manual/guides/lobby-server.md`, `docs/changelog/v0.9.28.md` |

The combined focused run passed **113 tests / 10 files**. The reviewed snapshot,
round lifecycle and scoreboard cases passed **44 tests / 4 files**. Added
coverage checks atomic rollback/duplicate ingestion, schema-1 additive upgrade,
partial-schema refusal, missing-stat coverage, private pending records, own-account
authorization, cursor stability with new arrivals, replay divergence and late
scope replies. Updated the golden snapshot only for the intended two `frags: 0`
fields in reliable standings. Full validation also caught a live roster regression:
live reliable standings must retain the round death counter for change/ACK tracking;
only PostGame uses the whole-match death total. Corrected that branch and checked
the required enum import. The affected snapshot/protocol and previously failing
cases passed **60 tests / 11 files** on focused recheck.

Two initial complete runs exposed timer failures that isolated runs did not.
An ignored one-test reproduction confirmed that a spy on **fake** global
`setTimeout` can be restored again by a later `vi.restoreAllMocks()`, reinstalling
the stopped fake clock after real timers were restored. Replaced that spy in
`LobbyBotPreparation.test.ts` with a scoped wrapper restored before uninstalling
fake timers, and asserted repeated mock restoration leaves the native timer
unchanged. Kept the real control socket and the 75-second non-extending deadline
checks. The timer/async/remote-weapon recheck passed **19 tests / 4 files**; no
timeouts or lint baselines were increased. Froze the clock only in the existing
damage-event byte-comparison fixture, whose header includes a timestamp.
Final validation for this gameplay-stats continuation (2026-10-12):

| Check | Result |
| --- | --- |
| Full repository suite | **4,522 tests / 530 files passed**, 216.53 seconds. |
| Typecheck | Passed. |
| Biome gate | Passed: 0 errors, 322 warnings against the existing 0/339 baseline. |
| Application build and postbuild | Passed; Vite built in 1m 4s, 49 source maps relocated. |
| Simulation and physics probes | Both exited 0. Physics retains the existing wdm7 lightgrid-count mismatch and StepSlideMove position warning; this is not evidence that those warnings are resolved. |
| Server tick determinism | Passed; final checksum `2768943778`. |
| 1,000-tick fuzz | Zero errors, deterministic checksum `2620815328`; seed `1791801344196`. |
| Headless map and movement | wdm2 loaded through the PK3 index; scripted movement replay completed 91 ticks. |
| Whitespace checks | Passed in both repositories. |

Exact final commands, run from the outer repository using PowerShell:

```powershell
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
git diff --check
git -C src/games/fps diff --check
```

Logs are local ignored `.cache/stats-full-tests-clean.log`,
`.cache/stats-final-{typecheck,biome}.log`, `.cache/stats-build.log`, and
`.cache/stats-{simulation,physics,tick,fuzz,bsp,replay}.log`. The build uses
the existing local config with a linked public-assets view that excludes large
local profiling archives; application compilation/bundling and postbuild ran,
but normal release asset packaging remains unverified.

Assumptions: existing FPS modes Duel, Amphi, FFA and S&D, authenticated lobby
accounts, independent Public/Private pools, and the current signed result
contract. Migration/restart tests used isolated test databases and signed
fixtures. No live service was restarted, no actual account database was reset
or migrated, and no production bot reference was installed. Browser appearance,
the narrow Profile layout, native AI gameplay and deployed persistence after a
real service restart still require acceptance. These changes remain uncommitted
in the outer repository and FPS submodule.

The release goal is a dependable basic ladder: finish a match, save it once,
update the correct rating pool, and show the player an understandable result.
Seasons, matchmaking, badges, elaborate operator dashboards and historical
imports are outside this release. This section is the current assessment;
later work-log sections describe earlier stages and their then-open tasks.

| Area | Current implementation | Minimum remaining for alpha |
| --- | --- | --- |
| Public/private separation | Independent board queries, records, profiles, caches and rating pools. Bots are private-only. | Confirm the deployed browser and lobby use the same build and data directory. |
| Human skill rating | Pinned classic TrueSkill for Duel, Amphi, FFA and S&D; placements/ties, team results and eligible forfeits; provisional after the first eligible match. Localhost account/ticket/result checks passed for Public/Private Duel, Amphi, FFA and short S&D matches. | Real browser combat/objective play with normal match lengths. No further rating algorithm is required. |
| Leaderboards and profiles | Skill order, rating/provisional display, W/L/D, month/all-time views, pagination/local row and explicit unavailable/pending/excluded states. | Browser layout and interaction check; finish real matches and verify persistence after restart. |
| Result authenticity and eligibility | Signed server results tied to authenticated admission/played seats; late joins, side changes, interruptions and aborts cannot silently create eligible skill updates. Localhost disconnect/resume and eligible Duel/Amphi forfeits passed. | Real browser gunplay acceptance; no additional core eligibility code identified. |
| Durable delivery | Private signed outbox, persisted verification context, atomic journal/state/records, duplicate protection and startup/periodic/offline recovery. Live retries use a bounded rotating cursor. | Exercise deployment restart/recovery and database backup/restore in the target environment. |
| Database foundation | Versioned ranking schema, immutable policy/reference identity, complete canonical match snapshots, normalized participants and before/after updates. | No additional core tables are required for the agreed alpha scope; retain a backed-up fresh production directory. |
| Gameplay stats and recent matches | Schema 2, verified per-player counters, own-account summaries/history and committed rating changes. Responsive Profile passes ten headless Edge sizes; real-child public/private FFA cases also verify stats after reopen. | Deployed browser acceptance and real player gunplay; the former narrow-viewport layout gap is resolved. |
| Private human matches | Independent private rating pool; localhost Duel, Amphi, normal FFA and short S&D results persisted through restart without changing Public. | Real browser combat/objective play with normal match lengths, as for Public. |
| Private bot records | Human wins, draws and losses are recorded even before bot strength is available. Native easy-bot private Duel recorded a human loss, deaths and active time with skill pending. | Real human gameplay quality check; no further record-storage code identified. |
| Private bot skill | Fixed-reference solver and exact configuration/model/build bindings implemented. No invented default strengths. Pilot export, draft analysis and explicit reviewed-artifact tooling are available. | **Real human calibration and reference installation for every bot configuration/mode/map advertised as skill-rated.** Until then, records work and skill stays pending. |
| Bot invitation lifecycle | Preparation is bounded at 60 seconds, lobby join at 10; an authenticated progress message grants the requester a 75-second budget once. Cancellation disposes late resources and prevents late authentication. | Cold-load acceptance with the deployed native TensorFlow weights; mocked slow loads do not prove native runtime behavior. |
| Recovery maintenance | Secret-free paginated inspection, cleanup preview and explicit application; unresolved reports and unknown/running contexts survive. | Choose a retention schedule. No archive/restore UI or automatic destructive cleanup is needed for alpha. |
| Automated acceptance | `npm run ranking:acceptance` covers math, journal, delivery, real local lobby/child handoff and UI contracts. Full repository and required server regressions remain the release gates. | Run on the final release build, followed by the small live checklist above. |

Human leaderboards do not depend on completing bot calibration. If alpha promises
skill changes from bot games, calibration is a release requirement, not more
solver implementation. Otherwise explicitly label bot skill pending; do not
claim those games are already skill-rated.

### Responsive Profile and isolated acceptance continuation

The first remaining essential code gap is implemented: `Identity.css` now stacks
the Profile account panel and record stage into one scrollable view at widths up
to 1100px. Profile-specific rules keep the stage visible below 700px, remove the
slanted panel clipping in the stacked layout, and fit the key plate/actions.
Container queries let record rows use two lines when their own sidebar is narrow,
including desktop widths above the stacking breakpoint. History text wraps and
the record padding accommodates raised navigation buttons' offset sides.

The browser connector failed twice during initialization with `failed to write
kernel assets` / OS error 3. An isolated **headless Edge** application check used
the actual `ProfileView`, repository styles/fonts and synthetic records, with no
lobby connection. All ten sizes passed: 1920x1080, 1366x768, 1101x768, 1100x768,
1024x600, 768x600, 700x600, 390x720, 320x568 and 844x390. Every size retained all
four mode controls and ten history rows, supported scrolling, and had no measured
horizontal overflow. Scope switching and older/latest history paging also passed.
Inspected desktop and narrow screenshots; keyboard focus scrolls to record controls.

Headless validation preceded the browser check: **20 tests / 4 files passed**,
plus simulation, physics, indexed wdm2 loading and the 91-tick movement replay.
Typecheck and Biome passed (0 errors / 322 warnings). The first build passed
(55.35s, 49 source maps relocated). A final build rerun exhausted disk space
copying public map assets; an interrupted test edit was restored from its verified
unchanged HEAD version before adding the intended assertions. Only generated
PK3 copies under the resolved workspace `dist/data` directory were removed
(30 files, 213,891,588 bytes); original `public/data` assets were retained.
The retry validates application bundling with `publicDir: false` to avoid
duplicating installed game data; normal release asset packaging is still unverified.

The next acceptance pass extends the existing real-lobby/child-server wdm2 FFA
integration cases: both public human-account and private uncalibrated-bot results
must reopen with stats, positive active time and own-account history; stored rating
feedback must agree with eligibility, and the opposite scope remains empty.
These are scripted clients using isolated accounts, not human calibration evidence.

Exact files changed in this continuation: `src/games/fps/client/styles/Identity.css`,
`src/lobby/integration/RoomToRanking.test.ts`, `docs/changelog/v0.9.28.md`,
`docs/manual/guides/lobby-server.md` and this document. Local fixtures, the browser
script, screenshots and reports remain ignored under `.cache/profile-responsive*`.

```powershell
npm.cmd run test:run -- src/games/fps/client/__tests__/ProfileGameplayStats.test.ts src/games/fps/client/__tests__/ProfileRecord.test.ts src/games/fps/client/__tests__/IdentityFields.test.ts src/engine/ui/__tests__/UIStyles.test.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd run typecheck
npm.cmd run gate:biome
node .cache/profile-responsive-check.mjs
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run build -- --config .cache/profile-build.config.ts
npm.cmd run ranking:acceptance
git diff --check
git -C src/games/fps diff --check
```

Final results: **486 acceptance tests / 51 files passed** in 162.85 seconds,
including the added public/private real-child stats assertions. Typecheck and
Biome passed again after those assertions. Final application build with public
asset copying disabled passed in **52.84 seconds**, with 49 source maps relocated.
Both repository whitespace checks passed. The previous full suite's 4,522-test
result remains recorded above; this CSS/test-only continuation used focused UI
checks and ranking acceptance rather than repeating unrelated full-suite tests.
The physics probes retain their previously documented warnings.

Local evidence: `.cache/profile-responsive-evidence/report.json` and desktop/narrow
PNGs, `.cache/profile-responsive-tests.log`,
`.cache/profile-responsive-{simulation,physics,bsp,replay}.log`,
`.cache/profile-final-{typecheck,biome}.log`,
`.cache/profile-responsive-build-code.log` and
`.cache/profile-ranking-acceptance-final.log`.

Essentials status: responsive Profile implemented and visually checked; isolated
real-result/reopen/delivery checks passed. The remaining deployed-match acceptance
needs the target lobby WebSocket URL. Deployment restart and backup/restore still
need a target-environment rehearsal. Bot skill needs real human calibration and
reviewed reference installation; pending records already work.

Actual user services, complete deployed UI navigation, human gunplay, other browser
engines, native AI behavior and bot rating calibration remain unverified. No
production accounts/results were reset, and no production service was restarted.

### Live localhost acceptance and team mapping correction

Target supplied by the user: `ws://localhost:9000`. The running service advertises
both `features.playerStats` and `features.skillRatings`. Fresh test accounts 100
and 101 were used; their keys are kept only in an ignored private local fixture.
The existing `server-data/players.db` was positively identified by matching the
test accounts' key hashes without printing hashes or keys. No other account was
used to play test matches.

Public and Private Duel checks initially passed: a genuine disconnect/resume
kept the player identity; a subsequent expired 20-second grace produced one
eligible forfeit, win/loss records, gameplay totals and saved rating feedback.
The opposite scope stayed unchanged, and a fresh authenticated lobby connection
read the same summary. Those reports are in `.cache/ranking-live-matches.json`.

Amphi exposed a production mismatch: the unchanged players' forfeit retained
records/stats but was excluded with `team_changed`. The immutable snapshot showed
the starting roster assigned account 100 to Udon and 101 to Soba, while actual
played seats were 100 Soba and 101 Udon. `ResultSnapshot.teamOf` independently
mapped lobby `alpha` to Udon, opposite the shared gameplay normalizer. Duel's
auto-assignment ignored its lobby side and happened to mask the error in the
initial connection order. The first Amphi driver also omitted required kit
selection; corrected that fixture before observing the actual rating exclusion.

Production fixes reuse `normalizeTeamId` for incoming result teams, honor a free
requested Duel side, and keep the two-seat limit/fallback for occupied sides.
Canonical historical snapshots already use Soba/Udon, so replay retains their
stored decisions; previously excluded results are not retroactively rated.
Tests now cover literal lobby aliases in Duel/Amphi/S&D, both Duel connection
orders, full-side fallback, and real-socket Duel/Amphi forfeits carried through
normalization and skill eligibility. **48 tests / 4 files passed** in the targeted
pipeline run. A fixture still expected the old first-seat Udon score; updated
that snapshot-copy assertion to use the correct Soba score. Full gates and a
post-restart live rerun follow below.

Database-only backup/restore rehearsal: SQLite's online backup API captured the
running WAL database, restored into a new isolated `.cache` directory, and passed
`integrity_check`, `foreign_key_check` and read-only rating-journal replay.
At that snapshot it contained the two initial Duel results, four seats/stats rows
and four rating updates; replay reported two applied matches/four ratings.
This copy is not yet a complete operational backup: unresolved delivery files and
the shared bot secret also need preserving together with the database when
rehearsing a full stopped-service restore. The actual service has not been
restored from the copy or reset.

Files in this correction: `src/lobby/ResultSnapshot.ts`,
`src/engine/server/network/__tests__/_resultReport.ts`,
`src/lobby/__tests__/ResultSnapshot.test.ts`,
`src/games/fps/server/gametypes/GametypeController.ts`,
`src/games/fps/server/gametypes/MatchState.ts`,
`src/games/fps/server/gametypes/__tests__/TeamBalanceOnJoin.test.ts`,
`src/games/fps/server/gametypes/__tests__/TeamSpawnStrategy.test.ts`,
`src/games/fps/server/__tests__/PlayedMatchResult.test.ts`, this document,
`docs/manual/guides/lobby-server.md`, and `docs/changelog/v0.9.28.md`.

Final gates for this correction: **4,530 tests / 530 files passed** in **226.47s**;
typecheck passed; Biome passed with **0 errors / 321 warnings** (baseline 0/339);
application build with public copying disabled passed in **48.03s**, relocating
49 source maps. Required networking probes all exited 0: simulation, physics,
server tick, 1,000-tick fuzz, indexed wdm2 load and 91-tick movement replay.
Tick checksum `2768943778`; fuzz checksum `96284469`, seed `1791805135944`.
Existing physics lightgrid/StepSlideMove warnings and the normal release asset
packaging limitation remain. Both repository whitespace checks passed.

Restart rehearsal completed after confirming no other players and no playing
matches (only empty waiting rooms from tests remained). Verified the exact lobby
listener/process, stopped it, copied **the complete existing `server-data/`
directory** including database/WAL/shared secret/delivery files into an ignored
backup, then restarted port 9000 using the same data directory and current source.
No bot-server or unrelated game-server process was stopped. Existing records and
rating replay remained unchanged. Restoring the complete backup into a separate
directory passed read-only journal replay too; actual working storage was never
replaced by a backup. The restarted lobby is left running for the user.

The post-fix live matrix passed all four cases: **Public Duel, Private Duel,
Public Amphi, Private Amphi**. Each used actual lobby authentication, a spawned
dedicated server, ticketed protocol clients, a real reconnect preserving identity,
and a subsequent expired-grace forfeit. Each saved exactly one new W/L/D record,
stats row and rated match per test account; saved rating feedback was present,
the opposite pool stayed unchanged, and new lobby sockets read identical data.
An initial post-restart driver request timed out; bounded direct protocol and
read-only store diagnostics succeeded, and the driver rerun completed all cases.
No application change was made for that transient request timeout.

The native bot server on localhost:9100 also passed a real **easy bot / private
Duel** invitation and game on `wdm12`. A scripted human occupied the active seat
for 12 seconds, then disconnected for a controlled forfeit. The loss and gameplay
stats (including one death, 32,024ms active-seat time including resume grace) were
recorded. Skill stayed `pending: bot_reference_pending`, with no rating delta;
the established private human rating and Public pool stayed unchanged. This proves
native invite/load and pending-record handling, not human skill calibration.

Final live journal replay is consistent: **8 receipts**, comprising **6 applied
human matches / 12 updates / 8 rating states**, the earlier Amphi `team_changed`
exclusion retained as evidence, and the native bot result pending calibration.
Test accounts **100 / 101** are labelled **StatsTest100 / StatsTest101**, and their
test results remain in the local service. No existing account was used or reset.

Exact final commands (PowerShell, outer repository):

```powershell
npm.cmd run test:run -- src/games/fps/server/__tests__/PlayedMatchResult.test.ts src/lobby/__tests__/ResultSnapshot.test.ts src/games/fps/server/gametypes/__tests__/TeamSpawnStrategy.test.ts src/games/fps/server/gametypes/__tests__/TeamBalanceOnJoin.test.ts
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/profile-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
node .cache/ranking-live-probe.mjs --require-idle
node .cache/ranking-live-backup.mjs
npm.cmd run lobby:server -- --port 9000 --data-dir ./server-data
npm.cmd exec -- vite-node .cache/ranking-live-match.ts
npm.cmd exec -- vite-node .cache/ranking-live-bot.ts
npm.cmd run lobby:server -- --ratings-verify --data-dir ./server-data
# Read-only verify was also run against each isolated restored directory.
git diff --check
git -C src/games/fps diff --check
```

Evidence/logs stay ignored and local: `.cache/ranking-team-alias-*.log`,
`.cache/ranking-live-matches.json`, `.cache/ranking-live-match-fixed-final.log`,
`.cache/ranking-live-amphi-history.json`, `.cache/ranking-live-bot-result.json`,
`.cache/ranking-live-bot.log`, `.cache/ranking-live-final-replay.log`,
`.cache/ranking-service-restart.json`, `.cache/ranking-service-restored-replay.log`
and the private backup/restore directories recorded there. The ignored account
fixture contains test credentials and is not a publishable research artifact.
This continuation is included in the gameplay stats feature commits in both repositories.

Remaining essentials: human gunplay and full-match FFA/S&D acceptance through the
deployed browser, normal release asset packaging with sufficient disk space, and
real-human calibration before advertising bot skill updates. The current running
FFA lobby configuration at that point advertised eight required seats (no lower
`minPlayers`), so that pass did not attempt a two-player FFA room; the follow-up
below removes that start barrier. S&D advertises two minimum
players but requires a full round match; its shared-side mapping is covered by
headless regressions, not a completed live human S&D match in this pass.

### Two-player FFA follow-up

FFA now has `minPlayers: 2` while retaining `maxPlayers: 8`, in both Public and
Private rooms. The existing room UI consumes the minimum separately and shows
"up to 8 players · starts at 2". Every player present still needs to be ready.

`RoomToRanking.test.ts` no longer reduces FFA capacity to two. It checks the
shipped eight-seat/two-player configuration, confirms that one ready human does
not spawn a child, then starts a real child when the second seat is ready. Its
Public human match saves records, active-time counters and ratings; its Private
human/bot match saves records and counters with skill pending calibration. Both
cases reopen storage and verify pool isolation. The targeted installed-map and
lobby lifecycle run passed 24 tests across two files.

Files changed in this follow-up: `src/lobby/LobbyServer.ts`,
`src/lobby/integration/RoomToRanking.test.ts`,
`docs/manual/guides/lobby-server.md`, `docs/changelog/v0.9.28.md` and this document.
Concurrent lobby player-cap changes are separate work and were preserved.

Validation after the FFA change: full suite **4,545 tests / 532 files** passed;
typecheck and Biome passed (0 errors, 321 warnings against the 0/339 baseline).
Application build passed in 47.12 seconds and postbuild relocated 49 source maps.
As in the earlier pass, `publicDir: false` avoids recopying installed assets on
this nearly full disk; normal release asset packaging remains unverified.
Simulation, physics, server tick, 1,000-tick fuzz, indexed wdm2 loading and
91-tick movement replay all exited 0. Tick checksum: `2768943778`; fuzz seed:
`1791807064595`, deterministic checksum: `514411605`, zero errors. Existing
physics diagnostic warnings remain. Whitespace checks passed in both repos.

Exact commands for this follow-up (PowerShell, outer repository):

```powershell
npm.cmd exec -- vitest run src/lobby/integration/RoomToRanking.test.ts src/lobby/__tests__/LobbyLifecycle.test.ts
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/profile-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
git diff --check
git -C src/games/fps diff --check
```

Local logs: `.cache/ranking-ffa-{targeted,full,typecheck,biome,build,simulation,physics,tick,fuzz,bsp,replay}.log`.

Live localhost follow-up also completed **Public and Private FFA** with two fresh
test accounts (100/101), default eight-seat capacity and the normal signed
result/admission path. The offered/voted map was `wdm1`. Both accounts tied at
zero frags: each received a recorded draw, positive active time and one committed
rating update in the selected pool. Queries before/after each match verified the
opposite pool was unchanged. These static clients verify the result path; they
do not establish human gunplay quality or performance.

The idle service was backed up before replacement. An eight-second timer and
ten-second warmup were enabled **only for this controlled acceptance run**. The
service was then restarted on `ws://localhost:9000` with those overrides removed,
using the same data directory. An independent event-driven WebSocket client read
both accounts' Public and Private results after restart. Read-only journal replay
passed: 10 receipts, eight applied matches, 16 updates and 12 rating states.
Existing accounts and earlier results were retained; the native bot server was
left running. The normal lobby remains running for local testing.

The original polling helper missed a final fresh-socket reply, despite receipt
being visible in its message log. Its ignored `Peer.query` helper now registers
request-correlated response/error/close listeners before sending and removes
them on completion or timeout. The corrected helper also read both pools after
restart. This was a local acceptance-harness change; no production stats change
was needed to complete these reads.

Additional exact validation commands:

```powershell
node .cache/ranking-live-probe.mjs --require-idle
# Temporary acceptance service only; normal service restored afterwards.
$env:SHAG_TIMELIMIT='8s'; $env:SHAG_WARMUP='10s'
npm.cmd run lobby:server -- --port 9000 --data-dir ./server-data
npm.cmd exec -- vite-node .cache/ranking-live-ffa.ts
# Remove pacing overrides before restoring the normal service.
Remove-Item Env:SHAG_TIMELIMIT -ErrorAction SilentlyContinue
Remove-Item Env:SHAG_WARMUP -ErrorAction SilentlyContinue
npm.cmd run lobby:server -- --port 9000 --data-dir ./server-data
node .cache/ranking-ffa-read.mjs
npm.cmd exec -- vite-node .cache/ranking-ffa-restored-read.ts
npm.cmd run lobby:server -- --ratings-verify --data-dir ./server-data
```

Evidence is ignored/local: `.cache/ranking-live-ffa.log`,
`.cache/ranking-live-ffa-result.json`, `.cache/ranking-ffa-restored-native.log`,
`.cache/ranking-ffa-restored-read-fixed.log`, `.cache/ranking-ffa-restored-read.json`,
`.cache/ranking-ffa-final-replay.log`, `.cache/ranking-ffa-service-restart.json`,
and `.cache/ranking-ffa-{short,normal}-lobby.log`. The backup and account fixture
contain private credentials and must not be published. Implementation and these
research notes are included in the gameplay stats feature commits.

### Short S&D localhost follow-up

Continued directly to the remaining mode's result path. Public and Private S&D
rooms on `wbomb2` each completed with two test accounts on opposite teams. The
clients connected in reverse lobby order, chose valid kits and readied. Two
round timeouts awarded a 2–0 team win: exactly one win and one loss were recorded,
both ratings were applied with saved before/after values, active participation
time was positive, and actual frags stayed zero while the winning team's mode
score was two. The opposite pool was unchanged. New lobby sockets read the same
summaries immediately after each match.

For bounded automated acceptance, the temporary service used
`SHAG_TIMELIMIT=1s`, `SHAG_SCORELIMIT=2` and `SHAG_WARMUP=10s`; the existing
round freeze/intermission remained in effect. These are complete short matches,
not evidence of a normal ten-win human match, bomb planting/defusing, combat
damage or browser presentation. No production code change was needed for S&D.

The idle service was backed up before replacement and restored again with all
three overrides removed. An independent WebSocket client verified both accounts'
Public and Private S&D records, counters and ratings after that restart. Final
read-only replay was consistent: **12 receipts, 10 applied matches, 20 updates
and 16 rating states**. The one earlier excluded receipt and one pending bot
receipt remain intact. The normal lobby is running at `ws://localhost:9000`.

Exact additional commands, using ignored local harnesses and fresh test accounts:

```powershell
node .cache/ranking-live-probe.mjs --require-idle
# Temporary acceptance service only, after backing up the idle data directory.
$env:SHAG_TIMELIMIT='1s'; $env:SHAG_WARMUP='10s'; $env:SHAG_SCORELIMIT='2'
npm.cmd run lobby:server -- --port 9000 --data-dir ./server-data
npm.cmd exec -- vite-node .cache/ranking-live-snd.ts
# Stop the idle temporary service, then restore normal pacing.
Remove-Item Env:SHAG_TIMELIMIT -ErrorAction SilentlyContinue
Remove-Item Env:SHAG_WARMUP -ErrorAction SilentlyContinue
Remove-Item Env:SHAG_SCORELIMIT -ErrorAction SilentlyContinue
npm.cmd run lobby:server -- --port 9000 --data-dir ./server-data
node .cache/ranking-snd-read.mjs
npm.cmd run lobby:server -- --ratings-verify --data-dir ./server-data
```

Evidence: `.cache/ranking-live-snd.log`, `.cache/ranking-live-snd-result.json`,
`.cache/ranking-snd-restored-read.{log,json}`, `.cache/ranking-snd-final-replay.log`,
`.cache/ranking-snd-service-restart.json` and
`.cache/ranking-snd-{short,normal}-lobby.log`. Backup/test keys remain private.
Only local harnesses and this status document changed after the 4,545-test pass;
no further production code changes require a repeated full suite.

No additional essential stats implementation gap was found by these passes.
Before release, verify real browser combat and bomb interactions at normal match
lengths, finish normal asset packaging with sufficient disk space, and calibrate
any bot configurations promised to alter skill ratings. Human leaderboards and
private bot records work independently of that calibration.

Commit handoff: FPS `e257dc6` (`feat(stats): capture gameplay counters and show
profile match history`), followed by the outer engine's `feat(stats): persist
gameplay stats and verify scoped match results` commit, which pins that FPS tip.
The separate lobby player-cap commits were retained. The final pre-commit
`npm.cmd run gate:biome` passed at 0 errors / 321 warnings; staged whitespace
checks passed. Local service data, test account keys, backups and profiling
artifacts are not part of either feature commit.

### Schema review: information to preserve before real results

| Stored foundation | Why it matters later |
| --- | --- |
| `ranking_schema` and `ranking_policies` | Separate ranking schema version from account storage; pin numerical parameters and refuse unsupported/inconsistent state. Later migrations must be explicit. |
| `ranking_results` | Unique match ID, commit sequence, scope/mode/time, versioned canonical snapshot/digest, record and rating status/reason, policy and groups. Prevents duplicate rating and preserves the decisions behind a result. |
| `ranking_seats` | Stable played-seat/account identity, team history, scores/placements, join/leave and disconnect/forfeit facts. The full snapshot also retains participation interruptions, original roster, completion and bot references. |
| `ratings` | Full-precision mean/uncertainty/count per account, mode, scope and policy, with the last update/result time. Display numbers never replace the underlying state. |
| `rating_updates` | Before/after values and counts tied to result sequence and account. Enables deterministic integrity replay and historical pre-match pilot anchors; an account/pool/sequence index supports those reads. |
| `matches` / `match_participants` | Record-statistics projection maintained in the same transaction as the authoritative receipt. Month/all-time records do not erase career skill. |
| `bot_calibrations` | Immutable policy/mode/effective-reference identity and complete reviewed artifact. New pilot artifacts include covered map names and SHA-256 fingerprints of BSP bytes loaded during play. |
| `result_delivery` and private `result-outbox/` | Temporary verification context and completed signed report survive lobby/child restarts independently of demos. `closed_at` enables conservative housekeeping; private keys are never returned by inspection. |

This is enough for the agreed base system, not a claim that any imaginable future
feature needs no migration. Snapshot/artifact JSON already has explicit versions,
so additional captured context can be introduced deliberately; indexes and new
derived views can be added later without discarding old matches. Seasons, new
rating formulas, account merging and changes to active bot strengths need their
own policy/migration design. Do not prebuild those schemas for this alpha.

Map hashes cover BSP bytes, not every gameplay setting or asset. Calibration
pilots must keep the deployed gameplay rules and native/model environment fixed.
Legacy manually supplied calibration artifacts without `mapDigests` keep their
original map-name coverage semantics; newly generated pilot artifacts bind bytes.
Receipt hashes detect divergence for replay; they are not an independently signed
database history against an operator who can rewrite the entire database.

### Most useful next work after the implementation commit

1. **One live human result through the deployed stack.** Confirm browser/lobby
   build alignment and the active data directory, finish a Public Duel with two
   real accounts, and verify rating, W/L/D and profile persistence. Repeat in
   Private to confirm isolation, then complete the remaining mode, reconnect and
   browser checklist. This directly tests the original empty-leaderboard problem.
2. **A deployment recovery and backup rehearsal.** Use isolated storage to verify
   interrupted result delivery, restart, read-only replay and restoration of a
   consistent SQLite backup. Preserve unresolved outbox/context pairs. Establish
   the production data directory and backup procedure before real player results.
3. **Calibrate the smallest useful bot offering.** Freeze one supported preset,
   behavior/model build, map and mode first; collect real human evidence through
   the saved pilot workflow and review/install its reference. Expand only to bot
   configurations advertised as skill-rated. This needs real trials, not another
   scoring subsystem; uncalibrated games continue to expose pending skill.

The next implementation should follow a concrete issue found in these checks.
No additional feature or schema expansion is proposed before alpha acceptance.

### Minimal pilot and recovery commands

```bash
npm run ranking:acceptance
npm run ranking:pilot -- --plan --output pilot-plan.json
npm run ranking:pilot -- --export --mode duel --data-dir ./server-data --output pilot.json
npm run ranking:pilot -- --analyze pilot.json --output analysis.json
npm run ranking:pilot -- --artifact pilot.json --reference <digest> --id duel-medium-v1 --report analysis.json --reviewed --output calibration.json
npm run ranking:references -- --check calibration.json
npm run ranking:references -- --install calibration.json --data-dir ./server-data
npm run ranking:delivery -- --info --data-dir ./server-data
npm run ranking:delivery -- --cleanup --data-dir ./server-data --older-than-hours 168
```

The plan is saved and rerunnable. Export verifies the journal in one WAL read
snapshot, uses established same-mode human ratings recorded before each trial,
and reports skipped games. One bot per trial avoids trying to estimate several
unknown opponents at once. `--anchor-scope public` explicitly permits using
established public humans as offline calibration anchors; live pools stay separate.
Thirty trials and three distinct humans per reference are review recommendations,
not new live eligibility rules or proof of adequate calibration.

Analysis is a sequential pinned-TrueSkill draft with historical human anchors
held fixed; repeated anchors are not a full joint statistical calibration model.
Inspect coverage and outcome diversity, review actual human evidence, then create
the immutable artifact explicitly. Artifact creation refuses fewer than two
distinct anchored humans or changed map bytes. The report must match the current
dataset/analysis, output files cannot overwrite existing evidence, and nothing
automatically installs a strength or re-rates earlier pending matches.

Inspection never returns credentials, admission manifests or raw signed reports.
Cleanup previews by default, requires at least one hour of age, removes only
committed leftovers, old known-closed contexts without reports and old owned
temporary files. Unresolved reports, linked paths and unknown/running contexts
are retained. Stop the lobby before applying offline cleanup with `--apply`;
no service or production cleanup was performed during implementation.

### Release review findings and fixes

- Reviewed the complete path from authenticated lobby admission through played
  standings, atomic receipt/state/record writes, scoped reads and browser contracts.
  Existing coverage checks rollback, duplicate/conflicting reports, pool isolation,
  lost bot control, stale UI replies and journal divergence.
- Fixed unbounded cold model preparation and cancellation: a cancelled load can
  finish internally but cannot authenticate later; eventual model resources are
  disposed. Service shutdown now includes preparing and lobby bots.
- Fixed retry backlog work: live passes process at most 100 contexts and rotate
  through waiting/rejected entries, so later completed reports are not starved.
- Added signed play-time map fingerprints and strict matching for hash-bound bot
  references, rather than trusting the current map file during a later export.
- Kept maintenance and pilots offline and explicit. Deferred archive workflows,
  extra fit-analysis variants and operator dashboards to preserve the alpha scope.
- No further blocking schema change was identified for the approved base feature.
  Real bot evidence, browser acceptance and deployment operations remain unverified.

### Alpha completion files and validation

This continuation changes `package.json`; `src/shared/ranking/{BotPreparation,
BotPilot,BotRatingReferences,BotMatchRatingGroups}.ts`; `src/lobby/{BotPilotStore,
RatingStore,ResultDeliveryStore,ResultSnapshot,GameServerSpawner,LobbyServer}.ts`;
`src/cli/{ranking-pilot,ranking-delivery,lobby-server,HeadlessMapLoader,
headless-netserver-v2}.ts`; `src/bot/{BotClient,BotLobbyClient,BotServer}.ts`;
`src/engine/server/network/MatchResultReport.ts`; and FPS submodule
`server/{Client,GameServer}.ts`. Test changes are
`src/shared/ranking/__tests__/{BotPreparation,BotPilot,BotMatchRatingGroups}.test.ts`,
`src/lobby/__tests__/{BotPilotStore,ResultDelivery,LobbyBotPreparation}.test.ts`,
`src/bot/__tests__/{BotLobbyReference,BotServerControlAuth}.test.ts`, and
`src/engine/server/network/__tests__/MatchResultReport.test.ts`. Documentation:
this file, `docs/manual/guides/lobby-server.md`, `docs/changelog/v0.9.28.md`.
Earlier feature inventories below remain applicable to the entire working tree.

The final full repository suite passed **4,509 tests / 527 files** in **226.22
seconds**, including the entire ranking acceptance group and the new preparation,
pilot and housekeeping tests. Typecheck and Biome passed (**0 errors / 322
warnings**, baseline unchanged). The build passed in approximately 61 seconds
and relocated 49 sourcemaps. Simulation, physics, server tick determinism,
1,000-tick fuzz, installed `wdm2` BSP info and the **91-tick** movement replay all
exited 0. Tick checksum: **2768943778**; fuzz repeated checksum: **189742258**,
seed **1791746549904**. Physics still prints its existing `wdm7` LightGrid and
StepSlideMove warnings.

Exact validation commands from the outer repository (PowerShell):

```powershell
npm.cmd run ranking:acceptance
npm.cmd exec -- vitest run src/lobby/__tests__/ResultDelivery.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/LobbyBotPreparation.test.ts src/bot/__tests__/BotServerControlAuth.test.ts src/engine/server/network/__tests__/MatchResultReport.test.ts
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
git diff --check
git -C src/games/fps diff --check
```

The first acceptance run had **476 passing tests and one new fixture failure**:
the cleanup test tried to publish a malformed line through the writer, which
correctly rejected it before cleanup. Replaced it with a properly published
report signed by the wrong key; all **11 delivery tests** passed on focused
recheck. The additional deadline/control/signature checks passed **21 tests / 3
files**. The final complete suite then passed every test. Fixed import/formatting
diagnostics and a solver helper name that Biome mistook for a focused test;
the baseline was not raised. No application change was needed for the fixture
failure.

Logs: `.cache/ranking-alpha-{acceptance,delivery,preparation,full-tests,typecheck,
biome,build,simulation,physics,tick,fuzz,bsp,replay}.log`. Build uses the existing
linked public asset view excluding local benchmark-result archives; normal
release asset packaging remains unverified. No real human calibration, native
cold-model acceptance, browser visual run, user-service restart or production
storage reset was performed. The feature is committed in both repositories on
`v0.9.28-assorted-improvements`.

## Before

- A match reached the results database only if it was ranked: humans not
  outnumbered by bots, at least two verified accounts, and a winner or a draw.
  Bot matches and matches a bot decided were dropped.
- No private flag anywhere: not in results, not in demos.
- The leaderboard is wins, losses and draws per account, mode and period
  (month, all time). There is no rating number yet.

## Plan

| # | Work | Status |
| --- | --- | --- |
| R1 | Results store: `private` and `bots` columns on `matches`, added to existing databases on startup (old rows are public). A private match with bots may have one account and any outcome (losing to a bot is a result); public matches keep the strict checks. | Done |
| R2 | Independent public-only/private-only queries, including totals, date windows and local rows. | Done (RM-01) |
| R3 | Lobby server: remember at match start whether the room is private and how many bots it seated; record every finished private match with both facts. Public matches keep the ranked-roster rule. | Done |
| R4 | Protocol validates and echoes `scope`, defaults missing requests to public, rejects obsolete combined requests and missing/mismatched reply scopes. | Done (RM-01) |
| R5 | Public/Private keys, persisted selection, independent board/rail caches and protection against late replies. | Done (RM-01) |
| R6 | Demos record whether the match was private: lobby → spawner → game server → demo header. | Done |
| R7 | Featured demos leave private matches out. | Done |
| R8 | TrueSkill ratings: independent public/private pools per gametype, including calibrated bot opponents in Private. | Implementation through RM-09; validation and real human bot calibration below |

## Decisions

- Public-only is the default; Private means private-only. There is no combined
  ranking in the intended interface.
- Both boards rank actual match results. Private bot games count toward the
  private board; they do not add public wins or alter public rank.
- This clarification supersedes the initial combined-ranking interpretation.
- Featured demos on the lobby screen exclude private matches (friends and bots).
- **Approved 2026-10-11:** classic TrueSkill; separate rating pools per gametype
  and public/private scope; private bot games update private skill using calibrated
  difficulty/model references; skill determines ladder order, with W/L/D and
  matches alongside; players appear after their first eligible match as provisional.
- **Production starts fresh.** Existing development results, ratings and demo
  archives do not need carrying over. Do not implement historical backfill,
  legacy-result conversion or demo-to-ranking imports. Old demos may be kept
  as isolated test fixtures; production rankings use newly recorded verified
  results. This decision specifies the launch boundary, not a cleanup action now.

## Log

- **2026-10-11.** R1, R2: `src/lobby/MatchResultStore.ts`.
- **2026-10-11.** Continued the unfinished working tree. R3/R4 were partly
  implemented already; completed the protocol validation, UI, server/demo
  handoff and featured filtering. Added regression coverage for migration,
  private bot wins/losses/draws, separate ranking caches and late replies, old
  lobby responses, and old demo layouts. A real public/private `wdm2` FFA
  lobby test launches dedicated servers, reads results over WebSocket and
  verifies an 11-second private recording's header and frames.
- **2026-10-11.** User clarified that public and private need independent
  rankings, not an inclusion filter. The implemented `includePrivate` view
  still combines them. Planned its replacement and audited the local empty
  database before adding rating calculations. No running service was restarted.
- **2026-10-11.** User approved the TrueSkill rules. Added implementation work
  orders RM-00–RM-09, contracts, migration/replay rules, mode adapters, bot
  calibration and rollout gates. This update changes the plan only.
- **2026-10-11.** User confirmed a fresh production result/demo start. Removed
  historical result migration/backfill requirements from the implementation
  plan. Existing demo compatibility tests describe work already done, not a
  requirement to preserve the old production archive.
- **2026-10-11.** Implemented RM-01: independent SQL scopes, explicit request/reply
  scope checks, Public/Private keys and persisted independent caches. Added
  RM-00 diagnostics and a read-only `--results-info` CLI. The focused suite
  passed 44 tests across 7 files, including actual public human/private bot-seat
  `wdm2` FFA matches, durable reopening and scoped WebSocket reads. No live
  service was restarted and no old results/demos were imported or reset.
- **2026-10-11.** Implemented RM-02 played-seat/result capture. The server tracks
  verified seats from first Active through disconnect/expiry/resume, with stable
  IDs, team history and join/leave ticks. FFA final standings retain departed
  scores and tied placements; tied leaders no longer turn every lower finish into
  a draw. Started Duel/Amphi games forfeit after the existing 20-second human
  resume grace only with the original opponent still playing. Graceful stops and
  fully abandoned games report aborted outcomes, never board wins. V2 signature
  verification rejects missing/inconsistent snapshots and duplicate seat IDs.

## Current implementation and compatibility

- Public is the default; Public/Private keys select independent boards. It applies
  to the main board, its off-page local row and every gametype's rail rank.
  `shag.leaderboard.scope` stores the preference locally. When storage
  is unavailable, selection still works for the current view.
- Board/rank caches include visibility, mode and period. A delayed public reply
  cannot overwrite a private board. Connection refresh/clear invalidates late
  requests. Mode changes reuse any full board's local rank instead of requesting
  it again.
- The server accepts only `scope: "public" | "private"`; omitted scope means
  public. It echoes the selected scope and rejects obsolete `includePrivate`
  requests. Clients reject legacy replies without a scope and mismatched scopes.
- The result store admits one verified human against bots only for private
  matches; private human-only matches retain the two-account/outcome checks.
  Recording is still idempotent and uses signed, verified seat results.
- `SpawnConfig.private` becomes `--private-match`, `GameServerConfig.privateMatch`,
  and `DemoHeader.private`. Format **v4** inserts one visibility byte after the
  match ID; frame, command and index layouts are unchanged. The reader supports
  versions 1–4. Old browser builds cannot read v4 and need deploying with the
  updated server.
- Both ranked and recency featured selections exclude private recordings.
  Private demos still belong to verified participants and remain in the archive.
  This feature does not add file-access restrictions.

## Assumptions and limits

- Visibility and bot-seat count are taken at match start; they are not supplied
  by a browser result request or guessed from names.
- Existing development records and demos are disposable before production.
  Their current classification/format compatibility is historical behavior,
  not a requirement to migrate them into the new ranking system.
- The real server smoke uses installed `wdm2`, FFA: two human accounts for Public,
  one human plus an authenticated scripted bot seat for Private. It launches
  isolated lobby/game servers with fresh temporary databases. The bot seat uses
  the real admission/result path but does not run live AI behavior.
- New clients explicitly request skill boards and require the advertised skill
  capability. Older requests retain the compatibility record query. Private
  bot skill machinery works with installed references, but the registry ships
  empty until real human pilots establish opponent strengths.
- Browser visual layout and a live user-driven bot match remain unverified.

## Next-work plan: independent rankings and missing results

### What the empty lists mean on this machine

A read-only inspection of `server-data/players.db` on 2026-10-11 found:

| Check | Result |
| --- | --- |
| Stored matches | 0 |
| Stored participant rows / distinct participating accounts | 0 / 0 |
| Match columns | `id`, `gametype`, `map`, `ended_at`; no `private` or `bots` |
| Running processes referencing `lobby-server.ts` | PIDs 19624 and 31740, started at 11:18:58 local time, before the implementation changes |

These are process entries, not proof that two lobby services are listening.
Neither command line specifies `--data-dir`. A process may still use
`SERVER_DATA_DIR`; the browser's actual lobby endpoint and that process's data
directory have not been verified. The default local database therefore has no
results to rank, and its schema shows that the updated store has not opened it.
The older running lobby rules are a likely explanation for missing bot results
if this is the service/database being used, rather than a leaderboard SQL bug.

The headless smoke tests used temporary databases. Their results deliberately
do not populate this database. The new tests prove the pipeline works under the
new code; they do not prove that the user's already-running lobby uses it.
Standalone `net:server`, `demo:record` and direct un-ticketed play do not produce
account-backed lobby results. Older results skipped by the bot/roster gates
were not saved and do not appear automatically after an upgrade.

Inspection command: `npm.cmd run lobby:server -- --results-info` (the supported
read-only CLI; reports resolved directory, result schema status and aggregate
counts/latest stored match when the schema is ready). This command returned
`schema_unavailable` for the default directory on 2026-10-11.
No database, account, service or historical result was modified.

### P0 — prove that played matches reach persistent storage

Confirm the browser endpoint and the lobby's startup data-directory message.
Run the updated lobby normally after any ongoing match has finished, then play
one completed public human match and one completed private bot match. For each,
trace the same match ID from spawn, signed result verification and storage to
the leaderboard read. Reopen the database/restart the lobby and confirm the
results persist. Use the real browser accounts, not an unrelated test database.

Add a bounded server diagnostic showing stored match counts by mode and
visibility, the latest stored result, and a concrete reason for each rejected
or skipped final report. Never log admission tickets, account keys or result
secrets. The post-match screen should say whether the result was recorded for
the public/private board or why it did not count. This makes a future empty
board diagnosable without reading source.

**Implemented:** startup storage summary; safe per-result status/reason logs;
process-local counters and a 32-outcome admin history via
`getResultDiagnostics()`; read-only CLI inspection without starting a service,
creating a database or migrating old data. Latest stored match is durable;
latest observed outcome and counters are process-local. Post-match receipt UI
and validation against the user's active endpoint/accounts remain future work.

**Acceptance:** both actual played matches are durably stored. The public match
appears only in Public; the bot match appears only in Private. No minimum-match
threshold hides a player's first eligible record.

### P1 — replace the combined view with two independent record boards (done)

Use `scope: "public" | "private"` in the store query and lobby request/reply;
omitted scope means public. Validate/echo the scope and apply the exact same
filter to entries, total count and the asking account's off-page row. SQL should
filter `m.private = ?`, not include both populations.

Replace **Include private lobbies** with **Public / Private** keys. Keep the
gametype and period selectors, and cache every board and rail rank by scope,
mode and period. Remember one scope preference for the whole screen. New
clients must refuse replies for another scope. Deploy protocol/UI changes
together; preserve omitted-scope public reads for older clients and reject an
obsolete combined request rather than presenting it as a private-only board.

For this first version, keep the existing, understandable record ordering:
most wins, then fewer losses, then more draws, with stable ordering for shared
ranks. Both public and private are ranked; private wins/losses/draws include
bots. This ranking measures a match record, not opponent-adjusted skill.

Test scopes with deliberately different public/private records for the same
accounts, private-only accounts, bots, rolling dates, ties, pagination and local
rows. Exercise rapid switches and delayed replies. Revise the old combined-view
tests, manual and changelog; retain the validated result/demo work.

**Acceptance:** changing scope changes the entire leaderboard and every rail
rank. A private result cannot change public order or totals, and vice versa.

### P2 — completed, disconnected and abandoned matches (capture implemented)

Final reporting now reads a server-owned played-seat ledger, independent of
connected sockets. It begins at the first Active phase, excludes permanent
warmup departures/watchers and retains subsequent permanent departures. Resume uses the same seat;
an expired token is refused even before the cleanup tick runs. Spectate/rejoin
retains the credential and reports the last playing team plus teams played.

FFA placements use the final individual scores, including departed players and
ties at lower positions. Tied top finishers get draws and lower finishers losses.
Team modes capture the final team scores and each seat's actual team membership.
Scores in Duel/Amphi reports remain team scores (frags/round wins respectively).

Forfeit is defined for ticketed single-match Duel/Amphi only: after the existing
20-second human reconnect grace, exactly the two original played seats must be
on different unchanged sides, neither a late join, with the opponent still
playing on a connected socket. Forfeit records actual scores but assigns the
remaining opponent the win, even if they were behind. Both players absent means
aborted, never two sequential forfeits. FFA/S&D departures alone do not forfeit.

The V2 signed payload adds required `details`: version, start wall time/start
and end ticks, completion, final team scores/placements and per-seat identity,
team history, participation ticks, disconnect/forfeit flags, late-join status and
placement. Normal/forfeit reports need at least two played seats; aborted reports
may retain one, with null outcomes/placements. The verifier rejects duplicate
stable seats across credentials and inconsistent ranks, scores, outcomes or
participation bounds. Lobby and children need the same V2 code.

Reporting is latched once per single-match server. Graceful mid-match stops and
empty started games emit aborted reports; the lobby diagnoses and skips them.
This is at-most-once attempted delivery, not durable delivery. Completed W/L/D
records remain durable in the existing store, but full snapshot/abort receipt
storage is now implemented in RM-04 below; retry/crash delivery recovery is RM-09. Killed children cannot guarantee
a report. No old results/demos need importing to implement those later slices.

### P3 — add skill ratings only after the record path is observable

Approved system: **classic TrueSkill**, with separate rating state per
account, gametype **and scope**. Numerical math and transactional storage are
implemented; live mode eligibility/activation is the next slice.
Public games update the public pool; private games update the private pool.
There is no cross-pool update. Private bot matches update private skill as well
as its match record. Use calibrated reference opponents keyed by gametype,
difficulty and bot/model version, independent of bot display name or process
lifetime. Reference bot strengths stay fixed within a calibration version;
human-vs-human private matches use the players' private ratings. Calibrate bot
strengths before enabling these skill updates, and test repeated wins against
easy bots as well as mixed human/bot teams. The existing record board can count
every eligible bot match while that calibration is being developed.

| Mode | Information needed for a skill update |
| --- | --- |
| Duel / Amphi | Two verified players, win/loss/draw, explicit forfeit outcome |
| Search & Destroy | Played team membership and final team result; a K/D score alone should not decide team skill |
| FFA | Final placement including tied scores, not just winner vs everyone else |
| Private bot matches | Human participation plus a stable bot difficulty/model reference |

Current stored record rows keep account, outcome and score. RM-02 now captures
teams, placements and participation in the authenticated V2 result, but its
full durable journal is now implemented in RM-04, and trusted bot identity/difficulty remains
RM-06. Finish those paths before claiming a complete four-mode skill system.
Keep durable results as the source
of truth, with versioned rating updates applied once per match in a transaction;
rating state should be rebuildable in a deterministic order from eligible data.

TrueSkill was selected because it models uncertainty, draws, multiple
competitors and individual skill from team outcomes; see the
[original Microsoft Research paper](https://www.microsoft.com/en-us/research/publication/trueskilltm-a-bayesian-skill-rating-system/).
That fits all four modes with one model. Glicko-2 remains a comparison candidate
for head-to-head simulations, rather than a second production rating system;
see [Glickman's specification](https://www.glicko.net/glicko/glicko2.pdf).
Choose a verified implementation/dependency and calibration parameters after
reference-vector, team, FFA, tie, rematch and bot simulations.

Store the estimated skill (`mu`) and uncertainty (`sigma`) internally. Proposed
ladder ordering uses a conservative score such as `mu - 3 * sigma`, rather than
promoting a highly uncertain new account on its estimated skill alone. Map the
score to a readable numeric **Rating** in the UI; agree on the scale and test
how uncertainty reduction affects it before promising a fixed Elo-like number
or a fixed points change per win. Display wins, losses, draws and matches as
record statistics alongside the rating. All players on each selected board
use that scope's rating, including the rail and off-page local row.

Let players appear as provisional after their first eligible match, with
uncertainty visible; do not leave an early community's board empty behind a
placement threshold. Keep record totals distinct from skill, and decide how the
screen presents them before changing the current win-based ordering. A rolling
30-day record filter should not silently reset career skill every month.

**Priority:** P0 result capture and P1 independent boards first; P2 participation
correctness next; P3 numerical skill ratings using the approved rules.
No numerical rating algorithm or live-service restart was performed in this
planning update.

## Implementation plan for the approved rules

### Delivery order and work orders

Each row is a reviewable implementation slice. Keep the working result-store,
demo privacy and featured-filter foundation; independent scopes are implemented.
Update the living changelog and this table as work lands. All work stays in the
existing lobby/shared engine and FPS submodule; there is no new game package.

| ID | Work and primary files | Depends on | Acceptance / status |
| --- | --- | --- | --- |
| RM-00 | Result-capture diagnostics: `src/cli/lobby-server.ts`, `src/lobby/LobbyServer.ts`, `src/lobby/MatchResultStore.ts`, `ResultDiagnostics.ts`, spawner result rejection reporting. | Existing foundation | Durable scope/mode counts and latest stored result; bounded runtime outcomes with skip/rejection reasons; read-only resolved-directory CLI. Public human/private bot-seat matches persist across reopening in isolated real servers. **Diagnostics implemented; user's actual endpoint/data directory and live AI acceptance still pending.** |
| RM-01 | Public/private-only query, protocol and selector: store, `src/lobby/types.ts`, `LobbyClient.ts`, `LobbyServer.ts`, FPS `client/NewUiApi.ts`, `LeaderboardView.ts`, CSS and tests. Replace `includePrivate` with `scope`. | Foundation; can precede live RM-00 check | Both boards, totals, local row, periods and rail are isolated. Private bot records appear after one result. Rapid switches and legacy replies cannot mix scopes. **Done; headless store/protocol/UI and real-server checks passed.** |
| RM-02 | Authoritative played roster and versioned result snapshot: FPS `GameServer.ts`, `Client.ts`, `SuspendedSessions.ts`, `gametypes/MatchState.ts` and engine `MatchResultReport.ts`; reuses existing stable admission IDs. | Foundation | Normal finish, reconnect and Duel/Amphi grace-expiry forfeit retain verified participants exactly once. FFA placements/ties and team results survive cleanup. Inconsistent/forged V2 reports fail verification. **Done; 48 focused / 4,256 full-suite tests passed.** Durable ingestion is now implemented in RM-04; delivery recovery remains RM-09. |
| RM-03 | Pure TrueSkill adapter, `src/shared/ranking/TrueSkillRating.ts` and versioned `RatingPolicy.ts`; headless `ranking:simulate`. Pinned implementation and parameters; normalized groups/ranks return new human states without database/network/UI dependencies. | Approved rules; independent of UI/store work | Published reference vectors, permutations, ties, teams, FFA, numerical failures and repeated-match checks pass. Versioned starting display/provisional rules evaluated through simulations. **Implemented; 45 focused tests passed.** Human/bot calibration and live integration remain later slices. |
| RM-04 | Fresh SQLite ranking schema and journal, `src/lobby/RatingStore.ts` / `ResultSnapshot.ts`, sharing the record store connection. Save normalized result, rating status/reason, old/new states and policy version atomically; no development-result migration or backfill. | RM-02, RM-03 | Fresh initialization, duplicates/conflicts, rollback/process death, restart, eight-pool isolation and consistent read-only replay pass. Actual lobby results retain complete snapshots and pending reasons. **Done; 54 focused / 4,354 full-suite tests passed.** Live mode decisions remain RM-05; delivery recovery remains RM-09. |
| RM-05 | Human mode adapters in `src/shared/ranking/MatchRatingGroups.ts`, automatic transactional activation in `RatingStore.ts`, latched server participation evidence. | RM-02, RM-03, RM-04 | Every complete eligible human match updates only its mode/scope. Team result drives team updates; FFA uses all placements including tied lower places. Incomplete/interrupted games retain records with skill exclusions. Bot-containing matches await RM-06/RM-07. **Done; 128 focused / 4,405 full-suite tests passed.** |
| RM-06 | Trusted bot reference handoff: service runtime identity, authenticated lobby messages, admission grants, signed played seats and canonical journal snapshots. Carry effective preset/custom difficulty, arbiter, behavior build and loaded model content identity. | RM-02 | Names/process IDs are absent from calibration identity. Public bots remain refused. Changes from handoff through receipt are latched as `bot_reference_changed`, retaining records. **Done; 128 focused/handoff / 4,428 full-suite tests passed.** |
| RM-07 | Versioned bot calibration and fixed-reference private updates, persisted registry and `ranking:references` CLI. | RM-03–RM-06 | **Infrastructure implemented; real human calibration pending.** All four private mode adapters, immutable bot references, transaction/replay checks and illustrative repeated-win/loss simulations pass focused tests. Registry ships empty; unregistered/custom bots retain records and pending status. |
| RM-08 | Skill leaderboard and result UI: query/protocol/API, FPS leaderboard and profile/rank consumers. Add Rating/provisional state/rated count, keep record columns, replace win-based podium/order and `nextStep()` hints. | RM-01, RM-04, RM-05; bot feature after RM-07 | **Implemented and headless/build validated.** Skill orders every new-client rank and featured top-ten selection. Career state survives period filters; provisional, off-page local rows and pending/excluded counts are exposed. Old records-only servers cannot masquerade as skill ladders. Browser layout remains unverified. |
| RM-09 | End-to-end rollout/recovery gates, manuals/changelog and real-service acceptance. | RM-00–RM-08 | **Delivery implemented and headless/build validated.** Persisted verification context, child outbox, retry/duplicate acknowledgement and process-kill recovery pass. No fabricated completion after an unfinished child is killed. Actual user matches, browser checks and real bot calibration remain pending. |

Human Duel/Amphi is the first numerical vertical slice, followed by team/FFA
adapters. This sequencing does not disable private records or commit to a
different rating system for another mode. Enable private bot **skill** updates
once their metadata/calibration slice passes; until then show their pending
status and keep every eligible record for deterministic processing later.

### Result contract and eligibility

Introduce a versioned result payload through the existing signed child-to-lobby
channel. The lobby remains authoritative for scope, gametype, map and admission
context; a client cannot select the pool or its opponent strength. Proposed
normalized fields:

| Part | Fields / rule |
| --- | --- |
| Match | Result schema version, match ID, mode, map, authoritative start/end, completion reason (`normal`, `forfeit`, `aborted`), final team results, played-roster snapshot |
| Participant | Stable admitted seat ID, verified account ID or bot reference, played membership, final score, outcome and placement/tie group, disconnect/forfeit status |
| Bot reference | Preset or custom-config digest, behavior build, model digest or explicit no-model identity, resolved calibration version |
| Processing | Record status, skill eligibility/status and reason, ingestion sequence, rating policy version |

Reuse admitted seat identity across original/recovery credentials; one seat
must not become two opponents. Late joiners need recorded participation, and
teams need played membership. Initially retain record statistics for drop-ins,
team switches and incomplete rosters, with an explicit skill exclusion reason
when the mode adapter cannot reconstruct a valid contest. This can expand
later without silently treating a last-second join as a full match.

Only an authoritative completed game or supported server-declared forfeit
updates skill. An abandoned game without a valid outcome creates no invented
win or rating change. Use the existing reconnect grace machinery; retain final
participation separately from socket lifetime and snapshot scores before
`MatchState.removePlayer()` deletes them. Spectators and bot-only matches
create no human rating entries.

### Storage, transaction and replay

Define the new ranking schema alongside accounts in the existing private SQLite
database design, and initialize it fresh for production. Proposed tables:

- A normalized match-seat/result table including bot participants; derive W/L/D
  records from its verified human participation. No old result rows need copying.
- `ratings`: key `(account_id, gametype, scope, policy_version)`, with `mu`,
  `sigma`, rated matches, last update and the last applied ingestion sequence.
- `rating_updates`: unique `(match_id, account_id, policy_version)`, the pool,
  before/after states and the ladder-score change. Bots have references, not
  account rows or public leaderboard entries.
- A versioned bot-reference registry plus result processing status/reason.

One transaction stores the verified final result, allocates a durable ingestion
sequence, applies all eligible updates and records their journal entries. A
calculation/SQL failure rolls back the whole application; a duplicate match
does not update ratings again. Preserve full-precision values and round only
for display. Stable ties and pagination must agree with local-row ranks.

Use persisted ingestion order as the initial replay order. A late result is
appended and receives its committed position, rather than silently rewriting
already displayed history by `ended_at`. An algorithm/calibration revision
builds a new policy version in separate state, replays eligible results and
compares it before activation. Retain old before/after values for audit.

Production starts with empty result and rating tables and the new complete
result contract. There is no legacy-result conversion, backfill or reconstruction
from old demos. Fresh-database initialization is the required launch path;
schema versioning and replay remain necessary for future production updates.
Keep selected existing demos only as test fixtures, outside the production demo
archive and featured selection. Replay after launch uses newly stored verified
results, not demo files. The launch reset does not imply resetting production
ratings every deployment or every month.

### Rating policy and presentation

The approved model is TrueSkill. Version the initial prior, performance noise,
dynamics, per-mode draw settings, conservative-score coefficient, display scale
and provisional threshold together. Freeze these after reference tests and
simulations; bot-only simulations establish relative bot ordering but cannot
alone establish the human rating scale. Use human pilots to calibrate it.

Store uncertainty and sort by the selected conservative skill score. Label the
number **Rating**. Show provisional status immediately after the first eligible
match; qualification never hides every new player's row. A conservative score
can change as uncertainty falls, so test the display on both wins and losses
before promising that every result changes the number in a fixed direction.

Career rating continues through both current period tabs. **Last 30 days**
filters active accounts and record totals in the selected mode/scope; **All
time** includes all rated accounts with their current rating and lifetime
record. Neither tab resets or recalculates skill using only that date window.
Do not add seasons, matchmaking queues, rank badges or artificial reset logic
in this first implementation.

Replace `nextStep()` with a rating gap to the next displayed rank, or omit that
hint until supported; wins needed cannot be predicted without future opponents.
Update the existing featured-demo top-ten lookup to use the public skill query
once live, retaining the private-demo exclusion. During staged rollout,
advertise record/rating capability so a client never fabricates ratings for an
older server or mistakes records-only data for a skill board.

### Validation and rollout

Each code slice runs `npm.cmd run typecheck`, relevant Vitest tests and the
Biome gate. Server/network/result-contract slices additionally run the required
simulation, physics, tick, 1,000-tick fuzz, BSP inspection and movement replay
commands listed below. Before the completed feature ships, run
`npm.cmd run test:run`, `npm.cmd run build` and browser/manual acceptance after
headless checks. A planning-only update needs no new application test run.

The regression matrix must cover all four modes, both scopes, normal finishes,
ties, reconnect/forfeit/abort, first-game provisional entries, private bots of
known/unknown references, mixed teams, duplicate delivery, database reopening,
failed transactions, pool isolation and deterministic replay. Inject failures
around receipt/commit/acknowledgment; distinguish exactly-once **application**
from reliable **delivery** in the acceptance report.

Add a fresh-production smoke: initialize empty ranking tables and an empty demo
archive, play the first public human and private bot matches, and verify that
only those new verified results create rows/ratings. Do not require importing
existing development databases or demo archives. Preserve only selected old
demos in isolated test/benchmark fixtures when they help a regression test.

Implement on `v0.9.28-assorted-improvements` in both existing repositories.
Commit FPS changes first and the outer repo second with its matching submodule
pin. No release bump or merge is part of this work. After headless acceptance,
coordinate a normal restart of the user's lobby after any ongoing game, confirm
its real endpoint/data directory, and record actual public/private results.

**Next acceptance task:** user-driven public
and private matches and browser checks. Real RM-07 human calibration remains
required before production bot skill updates. RM-00–RM-06, RM-07 infrastructure,
RM-08 skill display and RM-09 delivery are implemented. Coordinate real-service
acceptance separately so isolated test records are not mistaken for the user's
account history. Running services were not restarted by this implementation.

## RM-07 fixed-reference infrastructure

The registry is empty by default. A calibration artifact binds an immutable ID,
current policy, mode and exact effective bot reference to Gaussian `mu`/`sigma`.
It declares operator-reviewed human pilot evidence: match/human counts, covered
maps, report location and timestamp. The validator checks shape and numerical
validity; it cannot establish that the pilot was real or statistically adequate.
Bot-only results do not establish a human scale. Custom, loading, fallback and
unstable references are refused for the first release. Matches outside the
artifact's piloted map coverage remain pending.

```powershell
npm.cmd run ranking:references -- --check path/to/calibration.json
npm.cmd run ranking:references -- --list --data-dir ./server-data
npm.cmd run ranking:references -- --install path/to/calibration.json --data-dir ./server-data
npm.cmd run ranking:simulate
```

Check/list never initialize storage. Install requires an explicit artifact and
existing, consistent ranking database. Exact artifact retries are idempotent;
changing a reference's strength under the active policy is refused. Revisions
require a separate policy and ordered replay. Existing pending receipts stay
pending when a calibration is installed; only new eligible matches apply it.

All four private mode adapters use the original roster and unchanged full-match
participation. Bots enter the ordinary TrueSkill calculation with their fixed
Gaussian priors. Only human posteriors are written; a bot never gets an account,
ladder row or updated strength. Plans retain seat IDs, calibration IDs and exact
prior values, so replay detects deleted or altered references. The usual per-game
dynamics term still belongs to the pinned solver; stored bot priors remain fixed.
See the [TrueSkill package documentation](https://trueskill.netlify.app/) for
the underlying group-rating model.

The seed-927 simulation now also runs 500 repeated wins/losses against explicitly
hypothetical fixed opponents. A weak reference (`mu=10`, `sigma=2`) stays unchanged,
while repeated human wins reach displayed ratings 1501/1682/1841/1986 at
10/30/100/500 games. This is **not a hard farming cap**: even near-certain wins
continue to raise the human rating. Test this in real pilots before approving
production strengths; no unapproved cap or alternate scoring rule was added.
These values are synthetic illustrations, not shipped opponent calibration.

Pilot reports must also pin map assets, navigation/model files and inference
environment. The bot reference covers effective settings, behavior code and
model content; map-name coverage alone does not automatically fingerprint a
replaced BSP or prove equivalent inference behavior on another backend. The
existing eight-second bot invite/preparation deadline still needs a cold-model
real-service check before deploying calibrated loaded-model opponents.

Focused validation: 43 tests across artifact, group/math, persistence/replay and
actual CLI suites passed in 9.68 seconds. The simulation, typecheck and Biome
passed. Database fixtures and all installed test references are isolated.

## RM-08 skill ladder and profile

`skillLeaderboard()` ranks full-precision `mu - 3 * sigma`, then uses account ID
only for stable pagination among exact skill ties. It rounds only the displayed
rating. A read transaction keeps entries, totals, the off-page authenticated
player and processing counts consistent. All eight mode/scope pools remain
independent. The first eligible game creates a provisional row.

Last 30 days selects rated accounts with record activity in that scope/window
and shows window W/L/D. All time shows all rated accounts and lifetime records.
Both display the current career posterior and career rated-match count; there
is no period reset or historical-rating reconstruction. Records-only accounts
are not assigned an invented starting rating. Pending and excluded matches
appear as local processing counts even when the player has no skill row.

The server advertises `features.skillRatings`; new clients send
`system: "trueskill"` and validate the echoed scope, system, policy and rating
fields. A records-only server leaves skill UI unavailable. Omitted-system reads
remain compatible with older clients. Podium, rows, rail and profile show Rating,
provisional state and records. Rows also show career rated count. The profile
can read Public or Private explicitly. Win/loss tie rules and wins-to-pass hints
are replaced by a rating-point gap to the next displayed rank. Featured top-ten
eligibility now uses public 30-day skill, retaining private-demo exclusion.

Focused tests cover eight pools, exact and rounded ties, pagination, career
state through changing activity windows, old/partial replies, names as text,
delayed scope replies, profile scope and pending bot status. Browser visual
layout has not been checked during this work.

## RM-09 durable delivery and restart recovery

Before launching a supervised match, the spawner stores the exact verification
manifest, signing secret and lobby-owned result policy in `result_delivery`.
This private operational table is separate from the credential-free normalized
rating journal. Drop-in grants are persisted before sending them to the child;
bot changes are latched durably and never alter a committed receipt.

The child flushes its signed final report to a temporary file, then publishes
it atomically without overwriting an existing report in
`<data-dir>/result-outbox/<match-id>.result`. It then emits the usual stdout line.
The directory is outside public assets/demos. Keep the database and outbox under
the server data directory's private access controls; POSIX mode requests do not
replace Windows ACLs. No credentials are added to browser responses or diagnostics.

The lobby retries on startup, every five seconds and after graceful child
shutdown. Only a committed journal receipt acknowledges delivery. A crash after
commit but before cleanup replays a duplicate, without another rating update.
Failed ingests and rejected reports keep their context/file. An incomplete
match with no report stays waiting, never becomes an invented win. Context
without a file but with a committed receipt can finish acknowledgement.

```powershell
npm.cmd run lobby:server -- --results-recover --data-dir ./server-data
npm.cmd run lobby:server -- --ratings-verify --data-dir ./server-data
```

Offline recovery writes receipts but starts no service. It requires explicit,
existing consistent storage and cannot be mixed with read-only inspection flags.
It reports delivered/waiting/rejected/failed counts and fails on rejection/error.
After losing the prior lobby's bot control session, uncommitted bot contexts are
marked changed: recovered records survive but skill is excluded. Already committed
bot receipts remain unchanged. Human results can recover and rate normally.

Eight focused recovery tests pass, including a writer process killed after
publication, reopened storage, temporary transaction failure, commit-before-ack
death, forged/off-roster reports, persisted admission changes, lost bot control,
unfinished matches and actual offline CLI invocation. A disk/outbox write failure
logs recovery unavailability and still attempts stdout delivery. This does not
promise recovery for a child killed before publication, machine power loss,
deleted/corrupt storage or restoration of running rooms after a lobby restart.
Retained waiting/rejected entries and abandoned temporary files need operator
inspection; automatic retention cleanup is not implemented.

## RM-07–RM-09 files changed this continuation

All paths are relative to the outer repository. FPS paths are in its submodule.
Earlier uncommitted work is retained; the following lists this continuation.

| Area | Exact files |
| --- | --- |
| Fixed-reference math/artifacts | `src/shared/ranking/BotRatingReferences.ts`, `src/shared/ranking/FixedReferenceRating.ts`, `src/shared/ranking/BotMatchRatingGroups.ts` |
| Registry and activation | `src/lobby/BotCalibrationStore.ts`, `src/lobby/RatingStore.ts` |
| Operator CLI/simulation | `package.json`, `src/cli/ranking-references.ts`, `src/cli/ranking-simulate.ts`, `src/cli/lobby-server.ts` |
| Skill queries and protocol | `src/lobby/MatchResultStore.ts`, `src/lobby/types.ts`, `src/lobby/LobbyClient.ts`, `src/lobby/LobbyServer.ts` |
| Durable delivery | `src/lobby/ResultDeliveryStore.ts`, `src/lobby/ResultOutbox.ts`, `src/lobby/GameServerSpawner.ts`, `src/cli/headless-netserver-v2.ts` |
| Fixed-reference tests | `src/shared/ranking/__tests__/_botCalibration.ts`, `src/shared/ranking/__tests__/BotRatingReferences.test.ts`, `src/shared/ranking/__tests__/FixedReferenceRating.test.ts`, `src/shared/ranking/__tests__/BotMatchRatingGroups.test.ts`, `src/lobby/__tests__/BotRatings.test.ts`, `src/lobby/__tests__/BotCalibrationCli.test.ts` |
| Skill/delivery tests | `src/lobby/__tests__/_humanSnapshot.ts`, `src/lobby/__tests__/SkillLeaderboard.test.ts`, `src/lobby/__tests__/ResultDelivery.test.ts`, `src/lobby/__tests__/HumanRatings.test.ts`, `src/lobby/__tests__/DemoOwnership.test.ts`, `src/lobby/__tests__/LobbyClientConnection.test.ts`, `src/lobby/integration/RoomToRanking.test.ts` |
| FPS UI | `src/games/fps/client/NewUiApi.ts`, `src/games/fps/client/LeaderboardView.ts`, `src/games/fps/client/ProfileView.ts`, `src/games/fps/client/LobbyPanel.ts`, `src/games/fps/client/styles/Identity.css` |
| FPS UI tests | `src/games/fps/client/__tests__/LeaderboardView.test.ts`, `src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts`, `src/games/fps/client/__tests__/ProfileRecord.test.ts` |
| Documentation | `docs/research/ranking_matches.md`, `docs/manual/guides/lobby-server.md`, `docs/manual/guides/headless-mode.md`, `docs/changelog/v0.9.28.md` |

## RM-07–RM-09 combined validation

The final full suite passed **4,487 tests / 523 files** in **199.60 seconds**,
with no concurrent build. This includes real installed-map public-human and
private scripted-bot `wdm2` FFA lobby/child handoffs. Welcome advertised skill;
scoped skill reads returned either provisional human ratings or honest pending
bot counts; the child's outbox/context were acknowledged after commit. Reopened
storage and read-only replay remained consistent. The private fixture uses an
authenticated protocol bot seat, not live AI or human calibration evidence.

Exact validation commands run from the outer repository (PowerShell):

```powershell
npm.cmd run ranking:simulate
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run test:run
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd exec -- vitest run src/lobby/__tests__/SkillLeaderboard.test.ts src/lobby/__tests__/BotRatings.test.ts src/lobby/__tests__/DemoOwnership.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/ResultDelivery.test.ts src/games/fps/client/__tests__/ProfileRecord.test.ts
git diff --check
git -C src/games/fps diff --check
```

Earlier focused runs this continuation, also checked:

```powershell
npm.cmd exec -- vitest run src/lobby/__tests__/RatingStore.test.ts src/lobby/__tests__/HumanRatings.test.ts src/shared/ranking/__tests__/BotMatchRatingGroups.test.ts src/shared/ranking/__tests__/FixedReferenceRating.test.ts src/shared/ranking/__tests__/BotRatingReferences.test.ts src/shared/__tests__/NoEngineImports.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/BotRatings.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/BotRatings.test.ts src/shared/ranking/__tests__/BotMatchRatingGroups.test.ts src/lobby/__tests__/BotCalibrationCli.test.ts src/shared/ranking/__tests__/FixedReferenceRating.test.ts src/shared/ranking/__tests__/BotRatingReferences.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/HumanRatings.test.ts src/lobby/__tests__/MatchResultStore.test.ts src/lobby/__tests__/DemoOwnership.test.ts src/games/fps/client/__tests__/LeaderboardView.test.ts src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts src/games/fps/client/__tests__/ProfileRecord.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/SkillLeaderboard.test.ts src/lobby/__tests__/HumanRatings.test.ts src/lobby/__tests__/DemoOwnership.test.ts src/games/fps/client/__tests__/LeaderboardView.test.ts src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts src/games/fps/client/__tests__/ProfileRecord.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/ResultDelivery.test.ts src/lobby/__tests__/SkillLeaderboard.test.ts src/lobby/__tests__/HumanRatings.test.ts src/lobby/__tests__/BotRatings.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts src/games/fps/client/__tests__/ProfileRecord.test.ts
```

Intermediate failures were corrected in fixtures: the featured test needed a
rated match rather than a legacy record; synthetic team-seat scores had to
agree with team standings; receipt assertions needed the returned `receipt`
property; the killed-writer test had to wait through Vite startup output for
its publication marker. The final full run passed all of these cases.

Typecheck, Biome (**0 errors / 322 warnings**, baseline unchanged) and all required
network regressions passed. Tick checksum **2768943778**; 1,000-tick fuzz had
no errors and repeated checksum **2974730874**, seed **1791744104789**. BSP info
and the 91-tick replay passed. Physics still exits 0 with existing `wdm7`
LightGrid dimension and StepSlideMove position warnings; the simulation smoke
initializes without a collision world. These checks do not validate browser GPU
rendering or map-collision accuracy beyond the tests' stated scope.

Build passed in **49.57 seconds**, with 49 sourcemaps relocated. It uses the
existing temporary public asset view that excludes local profiling result
archives; ordinary release asset packaging was not tested. Both repositories'
whitespace checks passed. Assumptions: fresh isolated accounts, on-disk SQLite,
the same accessible data directory across supervised child/lobby processes and
unchanged policy/references. No live user service/database/demo archive was
restarted, reset, migrated or imported. No browser visual check or real human
bot pilot was performed. Work remains uncommitted in both matching branches.

Logs: `.cache/ranking-fixed-{focused,storage,final-focused,simulate,typecheck,biome}.log`,
`.cache/ranking-skill-{focused,final-focused,store-focused}.log`,
`.cache/ranking-delivery-{focused,recheck}.log`, and
`.cache/ranking-live-{typecheck,biome,full-tests,build,simulation,physics,tick,fuzz,bsp,replay}.log`.

## Public/Private selector polish (side quest)

The scope selector reuses the gametype key styling with an explicit neutral
cream `--m`. Previously that variable was missing, so the selected key's
background/shadow declarations were invalid and dark active text remained on
the page. Both scope and mode keys are now 100 × 46 px. Public/Private share a
dark frame with 10 px padding/gap (and space for the existing raised-key shadow).
The gap to the gametype group is 20 px: **2×** the normal 10 px key gap. The frame
provides enough separation without the 40 px gap of the 4× alternative.

Changed files: FPS `client/styles/Leaderboard.css`, outer
`docs/changelog/v0.9.28.md` and this research document. No selection/query logic
changed. Existing headless leaderboard tests passed **15 tests / 2 files**;
Biome passed with **0 errors / 322 warnings**. Production build passed in
**55.61 seconds**, using the existing asset view excluding local profiling
archives; 49 sourcemaps were relocated. Existing build warnings remain.

```powershell
npm.cmd exec -- vitest run src/games/fps/client/__tests__/LeaderboardView.test.ts src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
git diff --check
git -C src/games/fps diff --check
```

Assumptions/unverified: the existing gametype key dimensions are the size to
match. Browser visual verification was attempted after headless checks, but
`cua.getState()` failed during connector asset initialization (`os error 3`),
so rendered font fit and responsive appearance are unverified. Refresh the
leaderboard to load the injected stylesheet. Logs:
`.cache/leaderboard-toggle-{tests,biome,build}.log`. Changes are uncommitted.

## RM-06 trusted bot calibration identity

The bot service now reports a bounded `BotReference` containing the effective
preset (or `custom`), all nine numerical difficulty parameters, resolved goal
arbiter, behavior build digest and neural model status/content digest/accepted
heads. Names, process IDs, directory paths, connection IDs and authentication
material do not form the reference. Unknown preset names record the actual
medium fallback. Custom difficulty is copied, so later caller mutations cannot
silently alter the brain or saved configuration.

The conservative behavior digest hashes runtime TypeScript sources, dependency
lock and learned-route JSON, excluding tests, hidden directories and bot names.
It is cached per process. Unrelated runtime source/dependency edits can invalidate
a calibration too; this is intentional for the initial development system.
The existing source-based Node launch is assumed. A packaged bot distribution
will need an equivalent generated build manifest. Navigation cache/map assets
and backend availability still need coverage in RM-07's reproducible calibration
environment; this digest alone does not certify opponent strength.

### Trust path and changes

1. `BotLobbyClient` prepares its actual `BotClient` and awaits model loading
   before authenticating. It carries that prepared client into the match.
   Requested models do not masquerade as loaded ones. Actual tactical/combat
   acceptance is reported; absent/refused models report fallback. Model artifacts
   and metadata are hashed before and after loading; changed/unreadable artifacts
   with accepted heads report `unstable`. Identical files in another directory
   have the same digest. Arbiter settings now survive service/lobby forwarding
   and reach HybridBrain's state-machine fallback too.
2. The lobby accepts metadata only from a local connection authenticated with
   the shared bot secret. Human claims are ignored/rejected, and malformed
   service metadata fails authentication. Canonical whitelists discard extras.
3. Initial metadata travels in the parent-owned admission manifest through the
   existing spawner. The game server copies it into the bot's played seat, and
   the signed V2 verifier requires exact agreement with admission. Removing,
   replacing or attaching a bot reference to a human seat fails verification.
4. Authenticated `bot:reference` updates carry effective difficulty changes.
   Identical updates do nothing. Changes, failed updates or losing the bot's
   lobby control session after handoff latch the match's change flag; changing
   back cannot clear it. Changes during asynchronous spawning are latched too.
   The initial identity remains in the signed snapshot. The lobby-owned flag
   is retained in the canonical receipt. Post-receipt teardown cannot alter a
   committed context or invalidate a duplicate.
5. Changed private bot matches retain eligible W/L/D records with skill
   exclusion `bot_reference_changed`. Stable private bot matches remain
   `bot_reference_pending`, including legacy bots without metadata. Public bot
   matches remain refused. No bot prior, calibration registry or skill update
   is invented in this slice.

The change window deliberately starts at handoff, rather than trusting a client
to say which game tick its change affected. It can conservatively exclude an
otherwise complete game if control is lost before the result arrives. RM-09
delivery ordering/recovery remains separate. Optional metadata preserves old
canonical snapshots/replay; no result migration, reset or backfill was added.
Multiple bot configurations on the same side have a canonical roster order.
Prepared/failed clients release reference listeners and neural resources; lobby
auto-ready timers are cleared and cancelled connection generations cannot retry.

### RM-06 validation and changed files

Focused tests: **124 passed / 9 files** in **2.67 seconds**. Handoff tests:
**4 passed / 2 files** in **59.85 seconds**. These cover canonical validation,
custom settings, name/process-ID independence, relocated/replaced model shards,
spoofing and authenticated updates, admission binding, persisted exclusions,
duplicate/reopen/replay, and ten-seat reports within the existing 16 KiB cap.
Actual WebSocket model preparation proves authentication waits for loading and
prepared models are disposed. Installed `wdm2` lobby/child matches preserve bot
identity in both original roster and played seat after reopening; the human
public game still applies ratings and the private bot game remains pending.

Full suite: **4,428 tests / 516 files passed** in **191.04 seconds**. Final preset
fallback/model preparation checks: **5 tests / 2 files passed**; the fallback
whitelist also covers inherited object-property names. Typecheck and Biome
passed (**0 errors / 322 warnings**, unchanged baseline). Build passed in
**54.86 seconds**, with 49 sourcemaps relocated, using the existing public asset
view excluding only local profiling archives. Existing transcoder, mixed-import
and chunk-size warnings remain.
Required regressions exited **0**: tick checksum **2768943778**; 1,000-tick fuzz
**0 errors**, repeated checksum **1115946807**, seed **1791740677454**; installed
`wdm2` BSP info and the 91-tick movement replay passed. Physics retains the
existing `wdm7` LightGrid mismatch and StepSlideMove position warning; the
initialization simulation still has no initialized collision world. Exit zero
does not prove those collision concerns resolved. The read-only old isolated
journal CLI still replays **2 applied matches / 4 updates / 4 states**, retaining
the previous pending human receipt without reclassification.

Exact validation commands (PowerShell, outer repository):

```powershell
npm.cmd exec -- vitest run src/shared/ranking/__tests__/BotReference.test.ts src/shared/__tests__/NoEngineImports.test.ts src/bot/__tests__/BotRatingIdentity.test.ts src/bot/__tests__/BotServerModelDir.test.ts src/lobby/__tests__/LobbyAuth.test.ts src/lobby/__tests__/RatingStore.test.ts src/lobby/__tests__/ResultSnapshot.test.ts src/engine/server/network/__tests__/MatchAdmission.test.ts src/engine/server/network/__tests__/MatchResultReport.test.ts
npm.cmd exec -- vitest run src/bot/__tests__/BotLobbyReference.test.ts src/lobby/integration/RoomToRanking.test.ts
npm.cmd exec -- vitest run src/bot/__tests__/BotRatingIdentity.test.ts src/bot/__tests__/BotLobbyReference.test.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd run lobby:server -- --ratings-verify --data-dir .cache/ranking-journal-smoke-IiezWn
npm.cmd exec -- biome check --write src/shared/ranking/BotReference.ts src/shared/ranking/MatchRatingGroups.ts src/shared/ranking/__tests__/BotReference.test.ts src/shared/ranking/__tests__/_botReference.ts src/bot/BotRatingIdentity.ts src/bot/BotClient.ts src/bot/BotLobbyClient.ts src/bot/BotServer.ts src/bot/HybridBrain.ts src/bot/__tests__/BotRatingIdentity.test.ts src/bot/__tests__/BotLobbyReference.test.ts src/lobby/LobbyServer.ts src/lobby/types.ts src/lobby/ResultSnapshot.ts src/lobby/__tests__/LobbyAuth.test.ts src/lobby/__tests__/RatingStore.test.ts src/lobby/integration/RoomToRanking.test.ts src/engine/server/network/MatchAdmission.ts src/engine/server/network/MatchResultReport.ts src/engine/server/network/__tests__/MatchAdmission.test.ts src/engine/server/network/__tests__/MatchResultReport.test.ts src/engine/server/network/__tests__/_resultReport.ts src/games/fps/server/Client.ts src/games/fps/server/GameServer.ts
npm.cmd exec -- biome check --write src/bot/BotRatingIdentity.ts src/bot/__tests__/BotRatingIdentity.test.ts
git diff --check
git -C src/games/fps diff --check
```

Logs: `.cache/ranking-bot-{focused,handoff,identity-final,full-tests,typecheck,format,format-final,biome,build,simulation,physics,tick,fuzz,bsp,replay,legacy-cli}.log`.

Assumptions/unverified: isolated accounts, local fresh test databases, source-based
Node bot runtime, signed scripted bot seats for the installed-map test. Neural
readiness tests use a controlled HybridBrain loader; they do not calibrate real
TF weights or measure AI strength. No user service restart, production reset,
historical import, browser skill display or real human-vs-AI calibration has
been performed. Existing uncommitted work is preserved; this slice is uncommitted.
Cold preparation with the user's real model files is unmeasured and shares the
existing eight-second bot-invite deadline; RM-07's real-service pilot must check
that latency along with strength and map/navigation conditions.

Exact files changed in RM-06:

- `src/shared/ranking/BotReference.ts`
- `src/shared/ranking/MatchRatingGroups.ts`
- `src/shared/ranking/__tests__/BotReference.test.ts`
- `src/shared/ranking/__tests__/_botReference.ts`
- `src/bot/BotRatingIdentity.ts`
- `src/bot/BotClient.ts`
- `src/bot/BotLobbyClient.ts`
- `src/bot/BotServer.ts`
- `src/bot/HybridBrain.ts`
- `src/bot/__tests__/BotRatingIdentity.test.ts`
- `src/bot/__tests__/BotLobbyReference.test.ts`
- `src/lobby/LobbyServer.ts`
- `src/lobby/types.ts`
- `src/lobby/ResultSnapshot.ts`
- `src/lobby/__tests__/LobbyAuth.test.ts`
- `src/lobby/__tests__/RatingStore.test.ts`
- `src/lobby/integration/RoomToRanking.test.ts`
- `src/engine/server/network/MatchAdmission.ts`
- `src/engine/server/network/MatchResultReport.ts`
- `src/engine/server/network/__tests__/MatchAdmission.test.ts`
- `src/engine/server/network/__tests__/MatchResultReport.test.ts`
- `src/engine/server/network/__tests__/_resultReport.ts`
- FPS submodule: `server/Client.ts`, `server/GameServer.ts`
- `docs/research/ranking_matches.md`
- `docs/manual/guides/lobby-server.md`
- `docs/changelog/v0.9.28.md`

## RM-05 human eligibility and live activation

`matchRatingGroups()` is a pure shared adapter consuming the verified normalized
snapshot and lobby-owned original roster. `RatingStore.ingest()` now uses it by
default, including the existing live `MatchResultStore.recordVerified()` route.
Eligible results load priors and commit skill, records, receipt and all updates
in the same transaction. There are no browser-supplied rating decisions.

- **Duel/Amphi:** exactly two original human opponents, unchanged opposite sides.
  Final authoritative standings determine win/draw, including a valid forfeit
  after reconnect grace even when the forfeiter led on raw score.
- **S&D:** each original human stays on their starting side. Both teams must
  contain players; each team is one rating group. Unequal team sizes are allowed.
  Personal kills do not replace the match's team result. Signed 5v5 results
  update all ten states together.
- **FFA:** every original human is a singleton group. All ordinal placements,
  including tied first and lower places, reach the numerical adapter.
- **Participation:** everyone must enter at the first Active tick and remain in
  play. Missing original roster/seats, drop-ins, changed teams and genuine
  interruptions produce a durable skill exclusion while retaining otherwise
  eligible W/L/D records. Held reconnect entities remain active in the world,
  so a held disconnect or successful resume is eligible. The final Duel/Amphi
  forfeiter is the only supported permanent departure for skill updates.
- **Bots:** private bot-containing matches remain `bot_reference_pending`;
  public bot results stay excluded. This does not assign uncalibrated bots
  human priors or change their fixed-reference plan.

### Participation evidence and compatibility

Previously, rejoining after spectating cleared `leftAtTick`. Team history
detected a changed side but could not detect returning to the same side. The
server now latches `participationInterrupted` for spectator departures and
genuine removals. Capturing/rejoining a seat never clears that flag. A held
resume seat and a valid final forfeit do not introduce an interruption; a
previous interruption still disqualifies a subsequent forfeit.

The flag is an optional authenticated V2 field; present values must be boolean.
New server snapshots always provide it. Older reports missing it still retain
records, but new ingestion gives `participation_unknown` rather than guessing
continuous play. Canonical snapshots leave an absent flag absent, preserving
existing saved hashes and replay. No SQL schema migration or historical result
import was introduced. Existing pending receipts remain pending on duplicate
delivery; replay uses the saved plan, not today's eligibility classifier.

### RM-05 validation and changed files

Focused validation: **128 tests / 9 files passed** in **71.98 seconds**. Includes
signed results for all four modes in both scopes, provisional first ratings,
duplicate protection/reopen/replay, 5v5 S&D, FFA lower ties, valid forfeits and
durable exclusions. Real socket tests cover held disconnect/resume, expiry and
spectating then rejoining the same FFA seat. Installed-map `wdm2` lobby tests
prove automatic public-human activation and private-bot pending state after
reopening. A spawned dedicated child also applies its signed human FFA result.

Full suite: **4,405 tests / 513 files passed** in **183.85 seconds**. Typecheck
and Biome passed (**0 errors / 322 warnings**, unchanged baseline). Build passed
in **55.08 seconds**, with 49 sourcemaps relocated; the existing asset view
excludes only local profiling archives. Existing transcoder, mixed-import and
chunk-size warnings remain. Required regressions exited **0**: tick checksum
**2768943778**; 1,000-tick fuzz **0 errors**, repeat checksum **2317247293**,
seed **1791738193886**; installed `wdm2` BSP info and the 91-tick movement replay
passed. Physics still emits its existing `wdm7` LightGrid mismatch and
StepSlideMove position warning; the initialization simulation has no initialized
collision world. These exit-zero commands do not prove those collision concerns
resolved.

Read-only CLI verification of the existing isolated RM-04 fixture still
reproduced **2 applied matches / 4 updates / 4 states**. Its previous human
`mode_adapter_pending` receipt remained pending. This verifies canonical replay
compatibility and no retroactive activation in another process.

Exact commands run for this slice (PowerShell, outer repository):

```powershell
npm.cmd exec -- vitest run src/shared/ranking/__tests__/MatchRatingGroups.test.ts src/shared/__tests__/NoEngineImports.test.ts src/lobby/__tests__/RatingStore.test.ts src/lobby/__tests__/ResultSnapshot.test.ts src/engine/server/network/__tests__/MatchResultReport.test.ts
npm.cmd exec -- vitest run src/shared/ranking/__tests__/MatchRatingGroups.test.ts src/shared/__tests__/NoEngineImports.test.ts src/lobby/__tests__/HumanRatings.test.ts src/lobby/__tests__/RatingStore.test.ts src/lobby/__tests__/ResultSnapshot.test.ts src/engine/server/network/__tests__/MatchResultReport.test.ts src/games/fps/server/__tests__/PlayedMatchResult.test.ts src/lobby/integration/RoomToRanking.test.ts src/lobby/integration/SpawnedResult.test.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd run lobby:server -- --ratings-verify --data-dir .cache/ranking-journal-smoke-IiezWn
npm.cmd exec -- biome check --write src/shared/ranking/MatchRatingGroups.ts src/shared/ranking/__tests__/MatchRatingGroups.test.ts src/lobby/__tests__/HumanRatings.test.ts src/lobby/__tests__/ResultSnapshot.test.ts src/lobby/RatingStore.ts src/lobby/ResultSnapshot.ts src/engine/server/network/MatchResultReport.ts src/engine/server/network/__tests__/MatchResultReport.test.ts src/engine/server/network/__tests__/_resultReport.ts src/games/fps/server/GameServer.ts src/games/fps/server/__tests__/PlayedMatchResult.test.ts src/lobby/integration/RoomToRanking.test.ts src/lobby/integration/SpawnedResult.test.ts
git diff --check
git -C src/games/fps diff --check
```

Exact files changed in RM-05 (earlier uncommitted work retained):

- `src/shared/ranking/MatchRatingGroups.ts`
- `src/shared/ranking/__tests__/MatchRatingGroups.test.ts`
- `src/lobby/RatingStore.ts`
- `src/lobby/ResultSnapshot.ts`
- `src/lobby/__tests__/HumanRatings.test.ts`
- `src/lobby/__tests__/RatingStore.test.ts`
- `src/lobby/__tests__/ResultSnapshot.test.ts`
- `src/engine/server/network/MatchResultReport.ts`
- `src/engine/server/network/__tests__/MatchResultReport.test.ts`
- `src/engine/server/network/__tests__/_resultReport.ts`
- `src/lobby/integration/RoomToRanking.test.ts`
- `src/lobby/integration/SpawnedResult.test.ts`
- FPS submodule: `server/GameServer.ts`, `server/__tests__/PlayedMatchResult.test.ts`
- `docs/research/ranking_matches.md`
- `docs/manual/guides/lobby-server.md`
- `docs/manual/guides/headless-mode.md`
- `docs/changelog/v0.9.28.md`

Assumptions/unverified: fresh isolated SQLite accounts and signed test fixtures;
real lobby/dedicated-server FFA handoffs on installed `wdm2`; actual socket
Duel/Amphi forfeits use test countdowns and accelerated grace expiry. The private
bot seat uses admission, not live AI. Human pilots, browser skill display, bot
calibration and crash/retry delivery remain future work. No user service was
restarted, no production data/demo reset or historical import was performed,
and this slice is not committed.

Logs: `.cache/ranking-modes-{focused,activation,typecheck,format,full-tests,biome,build,simulation,physics,tick,fuzz,bsp,replay,legacy-cli}.log`.

## RM-04 transactional snapshot and rating journal

The trusted lobby result path now calls `MatchResultStore.recordVerified()`.
It normalizes the authenticated V2 report together with lobby-owned scope,
starting roster and bot count, then ingests through `RatingStore` on the
**same SQLite connection** used for W/L/D records. All writes use one
`BEGIN IMMEDIATE` transaction. The owner enables foreign keys, WAL and a
five-second writer busy timeout.

Receipts retain start/end wall times and ticks, completion, team standings,
all played seats, team membership, late joins, departures/forfeits and the
original starting roster when available. Ticket fields, authentication secrets,
names and lobby connection IDs are omitted. Canonical snapshots are hashed;
seat rows and eligible record projections are checked against them before
commit and during replay. This checks internal consistency; authentication
still comes from the signed-report/admission verifier.

### Fresh schema and processing

| Table | Purpose |
| --- | --- |
| `ranking_schema` | Independent version **1**, without changing account `user_version` |
| `ranking_policies` | Immutable `shag-trueskill-v1` parameters; mismatches fail instead of overwriting the policy |
| `ranking_results` | Unique match ID, committed sequence, canonical V2 snapshot/digest, scope/mode, policy, record/rating status/reason and applied group plan |
| `ranking_seats` | Human/bot scores, outcomes/placements, teams and participation, with account foreign keys and unique seat/account constraints |
| `ratings` | Full-precision state keyed by account, mode, scope and policy, rated count, last sequence and that result's end time |
| `rating_updates` | Per-match/account/policy before/after states and conservative scores; no bot account ratings |

Initialization creates empty journal/rating tables. Development record rows are
left in place and never imported; production still starts fresh as approved.
A legacy record sharing a new result ID is refused rather than adopted as a
V2 receipt. Unsupported/partial schemas or changed policies fail without an
automatic reset. No migration, backfill, demo import or production reset was added.

Eligible completed records still populate the existing boards. Aborted and
ineligible reports now persist excluded receipts/seats without W/L/D or skill
entries. Runtime diagnostics remain `skipped` with the exclusion reason even
though the audit receipt is saved. Private bot games retain human records and
all played bot seats.

At completion of RM-04, live human results had **pending / `mode_adapter_pending`**;
RM-05 below now activates eligible new human results. Private bot games still
have **pending / `bot_reference_pending`**. The internal applied-plan
API loads current states inside the transaction, requires each verified human
exactly once and standings consistent with the snapshot, then commits RM-03
math, the receipt, records and every before/after update together. Bots and
excluded records cannot use this human path. RM-05 now supplies grouping and
participation eligibility on the default live route. An explicit internal plan
remains useful for numerical/storage tests and saved-plan replay.

Equivalent reordered duplicates preserve the original receipt without a new
sequence or another rating update. Changed payloads under that ID fail.
Duplicates cannot activate pending receipts. Late results append in committed
ingestion order; end times do not rewrite already applied history. Pending
reprocessing and future-policy activation need an ordered replay workflow,
rather than appending old updates on top of newer states.

### Read-only operational verification

```powershell
npm.cmd run lobby:server -- --ratings-info --data-dir ./server-data
npm.cmd run lobby:server -- --ratings-verify --data-dir ./server-data
```

Info reports schema/policy version, receipt/seat/rating/update counts, processing
reasons per scope/mode and the latest receipt. Verify additionally replays
applied plans in ingestion order, checking snapshots, seat/record projections,
every full-precision before/after update and current pool states. A consistent
WAL read snapshot prevents false divergence during another writer's commit.
Verification fails if storage is unavailable/unsupported or replay diverges.
Neither tool initializes storage or starts a service. A consistent applied-zero
journal is not evidence that live skill is enabled; inspect counts/reasons.

An isolated `.cache/ranking-journal-smoke-IiezWn` database was created by the
local `.cache/ranking-journal-smoke.ts` helper and closed before the actual CLI
ran in another process. It reported **4 receipts / 8 seats / 4 rating states /
4 updates**: two applied human results in different scopes, a pending human
result and an excluded abort. Replay reproduced **2 applied matches / 4
updates / 4 states**. Missing-path verification exited **1**, created no
directory and started no service. These are synthetic fixtures, not user matches.

### RM-04 validation and changed files

Focused storage/snapshot tests: **54 passed / 2 files** (40 journal tests and 14
normalization tests). SQL triggers fail the second insert at seat, record,
rating and journal stages to prove earlier writes roll back too. Coverage
includes unknown accounts, corrected retries, reopening, legacy collisions,
schema/policy mismatch, eight mode/scope pools, late arrival order,
duplicates/conflicts, private bots, excluded results and corruption detection.
An isolated Node child was killed with uncommitted rating/journal mutations;
reopening preserved the last committed state and duplicate protection. Another
WAL connection committed a store update during replay; the reader verified its
original snapshot and then saw the new commit afterward.

Full suite: **4,354 tests / 511 files passed** in **185.37 seconds**, including
installed `wdm2` public-human/private-bot handoffs. Those cases now assert that
snapshots and original starting rosters survive reopening with the correct
scope/pending reason. The spawned open-space signed FFA handoff checks journal
retention too. The existing record/diagnostics focused cases also pass.

Typecheck, Biome (**0 errors / 322 warnings**) and build passed. Build:
**56.90 seconds**, 49 sourcemaps relocated, using the existing public asset view
excluding only local profiling archives. Existing transcoder/mixed-import/
chunk warnings remain. Required regressions exited **0**: tick checksum
**2768943778**; 1,000-tick fuzz **0 errors**, repeat checksum **4216131562**,
seed **1791735612557**; BSP info and the 91-tick replay passed. Physics retains
the existing `wdm7` LightGrid mismatch and StepSlideMove position warnings.
The initialization simulation still reports no initialized collision world;
its pass does not validate map collisions.

Exact commands from the outer repository (PowerShell):

```powershell
npm.cmd exec -- biome check --write src/lobby/ResultSnapshot.ts src/lobby/RatingStore.ts src/lobby/MatchResultStore.ts src/lobby/LobbyServer.ts src/cli/lobby-server.ts
npm.cmd exec -- vitest run src/lobby/__tests__/RatingStore.test.ts src/lobby/__tests__/ResultSnapshot.test.ts src/lobby/__tests__/MatchResultStore.test.ts src/lobby/__tests__/ResultDiagnostics.test.ts
npm.cmd exec -- vitest run src/lobby/__tests__/RatingStore.test.ts src/lobby/__tests__/ResultSnapshot.test.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd exec -- vite-node .cache/ranking-journal-smoke.ts
npm.cmd run lobby:server -- --ratings-verify --data-dir .cache/ranking-journal-smoke-IiezWn
npm.cmd run lobby:server -- --ratings-verify --data-dir .cache/ranking-journal-smoke-IiezWn/missing
git diff --check
git -C src/games/fps diff --check
```

Changed files in RM-04:

- `src/lobby/RatingStore.ts`
- `src/lobby/ResultSnapshot.ts`
- `src/lobby/MatchResultStore.ts`
- `src/lobby/LobbyServer.ts`
- `src/cli/lobby-server.ts`
- `src/lobby/__tests__/RatingStore.test.ts`
- `src/lobby/__tests__/ResultSnapshot.test.ts`
- `src/lobby/__tests__/MatchResultStore.test.ts`
- `src/lobby/integration/RoomToRanking.test.ts`
- `src/lobby/integration/SpawnedResult.test.ts`
- `docs/research/ranking_matches.md`
- `docs/manual/guides/headless-mode.md`
- `docs/manual/guides/lobby-server.md`
- `docs/changelog/v0.9.28.md`

Assumptions/unverified: isolated fresh SQLite accounts/results, synthetic
human applied plans and installed-map FFA handoffs on the current Node runtime.
No live user service restart, database/demo reset, historical import or browser
validation. The process-death test proves SQLite rollback; durable child result
delivery, retries and restoration of verification context remain RM-09.
At this stage human mode eligibility was not yet implemented; RM-05 below
adds it. Bot calibration, skill queries/UI and future-policy activation/reprocessing
remain unimplemented. Earlier pending work in both
repositories is preserved; RM-04 changed no FPS submodule files.

Logs: `.cache/ranking-journal-{focused,storage-final,existing,typecheck,biome,build,full-tests,cli,cli-missing,smoke-create,format,simulation,physics,tick,fuzz,bsp,replay}.log`.

## RM-03 numerical foundation and simulation

`rateMatch(mode, groups)` consumes human groups with stable account identities,
prior states and ordinal ranks. A team is one group; each FFA player is a group.
Lower ranks win and equal ranks draw, including lower-place FFA ties. Rank gaps
are normalized: a score margin or a gap between placement numbers adds no
extra weight. Team membership, full-match eligibility, result scope and bot
references are the authoritative caller's responsibility in RM-04/RM-05/RM-07.
The adapter assumes equal, full participation; it does not accept client results
or treat an uncalibrated bot as another human account.

The adapter returns fresh before/after snapshots in stable player-ID order and
never changes an input. Stable group/member ordering makes reordered retries
produce identical numerical outputs on the pinned implementation/runtime.
Policy mismatches, duplicate identities, invalid priors/ranks and unsafe counts
are rejected. Numerical underflow/overflow fails the whole calculation rather
than returning a partial update, NaN or an invented fallback rating. Transactional
commit/rollback and separation of public/private mode pools are provided by RM-04.
Reliable result delivery/recovery remains RM-09.

### Starting policy: `shag-trueskill-v1`

| Parameter | Value / meaning |
| --- | --- |
| Implementation | Exact `ts-trueskill@5.1.0`; lockfile pins the complete dependency graph, including `ts-gaussian@3.1.0`, `mathjs@13.2.3` and `uuid@11.1.1` |
| Prior | `mu = 25`, `sigma = 25 / 3` |
| Performance noise / dynamics | `beta = 25 / 6`, `tau = 25 / 300` per rated contest |
| Draw model | `0.1` independently configured for each of Duel, Amphi, FFA and S&D; these are starting model assumptions, not measured SHAG draw frequencies |
| Numerical convergence | `minDelta = 0.0001` |
| Ladder key | Full-precision `mu - 3 * sigma`; never sort by rounded display numbers |
| Display | `round(1000 + 40 * (mu - 3 * sigma))`, label **Rating**; no artificial floor or ceiling |
| Provisional | Fewer than 10 rated matches **or** `sigma > 25 / 6`; both evidence conditions must pass, without hiding the first-match row |

The classic starting parameters and conservative-score approach follow the
[reference implementation's documentation](https://trueskill.org/) and
[Microsoft's TrueSkill explanation](https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/).
The chosen TypeScript port is [ts-trueskill](https://github.com/scttcper/ts-trueskill).
Every numerical/presentation change requires a new policy version and a separate
replay; a dependency change must also be evaluated as a policy revision before
activation. The display scale and provisional threshold above are the initial
implementation policy, still awaiting human pilot validation before production.
Mode draw frequencies, especially overtime modes, need measurement rather than
an assumption that every mode has the same real draw rate.

### Findings from the reproducible simulation

Run `npm.cmd run ranking:simulate`. It prints JSON containing the policy,
seed **927**, uncertainty/rating checkpoints and first non-provisional match for
each player. Four scenarios each run 500 synthetic human contests, using seeded
Gaussian performance noise: equal-strength Duel, a 20-mu-gap Duel, ten-player
FFA with a skill spread, and shuffled 5v5 teams with the same spread. All players
participate fully; these particular simulations generate no draws. They open no
database or service and do not establish bot-reference strength or real player
rating distributions.

| Scenario | First non-provisional match | Sigma after 10 / 30 / 100 matches per player |
| --- | --- | --- |
| Equal-strength Duel | 10, both players | 3.022 / 1.527 / 0.884 |
| One-sided Duel | 30, both players | 4.947 / 4.149 / 3.540 |
| Ten-player FFA | 10, all players | 1.562–1.868 / 0.926–1.053 / 0.651–0.727 |
| Shuffled 5v5 | 40, all players | 6.590 / 4.644 / 2.713 |

A fixed ten-game qualification would mark the simulated one-sided Duel and
5v5 players established while their uncertainty remains high. Keeping the
uncertainty check avoids that; provisional status is a label, not a hidden row.
The 5v5 simulation eventually recovers the synthetic skill ordering after 500
matches, while its early estimates remain noisy. This is a numerical smoke
check, not a claim about human match convergence or calibration.

With equal new 1v1 priors, the displayed first-match values are **1315** for a
win, **964** for a loss and **1225** for a draw (prior: 1000). Even a repeatedly
losing player's conservative rating can later rise as uncertainty falls; tests
cover this. Do not present Elo, fixed win/loss point deltas or wins-needed hints.
Across separate modes the same formula is a presentation convention, not proof
that equal displayed ratings imply equal ability across those modes.

TrueSkill's multi-group approximation introduces tiny asymmetries between
identical tied FFA players: in the new four-player `0,0,2,2` case, the tied
means differ by about **0.0067 mu** and uncertainty by **0.0033 sigma**.
Canonical account ordering makes this reproducible; no custom averaging of
posteriors was added. Tied standings remain tied inputs. Use full-precision
scores and a stable account tie-break in the eventual store query.

### RM-03 validation and changed files

Focused checks passed **45 tests / 2 files**: 44 rating tests and the existing
shared-layer guard. Independent rounded vectors cover the published 1v1
win/draw, uneven 1v2 and Microsoft's eight-player FFA table with absolute
tolerance **0.001**; the port's published 2v2 vector is also checked. Additional
cases cover policy isolation, team/member/report permutations, all-draw FFA,
tied leaders/lower places, immutable inputs, safe failures, upsets and repeated
Duel/ten-player FFA matches. These rounded reference tests do not claim an
independent full-precision oracle or bit-identical results across all runtimes.

Exact commands from the outer repository (PowerShell):

```powershell
npm.cmd install --save-exact --ignore-scripts --no-audit --no-fund ts-trueskill@5.1.0
npm.cmd exec -- biome check --write src/shared/ranking src/cli/ranking-simulate.ts package.json
npm.cmd run typecheck
npm.cmd exec -- vitest run src/shared/ranking/__tests__/TrueSkillRating.test.ts src/shared/__tests__/NoEngineImports.test.ts
npm.cmd run ranking:simulate
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
git diff --check
git -C src/games/fps diff --check
```

Final full suite: **4,300 tests / 509 files passed** in **183.16 seconds**,
including the installed-map public/private handoffs and prior roster tests.
Typecheck and whitespace checks in both repositories passed. Biome passed
with **0 errors / 322 warnings**, below the unchanged 339-warning baseline.
The production build passed in **51.35 seconds**, with 49 sourcemaps relocated.
The build uses the existing public asset view excluding only local profiling
archives, as described in the earlier validation notes; it still emits existing
Babylon transcoder externalization, mixed-import and chunk-size warnings.
The first build caught an ES2022 helper introduced by Biome; mode validation
was changed to an ES2020-compatible check before the successful final gates.
No renderer or networking runtime code was changed in RM-03; the earlier RM-02
networking results remain below as their own validation record.

Files changed in this slice:

- `src/shared/ranking/RatingPolicy.ts`
- `src/shared/ranking/TrueSkillRating.ts`
- `src/shared/ranking/__tests__/TrueSkillRating.test.ts`
- `src/cli/ranking-simulate.ts`
- `package.json` and `package-lock.json`
- `docs/research/ranking_matches.md`
- `docs/manual/guides/headless-mode.md`
- `docs/manual/guides/lobby-server.md`
- `docs/changelog/v0.9.28.md`

Assumptions/unverified: human full-participation numerical inputs, current Node
runtime and locked dependencies; no actual user matches, live service restart,
database/demo reset, historical import or browser validation. Live ratings,
durable snapshot/update journal, mode eligibility, bot calibration and UI remain
pending. Existing uncommitted RM-00/RM-01/RM-02 files are preserved.
The repeated simulation output matched byte-for-byte across separate Node
processes (SHA-256 `2BDDFDD94F01CAE7C4FCB0607B12B47C864928471E236E58DEABF9EC002F01B7`).
Logs: `.cache/ranking-math-{focused,simulation,simulation-repeat,typecheck,build,format,biome,full-tests}.log`.

## RM-02 validation

The final focused suite passed **48 tests / 7 files**. Eight real-socket result
cases cover a held player at normal finish, permanent FFA departure, resume,
late drop-in and spectator exclusion, lower/tied-top placements, Duel/Amphi
forfeit, simultaneous departures and graceful abort. Grace-expiry tests age
the held records while keeping production's 20-second grace unchanged. Every
final report is signed and verified against its actual admission manifest.
The existing Amphi BO3 test also checks final team scores and stable first-round
membership. Negative V2 tests cover tampered metadata and duplicate seats.

The first full run passed the installed `wdm2` public/private handoffs and all
new socket tests, but one older store fixture reused a ticket hash for two
players. Corrected that fixture to distinct credentials; the focused rerun
passed. The final full suite passed **4,256 tests / 508 files** in
**176.60 seconds**, including both real installed-map handoffs and all new
roster/result tests. Both repositories' final whitespace checks passed.

Exact commands from the outer repository (PowerShell):

```powershell
npm.cmd run typecheck
npm.cmd exec -- vitest run src/games/fps/server/__tests__/PlayedMatchResult.test.ts src/games/fps/server/__tests__/SuspendedSessions.test.ts src/games/fps/server/__tests__/SessionResume.test.ts src/games/fps/server/__tests__/AmphiProtocol.test.ts src/engine/server/network/__tests__/MatchResultReport.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts src/lobby/__tests__/MatchResultStore.test.ts
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
git diff --check
git -C src/games/fps diff --check
```

Typecheck, Biome (0 errors / 322 warnings), build and required networking
regressions passed. Build: **44.82 seconds**, 49 sourcemaps relocated; uses the
temporary public asset view described below, excluding only local profiling
archives. Physics still exits 0 with the existing `wdm7` LightGrid dimension
and StepSlideMove position warnings. Tick checksum **2768943778**; 1,000-tick
fuzz: no errors, repeated checksum **3577360784**, seed **1791731952062**.
BSP info and the 91-tick replay passed.

Assumptions: fresh isolated accounts/result databases, installed `wdm2` FFA
handoffs, open-space socket tests with accelerated match timers and authentic
seat/resume credentials. No live user service or browser visual testing;
no database/demo reset or historical import. At the RM-02 stage, full snapshot persistence,
delivery retries, killed-process recovery, numerical ratings and bot
calibration remain unimplemented. No FFA/S&D departure forfeit was introduced.

Logs: `.cache/ranking-roster-focused-final.log`,
`.cache/ranking-roster-full-tests.log`, `.cache/ranking-roster-full-tests-final.log`,
`.cache/ranking-roster-build.log`, `.cache/ranking-roster-typecheck.log`,
`.cache/ranking-roster-biome.log`, and
`.cache/ranking-roster-{simulation,physics,tick,fuzz,bsp,replay}.log`.

## RM-00/RM-01 validation

The focused suite passed **44 tests / 7 files**, including independent scope
ordering/local rows/date windows, old/mismatched protocol replies, UI caches
and delayed replies, bounded diagnostics and read-only inspection. Real
`wdm2` FFA lobby launches passed for both public humans and a private human/bot
seat, with exactly one stored match per temporary database. Both boards were
read over WebSocket, the opposite scope stayed empty, and reopening preserved
the selected board. The private demo header/frames also passed.

Commands run from the outer repository (PowerShell):

```powershell
npm.cmd run typecheck
npm.cmd exec -- vitest run src/lobby/__tests__/MatchResultStore.test.ts src/lobby/__tests__/ResultDiagnostics.test.ts src/lobby/__tests__/LobbyClientConnection.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts src/games/fps/client/__tests__/LeaderboardView.test.ts src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts src/lobby/integration/RoomToRanking.test.ts
npm.cmd run lobby:server -- --results-info
npm.cmd run test:run
npm.cmd exec -- vitest run src/games/fps/server/__tests__/LagCompensationLatency.test.ts
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
git diff --check
git -C src/games/fps diff --check
```

Typecheck, Biome (0 errors / 322 warnings, below baseline), build and required
networking regressions passed. Build used the same temporary all-game-assets
view described below, excluding only local benchmark report archives, and
relocated 49 sourcemaps. The physics smoke still exits 0 with existing `wdm7`
LightGrid/StepSlideMove warnings. Tick determinism checksum: **2768943778**;
1,000-tick fuzz: no errors, repeat checksum **748359046**, seed
**1791730421116**. BSP info and the **91-tick** replay passed.

The first full suite run exposed four outdated Profile record fixtures missing
the now-required public scope; updated the fixture to match the protocol. It
also hit an existing socket-latency timing assertion (about 72 ms versus over
80 ms), which passed when rerun alone without any latency code changes.
The final full suite passed **4,236 tests / 507 files** in **176.13 seconds**,
including the profile and latency tests, with no concurrent build. Final
typecheck/Biome and both repositories' whitespace checks also passed. The
build passed in approximately 61 seconds, with the packaging caveat below.

Local logs: `.cache/ranking-scopes-focused.log`,
`.cache/ranking-scopes-full-tests.log`, `.cache/ranking-scopes-full-tests-final.log`,
`.cache/ranking-scopes-latency-recheck.log`, `.cache/ranking-scopes-build.log`,
`.cache/ranking-scopes-results-info.log`, `.cache/ranking-scopes-typecheck.log`,
`.cache/ranking-scopes-biome.log`, and
`.cache/ranking-scopes-{simulation,physics,tick,fuzz,bsp,replay}.log`.

No browser visual check or real user-account/live AI match was performed.
The default local database inspection returned `schema_unavailable`; the
browser's active endpoint/data directory remain unverified. No running lobby,
account database or existing result/demo archive was restarted or reset.

## Foundation validation (before RM-01)

The focused suite passed: **49 tests / 9 files**, including both real lobby
launches and v1–v4 demo compatibility. The final full suite passed:
**4,231 tests / 506 files**, including the additional demo ownership/featured
checks and the updated bot-training pipeline regression.

Commands run from the outer repository (PowerShell):

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build -- --config .cache/ranking-build.config.ts
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd exec -- vitest run src/lobby/__tests__/MatchResultStore.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts src/lobby/__tests__/FeaturedDemos.test.ts src/games/fps/client/__tests__/LeaderboardView.test.ts src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts src/games/fps/server/__tests__/DemoRecorder.test.ts src/games/fps/server/__tests__/DemoRecordingGating.test.ts src/lobby/integration/RoomToRanking.test.ts src/lobby/integration/SpawnedResult.test.ts
git diff --check
git -C src/games/fps diff --check
```

Build validation uses the normal configuration with only `publicDir` overridden
to `.cache/ranking-build-public`: a linked view of every public game asset,
excluding only `data/benchmarks/results`. This avoids duplicating gigabytes of
local profiling reports. The application bundle and postbuild sourcemap
relocation ran normally; ordinary release asset packaging was not tested here.

The physics smoke exits 0 but prints the existing `wdm7` LightGrid dimension
mismatch and StepSlideMove position warning. Those diagnostics are outside
this ranking change. Tick determinism: **2768943778**. The 1,000-tick fuzz run
reported no errors and repeated checksum **1077365143**, seed **1791711640430**.
BSP inspection and the **91-tick** movement replay passed.

The first full run had one failure: the bot-training pipeline test expected
the recorder's previous version number (3). Its extraction/labels passed.
Updated that assertion for v4 and its default-public metadata; the clean full
run passed in **198.18 seconds**. Typecheck, Biome (0 errors / 322 warnings,
below baseline), and the build (59.16 seconds, 49 source maps relocated) passed.
Both repositories' diff whitespace checks passed. The built browser bundles
contain the leaderboard checkbox and the v4 visibility reader; this is bundle
verification, not a browser visual check.

Local logs: `.cache/ranking-focused.log`, `.cache/ranking-full-tests-final.log`,
`.cache/ranking-build.log`, and `.cache/ranking-{simulation,physics,tick,fuzz,bsp,replay}.log`.
The temporary build configuration/asset-view helper and logs are ignored local
validation artifacts. Implementation changes remain uncommitted in the outer
repo and FPS submodule.

## Files changed

Includes the predecessor's unfinished R1–R4 edits. All paths are relative to
the outer repo; the FPS paths belong to its submodule.

| Area | Files |
| --- | --- |
| Result store and lobby protocol | `src/lobby/MatchResultStore.ts`, `src/lobby/LobbyServer.ts`, `src/lobby/LobbyClient.ts`, `src/lobby/types.ts` |
| Result diagnostics and read-only inspection | `src/lobby/ResultDiagnostics.ts`, `src/cli/lobby-server.ts`, `src/node-sqlite.d.ts`, `src/lobby/__tests__/ResultDiagnostics.test.ts`, `src/lobby/__tests__/LobbyClientConnection.test.ts` |
| V2 result contract and tests | `src/engine/server/network/MatchResultReport.ts`, `src/engine/server/network/__tests__/MatchResultReport.test.ts`, `src/engine/server/network/__tests__/_resultReport.ts` |
| Played roster/reconnect lifecycle and tests | `src/games/fps/server/SuspendedSessions.ts`, `src/games/fps/server/gametypes/MatchState.ts`, `src/games/fps/server/__tests__/PlayedMatchResult.test.ts`, `src/games/fps/server/__tests__/SuspendedSessions.test.ts`, `src/games/fps/server/__tests__/AmphiProtocol.test.ts` |
| Spawn/recording handoff and readback | `src/lobby/GameServerSpawner.ts`, `src/cli/headless-netserver-v2.ts`, `src/shared/demo/DemoReader.ts`, `src/games/fps/server/Client.ts`, `src/games/fps/server/GameServer.ts`, `src/games/fps/server/DemoRecorder.ts` |
| Featured selection | `src/lobby/FeaturedDemos.ts` |
| Leaderboard UI | `src/games/fps/client/LeaderboardView.ts`, `src/games/fps/client/NewUiApi.ts`, `src/games/fps/client/styles/Leaderboard.css` |
| Lobby regression tests | `src/lobby/__tests__/MatchResultStore.test.ts`, `src/lobby/__tests__/GameServerSpawnerAdmission.test.ts`, `src/lobby/__tests__/FeaturedDemos.test.ts`, `src/lobby/__tests__/DemoOwnership.test.ts`, `src/lobby/integration/RoomToRanking.test.ts`, `src/lobby/integration/SpawnedResult.test.ts` |
| UI/demo/training regression tests | `src/games/fps/client/__tests__/LeaderboardView.test.ts`, `src/games/fps/client/__tests__/NewUiApiLeaderboard.test.ts`, `src/games/fps/client/__tests__/ProfileRecord.test.ts`, `src/games/fps/server/__tests__/DemoRecorder.test.ts`, `src/games/fps/server/__tests__/DemoRecordingGating.test.ts`, `src/bot/__tests__/DemoPipelineEndToEnd.test.ts` |
| Documentation | `docs/research/ranking_matches.md`, `docs/manual/guides/lobby-server.md`, `docs/manual/guides/headless-mode.md`, `docs/changelog/v0.9.28.md` |
