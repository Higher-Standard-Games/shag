# SHAGGED convex face selection and alignment

Branch: `v0.9.31-shagged-amphi-experiment`. This extends graphical brush face
editing. No FPS-module files or installed map packages are changed.

## Changed files

- `src/engine/editor/BrushFaces.ts`: shared box/convex face identity, material
  access, geometry and texture basis. Fit uses projected polygon extents.
  Convex Wrap rotates target planes about shared edges and traverses adjacency
  breadth-first, preferring selected sides. Mirroring retains signed V scale.
- `src/engine/editor/FaceAlignmentPanel.ts`: uses shared face access, Fit and
  Wrap for numeric convex sides and existing box faces. Wrap results are
  computed once per alignment action. Existing shift/scale/rotation, Natural
  and missing-image-size safeguards apply to both representations.
- `src/engine/editor/ConvexPreview.ts`: triangle-to-source-side metadata follows
  shader batching, including sides reordered by different materials.
- `src/engine/editor/EditorSession.ts`: Shift/Alt picking, numbered side list,
  selected-polygon overlays and 2D outlines, selected-side texture application,
  alignment and stale selection filtering. Edits use existing validated
  transactions, undo and autosave; vertex edits/rotation clear face selection.
- `src/engine/editor/__tests__/BrushFaces.test.ts`: actual-polygon Fit,
  rotated/mirrored Wrap, non-right-angle shared edges, and box compatibility.
- `src/engine/editor/__tests__/ConvexPreview.test.ts`: source side identity
  after shader batch reordering.
- `src/engine/editor/__tests__/EditorSession.test.ts`: real scene picking,
  side buttons, sampling, selected-only textures, Fit, nudging, undo, rejected
  zero scale and Wrap. Existing box workflows remain covered.
- `src/engine/editor/server/__tests__/ConvexCompile.test.ts`: compiler BSP UVs
  on a fitted sloped face match the shared texture basis and face matrix.
- `experiments/shagged/convex-browser-fixture.ts`,
  `experiments/shagged/convex-browser-probe.mjs`,
  `experiments/shagged/README.md`: optional `--faces` GPU acceptance mode.
- `docs/manual/guides/shagged-editor.md`, `docs/changelog/v0.9.31.md`,
  `docs/research/SHAGGED_NEEEDED_FEATURES.md` and this record: usage and a
  consolidated checklist separating completed work from historical findings.

## Commands and evidence

```text
npx vitest run src/engine/editor/__tests__/BrushFaces.test.ts src/engine/editor/__tests__/ConvexPreview.test.ts src/engine/editor/__tests__/FaceAlignmentPanel.test.ts src/engine/editor/__tests__/EditorSession.test.ts src/engine/editor/server/__tests__/ConvexCompile.test.ts
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
node experiments/shagged/convex-browser-probe.mjs --faces
git diff --check
```

The focused run passes 44 tests across five files, including native compilation.
The full isolated suite passes 610 files and 5,041 tests, with one skipped test,
in 333.42 seconds.
Typecheck, Biome (0 errors, 319 warnings versus 339 baseline), production build,
simulation, physics, server tick/fuzz, BSP/replay and manual build pass. Physics
has its documented position warning on success. The initial Fit test mistakenly
expected a horizontal face's projected extents to differ from its XY bounds;
the corrected test uses a diagonal vertical side. Biome caught a returning
forEach test callback, fixed before gates ran.

Real-GPU acceptance uses headless Edge/WebGL2 on an NVIDIA RTX 4070 SUPER.
A native Shift-click selects diagonal side 5, Fit and an 8-texel shift nudge
work, undo restores the fitted material, Alt-click samples `blx/blx_grid`, and
Wrap runs with a second selected side. The media grid texture is decoded.
Screenshots are inspected; report/logs live in `.cache/shagged-faces*`.
No shader errors or failed HTTP requests occur. Full media catalog parsing
emits unresolved-template warnings, recorded in the report.

The initial GPU probe could not locate a visible side because its projection
used the camera viewport's bottom-origin Y as a screen-space top-origin Y.
Correcting the fixture's viewport conversion made native picking pass;
production picking code did not require a coordinate workaround.

## Assumptions and limits

- Hull side indices refer to the current document; topology changes can reorder
  them. Box face names and document schema remain unchanged.
- Alignment needs known image dimensions. Pick a texture before editing a
  legacy fixed-matrix face. Invalid scale values reject the whole transaction.
- Fit covers projected texture U/V ranges, not a special parametrization of
  triangles or irregular polygons. Wrap follows deterministic adjacency paths;
  other edges on a closed solid can still show seams.
- This does not implement texture locking during rotation or reshaping.
- WebGPU and a full in-game map playthrough were not separately tested.
