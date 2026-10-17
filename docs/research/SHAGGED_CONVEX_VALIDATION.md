# SHAGGED convex brush authoring validation

Branch: `v0.9.31-shagged-amphi-experiment`. This implements the diagonal/convex
geometry priority from the Relay Yard experiment. No FPS-module files, map
packages, lobby pools or game movement rules were changed.

## Implementation

- `src/engine/editor/ConvexBrush.ts`: normalized hull representation, closed
  convex solid validation, box conversion, three-axis rotation, convex prism
  extrusion and arbitrary-plane texture bases.
- `src/engine/editor/EditorDocument.ts`: additive optional hull state and
  validation, retaining existing v2 boxes and bounds-based editing.
- `src/engine/editor/api/Operations.ts`,
  `src/engine/editor/api/CreationMaterials.ts`: typed creation/rotation, numeric
  side materials, natural alignment and atomic rejection of overlapping cuts.
- `src/engine/editor/server/AgentPipeline.ts`: image-size resolution for the
  new operations. Existing inspection/snapshot paths preserve hull data and
  use the existing brush bounds and ownership IDs.
- `src/engine/editor/MapWriter.ts`: outward hull polygons export as brushDef
  planes with compiler winding, materials and detail contents.
- `src/engine/editor/MapHealth.ts`: check actual hull side materials.
- `src/engine/editor/TexturedPreview.ts`,
  `src/engine/editor/ConvexPreview.ts`: actual polygon meshes, UVs and edges.
- `src/engine/editor/EditorSession.ts`: brush/textured/wireframe and gesture
  rendering, 2D hull edges, bulk texturing, rotation inspector and bounds edits.
- `src/engine/editor/server/CompileDiagnostics.ts`,
  `src/engine/editor/server/CompilerPlaceholders.ts`,
  `src/engine/editor/server/CompileJobs.ts`: preserve the native bare noshader
  warning and verify it has no draw usage before allowing publication.
- `src/cli/shagged-mcp.ts`: operation discovery descriptions.
- `src/engine/editor/__tests__/ConvexBrush.test.ts`,
  `src/engine/editor/__tests__/ConvexPreview.test.ts`,
  `src/engine/editor/__tests__/EditorSession.test.ts`,
  `src/engine/editor/server/__tests__/ConvexCompile.test.ts`,
  `src/engine/editor/server/__tests__/CompilerPlaceholders.test.ts`: geometry,
  lifecycle, ownership, query, picking, inspector and native output coverage.
- `experiments/shagged/convex-smoke.mjs`,
  `experiments/shagged/convex-browser-fixture.ts`,
  `experiments/shagged/convex-browser-probe.mjs`,
  `experiments/shagged/README.md`: real MCP and browser validation.
- `docs/manual/guides/shagged-api.md`,
  `docs/manual/guides/shagged-editor.md`, `docs/changelog/v0.9.31.md`,
  `docs/research/SHAGGED_NEEEDED_FEATURES.md` and this record: usage/status.

## Commands and results

```text
npx vitest run src/engine/editor/__tests__/ConvexBrush.test.ts src/engine/editor/__tests__/ConvexPreview.test.ts src/engine/editor/__tests__/EditorSession.test.ts src/engine/editor/api/__tests__/Operations.test.ts src/engine/editor/api/__tests__/CreationMaterials.test.ts
npx vitest run src/engine/editor/server/__tests__/ConvexCompile.test.ts src/engine/editor/server/__tests__/CompilerPlaceholders.test.ts src/engine/editor/server/__tests__/CompileJobs.test.ts
npx vitest run src/engine/editor/__tests__/EditorSession.test.ts src/engine/editor/__tests__/ConvexBrush.test.ts src/engine/editor/__tests__/ConvexPreview.test.ts
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
node experiments/shagged/convex-smoke.mjs
node experiments/shagged/convex-browser-probe.mjs
git diff --check
```

All gates and headless regressions pass. The full suite passed 608 files and
5,028 tests, with one skipped test, in 334.51 seconds. Separate-fork execution
continues the established isolation mode. The final inspector layout adjustment
was followed by 35 passing focused tests and a fresh passing production build.
Biome stayed at 0 errors and 319 warnings (baseline 339). Physics emits its
documented position warning on a successful exit.

The native test compiled a sealed room, diagonal detail bridge and octagonal
platform. Sweep traces hit the actual bridge/platform tops and miss empty
space inside the diagonal bridge's AABB. Compiled UV deltas match the arbitrary
plane basis and requested natural image scale.

Initial native compilation was blocked by a bare `noshader` warning. Inspection
found that material on 13 collision sides and zero draw faces. The final
pipeline checks BSP usage before accepting this specific warning; tests ensure
visible placeholders and genuine missing assets remain blocking. An initial
picking fixture lacked a material, which makes Babylon fall back to bounds;
the corrected test assigns a material and verifies triangle hits/misses.
API duplication/deletion tests follow the existing ownership semantics.

The real SDK check creates a unique QA document, authors rotated/prism brushes,
edits numeric sides, queries group ownership and verifies an unsupported cut
leaves the saved document byte-equivalent as data. It removes its own document.

GPU QA uses headless Edge, WebGL2 on an NVIDIA RTX 4070 SUPER. Three actual
hulls render; the bridge has 24 preview vertices; actual-shape hit/miss picking
and rotation control presence pass. Brush, wireframe and textured screenshots
were inspected, including the installed grid texture on the actual hulls.
Browser shader errors and failed HTTP requests are absent. Loading the full
media catalog emits shader-parser warnings about unresolved media templates;
these are recorded in the report. Screenshots and GPU/browser report
are under `.cache/shagged-convex-*`. Initial standalone probe attempts failed
because mixed raw/prebundled Babylon imports used incompatible shader module
graphs and stale lazy chunks. The static fixture and isolated Vite setup keep
Babylon unbundled while prebundling the CommonJS JSZip dependency; this fixes
the probe without changing the production renderer. The fixture initializes
the published PK3 index before opening the editor and uses the root asset URL
base, matching normal application startup.

## Assumptions and limits

- Coordinates are Quake Z-up. Rotations preserve IDs, materials and ownership;
  textures follow the compiler face basis rather than a rotation texture lock.
- Hull vertices are normalized inside their existing AABB. Bounds resize is
  world-axis affine scaling. Region queries and orthographic selection use
  conservative bounds. Native collision uses the exported solid planes.
- Hulls must be convex, closed, planar-sided and nonzero in volume. Concave
  decomposition, convex subtraction and graphical vertex/topology editing are
  not implemented. Overlapping convex cuts reject the entire transaction.
- Browser bulk texturing works; numeric per-side materials are exposed through
  scripting. The six-face graphical alignment panel remains box-only.
- Native compilation and SDK checks require installed local tools/media.
  This task does not establish combat balance or movement quality of a new map.
- The browser probe checks the editor component on WebGL2; WebGPU and a full
  in-game visual playthrough were not separately tested.
