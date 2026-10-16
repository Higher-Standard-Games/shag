# Relay Yard validation and handoff

## Scope and assumptions

- Experiment branch in both repositories: `v0.9.31-shagged-amphi-experiment`, created from `main`.
- Existing FPS Amphi rules, supporting normal server play. No gametype or movement rules changed.
- Target: `wamphi1`'s 2304-unit outer horizontal scale for the arena, using `wfdm5` materials and compiler conventions. The surrounding city expands visual bounds, not the intended fighting footprint.
- The canonical editor snapshot is `solamphi1.json`; the live MCP document is its copy under `server-data/shagged/agent/`.
- Local Warfork source models were packaged without modification. Their original shader paths and dependency images are retained. No media binaries are committed to Git.

## Implementation checkpoints

- `d9c6bd9c`: validated patch creation through the scripting/MCP API.
- `7f0bc404`: deploy the Washoi profile where native compiler binaries resolve it.
- The map checkpoint includes the canonical source, recorded MCP edit batches, build scripts, reports and preview images. Recorded batches describe the actual editing history, including the first railing repair; the generator already includes that repair for a fresh reproduction.
- FPS is on the matching branch with no code changes required. Nothing was merged or pushed during this experiment.

## Engine validation

Commands run from the outer repository:

```text
npm run typecheck
npm run test:run
npm run build
npm run gate:biome
npm run docs:build
npx vitest run src/engine/editor/api/__tests__/Operations.test.ts
npx vitest run src/engine/editor/server/__tests__/CompilerConfig.test.ts src/engine/editor/server/__tests__/CompileJobs.test.ts
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- --exec "sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit"
```

All completed successfully. Full suite: 595 files passed, 4,990 tests passed, one skipped. Focused operations suite: 12 tests passed. Focused compiler/job suites: seven tests passed. Biome stayed below baseline, with zero errors. Physics exited successfully with the existing direct-step position warning documented in the repository instructions. Tick and fuzz checks reported matching deterministic checksums and no numeric errors.

The first PowerShell-redirection invocation of each headless CLI command reported a shell-level failure from native stderr despite completing its commands. Both were rerun through `cmd.exe` with native exit-code capture: BSP exit 0, replay exit 0; the replay completed 91 ticks.

## Map and GPU validation

The MCP authoring commands and exact reproduction order are in the README. The `report-report.json` file records the final reviewed compile quality, package, BSP hash, leak result, player reachability and bot navigation results. Final build: normal/default quality, `map_solamphi1_00008.pk3`, no leak, four connected spawns and four reachable items. Player and bot reports both passed. The document contains 382 brushes, 28 patches and 20 model instances. Every spawn must reach every item and the other spawns.

The first detail report caught an upper-armor route blocked by railings. It passed after stair openings were restored. After correcting compiler profile lookup, indexed BSP inspection verified actual barrel/crate materials in the output, rather than assuming successful model loading from an exit code.

GPU review uses the repository's browser-probe workflow: private no-HMR Vite on port 3100, headless Edge, WebGL2 on the real GPU, and direct map loading through `MapLoader`. The screenshots cover an overview, gallery and ground view. No browser exceptions or failed HTTP requests occurred in either the corrected fast-build review or the final normal-quality review. Existing media-template warnings and informational unhandled compile-time entity warnings are not treated as new render failures.

This is not a live Amphi match test, balance review, minimum-spec benchmark or proof of collision cost under combat. Human review remains needed for spawn exposure, movement feel, upper-route advantage and visual preferences. The central footprint and bridges remain axis-aligned; curved patches provide the reactor and service piping.

## Exact changed files

Engine/API and documentation:

- `src/engine/editor/api/Operations.ts`
- `src/engine/editor/api/__tests__/Operations.test.ts`
- `src/cli/shagged-mcp.ts`
- `src/engine/editor/server/CompilerConfig.ts`
- `src/engine/editor/server/__tests__/CompilerConfig.test.ts`
- `docs/manual/guides/shagged-api.md`
- `docs/changelog/v0.9.31.md`
- `docs/research/SHAGGED_NEEEDED_FEATURES.md`

Map experiment files, all under `experiments/shagged/solamphi1/`:

- `README.md`, `VALIDATION.md`, `build.mjs`, `package-props.mjs`, `solamphi1.json`
- `greybox.ops.json`, `detail.ops.json`, `polish.ops.json`, `access.ops.json`, `finish.ops.json`, `machinery.ops.json`, `city.ops.json`
- `greybox-report.json`, `polish-report.json`, `access-report.json`, `finish-report.json`, `machinery-report.json`, `city-report.json`, `report-report.json`
- `preview-overview.png`, `preview-gallery.png`, `preview-ground.png`

Local generated media: the published `map_solamphi1_*.pk3` builds, publish pointer/index updates, `solamphi1_compile_props.pk3`, and the executable-adjacent Washoi profile. These are workspace build artifacts, excluded from Git. Scratch probe scripts, raw logs and test output remain in `.cache/`.
