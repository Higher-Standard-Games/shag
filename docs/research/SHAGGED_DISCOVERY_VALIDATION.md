# SHAGGED reference and asset discovery

Implemented on `v0.9.31-shagged-amphi-experiment`. These are editor/tool
extensions; gameplay, renderer implementations and network protocols are
unchanged. No map document or lobby pool is edited by discovery.

## Changes

- `src/engine/editor/server/InstalledMapInspection.ts` and
  `src/engine/editor/server/__tests__/InstalledMapInspection.test.ts`: indexed
  BSP inspection, canonical generic/team spawns and material usage pagination.
- `src/engine/editor/server/ModelLookup.ts` and
  `src/engine/editor/server/__tests__/ModelLookup.test.ts`: packaged/loose model
  discovery, override precedence, invalidation and optional headless bounds.
- `src/engine/editor/CompilerEntityCatalog.ts`,
  `src/engine/editor/EntityCatalog.ts` and
  `src/engine/editor/__tests__/CompilerEntityCatalog.test.ts`: shared compiler
  entity metadata, correct point/brush placement, health and export coverage.
- `src/cli/shagged-mcp.ts` and `src/cli/shagged.ts`: discovery tools and CLI
  inspection/model commands; MCP compiler/runtime class filtering.
- `experiments/shagged/discovery-smoke.mjs` and
  `experiments/shagged/README.md`: real read-only SDK validation and instructions.
- `docs/manual/guides/shagged-api.md`,
  `docs/manual/guides/shagged-editor.md`, `docs/changelog/v0.9.31.md`,
  `docs/research/SHAGGED_NEEEDED_FEATURES.md` and this record: usage and status.

The preceding Node 24 configuration/doc correction is a separate checkpoint.

## Validation

Commands run from the repository root:

```text
npm run typecheck
npx vitest run src/engine/editor/__tests__/CompilerEntityCatalog.test.ts src/engine/editor/__tests__/EditorEntities.test.ts src/engine/editor/__tests__/MapHealth.test.ts src/engine/editor/server/__tests__/ModelLookup.test.ts src/engine/editor/server/__tests__/InstalledMapInspection.test.ts
npx vitest run src/engine/editor/server/__tests__/InstalledMapInspection.test.ts src/engine/editor/server/__tests__/ModelLookup.test.ts src/engine/editor/__tests__/CompilerEntityCatalog.test.ts
npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1
npm run gate:biome
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"
npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
npm run docs:build
npm run shagged -- inspect-bsp wfdm5 --limit 5
npm run shagged -- models lamp --bounds --limit 3
node experiments/shagged/discovery-smoke.mjs
git diff --check
```

Focused tests pass (25 tests across five files; final three-file confirmation
covers the six new tests). Typecheck, build, Biome, simulation, physics,
tick/fuzz, BSP load, replay, docs and real SDK discovery pass. Detailed logs
use `.cache/shagged-discovery-*`. The full suite passed 600 files and 5,009
tests, with one skipped test (316.51 seconds).
The full suite uses separate forks because the preceding SHAGGED cycle found
an intermittent remote weapon test when all files share one fork.

The real SDK check reads `wfdm5`: 1,353 faces, 155 used materials, stable pages,
the original ASE wall lamp with bounds, and four compiler catalog classes.
It also verifies runtime-only filtering. Typechecking caught Node Buffer
generic incompatibilities and an unavailable ES library helper; both were
corrected before the final confirmation.

## Assumptions and limits

- Installed references and props come from `SHAGGED_PUBLISH_ROOT`, defaulting
  to `public/data`. These tests use local installed media and Node 24.
- World bounds include scenery/clips. They do not establish playable size.
- Model dimensions are raw ASE/OBJ vertex envelopes or MD3 frame envelopes;
  they are not transformed placement bounds or collision. GLB/glTF bounds
  remain explicitly unavailable. Corrupt/unreadable bounds return an issue.
- Compiler key metadata follows the bundled MakeBSP README. This task tests
  authoring/export and classification; it does not introduce new compiler
  behavior or newly verify every native key combination visually.
- Browser palette/inspector appearance and in-game visuals were not manually
  retested. Restart existing MCP/editor processes to load the new catalog/tools.
