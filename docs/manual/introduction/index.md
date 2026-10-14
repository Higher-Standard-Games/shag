# Introduction

SHAG is a TypeScript/Babylon.js engine and playable arena-FPS stack built around Quake 3 and Warsow media.

It is more than an asset viewer. The repository includes:

- Q3 `IBSP` and Warsow/qfusion `FBSP` loading;
- PK3 discovery and a virtual filesystem;
- Quake shader compatibility and Babylon material extensions;
- BSP collision and deterministic FPS movement;
- server-authoritative multiplayer, prediction, and snapshots;
- the active FPS game, lobby, bot, HUD, weapon, pickup, and gametype layers;
- SHAGGED, a built-in brush map editor with a scripting API;
- browser, headless, Android, and Electron compositions at different maturity levels.

## Architecture

```text
browser / CLI / server compositions
              |
        game modules
   (active path: games/fps)
              |
 shared deterministic contracts
              |
 reusable engine systems
 (loader, rendering, input, console,
  collision, networking, services)
              |
          Babylon.js
```

`src/engine/` should not depend on a game module. Game-specific integrations belong under `src/games/fps/` unless a task explicitly calls for a separate game.

The repository can select a build game through `GAME`, but it is still architecturally FPS-centric: `src/main.ts` wires FPS flow and `@game/*` points to `src/games/fps/*`.

## Content workflow

External PK3s live under `public/data/` and are not committed. Browser discovery starts from a generated manifest; the runtime index resolves maps, shader scripts, textures, models, and sounds.

Maps can be built in SHAGGED, the brush editor built into the engine, which compiles them with MakeBSP/MakeLight and launches a playtest; scripts and AI agents can build them through its [scripting API](../guides/shagged-api.md). NetRadiant and other idTech3 toolchains work too, compiling to BSP.

## Testing philosophy

Loading, collision, simulation, server behavior, and protocol work can be checked headlessly. WebGL material output, input feel, and native wrappers still require their target runtime.

Start with [Getting started](../getting-started/) and use [Feature status](./features.md) to distinguish implemented paths from partial or planned ones.
