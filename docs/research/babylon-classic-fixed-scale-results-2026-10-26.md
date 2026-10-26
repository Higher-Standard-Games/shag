# Fixed-scale shader registrations: follow-up results

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`.
Reference engine revision: `cb02caeb`; Babylon 9.31.2. FPS is unchanged.
See the [progress matrix](babylon-classic-to-lite-groundwork-plan-2026-10-26.md#feature-branch-and-progress-matrix).

## Accepted scope

An entry containing only fixed `tcMod scale` operations can retain a frozen
material and skip repeated UV writes while its actual texture transforms match
the stage state. The guard reads all five bound UV values and checks every
stage. It allocates no per-frame arrays or result objects.

Registrations remain in their original order and the system clock continues
advancing. A changed target uses the existing update path, including unfreezing
and restoring its UVs. No automatic refreeze is added. Unregister, clear and
scene disposal retain their existing behavior. This does not remove entries or
claim exclusive ownership of shared texture wrappers.

Entries with frames, waves, rotation, scroll, transform or turbulence retain
their existing route. Even a constant-amplitude wave is excluded. Mixed entries
cannot bypass their animated stages. The test coverage checks a shared texture
in both registration orders, in addition to Standard/PBR freezing, external UV
changes, unregistration and preserved clock advancement.

## Controlled GPU comparison

Headless Edge used the real GPU on WebGL2 and Babylon WebGPU. An archived copy
of `ShaderAnimationSystem` from `cb02caeb` was imported from ignored `.cache/`
for the reference; no source reversion or branch switch was needed.

Each material renders a repeated 2-by-2 test texture at scale 2-by-3 for 120
frames after initialization. Both versions freeze it before this sequence.

| Backend | Material | Reference UV assignments | Candidate UV assignments | Candidate remains frozen | Image comparison |
| --- | --- | ---: | ---: | --- | --- |
| WebGL2 | Standard | 600 | 0 | Yes | Identical SHA-256 |
| WebGL2 | PBR | 600 | 0 | Yes | Identical SHA-256 |
| Babylon WebGPU | Standard | 600 | 0 | Yes | Identical SHA-256 |
| Babylon WebGPU | PBR | 600 | 0 | Yes | Identical SHA-256 |

The reference unfreezes both materials. All four candidate/reference pairs
also repair an external `vOffset` change and return to identical pixels, then
stop owning the texture after unregistering. Nonbackground pixels are required.
The counter measures application property assignments, not GPU uploads or FPS.

## Live map evidence and corrected tally

The previous dm5 JSON inventory contains **seven**, not eight, fixed-scale-only
registrations: six Standard materials and one generated PBR material. The initial
written tally was incorrect and is corrected in the first-cycle report.

The follow-up played `washoi_dm5_ffa_20261025_170933.shagdemo` on WebGL2 and
observed seven eligible entries sharing five texture wrappers. Across 60 rendered
frames, those wrappers received **zero UV assignments**, and all seven materials
remained frozen. There were 16 total registered entries and 616 scene meshes at
the measurement point. The scene loaded without failed HTTP requests or browser
errors; existing skin-root, fallback-water and unhandled-entity warnings remain.
Scene mesh counts are playback-point observations, not stability assertions.

This real shared-wrapper workload supports retaining the actual-target guard
rather than removing static registrations or assuming exclusive UV ownership.

## Reproduce the isolated comparison

Start a private no-HMR server, then run the driver in a second shell:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3117
# Second shell:
node scripts/benchmarks/renderer-groundwork.mjs webgl2 fixed-scale 3117 cb02caeb
node scripts/benchmarks/renderer-groundwork.mjs webgl2 fixed-scale
node scripts/benchmarks/renderer-groundwork.mjs webgpu fixed-scale 3117 cb02caeb
node scripts/benchmarks/renderer-groundwork.mjs webgpu fixed-scale
```

Logs and records are written to `.cache/renderer-groundwork/fixed-scale-*`.
Archived module URLs include their commit hash. A compatibility probe exposed
that reusing one archive filename under the no-HMR server could return an earlier
revision from Vite's cache even after the file changed. Distinct immutable URLs
prevent that measurement error; the corrected reference comparisons were rerun.
The live-map diagnostic used an ignored local probe following the existing
browser-probe demo procedure; its record is `fixed-scale-map.json`. Registry
access and temporary property counters are diagnostic code, not new public APIs.

## Validation

Focused headless tests: 19 passed across `TextureTransforms` and
`Q3StageEvaluation`. The first invocation used an ambiguous `--silent` argument;
Vitest rejected it before running tests. The explicit boolean form succeeded:

```powershell
npm.cmd run test:run -- src/engine/loader/shader/__tests__/TextureTransforms.test.ts src/engine/loader/shader/__tests__/Q3StageEvaluation.test.ts --silent=true
```

Required gates and regressions:

```powershell
npm.cmd run typecheck
npm.cmd run test:run -- --silent
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run docs:build
npm.cmd --prefix src/games/fps run test:simulation
npm.cmd --prefix src/games/fps run test:physics
npm.cmd --prefix src/games/fps run server:tick
npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000
npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
```

Typecheck, focused tests, the Biome baseline and required gameplay/server/map
regressions passed. The complete suite passed 737 files and 5,740 tests, with one
skipped test. Production and manual builds passed, with the production build's
existing large-chunk warning. Biome retained its baseline of zero errors and
47 warnings. The first regression shell wrapper incorrectly
treated a native stderr diagnostic as a terminating PowerShell error; the
corrected wrapper checks each process exit code and preserves all output.

No whole-game frame-rate estimate, exhaustive map coverage, live network match,
context/device-loss result for this follow-up, or Lite integration is claimed.
Both rendering backends were checked with isolated materials; live dm5 coverage
in this slice is WebGL2 only. The previous effect restoration result remains
separate evidence.

## Files changed

- `src/engine/loader/shader/ShaderAnimationSystem.ts`
- `src/engine/loader/shader/__tests__/TextureTransforms.test.ts`
- `src/engine/rendering/__qa__/RendererGroundworkFixture.ts`
- `scripts/benchmarks/renderer-groundwork.mjs`
- `docs/manual/guides/shader-system.md`
- `docs/manual/guides/render-variables.md`
- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`
- `docs/research/babylon-classic-groundwork-results-2026-10-26.md`
- `docs/research/babylon-classic-fixed-scale-results-2026-10-26.md`
- `docs/changelog/v1.0.0-alpha.6.md`
