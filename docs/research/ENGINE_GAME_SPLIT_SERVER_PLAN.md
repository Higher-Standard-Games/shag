# Repository split: server ownership plan

Status: implementation sequence, 2026-10-23. Phase 1 is validated in
progress-log step 15; application file moves and Git detachment remain pending.
Inspected baseline: SHAG `8d070ebc`, Washoi `536f8cb`.

## Goal and boundary

Both repositories must be checkoutable without fetching the other. SHAG must
have no source, build, test or installation requirement on Washoi. Running
Washoi can require an explicitly assembled checkout containing SHAG; standalone
execution of either checkout is not a release requirement. The game manual
will document that assembly. Package publication is unnecessary for this goal.

Reusable server, lobby, transport, admission, result storage and editor
infrastructure stay in SHAG. Concrete Washoi composition, bots and tools belong
to Washoi. Preserve server behavior while changing ownership and launch paths.
Do not combine this work with gameplay, protocol, rating, database, transport,
tick scheduling or performance changes.

The engine production source boundary is already clean, including the editor
map-report pipeline. The remaining work extends that boundary to the outer
applications, tools, tests and repository configuration. See
[the progress log](./ENGINE_GAME_SPLIT_PROGRESS.md) and
[dependency inventory](./ENGINE_GAME_SPLIT_INVENTORY.md).

## What the source says

The dedicated `GameServer` and its gametypes already live in Washoi. The risky
part is the surrounding process contract:

| Existing owner/path | Responsibility | Intended ownership |
| --- | --- | --- |
| `src/games/fps/server/` | Washoi match implementation | Washoi; preserve implementation |
| `src/cli/headless-netserver-v2.ts` | Builds the concrete server, loads its map, handles process input/output | Washoi entry point, initially moved intact |
| `src/cli/HeadlessMapLoader.ts` | Indexed BSP/collision loading combined with Washoi pickup extraction/placement | Washoi composition, initially moved intact |
| `src/cli/HeadlessBSPCollisionWorld.ts`, `_runCli.ts`, `ServerMemoryMarker.ts` | Reusable collision factory, CLI failure handling, telemetry | SHAG; avoid incidental relocation |
| `src/lobby/GameServerSpawner.ts`, `ServerRuntime.ts` | Child process ownership and runtime selection | SHAG, with game-supplied entry locations |
| `src/lobby/LobbyServer.ts` | Rooms, accounts, match lifecycle and results; also imports Washoi demo-map aliases | SHAG service; supply the alias policy from Washoi |
| `src/lobby/PlayerIdentity.ts` | Shared browser/server key and name validation; imports Washoi bot names | SHAG validation with explicit game name policy |
| `src/cli/lobby-server.ts` | Application startup and storage composition | Washoi startup supplying generic SHAG services and game policy |
| `src/bot/`, `src/cli/bot-server.ts` | Washoi bot application and startup | Washoi, in a later separate step |
| `scripts/build-servers.mjs` | Selects five concrete application/probe entry points and publishes bundles | Washoi assembly recipe; retain atomic publishing behavior |
| `src/engine/server/`, generic `src/shared/` contracts, lobby stores | Reusable execution, networking and persistence | SHAG; keep algorithms and formats unchanged |

Proposed destinations are under the game checkout's `cli/` and `scripts/`
directories. Exact exported configuration names are implementation decisions,
not APIs already available in the repository.

## Contracts to preserve

1. **Runtime and process ownership.** Children inherit the parent's actual
   executable. Source Node launches use the Vite Node wrapper; source Bun and
   bundled launches run the entry directly. Preserve argument arrays,
   `shell: false`, hidden Windows children, piped standard streams and the
   assembled root working directory. Test paths containing spaces.
2. **Artifacts.** Keep `dist-server/headless-netserver-v2.mjs`,
   `lobby-server.mjs`, `bot-server.mjs`, `ServerBenchmarkClient.mjs` and
   `ServerRuntimeProbe.mjs` during the ownership migration. Changing source
   ownership does not require renaming deployment artifacts.
3. **Admission.** Preserve generation and handling of `SHAG_MATCH_ADMISSION`,
   `SHAG_MATCH_RESULT_SECRET` and `SHAG_MATCH_RESULT_OUTBOX`, including removal
   of inherited values before assigning a child's values. Preserve seat grants,
   reconnection behavior, stdin admission commands and acknowledgement parsing.
   Validation receipts must redact secret values.
4. **Readiness and cleanup.** Preserve the launcher's `Ready for connections`
   output and the spawner's accepted readiness messages. Preserve port
   reservation/reuse, startup failure cleanup and existing timeout values.
5. **Results.** Preserve signed result validation, issued-roster checks,
   durable outbox publication, retries, duplicate handling and ranking delivery.
   No result/database migration belongs in this change.
6. **Shutdown and demos.** Preserve `quit\n` on stdin and awaited server stop,
   signal handling and the spawner's forced termination fallback. Recordings
   must finish saving on graceful shutdown, including on Windows.
7. **Simulation and map data.** Preserve indexed PK3 lookup, map digest,
   collision, spawn points, pickups, triggers, PVS and telemetry stages. Keep
   gametype aliases, flags, defaults, tick/snapshot cadence and demo formats.
8. **Identity and presentation.** Supply the same bot-name classification to
   browser and server. Preserve key parsing/formatting (including `WASHOI`),
   default-name reservation and demo levelshot alias results. Removing an
   import is not a reason to change account keys or accepted names.

The build script stages complete bundles and swaps directories with rollback
on publication failure. Retain that property. Validation builds must use an
isolated checkout/output directory, not replace artifacts used by a live lobby.
Keep WebTransport support intact.

## Implementation sequence

### 0. Capture a reproducible server baseline

Record both revisions, installed runtime versions, build inputs and artifact
hashes. Run the server checks below before moving code. Save deterministic
results for comparison; matching two newly modified implementations alone is
insufficient evidence of parity with the baseline.

Use scratch accounts, settings, results, recordings and ports for integration
checks. Do not use the normal player database or attach to live services.
Capture real spawn, readiness, admission, match result and shutdown behavior.

### 1. Make the child entry an explicit input

This is the smallest first implementation patch. Extend the existing runtime/
spawner configuration to receive source and bundled entry locations. Preserve
the executable selection, argument construction and process lifecycle. Update
the Washoi lobby composition to supply the existing locations first, before
moving them. Exercise the same configuration through the runtime probe.

The reusable service must ultimately have no fallback path pointing at a
Washoi application. A spawner without a configured application should fail
clearly when asked to spawn; reusable lobby construction/testing need not
require a game process. Validate configuration before allocating resources or
preparing result delivery. Choose the precise failure boundary after checking
all spawner callers. Do not change normal configured-match behavior.

Keep configuration as explicit paths/options passed by composition code. No
plugin discovery, executable shell strings or new process framework is needed.

### 2. Move dedicated-server composition and build ownership

Move the launcher and mixed map loader to Washoi, preserving their bodies
except for imports and necessary entry wiring. Move the lobby application
bootstrap to Washoi and supply its new source entry location. Transfer the
concrete server build recipe to Washoi, adapting root resolution explicitly.
Preserve bundle basenames, assembled-root cwd and atomic output publication.

Land paired game/engine changes together as a verified revision pair. All
entry references in development scripts, probes, benchmarks, deployment files
and tests must follow the move. Temporary compatibility wrappers may help an
intermediate commit, but any SHAG wrapper importing Washoi must be removed
before declaring repository independence.

Do not extract a new generic BSP service during this move. The existing generic
collision/index helpers remain reusable; a further extraction can be evaluated
after ownership is correct and server parity is established.

### 3. Supply the two remaining lobby policies

Replace the demo-map alias import with an explicitly supplied resolver. Replace
the bot-name import with game-supplied reservation policy, tracing every browser
and server caller so validation remains consistent. Use existing constructor/
options patterns where suitable; avoid a global mutable policy if explicit
arguments or a configured validator suffice.

Test exact existing names, aliases and account-key fixtures. Keep generic
account, room, result and rating implementations in SHAG. Broader lobby
generality is outside this patch unless a remaining import requires it.

### 4. Move bots and game tools in separate patches

Move the concrete bot application and its startup, preserving control
authentication, real client connections, navigation, training/demo selection,
model paths and persistence. Audit TensorFlow dependencies/fixups with this
step. Do not rewrite bot algorithms or formats.

Then migrate remaining game CLI tools and editor composition entry points in
small groups. Preserve reusable implementations in SHAG. Move game integration
tests with their subjects; use neutral fixtures only for genuinely generic
engine behavior. Preserve coverage and test discovery across the assembled pair.

### 5. Prove checkout independence and remove the Git attachment last

Audit package scripts, aliases, TypeScript/Vitest/Vite inputs, CI, platform
metadata, assets/configuration recipes and deployment paths. Distinguish game
assembly commands from engine-only commands. No engine installation/build/test
step may silently fetch or require Washoi. Unexercised platform paths must be
reported explicitly rather than assumed correct.

Document the game-owned assembly layout, working directory, asset installation,
build/start commands and a tested pair of revisions in the game manual. Keep
revision compatibility information with the game assembly; SHAG need not pin
or fetch Washoi. Exact clone URLs/commands must be checked before publication.

In disposable checkouts, verify: SHAG alone installs and passes its retained
checks; Washoi alone checks out without fetching SHAG; the documented assembly
builds and completes the server scenarios below. Washoi-alone execution is
outside the acceptance criteria.

Only then remove the engine gitlink and `.gitmodules` attachment, recursive
checkout assumptions and obsolete game commands. Preserve the existing local
game checkout and its Git metadata; do not use recursive deletion or submodule
deinitialization as a shortcut. Repeat the fresh-checkout proof after cutover.

## Validation checkpoints

These are planned checks, not results from this planning session. The command
names below exist at the inspected baseline; migrate their game-owned entry
paths explicitly as part of the relevant patch.

For each server-sensitive patch, run:

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run build
npm.cmd run build:server
npm.cmd run gate:biome
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm.cmd run test:runtime-equivalence
npm.cmd run test:server-runtime
```

The equivalence script compares 10,000 ticks with seed 42 under Node and Bun.
Compare against the saved pre-move checksum as well. Bun availability/version
must be recorded; an unavailable runtime is unverified, not a passing check.
Run documentation builds when the manuals change.

| Contract | Existing coverage to retain and supplement with real processes |
| --- | --- |
| Node/Bun source and bundle entry selection, spaces | `src/lobby/__tests__/ServerRuntime.test.ts`; runtime probe |
| Port reuse and failed startup cleanup | `SpawnerPorts.test.ts`, `SpawnAbandon.test.ts` in the same test directory |
| Secrets, roster, drop-in acknowledgement | `GameServerSpawnerAdmission.test.ts`; engine `MatchAdmission.test.ts` / `MatchResultReport.test.ts` |
| Real result and account/ranking flow | `src/lobby/integration/SpawnedResult.test.ts`, `RoomToRanking.test.ts`, `DropIn.test.ts` |
| Game authority and protocol | Washoi `GameServerProtocolSmoke.test.ts`, `MatchAdmissionGate.test.ts`, `PlayedMatchResult.test.ts` |
| Graceful recording persistence | Washoi `DemoRecordingSaveOnLeave.test.ts` and related recording tests |
| Identity/aliases and bot control | Lobby identity/demo tests and bot control-authentication tests |

After headless checks, verify the assembled browser/lobby flow: create match,
join, invite a bot, disconnect/rejoin, finish match and inspect the result.
Cover Duel, FFA, Amphi and S&D before the final cutover. Confirm recordings
remain readable and result delivery does not duplicate ratings. Where automated
coverage cannot establish a contract, add a focused integration case or record
the remaining manual requirement; do not weaken timeouts/assertions to pass.

The previous full-suite run has an unresolved `RemoteWeaponLeak` weapon-root
wait failure, with its isolated cases passing (progress log step 14). Record
whether it reproduces; do not call the full suite green based on isolated tests.
All server failures require investigation before advancing the affected phase.

## Review and rollback

Each phase has a small diff, a game/engine revision pair, exact commands and
results, and a list of unverified items. Review moved function bodies with
import normalization where possible. Keep the previous verified pair and
server artifacts available; rollback restores that pair/artifact set without
database/schema conversion. Never rewrite a production database for validation.

No deployment, release, push, live-service restart or Git detachment is part of
this planning change. The first executable change is phase 1, followed by its
server checks before any application file moves.
