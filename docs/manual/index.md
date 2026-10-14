# SHAG Engine documentation

SHAG is a TypeScript/Babylon.js engine and playable arena-FPS stack for Quake 3 and Warsow media.

It provides BSP/PK3 loading, Quake shader compatibility, deterministic movement and collision, server-authoritative multiplayer, gameplay systems, headless tools, and multiple application wrappers.

## Current boundaries

- Indexed Q3 IBSP and Warsow/qfusion FBSP maps are the primary playable content path.
- SHAGGED, the built-in map editor, builds, compiles and playtests maps. A raw text-map parser and renderer also exist, but a local `.map` file is not a playable map.
- Web and Node/headless flows are active.
- Android and Electron projects exist but have documented integration/packaging work remaining.
- External game media belongs under `public/data/` and is not committed.

## Start here

| Section | Use it for |
| --- | --- |
| [Introduction](./introduction/) | Architecture and feature status |
| [Getting started](./getting-started/) | Install, run, and first verification |
| [Tutorials](./tutorials/) | Task-oriented learning |
| [Guides](./guides/) | Subsystem contracts and workflows |
| [Tools](./tools/) | CLI, server, and research utilities |
| [Deployment](./deployment/) | Web, Android, and Electron status |
| [FAQ](./faq/) | Troubleshooting |
| [Contributing](./contributing/) | Contribution workflow |

## Quick verification

```bash
npm install
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
npm run test:simulation
npm run test:physics
npm run dev
```

The map check requires compatible external PK3 data. The development server runs at [http://localhost:3000](http://localhost:3000).

## For repository agents

Read the root `AGENTS.md` before changing code. Verify APIs in source, keep FPS extensions under `src/games/fps/` by default, test headlessly first, and run the required renderer/networking regressions for critical-system edits.

SHAG is released under the [MIT License](https://github.com/Higher-Standard-Games/shag/blob/main/LICENSE).
