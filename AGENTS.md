# AGENTS.md - AI Assistant Instructions for SHAG Engine

> Goal: provide enough concrete, verified guidance for an agent to build and validate gameplay features from a single prompt.
> Priority: information accuracy over speed. If unsure, inspect code/docs before acting.

## Strict Mode Checklist (Read First)

1. Verify facts in source before coding:
   - APIs and imports in actual `.ts` files
   - command/script names in the engine or `src/games/fps/package.json`
   - behavior/usage in `docs/manual/guides/*`
2. Choose architecture correctly:
   - default to `src/games/fps` extensions
   - do not create a separate game module unless explicitly required
3. For renderer or networking edits, treat as high-risk:
   - edit cautiously
   - run required regression commands (see Critical Systems section)
   - include test results in final report
4. Headless-first validation is required before browser/manual testing.
5. Handoff must include:
   - exact files changed
   - exact validation commands run
   - explicit assumptions
   - explicit unverified items

## Quick Reference

Run engine commands from the assembled root. Washoi owns its command package:
`npm --prefix src/games/fps run <command>` from that root, or `npm run <command>`
inside the game folder. Game commands select Washoi and use the assembled root
for data, storage and artifacts. Install dependencies once at the engine root.

There is no `@/` import alias: import with relative paths (`../../engine/...`).
The aliases that exist are `@game/*` (the FPS module), `@engine/server`,
`@shared/server` and `@games/fps/server`.

| I want to... | Do this |
|--------------|---------|
| Run a console command | `await CommandRegistry.getInstance().executeChecked('map washoi_dm2 duel')` (one command per call; `ok` tells failure from output) |
| Inspect a BSP map | `executeChecked('bsp load washoi_dm2')`, then `executeChecked('bsp info')`; or headless `npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` |
| Load a map in code | `await MapLoader.getInstance().loadMap('washoi_dm2', scene)` |
| Change camera controller | `CameraSystem.getInstance().setController('freefly')` |
| Play a one-shot sound | `AudioManager.getInstance().playSfx(path)` |
| Spawn an entity by id | `EntityManager.getInstance().spawnEntityById(id, position, scene)`, or console `spawn_pickable_entity <id>` |
| Add a console command | A `*Command.ts` class in `src/games/fps/console/commands/` (discovered automatically) |
| Read input | `InputSystem.getInstance().isActive(actionId)` / `wasPressed(actionId)`; raw keys with `isKeyDown(key)` |
| Connect to a server | console `connect localhost:7777` |

## Agent Workflow (Do This First)

1. Confirm scope from prompt: game mode, win condition, map, single-player vs networked.
2. Choose implementation strategy:
   - Preferred: extend `src/games/fps` with a new system, command or HUD widget.
   - Full new game module only when prompt explicitly requires a separate game package.
3. Implement iteratively in small patches (commands, systems, HUD/events).
4. Validate in headless mode first (required before asking for browser testing).
5. Summarize what was built, how to run it, and known limitations.

## Accuracy and Context Protocol (Mandatory)

Before coding:

1. Verify API names and file locations from source (not memory).
2. Open the relevant guide in `docs/manual/guides/` for the subsystem being edited.
3. Check for existing implementations in `src/games/fps` and reuse patterns before creating new abstractions.
4. Confirm script names in `package.json` before running or documenting commands.

When handing off or reporting:

1. List exact files changed.
2. List exact commands run for validation.
3. State assumptions explicitly (map name, gametype, single-player/network).
4. Call out anything unverified.

## Architecture Reality Check (Important)

The codebase is FPS-centric:

- `@game/*` in `tsconfig.json` points to `src/games/fps/*`.
- `src/main.ts` is the neutral engine example. Washoi's `client/main.ts` owns its FPS/lobby startup; `SHAG_APP` selects the browser application directory.
- Engine code must not import game modules: where it needs something a game owns, use the service registries (`GameplayMapLauncher`, `NetworkConnector`, `GameFrameHook`, `FreeflyInput`, `GameMapEntities`, `WeaponIdResolver`; see `docs/manual/guides/service-registries.md`). The concrete `FPSController` and `PlayerVisuals` live in `src/games/fps/camera`; `EntityManager` lives in `src/games/fps/world`. Engine barrels must not re-export them. Indirect ownership dependencies through shared definitions and other engine modules remain under review in the separation log.
- `src/shared/` holds deterministic client/server contracts and must not use Babylon or browser APIs.
- Washoi's concrete weapon/projectile/ammo/item catalog is shared by its client and server at `src/games/fps/shared/entities/`. Generic entity interfaces and the registry remain in `src/shared/entities/`; its barrel must not re-export the game catalog.
- Washoi pickup classname extraction and Node map-data helpers live in `src/games/fps/shared/bsp/`; pickup landing/respawn rules live in its `shared/items/`. Generic BSP parsing, package resolution and collision remain in SHAG.

Implication:

- For most requests, implement inside `src/games/fps` (command, subsystem, HUD widget).
- Creating a truly separate game under `src/games/<newgame>` is possible, but requires additional wiring/refactor work.

## Project Conventions

- **Gametypes for 1.0 are fixed:** Duel, Amphi, FFA and S&D, with the same core rules in every mode. Do not add a gametype unless asked.
- **Accounts are key + name only:** there are no guests; every connection gets an account (`Player_<number>` by default). See `docs/manual/guides/lobby-server.md`.
- **Comments describe the code as it is.** What it used to do, and where an idea came from, belong in the commit message.
- **Prefer a better default to an optional toggle** in player-facing settings.
- **Keep the WebTransport transport.** `WebTransportTransport.ts` is never instantiated today, but WebTransport is the preferred future transport, waiting on Node library support. Do not delete it as dead code.
- **`docs/known_bugs.md` is stale.** Treat each entry as a rumour: read the code that would make it true before acting, then fix or delete the entry.
- **Logging:** repeating client lines use `devLog` (prints with `developer 1`); game server setup and diagnostics use `debugLog(topic, ...)` behind `SHAG_DEBUG`. Plain `console.log` is for one-off events and CLI tools.
- **No floating promises** (Biome `noFloatingPromises` is an error). Await it, or start it in the background with `background(promise, "Context")`, or end a lazy `import().then(...)` with `.catch(logRejection("Context"))` (`src/engine/core/AsyncErrors.ts`). A failed lazy chunk then offers a reload instead of failing silently.
- **`public/ui-proto/*.html` are static mockups** (page-switcher bar, invented players), not the live UI. The dev server serves them; release builds leave them out. The live UI shows only data the game or server actually has.

## Procedures (skills)

Step-by-step procedures live in `.claude/skills/<name>/SKILL.md`. Claude Code
loads them automatically when a task matches; other agents should read the
relevant file before doing that job.

| Skill | Use it for |
| --- | --- |
| `merge-and-release` | Merging a branch to `main` in both repositories, re-pinning fps, cutting a release |
| `regression-check` | Running and reporting the gates and the renderer/networking regression set |
| `browser-probe` | Verifying in a headless browser on the real GPU: private Vite server, CDP driver, demo probe, lobby QA |
| `docs-edit` | Writing docs, the changelog and `AGENTS.md` with every claim checked against the source |
| `shared-worktree` | Safe git in a two-repository tree that several agents edit at once |
| `protocol-change` | Every place a snapshot, message or demo-format change touches, and how to keep old demos playing |
| `local-stack` | Running the lobby, bot server and game servers locally, with a scratch data directory |
| `ranking-change` | Changing results, ratings or their schema, tested on a copy of real `players.db` first |

## Critical Systems: Renderer and Networking

Renderer and networking are high-value and high-risk systems. Edit with extra caution.

- Renderer-sensitive areas include: `src/engine/loader`, `src/engine/rendering`, `src/engine/lighting`, map/material/shader paths.
- Networking-sensitive areas include: `src/engine/network`, `src/engine/server`, `src/shared/net`, `src/games/fps/server`, prediction/replication code.

If either area is edited, always run targeted regressions after changes:

```bash
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
```

`test:physics` prints a position warning on a passing run; read its pass/fail
line rather than the warning.

Do not ship renderer/networking edits without test results in the final report.

## Project Overview

SHAG Engine is a Babylon.js engine for Quake 3 / Warsow-style gameplay:

- BSP map loading (Q3 IBSP, Warsow FBSP)
- PK3 virtual filesystem with a published index
- Quake shader workflows
- Server-authoritative multiplayer at 125 Hz, with a lobby, accounts and TrueSkill ratings
- High-skill FPS movement (strafe jump, bunny hop, wall jump, slide, ledge grab)
- Demos, highlight reels and bots
- SHAGGED, a built-in brush map editor with a scripting API

Full manual: `docs/manual/` (`npm run docs:dev`). The player-facing game manual
is `src/games/fps/docs/manual` (`npm --prefix src/games/fps run docs:dev`).

## Directory Structure

```text
src/
|- engine/           # Game-agnostic engine code
|  |- core/          # GamePaths, EventBus, GameTimer, Cvar
|  |- camera/        # CameraSystem, controllers, first-person pose/motion
|  |- viewport/      # View effects (bob, lean, landing, speed FOV)
|  |- console/       # Commands, command registry
|  |- input/         # Action-based InputSystem
|  |- loader/        # BSP, PK3, shaders, textures, models, MapLoader
|  |- network/       # Client networking, snapshot buffer, clock sync
|  |- server/        # Reusable server support, lag compensation
|  |- physics/       # Collision backends, Havok
|  |- movement/      # MovementVars, generic CharacterController
|  |- editor/        # SHAGGED map editor
|  `- ui/            # Shared HUD/menu components
|- shared/           # Deterministic client/server contracts (no Babylon/DOM)
|- games/
|  `- fps/           # Active game module and bot service/training (git submodule)
|- lobby/            # Lobby server: accounts, rooms, results, ratings
`- cli/              # Headless tools

public/
|- engine/           # Engine assets
|- data/             # Game data and PK3s (gitignored)
`- wasm/             # Havok wasm (auto-copied)
```

## Creating a New Game Module (When Explicitly Needed)

A game module can live under `src/games/<name>/` with a `game.json`. Its browser
application is selected with `SHAG_APP=src/games/<name>` or an ignored
`.shag-application.json` (`{"application":"src/games/<name>"}`). Without a
selection, SHAG launches its engine example.

```json
// src/games/mygame/game.json
{
  "name": "mygame",
  "displayName": "My Game",
  "version": "0.1.0"
}
```

Additional wiring is required:

- Point `@game/*` in `tsconfig.json` at the new module (Vite's `@game` alias follows the browser application selection).
- Supply `browser.json` with `entry` and `html` paths; the game-owned HTML includes `<!-- SHAG_APPLICATION_ENTRY -->`. Keep application startup in the game.
- Register the game's adapters with the service registries.
- Verify CLI/server scripts if the new mode requires them.

Guide: `docs/manual/guides/configuration.md`

## Core Systems

### Camera

Controllers: `fps`, `freefly`, `isometric`, `sidescroll`, `follow`, and
`spectator` (driven by the FPS `spectator` command).

```typescript
const cameras = CameraSystem.getInstance();
cameras.setController("freefly");
const camera = cameras.getCamera();
```

Field of view is the `cl_fov` cvar (console `camera fov 100`); view effects
rewrite `camera.fov` every frame, so do not set it directly. The local camera
and every watched view (spectating, demos) share the first-person effects and
pose code in `src/engine/viewport/FirstPersonEffects.ts` and
`src/engine/camera/FirstPersonPose.ts`.

Guide: `docs/manual/guides/camera-system.md`

### Input

Input is action-based; the FPS module registers the default action map.

```typescript
import { FPS } from "@game/client/FPSActions";

const input = InputSystem.getInstance();
if (input.isActive(FPS.JUMP)) {
  // held
}
if (input.wasPressed(FPS.FIRE)) {
  // pressed this frame
}
const delta = input.getMouseDelta();
```

Action IDs are the constants in `src/games/fps/client/FPSActions.ts`
(`FPS.JUMP` is `"fps_jump"`).

### Console Commands

Commands are classes discovered from `src/engine/console/commands/` and
`src/games/fps/console/commands/`; the file name must end in `Command.ts`.

```typescript
// src/games/fps/console/commands/HelloCommand.ts
import { Command, type CommandDef, fail } from "../../../../engine/console/Command";

export default class HelloCommand extends Command {
  readonly definition: CommandDef = {
    name: "hello",
    description: "Print a greeting",
    usage: "hello [name]",
    // developer: true,  // gate it behind `developer 1`
  };

  async execute(args: string[]) {
    if (args[0] === "error") return fail("Asked to fail");
    return `Hello, ${args[0] ?? "player"}!`;
  }
}
```

Return `fail(message)` for a failure automation must see; a plain string is
success. `executeChecked` runs one command; the console and the headless
`--exec` runner split semicolon batches. A runtime-only handler can use
`CommandRegistry.getInstance().register(name, handler, description)` and
`unregister(name)`.

Guide: `docs/manual/guides/console-system.md`, `docs/manual/guides/command-reference.md`

### Assets and BSP

```typescript
const index = PK3Index.getInstance();
await index.ensureIndex();
const owner = index.findFile("scripts/common.shader");   // which pk3 has it
const bytes = await PK3Loader.getInstance().getFile("scripts/common.shader");

await MapLoader.getInstance().loadMap("washoi_dm2", scene);
```

After adding PK3s under `public/data/`, run `npm run tools:manifest`.
`public/data/` is not in Git. Packaged media is built from `assets-source/` and
the master `washoi_textures.pk3` (`tools:weapon-models`, `tools:map-media`,
`tools:textures`); publishing it to production is a release step in the
`merge-and-release` skill.

Guides:
- `docs/manual/guides/pk3-filesystem.md`
- `docs/manual/guides/bsp-system.md`

### Movement (Q3-style)

The authoritative movement rules are `MovementProfile` in
`src/games/fps/simulation/MovementProfile.ts`, shared by client prediction and
the server; its defaults are `DEFAULT_FPS_MOVEMENT_CONFIG`.

```typescript
import { MovementProfile } from "@game/simulation/MovementProfile";

const movement = new MovementProfile({ gravity: 1000, jumpVelocity: 320 });
```

Common cvars: `sv_movementSpeed` (280), `sv_runSpeed` (400), `sv_jumpheight`,
`sv_gravity`, `sv_aircontrol`, `sv_autohop`. Run `cvarlist sv_` for the full set.

Guide: `docs/manual/guides/movement-system.md`

### Networking

```bash
npm --prefix src/games/fps run net:server -- --map washoi_dm2 --port 7777
```

Then `connect localhost:7777` in the browser console. Normal play goes through
the lobby (`npm --prefix src/games/fps run lobby:server`), which spawns one game server per match.

Guides: `docs/manual/guides/networking.md`, `docs/manual/guides/lobby-server.md`

### EventBus

```typescript
import { EventBus } from "../../engine/core/EventBus";

const unsub = EventBus.on<{ mapName: string }>("map:loaded", ({ mapName }) => {
  console.log(mapName);
});
unsub(); // always clean up subscriptions
```

Typed event names are declared in `src/engine/core/EventBus.ts`; use existing
events rather than inventing global ones.

## Headless-First Validation (Required)

Run these before asking for manual browser tests:

```bash
npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm --prefix src/games/fps run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
```

Windows PowerShell through `npm.cmd` needs escaped inner quotes for the replay:
`npm.cmd --prefix src/games/fps run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'`.

Useful command groups:

- REPL: `npm --prefix src/games/fps run cli:game`, `npm run cli:bsp`
- Network: `npm --prefix src/games/fps run net:server`, `npm run net:client`, `npm --prefix src/games/fps run lobby:server`, `npm --prefix src/games/fps run bot:server`
- Server tests: `npm --prefix src/games/fps run server:tick`, `npm --prefix src/games/fps run server:fuzz -- --ticks 1000`
- Debug: `npm run debug:textures -- washoi_dm2`; spawn/grounding checks: `npm --prefix src/games/fps run test:physics`
- Unit tests: `npm run test:run` (once), `npm test` (watch)
- Demos: `npm --prefix src/games/fps run demo:record -- --map washoi_dm2 --bots 2 --seconds 30` (one-shot: server + AI bots + record). See the [headless-mode guide](docs/manual/guides/headless-mode.md#demos-and-anti-cheat-tools).
- Verify re-sim: `npm --prefix src/games/fps run demo:verify -- <bundle.shagverify>` — replays a re-sim bundle's usercmds through the deterministic sim and checks the recorded per-tick checksums reconcile. Exit 0 = reconciled, 1 = diverged.
- Calibrate anti-cheat: `npm --prefix src/games/fps run anticheat:calibrate -- [--trials 40] [--ticks 1500]` — synthetic aimbot-vs-human trials; prints detection% vs false-positive% per threshold. Numbers are directional until calibrated on real player demos. See [ANTICHEAT_FEATURES.md](docs/research/ANTICHEAT_FEATURES.md).
- Ranking: `npm run ranking:simulate`, `npm --prefix src/games/fps run ranking:acceptance`, `npm --prefix src/games/fps run lobby:server -- --ratings-verify --data-dir ./server-data`
- Maps: `npm --prefix src/games/fps run shagged -- report <map.json>` (see `docs/manual/guides/shagged-api.md`)

Headless map loading goes through the pk3 index (`src/engine/loader/pk3/NodePk3.ts` — `resolveMapBspViaIndex`), the same database the game uses. Do NOT re-introduce ad-hoc BSP path searches.

## Definition of Done for Agent Tasks

A feature is done only when all are true:

1. Gameplay logic is implemented (not only scaffolding).
2. Console command(s) or config path exists to access the feature.
3. Headless validation was run, with command output checked for errors.
4. New EventBus listeners/timers are cleaned up (no obvious leak).
5. User-facing summary includes run instructions and caveats.
6. If renderer/networking was touched, required regression suite was run and reported.
7. The living changelog and the affected manual pages are updated.

## Branches, Changelog and Releases

The repository is two repositories: the outer engine and `src/games/fps`, a git
submodule. Both carry the same branch names and move together.

### Versions

Versions are semver. The 1.0 line runs through pre-releases: `1.0.0-alpha`,
`1.0.0-alpha.2`, …, `1.0.0-beta`, `1.0.0-rc.1`, then `1.0.0`; after that the
patch number counts up (`1.0.1`). `src/engine/version.txt` and `package.json`
(outer repo only) hold the version being developed, which the game shows in the
lobby, and which names its changelog (`v1.0.0-alpha.md`) and tag (`v1.0.0-alpha`).

### Feature branches

- Named for the version and the topic: `v1.0.0-alpha-lobby-ui`, or
  `v1.0.0-alpha-qa` for a QA/bugfix cycle.
- Created from `main` in **both** repositories.

### Staging checkpoint

`staging` is the integration and review checkpoint in both repositories. Merge
feature work into `staging` before any merge to `main`. `main` is the production
branch and is automatically deployed; a request to commit or push `staging`
does not authorize promoting it to `main`. Promote only when the owner asks.

### The living changelog

Each cycle keeps `docs/changelog/v<version>.md` (now `v1.0.0-alpha.md`) with
`**Release Date:** unreleased — living changelog` at the top, updated as work
lands rather than written at the end. Write it for a player or a developer
reading later: what changed, and what was wrong before. Every version has a row
in `docs/changelog/index.md`, and washoi.net's devlog is generated from these
files. A cycle's research notes live in `docs/research/`.

### Merging and releasing

Always fps first, for both feature-to-`staging` integration and approved
`staging`-to-`main` promotion: merge in `src/games/fps`, then merge the outer
branch and re-pin `src/games/fps` at the fps destination branch's tip. Push fps
before the outer repository, and only when asked. A release keeps
`src/engine/version.txt`,
`package.json` and both root version fields in `package-lock.json` at the version
being released. Finalize its changelog in `chore: release v1.0.0-alpha` and put
the annotated `v1.0.0-alpha` tag on that commit. Create only the next changelog
stub at release time; bump the version files when beginning the next release
cycle, so the tagged and deployed build identifies the release correctly.
The next version of a pre-release is the next pre-release
number unless the owner names the next stage (`1.0.0-beta`, `1.0.0-rc.1`,
`1.0.0`).

The full steps, including resolving `UU src/games/fps`, are in
`.claude/skills/merge-and-release/SKILL.md`. Shared-tree git practice (absolute `cd`
before git, staging explicit paths, never committing another agent's files
unasked) is in `.claude/skills/shared-worktree/SKILL.md`.

### Gates

`npm run typecheck`, `npm run test:run`, `npm run build`, and
`npm run gate:biome` — the last is also a pre-commit hook from `.githooks`, so
a commit that raises the Biome baseline is refused. Renderer or networking
edits additionally need the regression set in "Critical Systems" above. Manual
edits must keep `npm run docs:build` passing; it fails on a dead link.

## Common Gotchas

1. Babylon imports must be modular:
   - Correct: `@babylonjs/core/...`
   - Avoid: `babylonjs` UMD import
2. Some Babylon features need side-effect imports:
   - `@babylonjs/core/Animations/animatable`
   - `@babylonjs/core/Collisions/collisionCoordinator`
3. Do not forget unsubscribe handles for EventBus listeners.
4. Tag map-owned objects for cleanup when needed:

```typescript
mesh.metadata = { mapOwned: true };
```

5. Quake coordinates are Z-up; Babylon is Y-up. Convert at the loader boundary
   (`q3ToBabylonVec3`), never with local axis swaps.
6. Most debugging commands (`map`, `pk3`, `render`, `teleport`, `noclip`, ...)
   need `developer 1` first; without it the console refuses them.

## Documentation Pointers

- Commands: `docs/manual/guides/command-reference.md`
- BSP/PK3: `docs/manual/guides/bsp-system.md`, `docs/manual/guides/pk3-filesystem.md`
- Camera: `docs/manual/guides/camera-system.md`
- Movement: `docs/manual/guides/movement-system.md`
- Networking: `docs/manual/guides/networking.md`
- Headless: `docs/manual/guides/headless-mode.md`
- Configuration and environment variables: `docs/manual/guides/configuration.md`
- Shader system and water: `docs/manual/guides/shader-system.md`
- Lobby, accounts, results, ratings: `docs/manual/guides/lobby-server.md`
- Map editor: `docs/manual/guides/shagged-editor.md`, `docs/manual/guides/shagged-api.md`
- Research notes: `docs/research/`
- Changelog: `docs/changelog/`
