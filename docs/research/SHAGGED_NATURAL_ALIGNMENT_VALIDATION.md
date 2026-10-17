# SHAGGED natural creation alignment

Scope: the next mapping-tool priority after reference/model/compiler discovery,
on `v0.9.31-shagged-amphi-experiment`. This adds creation-time material alignment
without migrating existing documents or altering legacy calls.

## Changed files

- `src/engine/editor/api/CreationMaterials.ts`: typed creation options and
  natural face material construction.
- `src/engine/editor/api/Operations.ts`: box and generator operation support.
- `src/engine/editor/server/AgentPipeline.ts`: resolve needed material sizes
  from the configured media catalog without replacing explicit sizes.
- `src/engine/editor/server/TextureLookup.ts`: include media root in cache keys.
- `src/cli/shagged-mcp.ts`, `src/cli/shagged.ts`: explain the option in discovery
  and use the configured media root for texture searches.
- `src/engine/editor/api/__tests__/CreationMaterials.test.ts`: image-repeat
  scale, legacy export compatibility, generated materials, carving and atomic
  failure regression coverage.
- `src/engine/editor/server/__tests__/CreationTextureLookup.test.ts`: automatic
  sizing, mixed materials, explicit size precedence and avoided catalog reads.
- `src/engine/editor/server/__tests__/TextureCatalogRoots.test.ts`: identical
  archive metadata in distinct media roots must not alias their catalogs.
- `src/engine/editor/server/__tests__/NaturalCompile.test.ts`: native compiler
  output must retain requested world-to-image texture repeat rates.
- `experiments/shagged/natural-alignment-smoke.mjs`,
  `experiments/shagged/README.md`: real MCP authoring validation and instructions.
- `docs/manual/guides/shagged-api.md`, `docs/changelog/v0.9.31.md`,
  `docs/research/SHAGGED_NEEEDED_FEATURES.md` and this record: usage and status.

## Validation commands

```text
npx biome check --write src/engine/editor/api/CreationMaterials.ts src/engine/editor/api/Operations.ts src/engine/editor/api/__tests__/CreationMaterials.test.ts src/engine/editor/server/AgentPipeline.ts src/engine/editor/server/TextureLookup.ts src/engine/editor/server/__tests__/CreationTextureLookup.test.ts
npx biome check --write src/engine/editor/server/__tests__/NaturalCompile.test.ts src/cli/shagged.ts src/cli/shagged-mcp.ts
npx biome check --write src/engine/editor/server/__tests__/TextureCatalogRoots.test.ts
npx vitest run src/engine/editor/api/__tests__/CreationMaterials.test.ts src/engine/editor/server/__tests__/CreationTextureLookup.test.ts src/engine/editor/api/__tests__/Operations.test.ts src/engine/editor/api/__tests__/ConnectStairs.test.ts
npx vitest run src/engine/editor/server/__tests__/NaturalCompile.test.ts
npx vitest run src/engine/editor/server/__tests__/TextureCatalogRoots.test.ts
node experiments/shagged/natural-alignment-smoke.mjs
npm run typecheck
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
git diff --check
```

Focused tests passed (27 tests across four files), the media-root fixture
passed, and a real MakeBSP/MakeLight room compile verified non-square natural
texture repeats in BSP vertex UVs. The real SDK smoke check used
`concrete/concretebunker0068` at catalog size 512 x 512: all six room brushes
stored natural face materials, and an unknown material failed without changing
the saved snapshot. The smoke script removes only its own uniquely named QA
document. Logs are under `.cache/shagged-natural-*`.

All gates and regressions passed: typecheck, Biome (0 errors, 319 warnings
against the 339-warning baseline), production build, docs build, simulation,
physics, server tick/fuzz, indexed `wdm2` load (7,475 faces) and movement replay.
The full suite passed 604 files and 5,017 tests, with one skipped test, in
316.26 seconds. Separate-fork execution follows the preceding discovery
validation's isolation mode. Physics printed its documented position warning
on a successful exit; no new failure was observed.

## Assumptions and unverified items

- `alignment: "natural"` is explicit for backwards-compatible scripts. Omitted
  alignment and `"legacy"` retain fixed 32-unit repeats. Stored face materials
  override a brush's fallback shader; later retexturing uses `face.material`.
- Natural scale is the existing gamepack default, 0.5 world units per texel.
  This is image scale, not automatic art-direction matching across materials.
- MCP/CLI use `SHAGGED_PUBLISH_ROOT`, default `public/data`. Direct pure API
  callers provide sizes; no Node/browser dependency was added to operations.
- The native compile and SDK checks used installed media and tools on Node 24.
  No existing map, game rules or FPS-module files were edited.
- Browser appearance was not manually retested. The native BSP UV check
  verifies compiler output, while existing material rendering is unchanged.
- Convex/rotated brush authoring and a clean CLI JSON launcher remain separate
  backlog items. This change does not add those capabilities.
