# SHAGGED texture locking

Branch: `v0.9.31-shagged-amphi-experiment`. Scope: brush authoring transforms
and their face mapping. No FPS-module files, networking contracts or installed
map packages changed.

## Changed files

- `src/engine/editor/TextureLock.ts`: solves an affine UV mapping from three
  stable corresponding anchors, with an inherited one-anchor fallback when
  a new facet has no independent source UV triangle. Handles unchanged
  topology transforms and normalized-hull bounds edits.
- `src/engine/editor/FaceUv.ts`: optional skew and signed scale encode general
  nonsingular affine matrices; conversion retains precision and normalizes
  whole texture repeats. Fit resets skew; existing box wrapping uses this
  same matrix conversion.
- `src/engine/editor/EditorDocument.ts`: validates additive optional `skew`
  and `sizeKnown: false` material fields. The latter distinguishes virtual
  dimensions for locked legacy fixed matrices from real image metadata.
- `src/engine/editor/ConvexBrush.ts`,
  `src/engine/editor/BrushVertexTools.ts`: lock rotation and reconstructed
  convex faces while retaining shader inheritance and topology remapping.
- `src/engine/editor/EditorGesture.ts`,
  `src/engine/editor/EditorBoxTools.ts`: movement and resize preview/commit use
  the shared lock helper. No geometry change keeps the original mapping.
- `src/engine/editor/api/Operations.ts`: bounds updates, movement and duplication
  lock mappings, including brush-entity-owned brushes. Carving retains the
  existing world-space mapping of its pieces.
- `src/engine/editor/EditorSession.ts`: inspector bounds edits and duplication,
  unknown-image-size controls/sampling, and fractional bounds inputs. Picking
  a texture initializes natural alignment for locked legacy mappings.
- `src/engine/editor/FaceAlignmentPanel.ts`,
  `src/engine/editor/BrushFaces.ts`: Skew field, unknown-size guard, Fit reset
  and shared mirrored matrix conversion during convex Wrap.
- `src/engine/editor/__tests__/TextureLock.test.ts`: per-corner UV checks for
  three-axis rotation, off-center pivots, mirroring, movement, nonuniform
  resizing/shear, legacy fixed matrices, split vertex-edit faces, API groups,
  duplication, undo and skew validation.
- `src/engine/editor/__tests__/FaceAlignmentPanel.test.ts`,
  `src/engine/editor/__tests__/BrushFaces.test.ts`,
  `src/engine/editor/__tests__/ConvexBrush.test.ts`,
  `src/engine/editor/__tests__/EditorSession.test.ts`: skew controls and
  unknown-size behavior; assertions recognize transformed legacy overrides
  instead of assuming unchanged material parameters. Wrap continuity checks
  measure distance to an integer repeat, handling floating-point boundaries.
- `src/engine/editor/server/__tests__/ConvexCompile.test.ts`: native compiler
  UVs on a locked rotated bridge and a rotated/nonuniformly resized platform
  with skew, alongside fitted ramp UVs and existing collision checks.
- `experiments/shagged/convex-browser-fixture.ts`,
  `experiments/shagged/convex-browser-probe.mjs`,
  `experiments/shagged/README.md`: GPU `--texture-lock` inspector acceptance.
- `docs/manual/guides/shagged-editor.md`,
  `docs/manual/guides/shagged-api.md`, `docs/changelog/v0.9.31.md`,
  `docs/research/SHAGGED_NEEEDED_FEATURES.md` and this record: controls,
  semantics, limits and checklist.

## Commands

```text
npx vitest run src/engine/editor/__tests__/TextureLock.test.ts src/engine/editor/__tests__/FaceUv.test.ts src/engine/editor/__tests__/BrushFaces.test.ts src/engine/editor/__tests__/BrushVertexTools.test.ts src/engine/editor/__tests__/ConvexBrush.test.ts src/engine/editor/__tests__/FaceAlignmentPanel.test.ts src/engine/editor/__tests__/EditorSession.test.ts src/engine/editor/api/__tests__/Operations.test.ts src/engine/editor/server/__tests__/ConvexCompile.test.ts
npx vitest run src/engine/editor/__tests__/TextureLock.test.ts src/engine/editor/__tests__/FaceUv.test.ts src/engine/editor/__tests__/FaceAlignmentPanel.test.ts src/engine/editor/server/__tests__/ConvexCompile.test.ts
npx vitest run src/engine/editor/__tests__/TextureLock.test.ts src/engine/editor/__tests__/EditorSession.test.ts
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
node experiments/shagged/convex-browser-probe.mjs --texture-lock
git diff --check
```

## Results and findings

The native/focused run passed 30 tests across four files. After the final
fractional-input fix, 38 focused UI/texture-lock tests pass. Typecheck, Biome
(0 errors, 319 warnings versus 339 baseline), build, simulation, physics,
server tick/fuzz, BSP/replay and manual build pass. Physics prints its known
position warning on success. A fresh build follows the final bounds input fix.
The full isolated suite passes 611 files and 5,050 tests, with one skipped
test, in 338.40 seconds. The final unknown-image-size wording was followed by
38 passing inspector/UI tests.

Initial assertions assumed rotation left material parameters unchanged or
left legacy faces without overrides. Those checks now inspect the intended
transformed state; independent corner-UV tests verify attachment. Matrix
conversion precision was tightened; the existing wrap checks pass with signed
scales and stable repeat normalization. Biome test-callback/import diagnostics
were corrected before gates.

Native MakeBSP can normalize a surface's UVs by integer repeats. The compiler
test initially observed a five-repeat V offset on the skewed platform. The
final check requires a constant integer offset across every vertex on each
checked face, preserving both mapping gradients and repeat phase.

Headless Edge/WebGL2 on an NVIDIA RTX 4070 SUPER reports rotation corner drift
`2.22e-16` repeats and resize drift `9.12e-14` repeats. Inspector skew is about
`-13.2424` degrees. Undo restores the original pre-resize brush exactly. The
textured screenshot and Skew controls were inspected. No shader errors or
failed HTTP requests occur; the full media catalog emits its recorded
unresolved-template warnings. Artifacts are in `.cache/shagged-texture-lock*`.

The first GPU inspector resize was blocked: `checkValidity()` returned false
and the bounds change was zero. Whole-number input steps rejected fractional
bounds created by rotation. Bounds fields now accept fractional coordinates;
grid-snapped drags retain the existing snapping rules. The succeeding GPU
probe submits the real form and verifies UVs and undo.

## Assumptions and limits

- Affine movement, rotation and bounds scaling preserve all corresponding
  corner UVs modulo whole repeats. Resizing stretches mapping with the face;
  Natural restores the usual texel density. Locking is the default behavior.
- A non-affine polygon deformation cannot keep every old UV corner in a
  single planar affine mapping. Three stable anchors are retained; other
  corners can change. New facets lacking independent source UVs use the
  inherited mapping anchored at one corner. Review reshaped surfaces.
- Locked legacy matrices do not acquire real image dimensions. Alignment
  controls stay disabled until texture assignment initializes known sizes.
- Face data is additive to schema v2. Loading an untouched old draft does not
  change its source; transforming a brush may add face overrides and skew.
- Direct patch point edits keep authored patch UVs. New caps/topology-specific
  mapping, texture-lock toggles, WebGPU and full in-game map review were not
  added or separately tested.
