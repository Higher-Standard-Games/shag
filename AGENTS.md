# AGENTS.md - AI Assistant Instructions for SHAG Engine

> Goal: provide enough concrete, verified guidance for an agent to build and validate gameplay features from a single prompt.
> Priority: information accuracy over speed. If unsure, inspect code/docs before acting.

API examples, the directory map, command groups, versioning and release detail
are in [docs/reference/agent-reference.md](docs/reference/agent-reference.md).
Subsystem guides are in `docs/manual/guides/`.

## Strict Mode Checklist (Read First)

1. Confirm scope from the prompt: game mode, win condition, map,
   single-player vs networked. Implement in small patches.
2. Verify facts in source before coding: APIs and imports in actual `.ts`
   files, script names in the engine or `src/games/fps/package.json`, and
   behavior in the relevant `docs/manual/guides/*` page.
3. Check for existing implementations in `src/games/fps` and reuse their
   patterns before creating new abstractions.
4. Default to extending `src/games/fps` (a system, command or HUD widget). Do
   not create a separate game module unless the prompt explicitly requires one.
5. Treat renderer and networking edits as high-risk (see Critical Systems).
6. Validate headless before any browser/manual testing.
7. Handoff must include: exact files changed, exact validation commands run,
   explicit assumptions (map, gametype, single-player/network), and anything
   unverified.

## Running Commands

Run engine commands from the assembled root. Washoi owns its command package:
`npm --prefix src/games/fps run <command>` from that root, or `npm run <command>`
inside the game folder. Game commands select Washoi and use the assembled root
for data, storage and artifacts. Install dependencies once at the engine root.

There is no `@/` import alias: import with relative paths (`../../engine/...`).
The aliases that exist are `@game/*` (the FPS module), `@engine/server`,
`@shared/server` and `@games/fps/server`.

## Architecture Rules

- Engine code must not import game modules: where it needs something a game owns, use the service registries (`GameplayMapLauncher`, `NetworkConnector`, `GameFrameHook`, `FreeflyInput`, `GameMapEntities`, `WeaponIdResolver`; see `docs/manual/guides/service-registries.md`). The concrete `FPSController` and `PlayerVisuals` live in `src/games/fps/camera`; `EntityManager` lives in `src/games/fps/world`. Engine barrels must not re-export them. Indirect ownership dependencies through shared definitions and other engine modules remain under review in the separation log.
- `src/shared/` holds deterministic client/server contracts and must not use Babylon or browser APIs.
- Washoi's concrete weapon/projectile/ammo/item catalog is shared by its client and server at `src/games/fps/shared/entities/`. Generic entity interfaces and the registry remain in `src/shared/entities/`; its barrel must not re-export the game catalog.
- Washoi pickup classname extraction and Node map-data helpers live in `src/games/fps/shared/bsp/`; pickup landing/respawn rules live in its `shared/items/`. Generic BSP parsing, package resolution and collision remain in SHAG.
- Headless map loading goes through the pk3 index (`src/engine/loader/pk3/NodePk3.ts` — `resolveMapBspViaIndex`), the same database the game uses. Do NOT re-introduce ad-hoc BSP path searches.

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

## Common Gotchas

1. Babylon imports must be modular (`@babylonjs/core/...`), never the `babylonjs` UMD import. Some features need side-effect imports: `@babylonjs/core/Animations/animatable`, `@babylonjs/core/Collisions/collisionCoordinator`.
2. Always keep and call the unsubscribe handle for EventBus listeners.
3. Tag map-owned objects for cleanup when needed: `mesh.metadata = { mapOwned: true };`
4. Quake coordinates are Z-up; Babylon is Y-up. Convert at the loader boundary
   (`q3ToBabylonVec3`), never with local axis swaps.
5. Most debugging commands (`pk3`, `render`, `teleport`, `noclip`, ...) need
   `developer 1` first; without it the console refuses them. `map` does not:
   from another machine it starts a solo practice server.

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

## Validation

**Headless first** (required before asking for browser testing):

```bash
npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm --prefix src/games/fps run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
```

**Gates** for any code change: `npm run typecheck`, `npm run test:run`,
`npm run build` and `npm run gate:biome`. The last is also a pre-commit hook
from `.githooks`, so a commit that raises the Biome baseline is refused. Manual
edits must keep `npm run docs:build` passing; it fails on a dead link.

**Critical systems.** Renderer and networking are high-value and high-risk:

- Renderer: `src/engine/loader`, `src/engine/rendering`, `src/engine/lighting`, map/material/shader paths.
- Networking: `src/engine/network`, `src/engine/server`, `src/shared/net`, `src/games/fps/server`, prediction/replication code.

Edits there also need the regression set from the `regression-check` skill, and
the final report must include its results.

## Definition of Done for Agent Tasks

A feature is done only when all are true:

1. Gameplay logic is implemented (not only scaffolding).
2. Console command(s) or config path exists to access the feature.
3. Headless validation was run, with command output checked for errors.
4. New EventBus listeners/timers are cleaned up (no obvious leak).
5. User-facing summary includes run instructions and caveats.
6. If renderer/networking was touched, required regression suite was run and reported.
7. The living changelog (`docs/changelog/v<version>.md`) and the affected manual pages are updated.

## Branches and Releases

The repository is two repositories: the outer engine and `src/games/fps`, a git
submodule. Both carry the same branch names and move together.

- Feature branches are created from `main` in **both** repositories.
- `staging` is the integration and review checkpoint in both repositories.
  Merge feature work into `staging` before any merge to `main`.
- `main` is the production branch and is automatically deployed; a request to
  commit or push `staging` does not authorize promoting it to `main`. Promote
  only when the owner asks.
- Always fps first: merge in `src/games/fps`, then the outer branch, and re-pin
  `src/games/fps`. Push fps before the outer repository, and only when asked.
- Shared-tree git practice (absolute `cd` before git, staging explicit paths,
  never committing another agent's files unasked) is in the `shared-worktree`
  skill; full merge and release steps are in `merge-and-release`.
