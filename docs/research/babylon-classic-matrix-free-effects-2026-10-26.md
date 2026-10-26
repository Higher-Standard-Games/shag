# Matrix-free Voltaic draws: isolated experiment

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`.
Reference engine revision: `3196debb`; installed Babylon 9.31.2.

**Decision: retain a reproducible experiment; defer gameplay adoption.** Both
backends render the tested cases identically without instance matrices, but the
forced-draw route undercounts Babylon's active-index statistics. The normal
Voltaic renderer, shaders, FPS module, media and renderer selection are unchanged.
See the [progress matrix](babylon-classic-to-lite-groundwork-plan-2026-10-26.md#feature-branch-and-progress-matrix).

## What the source actually requires

In installed `Meshes/mesh.pure.js`, `hasThinInstances` includes a positive
`forcedInstanceCount`. That routes a forced draw through `_renderWithThinInstances`.
Its `_draw` call uses the forced count, so custom instanced attributes can draw
without a matrix buffer. Zero means no override, not necessarily no draw: the
existing explicit `setEnabled(false)` empty-pool gate must stay.

Three other pieces matter:

1. `ShaderMaterial` automatically adds instancing defines/attribute names when
   compiling with `useInstances`. The ordinary `instancesDeclaration` and
   `instancesVertex` includes require `world0` through `world3`. The prototype
   replaces those includes only for `WORLD_BATCH`, declares the mesh `world`
   uniform and computes `finalWorld = world`. Hero shaders keep their existing
   include path. Compiled active inputs confirm the matrix columns are absent.
2. `_afterComputeWorldMatrix` can call `thinInstanceRefreshBoundingInfo` for
   forced draws too. That routine assumes matrix-backed thin instances. The
   prototype sets `doNotSyncBoundingInfo` on the two batch meshes, retaining
   the existing template bounds and `alwaysSelectAsActiveMesh` policy. This is
   not a new accurate analytic-world bounds or culling implementation.
3. `_renderWithThinInstances` increments scene active indices using the stored
   thin-instance count, rather than the forced count. The public
   `thinInstanceCount` setter rejects positive counts without matrix-array
   capacity. The actual draw still succeeds, but the scene statistic is wrong.

`RendererPerformanceCapture` and `StatsCommand` use `scene.getActiveIndices()`;
FPS `TimedemoService` does too. Keeping that regression out of normal rendering
is preferable to patching Babylon internals to save a few static buffers.

## Reproducible prototype, without a second production renderer

`scripts/benchmarks/matrix-free-voltaic.mjs` reads the renderer and material from
an explicitly supplied Git commit. Exact-match edits remove the matrix array,
initialization and buffer attachment, use `forcedInstanceCount`, add the bounds
guard and change the batch shader includes. A mismatched source shape fails
instead of silently producing a partial conversion.

The generated TypeScript modules go under ignored `.cache/renderer-groundwork/`.
Their URLs contain a digest of the transformed source, keeping the no-HMR Vite
cache honest. The diagnostic driver opens a fresh browser for each run; it does
not mix reference and prototype shader stores in a gameplay page. Reference and
candidate result records also have revision-qualified copies so later probes
can retain more than one baseline.

This leaves the application pool, keys, seeds, capacities, geometry, clocks,
dirty ranges, custom-buffer adapter, fog, blending and depth rules intact.
Existing restoration reattaches full-capacity custom arrays; it simply has no
matrix array to reattach in the prototype. No universal rendering interface,
dependency upgrade, player toggle or gameplay bootstrap switch was introduced.

## Results on both current backends

Headless Edge reached the real GPU on WebGL2 and Babylon WebGPU. Each run used
the same camera, explicit effect clock, templates and 256-by-256 readback.

| Measured property | Matrix-backed reference | Matrix-free prototype |
| --- | ---: | ---: |
| Retained CPU matrix-array bytes, both pools | 3,584 | 0 |
| GPU matrix-buffer capacity bytes, four draws | 7,168 | 0 |
| Matrix-column vertex inputs per active batch | 4 | 0 |
| Submitted custom-buffer bytes over 120 updates | 17,280 | 17,280 |
| Custom-buffer writes over 120 updates | 1,080 | 1,080 |
| Actual indexed draws over 120 frames | 240 | 240 |
| Reported scene active indices, one world beam/impact | 480 | **0: inaccurate** |
| Draws after clear | 0 | 0 |
| Draws after reusing a world slot | 2 | 2 |

The static matrices were not uploaded every frame, so this removes no recurring
matrix upload stream. Buffer capacities and inputs are concrete reductions;
they do not establish saved bus bandwidth or a frame-rate improvement. Active
attribute counts also differ by backend: WebGL optimizes away an unused beam UV
input while the WebGPU path retains it. The four matrix columns disappear in
both paths.

There were **18 matched SHA-256 image pairs**: the original one-beam capture and
eight additional cases on each backend:

| Case | Expected draws | What it checks |
| --- | ---: | --- |
| World and chain | 4 | Both batch profiles draw with their custom data |
| Transformed batches | 4 | Mesh world transforms remain effective; bounds updates do not crash |
| Hero, world and chain | 6 | The local uniform-based hero path remains compatible |
| Depth occluder | 7 | Opaque geometry occludes the same effect contribution |
| Full capacity | 4 | 32 remote and 24 distinct chain slots retain batching |
| Swap removal | 4 | Removing a middle remote slot leaves 31 remote / 24 chain entries |
| Expired empty | 0 | Expiry cannot expose a noninstanced template draw |
| Reuse after expiry | 2 | A reused slot becomes drawable again |

Transform, occluder and removal images were required to differ from their
controls. Nonempty cases required nonbackground pixels, so an empty render
could not pass. WebGL context loss/restoration with one active world beam
returned identical pixels; other profiles were drawn afterward. WebGPU device
loss was not tested. Warmup completed and live draws worked, but this fixture
does not establish zero late compilation or first-use latency.

## Commands and records

Start the private server, then use a second shell:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3117
# Second shell:
node scripts/benchmarks/renderer-groundwork.mjs webgl2 effects 3117 3196debb
node scripts/benchmarks/renderer-groundwork.mjs webgl2 matrix-free-effects 3117 3196debb
node scripts/benchmarks/renderer-groundwork.mjs webgpu effects 3117 3196debb
node scripts/benchmarks/renderer-groundwork.mjs webgpu matrix-free-effects 3117 3196debb
node scripts/benchmarks/compare-matrix-free.mjs 3196debb
```

The comparator reads revision-qualified JSON files in
`.cache/renderer-groundwork/`. A rendering/resource pass explicitly reports
gameplay adoption deferred; it asserts the observed statistics discrepancy
rather than concealing it. Engine-method wrappers and scenes/engines are cleaned
up in `finally` blocks, and the driver closes its browser.

Completed checks include the seven existing headless Voltaic pool/lifecycle
tests before GPU probes, typecheck, Biome at zero errors / 47 warnings, production
build, manual build, and the required simulation, physics, tick, 1,000-tick fuzz
and indexed `washoi_dm2` map checks. The first full-suite run passed 736 files and
5,739 tests, skipped one, and failed the rotated-solid `ConvexCompile` test:
the compiler's verification stage reported that compiler/media inputs changed
while the job ran. Source review confirmed this is the input-fingerprint guard;
the changed file was not identified by that diagnostic. The concurrent production
build regenerated levelshot files under the fingerprinted media root, which is
a plausible cause; the root index JSON files themselves are excluded from the
fingerprint. This attribution is an inference, not a captured per-file diff.
Both compiler tests then passed in isolation. The controlled full-suite follow-up
with the build/probes finished passed all 737 files and 5,740 tests, with one
skipped test. The guard was not weakened. Future runs should sequence the asset-dependent suite and
production prebuild. The generated prototype itself is validated by the GPU
cases, not claimed as covered by the unchanged gameplay unit tests.

```powershell
node --check scripts/benchmarks/matrix-free-voltaic.mjs
node --check scripts/benchmarks/compare-matrix-free.mjs
node --check scripts/benchmarks/renderer-groundwork.mjs
npm.cmd run test:run -- src/engine/weapon/__tests__/VoltaicEffectRenderer.test.ts --silent=true
npm.cmd run test:run -- src/games/fps/editor/server/__tests__/ConvexCompile.test.ts --silent=true
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

## Adoption boundary and Lite value

Before normal adoption, choose a supported draw/count/statistics contract,
preferably an upstream Babylon fix or documented route. Updating a public thin
count by writing private matrix storage would couple the engine to internals;
retaining fake CPU matrices only to satisfy that setter also weakens the design.
An application-owned draw adapter is another option, but needs its own render
pass, instrumentation, restoration and disposal contract. This small saving does
not justify silently introducing either workaround for 1.0.

The concrete future change boundary is small but spans more than one class:

- `VoltaicEffectRenderer.ts`: batch allocation, buffer attachment, draw count,
  empty gating, restoration and bounds policy; retain pool/seed/event behavior.
- `VoltaicShaderMaterial.ts`: batch vertex-input declaration and world-transform
  construction; retain hero uniforms, fog, alpha and depth behavior.
- A supported Babylon draw-count/statistics solution: preserve existing
  `StatsCommand`, performance-capture and timedemo meaning, rather than silently
  special-casing one effect in each reporting consumer.
- `RendererGroundworkFixture.ts` and the existing lifecycle tests: preserve
  the same event/count/depth controls as the adopted backend adapter evolves.

For a future native sink, the ownership sketch is:

```text
// Pseudocode: counts/ranges are logical; native packing is owned by the sink.
class NativeVoltaicBatch {
  initialize(capacity, template, nativeLayout)
  submit(records, changedSlotIntervals, activeCount) {
    uploadNativeRanges(records, changedSlotIntervals)
    if (activeCount == 0) suppressDraw()
    else drawTemplateInstances(activeCount)
  }
  restore() { rebuildFullCapacityBuffersFromRetainedRecords() }
  dispose() { releaseBuffersAndLifecycleSubscriptions() }
}
```

That is not a new shared `Mesh` facade or an assumption that Classic and Lite
accept identical packed buffers. The pool supplies semantic records and counts;
the sink owns resource layouts, readiness, submission and recovery.

Then verify live spectating/demo target changes, reflections/render targets,
previous-frame/motion behavior and full-scene restoration. Analytic bounds and
GPU culling remain separate work; an always-active fixture does not prove them.

For Lite, the useful contract is the effect's logical records, dirty intervals,
capacity, explicit active count, empty gating, image/depth controls and lifetime
tests. A native draw adapter can bind those records without an identity-matrix
stream. Neither Babylon's thin-instance storage nor its forced-count statistics
should become part of that shared contract.

## Files changed

- `scripts/benchmarks/matrix-free-voltaic.mjs`
- `scripts/benchmarks/compare-matrix-free.mjs`
- `scripts/benchmarks/renderer-groundwork.mjs`
- `src/engine/rendering/__qa__/RendererGroundworkFixture.ts`
- `docs/manual/guides/render-variables.md`
- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`
- `docs/research/babylon-classic-matrix-free-effects-2026-10-26.md`
- `docs/changelog/v1.0.0-alpha.6.md`
