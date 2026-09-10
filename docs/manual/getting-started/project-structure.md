# Project structure

## Top level

```text
src/              TypeScript application, engine, games, shared code, CLIs
public/           files copied by Vite
docs/manual/      this VitePress manual
docs/reference/   implementation-oriented reference
docs/research/    design investigations
scripts/          asset, build, and maintenance tools
config/           shared runtime/server metadata
android/          committed Capacitor Android project
build-resources/  Electron packaging assets
```

Generated directories such as `dist/`, `dist-electron/`, `release/`, and VitePress output are not source.

## Source layers

```text
src/
  main.ts            active browser composition
  engine/            reusable browser/game-engine systems
  shared/            deterministic/browser-free client-server contracts
  games/
    fps/             active arena FPS (git submodule)
    tower/           secondary game module
  lobby/             matchmaking and game-server spawning
  bot/               bot service and training
  cli/               headless game, BSP, server, demo, and diagnostics
  electron/          desktop main and preload processes
  tools/             source-side content tooling
```

The codebase is currently FPS-centric. `src/main.ts` composes FPS classes directly and TypeScript maps `@game/*` to `src/games/fps/*`.

## Engine areas

Important reusable subsystems:

| Path | Responsibility |
| --- | --- |
| `engine/camera` | camera ownership and controllers |
| `engine/console` | commands and cvar integration |
| `engine/core` | services, events, paths, settings, lifecycle |
| `engine/input` | action-based input |
| `engine/loader` | BSP, PK3, shaders, textures, maps, models |
| `engine/physics` | traces, collision adapters, Havok |
| `engine/movement` | generic movement and variables |
| `engine/network` | client transport/protocol/interpolation |
| `engine/server` | reusable server support |
| `engine/rendering`, `engine/effects`, `engine/lighting` | scene presentation |
| `engine/ui` | shared HUD/menu components |
| `engine/weapon`, `engine/world`, `engine/entities` | reusable gameplay presentation/bases |

Use `rg --files src/engine/<area>` for the exact current files; large per-file trees in prose become stale quickly.

## Assets

```text
public/
  engine.json       required GamePaths configuration
  engine/           shared loose engine assets
  data/             external PK3 media and generated manifests (ignored)
  games/<id>/       optional loose game assets used by GamePaths (ignored)
  wasm/             generated/copied runtime WASM
```

The active FPS BSP/media path uses indexed PK3s under `public/data/`. `GamePaths` still exposes optional loose-asset URLs under `/games/<id>/`; a helper does not prove those files exist.

## Ownership rules

- generic code belongs in `src/engine/`;
- deterministic shared code must avoid Babylon and browser APIs;
- FPS features belong in `src/games/fps/` by default;
- composition roots wire engine-to-game adapters;
- external media and generated output stay out of Git.
