# SHAGGED graphical brush vertices

Branch: `v0.9.31-shagged-amphi-experiment`. Scope is editor brush geometry;
FPS movement, map packages and game networking are unchanged.

## Changed files

- `src/engine/editor/BrushVertexTools.ts`: world-space corner access, projected
  handle picking and incremental convex envelope reconstruction. Coplanar
  triangles become polygon sides. Materials inherit by shared source vertices,
  then normal similarity. Removed interior vertices have a negative remap.
- `src/engine/editor/EditorSession.ts`: Vertices/G tool, projected handles and
  grouped labels, Shift selection, grid drag preview/cancel, individual vertex
  selection, exact positions and relative moves. Commit uses the normal
  validated transaction, autosave and undo path. Collapsed previews show red
  handles; rejected commits keep the document unchanged.
- `src/engine/editor/EditorDraftStore.ts`: persisted vertex tool mode.
- `src/engine/editor/api/Operations.ts`, `src/cli/shagged-mcp.ts`: expose
  `brush.vertices` with indexed absolute world coordinates.
- `src/engine/editor/__tests__/BrushVertexTools.test.ts`: single corner edits,
  projected groups, merged vertices, materials, ownership, rejection, undo,
  repeated rotated edits and a 32-sided prism.
- `src/engine/editor/__tests__/EditorSession.test.ts`: mouse drag, cancellation,
  numeric single/group edits, Shift selection, undo/redo and deletion guard.
- `src/engine/editor/server/__tests__/ConvexCompile.test.ts`: native compiler
  and SweepCollisionBackend verify a vertex-shaped ramp's sloped top.
- `experiments/shagged/convex-browser-probe.mjs`: optional `--vertices` checks
  a native browser mouse drag, undo and numeric height edit on the real GPU.
- `docs/manual/guides/shagged-editor.md`,
  `docs/manual/guides/shagged-api.md`, `docs/changelog/v0.9.31.md`,
  `docs/research/SHAGGED_NEEEDED_FEATURES.md`,
  `experiments/shagged/README.md` and this record: controls, API and status.

## Validation

```text
npx vitest run src/engine/editor/__tests__/BrushVertexTools.test.ts src/engine/editor/__tests__/EditorSession.test.ts src/engine/editor/server/__tests__/ConvexCompile.test.ts
npx vitest run src/engine/editor/__tests__/BrushVertexTools.test.ts src/engine/editor/__tests__/EditorSession.test.ts
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
node experiments/shagged/convex-browser-probe.mjs --vertices
git diff --check
```

The initial focused run passed 34 tests including native compilation. The
final focused run passed 34 tests after grouping overlapping labels and adding
the many-sided prism case. Typecheck, production build, simulation, physics,
server tick/fuzz, BSP loading and replay, and manual build pass. Physics has
its documented passing-run position warning. Biome initially found four import
ordering errors; these were corrected, and the gate passes with 0 errors and
319 warnings against the 339-warning baseline.

The full isolated suite passed 609 files and 5,034 tests with one skipped test
in 358.87 seconds. The final focused run also covers the additional prism case
and handle-label refinement; a fresh production build passes afterward.

GPU validation uses headless Edge/WebGL2 on an NVIDIA RTX 4070 SUPER. A native
mouse drag moves the projected group, undo restores its source brush exactly,
and a numeric edit raises one corner from 48 to 64. Installed grid textures
decode and render. The final screenshot was inspected, including grouped
overlapping labels and the exact coordinate inspector. The report has no
shader errors or failed HTTP requests;
the full media catalog emits unresolved-template parser warnings, recorded
in the report. Screenshots and logs are in `.cache/shagged-vertices*`.

## Assumptions and limits

- Vertices edit a convex envelope. Pulling a point inward can remove it, and
  changing a face may triangulate it. Concave geometry needs multiple brushes.
- Existing side materials are inherited, but texture locking is not provided;
  inspect alignment after reshaping. Vertex and side indices can change.
- Geometry limits remain 128 vertices, 64 sides, and the document's map bounds.
- Handles are in the three orthographic panes. The perspective pane shows the
  shape and drag ghost; direct 3D vertex gizmos are not implemented.
- There is no vertex insertion command or topology-specific vertex deletion.
  Moving corners together can merge them; whole-brush deletion uses Select.
- WebGPU and a full in-game map playthrough were not separately tested.
