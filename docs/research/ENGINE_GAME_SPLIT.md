# Separating the engine from the game

**Status:** plan only, postponed until after the next alpha. Players don't see
this problem; it affects how cleanly SHAG can host a second game and how each
repository builds and tests on its own.

## The goal

SHAG (this repository) is the engine. Washiki Washoi (`src/games/fps`, the
`wash-fps` repository) is a game built on it. The engine must never depend on
the game: it should build, test and run a sample without `src/games/fps`
checked out, and the game should depend on a known engine version.

## Where the engine depends on the game today

Counted on the `papercuts` branch, October 2026, excluding tests.

| Area | Files importing the game | What they use |
| --- | ---: | --- |
| `src/engine` | 5 | `FPSController` and `FreeflyController` import `FPSActions` and `Game`; `EntityManager` loads `FPSPickup` and the procedural pickup factory; the `join` and `scene` console commands load `Game` |
| `src/main.ts` | 1 | Boots straight into `LobbyPanel`, `FPSPlayer` and the FPS module |
| `src/lobby` | 1 | `LobbyServer` uses the game's demo map aliases (`DemoMapAliases`) |
| `src/bot` | 8 | The bots play Washoi: its movement, routes and demos |
| `src/cli` | 20 | Headless tools for Washoi: server tick, fuzz, simulation, demos, bot training |
| `src/shared` | 0 | No imports, but `src/shared/entities/definitions/weapons/*` are Washoi's weapons |

`src/engine/world/Pickup.ts` and `src/engine/camera/GameFrameHook.ts` only
mention the game in comments.

Files at the repository root are Washoi's, not the engine's:

- `index.html`: the title, description and link-preview tags.
- `capacitor.config.ts` (`net.washoi.game`) and `android/`.
- `public/site.webmanifest`: still named "SHAG Engine", with the engine's icons.

`electron-builder.config.cjs` already reads the game's `game.json` for its
name and app id, which is the right pattern.

## What already helps

- **Service registries** (`docs/manual/guides/service-registries.md`):
  `GameplayMapLauncher`, `NetworkConnector` and `GameFrameHook` let engine code
  call the game without importing it, and `src/main.ts` registers them.
- **`GAME=<name>`** and `game.json` select the game at build time, and Vite's
  `@game` alias follows it.
- `AGENTS.md` already forbids new engine imports of the game.

## Options

### A. Enforce the boundary inside the current layout (first)

1. Add a check to the gates that fails when `src/engine`, `src/shared` or
   `src/lobby` imports `src/games`. A small script, or Biome's
   `noRestrictedImports` per folder, is enough. Start it with the five engine
   files as known exceptions, so it stops new ones at once.
2. Move `FPSController` into the game; a comment at its imports already plans
   the move.
   `FreeflyController` gets its actions through a registry.
3. `EntityManager` asks a pickup factory registry instead of loading
   `FPSPickup`. `join` and `scene` use `GameplayMapLauncher`, or move to the
   game's `console/commands`.
4. `LobbyServer` takes the demo map resolver as a constructor option.
5. Move Washoi's weapon definitions from `src/shared/entities/definitions` into
   the game, leaving the engine's `WeaponDef` type and registry behind.

This is mechanical and testable with the gates we have. Nothing changes for
players.

### B. Flip which repository is the application (after A)

`wash-fps` becomes the app. It owns the boot code now in `src/main.ts`,
`index.html`, the manifest and icons, Capacitor and `android/`, the Electron
package, the bot service and the Washoi CLI tools. It depends on SHAG through
an npm workspace (or the engine as a submodule inside the game, the reverse
of today).

SHAG keeps a tiny sample game, for example one map with free-fly and the
console, so its own tests, CI and manual still run without Washoi.

Bots are the open question: the bot service and its training are Washoi-specific
today, but the route learning and movement analysis could be engine features.
They can move with the game first and be split later.

### C. Publish the engine as a versioned package (optional, later)

Publish SHAG to a private registry (for example GitHub Packages) and pin a
version in the game. This is the strictest boundary and gives clean engine
release notes, at the cost of a publish step for every engine change the game
needs. It is only worth it once a second game or outside users depend on SHAG.

## Recommendation

Do A first, after the next alpha, on its own branch. Do B once A's check runs
green with no exceptions. Going straight to B would only move the tangle into
another repository. Consider C only when there is a second consumer.

## Smaller items to do along the way

- Give `public/site.webmanifest` Washoi's name, colours and icons. washoi.net's
  manifest already has them. In B it moves to the game, where it belongs.
- The engine's CI checks out the game submodule with `SUBMODULES_TOKEN`. After
  B, engine CI no longer needs the game at all.
