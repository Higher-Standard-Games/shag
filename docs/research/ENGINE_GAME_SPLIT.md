# Separating SHAG from Washoi: verified refactoring map

**Status:** investigation and implementation plan; no runtime refactor or Git/submodule removal performed.
**Audited:** October 23, 2026, after the alpha.2 bot hotfix.
**Engine source:** `5ee0b5de165aecd02f5778debccf5479e781d2ec`.
**Washoi source:** `d98070ab66bc4163307805067f58f1378acc5fde`.

This replaces the earlier outline in this file. The goal is an independently
buildable/testable SHAG repository, an independently owned Washoi application,
and the same Washoi behavior when the two are assembled. Publishing an npm
engine package or reversing the repository layout is not required for this goal.

## Findings and recommendation

The game files already belong to the separate `wash-fps` repository. SHAG tracks
its URL in `.gitmodules` and a mode-160000 gitlink containing the game commit;
it does not store all the FPS files as ordinary engine files. The problems are
that SHAG requires that game checkout, and some Washoi implementation/data is
still owned by the engine repository.

Removing that gitlink alone will break the application and tests. A TypeScript
probe that virtually hides `src/games/fps` produces **91 diagnostics**; the same
outer-project roots with the game available produce **zero**. The real game
folder was never renamed, removed or edited by this probe.

An AST audit found:

| Scope | Files importing Washoi directly | Import sites |
| --- | ---: | ---: |
| `src/engine` | 5 | 13 |
| `src/bot` | 8 | 8 |
| `src/cli` | 18 | 35 |
| `src/lobby` | 1 | 1 |
| `src/main.ts` | 1 | 5 |
| Total production `src` files | 33 | 62 |
| Outer tests/fixtures | 12 | 13 |

There are also four historical research TS probes and one scripts TS file with
such imports. **33 engine modules reach Washoi transitively**, including barrels,
map loading, commands and SHAGGED reachability. These are source/type dependency
paths, not a measurement of browser bundle size. **292 FPS files import parent
repository modules**; keeping the nested layout avoids unnecessarily changing
all of those paths at once.

See [the complete inbound inventory](./ENGINE_GAME_SPLIT_INVENTORY.md) and the
reproducible tools below. A text search alone misses type imports, lazy imports,
barrel exposure, indirect bot dependencies and concrete game data under `shared`.

Recommended target:

1. Keep `src/games/fps` as the local assembly location initially.
2. Make the engine's default composition game-free, with a small neutral engine
   fixture. An installed game supplies its own bootstrap and game-specific data.
3. Move product-owned code/data into Washoi and expose narrow engine-owned
   interfaces where the engine needs callbacks or configuration.
4. Only after the no-game and Washoi parity gates pass, remove the tracked
   gitlink/`.gitmodules` entry and ignore local game checkouts.
5. Use an ignored clone for the clean one-checkout workflow. If true submodules
   are a requirement, put their tracking metadata in a separate workspace repo.

## Will adding the submodule locally afterward work?

Yes, Git can add it locally, but it does **not** keep the engine repository clean:

```text
A  .gitmodules
A  src/games/fps
160000 <game-commit> 0 src/games/fps
```

That is actual output from a disposable local Git fixture. `git submodule add`
automatically stages the metadata and gitlink. Adding ignore rules afterward
does not hide staged/tracked entries. If the future engine ignores this path,
`submodule add` would also need `--force`. Keeping those changes uncommitted is
possible, but leaves a permanent accidental-commit hazard and no reproducible
engine release pin. It is not the recommended final setup.

The closest clean workflow is an ordinary nested repository:

```powershell
# Proposed future setup, after the refactor. Not sufficient on today's code.
git clone git@github.com:Higher-Standard-Games/shag.git shag
cd shag
git clone git@github.com:Higher-Standard-Games/wash-fps.git src/games/fps
```

With the game path ignored, this leaves engine `git status` clean, keeps game
commits independent, and preserves the source layout. The fixture verified both
an empty parent status and an empty parent tracked entry for this ignored clone.
It is a nested Git checkout, **not a registered submodule**; `git submodule
update` will not manage it.

For real submodule pinning, use an application/workspace repository that tracks
engine and game checkouts. It may be private or operator-owned; SHAG itself must
not track its game consumer. A sibling layout needs explicit source resolution
or engine package exports; simply putting an engine submodule inside `wash-fps`
today breaks its many `../../engine`/`../../shared` imports. That larger layout
change is optional, not a prerequisite to the nested-checkout solution.

## Ownership and interfaces

All interface names below that are not already present in source are proposals.
Do not treat them as existing APIs. Prefer moving application code intact before
redesigning its internals: this is a compatibility refactor, not a gameplay rewrite.

### R1. Application bootstrap and selected-project resolution

**Files:** `src/main.ts`, `src/games/fps/index.ts`, `src/games/fps/game.json`,
`public/engine.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`,
`src/engine/core/GamePaths.ts` and Node/build entrypoints.

- Extract the Washoi lifecycle from `src/main.ts` into a game-owned client entry.
  The existing game `index.ts` exports Game, command registration and adapters;
  it does not implement the full application startup lifecycle. `entryPoint` in
  `game.json` is not enough to make today's main generic.
- Keep renderer/service creation reusable. The game entry supplies LobbyPanel,
  FPSPlayer, frame-rate HUD, FPS controller, branding, startup/session flow and
  registrations. Preserve the existing initialization order, loading phases,
  editor return behavior and exactly-once frame/network updates.
- Define one selected-project resolver shared by browser, Node, server bundling,
  tests and packaging. Return resolved paths and typed entrypoints; consumers must
  not reconstruct `src/games/fps` themselves.
- Proposed precedence: explicit `GAME`/project path, ignored local project config,
  one installed game, otherwise the neutral engine fixture. Multiple installed
  games require an explicit selection. One ignored Washoi clone can therefore
  be enough for the familiar `npm run dev` workflow, without another tracked pin.
- Generate an exact virtual entry/alias for the selected project at build time.
  Do not put a literal Washoi fallback in engine source or glob-import every
  installed game into an engine build. Supply an engine-owned TypeScript module
  declaration for that virtual entry.
- Remove `defaultGame: fps` from engine-owned defaults. `GAME` currently changes
  Vite's `@game`, but TypeScript's `@game/*` and `@games/fps/server` aliases remain
  fixed to FPS, and GamePaths reads the runtime engine.json default separately.
  These must agree after the refactor.

**Parity check:** browser startup, loading/error screens, lobby, account restore,
match entry/return, editor entry/return and renderer QA all behave identically.

### R2. FPS controller, its dependents and commands

**Direct file:** `src/engine/camera/controllers/FPSController.ts`.

Move this concrete controller to Washoi, retaining its public behavior and the
`fps` controller registration ID. It imports Game, FPSActions, InventoryManager,
GibSystem and DamageNumbers. Preserve prediction, reconciliation, spectator/death
camera behavior, inventory callbacks, input stripping, viewport effects and HUD
updates. Do not reimplement the movement rules while moving it.

Also handle `controllers/components/PlayerVisuals.ts`, which imports the concrete
controller, and remove its export from `controllers/index.ts` and engine barrels.
Keep generic CameraSystem, controller interfaces, CameraInputHandler,
ReusableFreeCamera, FirstPersonPose and viewport infrastructure in the engine.

Dependent commands require explicit changes, not just an import-path move:

| Current engine command/file | Required treatment |
| --- | --- |
| `JoinCommand.ts` | Move to the game's command set; it calls Game.joinGame. GameplayMapLauncher does not provide join and NetworkConnector does not currently provide a general join method. |
| `SpectatorCommand.ts` | Move game-specific FPS/freefly switching/controller construction to the game, preserving command name and behavior. |
| `GiveWeaponCommand.ts` | Move inventory/weapon-grant behavior to the game. |
| `DebugCommand.ts` | Retain generic renderer diagnostics; make its player-capsule branch consume a small position/dimensions capability instead of casting to FPSController. |
| `SceneCommand.ts` | Use the existing NetworkConnector.isConnected query for the freefly decision; absence of an adapter means no game connection. |
| `SpawnPickupCommand.ts` | Move the concrete pickup command to the game or delegate through the game entity-spawn capability. Preserve `spawn_pickable_entity`. |
| `NameCommand.ts` | Move account-aware naming to the application, or inject account/profile operations. It imports AccountSession and PlayerIdentity today. |

Check console discovery/registration for duplicates. The engine's eager
`*Command.ts` glob must stop finding moved commands, while Washoi still
registers them with the same names, aliases, developer gates and return results.

### R3. Freefly input without a game import

`FreeflyController.ts` imports and calls `registerFPSActions()` and reads seven
FPS action IDs. Give it an engine-owned action mapping/input capability; Washoi
passes its existing movement/jump/crouch/sprint actions. The neutral engine
fixture supplies defaults. Preserve user remappings, mouse/pointer lock,
collision toggles and freefly's existing GameFrameHook behavior.

Changing the strings to new fixed engine keys without aliasing the user's
bindings would change functionality and is not an acceptable shortcut.

### R4. Map entities, definitions and preload/cleanup order

**Files:** `src/engine/entities/EntityManager.ts`,
`src/engine/loader/map/MapLoader.ts`, `src/shared/entities/index.ts`,
`src/shared/entities/initEntityDefs.ts`, concrete `definitions/**`,
`src/shared/bsp/PickupTable.ts` and their consumers.

EntityManager is largely the Washoi pickup manager: it loads FPSPickup and the
procedural visual factory, registers classnames/aliases and builds the pickup
ID table. Move that concrete implementation into Washoi. Keep generic
EntityRegistry/types, EntityHandlerRegistry and the generic Pickup visual/lifetime
base in SHAG.

MapLoader must stop constructing/registering/disposing this concrete manager and
stop automatically initializing Washoi definitions. Reuse EntityHandlerRegistry
for spawn dispatch; add a narrow game map-lifecycle/preload adapter where current
registration and disposal ordering cannot be expressed by its existing hooks.
Washoi must register definitions before model dependency discovery, install the
pickup-table pre-render work before entity dispatch, await visual creation, and
clean everything before map-owned models/materials are released.

Move concrete weapons, ammo, projectiles, health/armor/powerup definitions and
initializeEntityDefs into game-owned shared code. Remove their reexports from
the generic shared barrel. Generic consumers must receive definitions/lookup
operations rather than regain a dependency through another barrel.

`WeaponViewManager.ts` imports the concrete WeaponsTable only for compatibility
normalization; inject the game's canonical-ID mapping (including lasergun to
Voltaic). PickupTable's classname taxonomy is also game data: split the generic
BSP traversal/ID assignment from the supplied Washoi classname mapping, or move
that whole table to the game if no generic consumer remains.

**Critical invariants:** exact classname aliases, BSP iteration/order, pickup IDs,
raw-vs-standing coordinates, ammo pools, spawn yaw, procedural toggles, mirror
asset requests and all pickup active-mask/respawn behavior. Client and server
must continue using the same game-owned definitions and extraction algorithm.

### R5. Game media recipes, branding and package policy

These do not show up as imports of `src/games/fps`, but are concrete ownership:

| Current input/consumer | Required treatment |
| --- | --- |
| `config/player-model-vanguard.json` / `engine/animation/PlayerModelAssets.ts` | Game supplies model/animation/package descriptor; engine keeps generic loading/animation machinery. Remove the hard-coded default asset owner. |
| `config/weapon-models.json` / MapLoader | Supply the same extra model/package dependency metadata through the project/asset descriptor. |
| `config/maps.json`, `config/bot-routes/`, `config/sound-package.json`, `config/billboard-package.json`, `config/pk3-packages.json` | Move product recipes/pools/route data to Washoi and pass paths to generic tools; preserve filenames/content and bank policy. |
| `index.html`, relevant `public/` icons/manifest, main's Washoi logo/title/text | Game owns app branding/templates; engine fixture gets neutral metadata. Preserve Washoi's rendered HTML/assets exactly. |
| `src/engine/ui/styles/WashikiFonts.css` and UI theme usage | Decide reusable built-in theme versus game-owned skin; parameterize game branding without a visual redesign or changed font URLs. |
| Root game media packaging scripts | Keep generic archive/model/texture conversion engines reusable; move concrete Washoi input recipes/entry scripts or dispatch through selected-project paths. |

No PK3 or texture re-encoding/repackaging is required for source separation.
Keep production `public/data` linkage and all virtual asset paths, per-map banks,
master exclusion, billboard ownership and manifest/index consistency unchanged.

### R6. SHAGGED is also an integration surface

- `engine/editor/EntityCatalog.ts` eagerly imports the Washoi NetRadiant
  `entities.def?raw`. Retain the generic parser and compiler entity definitions;
  register game catalogs, class defaults, bounds, keys and menu ordering from
  the selected game. Raw Vite imports must be audited separately from resolved
  TypeScript modules.
- `engine/editor/server/CompilerConfig.ts` requires/installs `washoi.json`, and
  `BuildRecipe.ts` emits `-game washoi`. Move the concrete profile/gamepack and
  recipe parameters to project configuration. Preserve argv, default qualities,
  compiler input fingerprints, source hashing and output/publish layout for Washoi.
- `engine/editor/server/AgentPipeline.ts:mapReachability` imports BotVision and
  BotNavGraph; those reach FPS movement. Introduce a selected-game report provider
  instead. Washoi supplies the existing player and bot analyses with the same
  result shape. Generic map inspection/compiler infrastructure must not import
  the bot application.
- Preserve PlayerReach's current walk-flood semantics (including its 45-unit hop)
  during this extraction; do not retune it to another movement profile as part
  of the boundary work. Keep any neutral geometry analysis independently usable.

**Parity check:** editor placement catalog, .map round trips, compiler recipes,
map reports, bot routes, local playtest and return flow. A missing game adapter
must be explicit, not a silent successful report that omitted player/bot checks.

### R7. Bot/lobby application and Node tools

Move the Washoi bot service and training/application code under `src/bot` into
the game first, retaining algorithms and persisted model/route formats. Extract
reusable navigation later only if the engine needs it behind generic movement
and perception interfaces. AgentPipeline must be decoupled before this move.

Treat `src/lobby` as an application/service ownership pass, not merely the one
DemoMapAliases import. The current lobby owns Washoi accounts, rooms, ratings,
bot presets and server launches. Recommended first move: keep that product
service with Washoi; retain neutral server transport, match-admission/result
contracts and reusable persistence/math primitives in SHAG. If the lobby is
kept as an engine-hosted reusable service instead, all game policy/launch/map
alias inputs must be injected, including the demo levelshot resolver. Do not
leave a hidden FPS default.

Before moving it, remove engine NameCommand's account dependency and replace
MatchLobbyView's imports of LobbyClient/lobby DTOs with presentation data and
callbacks, or move that concrete view into Washoi. Keep engine connection UI
on NetworkConnector rather than adding a back-edge to the relocated service.

Classify the rest of `src/shared` by ownership. Concrete bot names/weight
profiles, FPS loadout choices/ammo, pickup classnames and game settings schemas
belong to Washoi. Generic codecs, deterministic math, collision, registry
contracts, admission/result shapes and reusable rating math may remain. Where
an engine contract currently references a concrete game schema, split the shape
from game validation/defaults; preserve the serialized shape and values.

All 18 direct-import CLI files are listed in the inventory. Move game commands
(server, tick/fuzz, FPS simulation/physics, demos, anti-cheat, bot learning and
game asset audits) to game-owned entries. For mixed `headless-game.ts`, retain
generic engine/BSP/console startup and register game commands through a provider.
Also audit indirect consumers and the other CLI files, not just this direct list.

Keep familiar npm command names/flags and output bundle names via selected-project
wrappers where needed. `scripts/build-servers.mjs` currently builds fixed game,
lobby and bot entries together; engine-only builds need independent entries,
while Washoi assembly must still produce the expected `dist-server/*.mjs` files.
`src/lobby/ServerRuntime.ts` currently derives match-server paths from the outer
root; moving files must not change process runtime, cwd, admission/result delivery,
shutdown behavior or existing environment/data-directory semantics.

### R8. Build, tests, documentation and platform packaging

| Surface | Exact work |
| --- | --- |
| `tsconfig.json` | Separate engine roots/ambient types from assembled application/test roots. Git ignore does not exclude a folder from TypeScript's `include: [src]`. Resolve game aliases consistently. |
| Engine public barrels | Remove exports that drag in concrete FPS/controller/UI/application modules. Test the engine API as a consumer, not only in a whole-src program. |
| Ambient declarations | Make `engine/core/DebugGlobals.ts` and browser/Electron bridge declarations part of the engine's own type entry/config. A barrel-only baseline currently reports 29 diagnostics, mainly missing Window declarations, even with FPS available. |
| `vite.config.ts`, `index.html`, `public/engine.json` | Build the selected entry and game-free fixture without hard-coded FPS source/config. Keep dev live-data serving, prebundling and renderer settings. |
| `vitest.config.ts` | Separate game-free engine tests from Washoi integration tests; do not achieve independence by skipping the whole meaningful engine suite. |
| `package.json`, lockfiles, `scripts/postinstall.mjs` | Separate game-owned dependencies/scripts (including bot TensorFlow fixups) from engine dependencies; preserve Node/native/wasm behavior. Washoi has no standalone package manifest today. |
| `typedoc.json`, `scripts/build-docs.js`, engine manual | Engine API/docs must build without the game; move game topics or clearly mark integration examples. Game manual stays game-owned. |
| `.github/workflows/ci.yml` | Engine checkout/install/typecheck/tests/build/API/sample must run without FPS or SUBMODULES_TOKEN. A separate game/workspace job pins engine and game and runs the complete integration gates. |
| `scripts/benchmarks/profile-timedemo.mjs`, `crowd-benchmark.mjs`, `scripts/water-visual-scene.ts` | Game demo/remote-player fixtures move to Washoi or use explicit game test adapters. Preserve benchmark engine+game revision receipts. |
| `experiments/shagged/convex-browser-probe.mjs`, historical TS probes | Parameterize the active project for executable probes; label archived snapshots rather than making them implicit engine build requirements. |
| `capacitor.config.ts`, `android/`, `electron-builder.config.cjs`, `src/electron/*` | Game owns platform identity/branding; reusable host infrastructure accepts a descriptor. Preserve Android app ID `net.washoi.game` and save/profile locations. Electron builder already selects game.json, but Electron main uses the stale `src/game/game.json` path; investigate packaging coverage instead of assuming desktop works today. |
| `AGENTS.md`, merge/release/shared-worktree/local-stack/browser procedures | Remove the required FPS pin/lockstep-branch assumptions after cutover; keep instructions for assembling and validating Washoi explicitly. |

The five engine test files that import FPS directly are enumerated in the
inventory. Move game integration cases to game tests, or supply neutral injected
fixtures to generic engine tests while retaining the original Washoi coverage.
Tests using concrete shared weapon definitions need the same ownership pass even
though they do not import the submodule directly.

## Dependency order and cutover

These are small reviewable refactoring steps, not a single delete-and-rebuild PR:

1. **Capture baseline / boundary audit.** Freeze engine+game commits, demos,
   deterministic checksums, gameplay/schema values, asset metadata and UI flows.
   Add an architectural check for static/dynamic/type/reexport imports and raw
   asset dependencies. Temporary exceptions must shrink, not hide new back-edges.
2. **Add assembly contract/resolver and neutral fixture (R1/R8).** Keep the
   existing Washoi boot behind the adapter while proving selection parity.
3. **Remove camera/command back-edges (R2/R3).** Preserve controller/command IDs.
4. **Separate entities, definitions and assets (R4/R5).** Preserve preload/spawn/
   dispose ordering and client/server pickup identity before moving catalogs.
5. **Decouple editor/game reports and compiler profiles (R6).** Then relocate bots.
6. **Relocate application services/CLI and remaining domain shared code (R7).**
   Keep public Node command wrappers/output paths until deployment is migrated.
7. **Make no-game CI and full Washoi integration CI pass (R8).** Include packaging
   paths, ambient types and API barrels; a grep-only pass is insufficient.
8. **Move version-pair ownership outside SHAG.** Game CI may pin its engine
   revision; deployment/workspace receipts pin both revisions. Never silently
   replace the old exact gitlink with two independently floating main branches.
9. **Remove the tracked FPS dependency last.** Update `.gitmodules` (currently
   FPS is its only entry), remove the gitlink from the engine index, add ignore
   rules and document the new clone/assembly command. Preserve local work first.
10. **Migrate production/CI operators, then release.** Validate the exact assembled
    pair, update the runbook/procedures and retain a rollback assembly recipe.

For step 9, `git rm --cached -- src/games/fps` is the relevant index operation,
not a request to delete the directory. These commands were **not** run here.
Existing submodule worktrees often have a `.git` file pointing into the parent's
`.git/modules`; inspect/backup them before conversion. Do not use `submodule
deinit`, recursive removal or a fresh clone over an existing working tree as a
shortcut. Fresh independent clones are simplest after preserving dirty work,
local branches and the exact previous commit.

## Production and release implications

The deployed `/srv/washoi/deploy.sh` was inspected during the alpha.2 release:
`prepare_shag` runs `git submodule update --init -- src/games/fps`, prepares npm
dependencies and builds game/docs/manual surfaces from that shared checkout.
Removing the gitlink without migrating it breaks deployment. The previous
release skill also requires an FPS main pin and same-named branches.

The new application/workspace release receipt must identify engine SHA, game
SHA, selected project/profile, dependency lockfiles and asset metadata. Engine
CI/release must not require private game credentials. Product deployment must
explicitly fetch the selected game and build the assembled pair; update triggers
for either revision, not only engine main. A game SHA change must still rebuild
its client/manuals even when engine SHA is unchanged, and vice versa.

Preserve `/srv/washoi/assets/data`, the public/data symlink, live demos, account
DB, bot secret, certificates, environment files, service names, ports, lobby URL,
map pools and cache locations. The source split requires no DB migration, account
reset, demo-format bump or PK3 re-upload. Preserve old client/demo compatibility;
do not introduce protocol changes just to express source ownership.

Keep generic engine docs and selected-game manuals as separate build targets.
The workspace deploy procedure owns dependency setup and idle-only lobby/bot
restart handling. No production configuration was changed by this investigation.

## Acceptance: functionality stays the same

Two different gates are required; passing only one is not completion.

**A. Engine without Washoi:** fresh non-recursive engine clone, no private game
credentials/assets, install, engine typecheck/tests/build/API docs and a runnable
neutral fixture. No reference to FPS may be resolved transitively by engine
runtime/type entrypoints. Loading a game must not be necessary for generic
renderer, camera/freefly, BSP/editor, collision and console capabilities.

**B. Assembled Washoi:** same engine/game pair, existing assets and all current
functionality. Run the existing commands below through their retained wrappers:

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:runtime-equivalence
npm.cmd run docs:api
npm.cmd run docs:build
npm.cmd run docs:fps:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm11; bsp info; bsp load washoi_amphi1; bsp info; bsp load washoi_snd1; bsp info; quit"
```

Also compare before/after deterministic replays/checksums, recorded demos,
pickup IDs/masks and classname aliases, movement parameters, weapon/ammo data,
map reports and compiler recipes. Playtest Duel/Amphi/FFA/S&D, heard-target bots
and learned trick jumps, spectators and highlight/demo playback, account/rating
flows, map switching and cleanup, editor return, renderer modes and desktop/mobile
builds on the platforms actually supported. Verify no duplicate game-frame ticks,
input handlers, commands, event subscriptions, timers or Babylon singleton copies.

Moving a simulation module must not change its algorithm, tick constants or
serialized names. Reuse the same Babylon/engine singleton module instances on
both sides of the boundary; bundling two engine copies is a functional regression.
A lost test moved into the game is not a passing no-game gate.

## Investigation evidence and limits

Reproducible source-read-only tools, run from the engine repository root
(the audit regenerates the Markdown inventory):

```powershell
node docs/research/engine-game-split-audit.mjs
node --max-old-space-size=4096 docs/research/engine-game-split-probes.mjs
```

The audit scans tracked TypeScript in both repositories using TypeScript's AST
and current tsconfig resolution, including import type, exports and literal lazy
imports. Full JSON outputs go to `.cache/engine-game-split/inventory.json` and
`proofs.json`; the checked-in Markdown inventory provides source locations.
Nonliteral imports, raw assets, configuration, shell/JS strings, manifests and
service scripts require the supplementary source review described above.
The probes create disposable repositories only under `.cache` and hide FPS
through a compiler host, not by touching the real game checkout.

Observed: normal outer-project compiler roots 0 diagnostics; virtual no-game
project 91. A smaller engine-barrel probe has pre-existing ambient-root problems
(29 diagnostics with game; 40 without), so its total is not a count of unique
FPS violations. The no-game build target needs explicit ambient ownership too.

Not yet implemented or verified: final plugin contract, any moved source, an
actual game-free browser build/sample, independent game dependency install,
mobile/desktop parity or a migrated production deploy. No functionality or
tracked submodule configuration was changed. Estimates should be made per
reviewable step after interface ownership is agreed, not inferred from the five
direct engine imports alone.

Investigation validation completed: both tools ran successfully; both scripts
passed `node --check`; `npm.cmd run docs:build` passed; `git diff --check`
passed. Expected missing-game diagnostics are findings, not a passing no-game
build. The game repository is unchanged. Changed artifacts are this plan,
`ENGINE_GAME_SPLIT_INVENTORY.md`, `engine-game-split-audit.mjs` and
`engine-game-split-probes.mjs`. No application tests were rerun for these
research-only changes, and no implementation/production parity is claimed.
