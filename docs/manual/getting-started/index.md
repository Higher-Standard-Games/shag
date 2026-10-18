# Getting started

This setup runs the browser client and verifies the engine without requiring a GPU-only test workflow.

## Requirements

- Node.js 24 or later (`.nvmrc` pins major version 24); the lobby stores accounts and results with the built-in `node:sqlite` module
- npm, which the continuous-integration build also uses
- Git, including submodule support
- a current WebGL2-capable browser

## Install

```bash
git clone --recurse-submodules https://github.com/Higher-Standard-Games/shag.git
cd shag
npm install
npm run dev
```

Vite is configured on [http://localhost:3000](http://localhost:3000).

Game PK3s are not committed. Put compatible assets under `public/data/` and generate/update the index when needed:

```bash
npm run tools:manifest
```

The manifest makes archives discoverable in a browser. The runtime `PK3Index` builds its searchable index from that manifest; use `pk3 index` in a developer console when it needs rebuilding.

## First browser check

Open the console with the backquote/tilde key, then inspect an indexed BSP:

```text
developer 1
bsp load washoidm2
bsp render
bsp info
camera mode freefly
```

`camera mode` selects a registered camera controller. For normal FPS gameplay, use the lobby UI or:

```text
map washoidm2 duel
```

The `map` command uses the configured gameplay/lobby launcher. See [Map launching](../guides/map-launching.md).

## Headless check

```bash
npm run cli:game -- --exec 'bsp load washoidm2; bsp info; quit'
npm run test:simulation
npm run test:physics
```

The headless game runner uses `bsp load`; it does not register the browser gameplay launcher.

## Common scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run build` | TypeScript and production web build |
| `npm run preview` | Preview `dist/` |
| `npm run typecheck` | TypeScript validation without emit |
| `npm run lint` | Biome lint |
| `npm run test:run` | One-shot Vitest suite |
| `npm run cli:game` | Headless engine console |
| `npm run net:server` | Dedicated authoritative server |
| `npm run lobby:server` | Lobby and matchmaker |
| `npm run docs:dev` | Manual development server |

## Repository shape

```text
src/
  engine/       reusable engine systems
  games/fps/    active arena-FPS game module
  games/tower/  secondary game module
  shared/       client/server deterministic contracts
  cli/          headless tools
  electron/     desktop shell
public/
  engine/       engine assets
  data/         external game data and PK3s
docs/
  manual/       this VitePress manual
  reference/    implementation reference
  research/     design investigations
```

The build can select a game through the `GAME` environment variable, but the repository remains FPS-centric and the TypeScript `@game/*` path maps to `src/games/fps/*`.
