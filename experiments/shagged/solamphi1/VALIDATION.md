# Relay Yard validation and handoff

The initial-build sections below are historical. The refinement section at the end describes the current map, measurements and validation.

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

## Lobby testing pool follow-up, 2026-10-17

The Amphi pool in `config/maps.json` now contains `wamphi1` and `solamphi1` (Relay Yard); `wda1` and `wda2` have no lobby gametype assignment. Lobby disk discovery recognizes numbered SHAGGED packages by their base map name. The lobby reads its configuration at startup, so a running instance needs a restart. Live lobby restart and browser selection were not performed for this change.

Changed files in this follow-up: `config/maps.json`, `src/lobby/LobbyServer.ts`, `src/lobby/__tests__/LobbyAmphiMaps.test.ts`, `docs/manual/guides/lobby-server.md`, `docs/changelog/v0.9.31.md`, `docs/research/SHAGGED_NEEEDED_FEATURES.md`, and this file.

Validation reran `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run gate:biome`, `npm run docs:build`, `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`, `npm run server:fuzz -- --ticks 1000`, and `npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"`. The focused command was `npx vitest run src/lobby/__tests__/LobbyAmphiMaps.test.ts`; it passed, including installed numbered builds and absent maps. The full suite passed 4,990 tests with one skipped; all gates and regression commands passed.

## Detail refinement, 2026-10-17

### Scope and scale correction

This pass keeps FPS Amphi rules and server movement unchanged. Matching the original outer envelope was an inadequate scale comparison: the prototype's outer spawn diagonal was about 22% longer than wamphi1's. All authored positions and geometry were uniformly scaled by 0.75, including model scales and appropriate light-power adjustment. Current court interior: 1680 x 1680 units; structural envelope: 1728 square; upper deck: 192 high; cardinal bridges: 144 wide. Surrounding city geometry remains outside the player boundary.

Four recessed slime basins use wamphi1's actual slime material. Escape steps rise at most 12 units. Dry lower paths and crossing underpasses beneath the reactor preserve circulation. Existing shared slime world effects provide damage; no overlapping hurt triggers were introduced.

The detail pass includes original ASE wall lamps, arched windows, reactor pillar props, shaped Nat's Bar signage, air conditioners, chimneys, dumpsters and loose paving. Masonry pilasters, plinths, coping, pipe hangers, vent mounts and gantry bearings give the fixtures physical support. Native projected lettering, graffiti, warning decals and grime identify the service areas. The reactor has a glass enclosure, inner core and retaining hoops. No live match balance claim is made.

### Implementation checkpoints and changed files

- `96c7884b`: compiler-native ASE reference support; original models need no conversion. Browser ASE preview remains unsupported.
- `6f736974`: validated worldspawn settings through MCP, persistence and export.
- `1da62e45`: solid detail-brush authoring, export, inspection and preservation through carve.

Exact engine/API files across these checkpoints: `src/engine/editor/EditorDocument.ts`, `src/engine/editor/MapWriter.ts`, `src/engine/editor/ModelReference.ts`, `src/engine/editor/__tests__/ModelReference.test.ts`, `src/engine/editor/api/Operations.ts`, `src/engine/editor/api/__tests__/Operations.test.ts`, `src/engine/editor/server/AgentPipeline.ts`, `src/cli/shagged-mcp.ts`, `docs/manual/guides/shagged-api.md`, `docs/manual/guides/shagged-editor.md`, and `docs/changelog/v0.9.31.md`. Use each checkpoint's diff for its individual scope.

Map/refinement files: `package-props.mjs`, `prepare-lettering.mjs`, `lettering.shader`, `source-model-bounds.json`, `refine.mjs`, `verify.ts`, `review.mjs`, `solamphi1.json`, `README.md`, `VALIDATION.md`, `preview-overview.png`, `preview-gallery.png`, `preview-ground.png`, `preview-slime.png`, and the operation/report JSON files under `refinement/`, all within this experiment directory. Additional documentation: `docs/research/SHAGGED_NEEEDED_FEATURES.md` and `docs/changelog/v0.9.31.md`.

`refinement/atmosphere-failure.json` records an intentionally canceled overlapping native compile, not a remaining authored-map failure. Its saved edits were included in the later sequential optimized build. Compile stages must run sequentially until cross-process coordination and native cache isolation exist.

### Exact validation commands

For the final editor feature, all commands below passed:

```text
npx vitest run src/engine/editor/api/__tests__/Operations.test.ts
npm run typecheck
npm run test:run
npm run gate:biome
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- --exec "sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit"
npm run docs:build
```

Full suite: 595 files passed, 4,994 tests passed, one skipped. Biome: zero errors, below baseline. Physics retained the documented passing-run position warning. Earlier ASE/worldspawn checkpoints also passed these gates and regressions.

Native map authoring uses the sequential MCP stages in README. Final map-specific commands:

```powershell
$env:SOLAMPHI_QUALITY = 'default'
node experiments/shagged/solamphi1/refine.mjs report
npx vite-node src/games/fps/scripts/diagnostics/solamphi1-verify.ts
```

The report verifies all four spawns and four items are connected for players and bots. The native collision probe verifies both underpasses with the actual standing-player origin and hull, all basin contents and escape step heights, dry paths, actual detail-pilaster solidity and baked font materials. MakeBSP consumes the source DETAIL classification; final material flags do not retain a distinct detail-solid shader entry.

Final reviewed build: `map_solamphi1_00017.pk3`, normal/default quality, BSP SHA-256 `8124eaf9a23da86bcf8f7479de74c1d2ea8179476df59fa8ca9f26f26768c413`. Source document revision 17 contains 568 brushes (433 marked detail), 64 patches and 87 model instances. Managed publication revision 16 is a separate counter. Player reachability checked 17,698 positions; bot navigation had 98 nodes and 1,006 edges. Both reports passed.

GPU review uses headless Edge/WebGL2 on the real GPU, a private no-HMR Vite server on port 3100, and normal MapLoader loading. Source-side winding was corrected after a temporary browser-only culling diagnostic revealed inward-facing reactor hoops. Final preview images use ordinary material culling. The capture command is `node experiments/shagged/solamphi1/review.mjs`. Raw logs stay in `.cache/`; a compact review report is saved with the refinement reports. No browser exceptions or failed asset requests occurred.

### Unverified items

Human combat balance, actual Amphi pacing versus wamphi1, minimum-spec performance and exhaustive movement-edge coverage need playtesting. Automated reachability does not prove these. The map remains an axis-aligned gameplay layout; an octagonal/diagonal layout requires additional convex-brush API work. Native font/media packages are local generated dependencies, not committed binaries. Both repositories remain on the experiment branch; no merge or push was requested.
