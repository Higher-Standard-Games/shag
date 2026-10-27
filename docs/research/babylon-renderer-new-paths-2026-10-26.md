# Renderer review: the measured floor and new paths toward Lite

Date: October 26, 2026. Status: review of the Babylon Lite research set and
proposed experiments. No runtime code changed; the renderer groundwork branch
`v1.0.0-alpha6-renderer-groundwork` is being implemented separately.

Reviewed: the [investigation](babylon-lite-renderer-investigation-2026-10-25.md),
[migration map](babylon-lite-migration-map-2026-10-25.md),
[code boundaries](babylon-lite-code-boundaries-2026-10-25.md),
[groundwork catalog](babylon-lite-groundwork-catalog-2026-10-26.md),
[API coverage](babylon-lite-api-coverage-2026-10-26.md),
[integration sketch](babylon-lite-integration-sketch-2026-10-26.md),
[native performance study](babylon-lite-native-performance-2026-10-26.md),
[current-renderer opportunities](babylon-classic-optimization-opportunities-2026-10-26.md),
[groundwork plan](babylon-classic-to-lite-groundwork-plan-2026-10-26.md) and its
[first](babylon-classic-groundwork-results-2026-10-26.md) and
[fixed-scale](babylon-classic-fixed-scale-results-2026-10-26.md) results, read
against [alpha3 performance](v1.0.0-alpha3-performance.md) and the
[v0.9.27 WebGPU measurements](v0.9.27-webgpu.md#wg27-6-measured-webgpu-compatibility-mode-vs-render-bundles-ncm1-headed-2026-10-09).

## Summary

**The research is careful and its completed work is correct, but none of it
targets the measured frame floor.** Alpha3 attributed the typical gunplay frame
on WebGL2 to Babylon CPU work for the map: about 7 ms issuing draws and 4.7 ms
choosing visible meshes. v0.9.27 found Babylon WebGPU about 1.3× slower than
WebGL2 at p50/p95, with scene CPU p50 of 10–13 ms. The groundwork cycle removed
counted work elsewhere (Voltaic upload bytes, shader-animation assignments).
That work is sound and reusable, but it does not reduce the floor.

The most promising new path is a **retained world draw set**: PVS decides
membership of the camera's candidate list, instead of toggling `isVisible` on
meshes Babylon still evaluates. It applies to WebGL2 and WebGPU. Stable draw
membership is also useful for future bundle reuse, but candidate filtering alone
does not establish lower bundle churn. In Lite it is the
`LiteWorldDrawSet` design from the native study.

## Review findings

### 1. The plan has no row for the frame floor

The progress matrix covers effect uploads, shader evaluation, texture guards,
analytic material expressions, then matrix-free effects, VAT and "draw-list/
visibility scheduling — later investigation". The measured floor sits in that
last, deferred row. The results docs correctly refuse to claim FPS wins from
counters. However, the plan should state which measured cost each package
targets. Draw submission and active-mesh selection should be first-class
targets rather than "later".

### 2. The baseline under every comparison is stale

The alpha3 profile predates layered lightmaps (median draws 191 → 172),
WebGL2 main-pass depth sharing (389 → 195), batched explosions, the light-cap
recompile fix and weapon-part LOD. P0 in the groundwork plan was scoped to effect
and material fixtures, not to the whole frame. Before choosing the next
renderer experiment, take a fresh attributed CPU profile of the current build
(see path 0 below).

### 3. The render-bundle result is not carried into the Lite studies

The opportunities doc lists cached WebGPU bundles as "existing `?ncm=1`
experiment; no default change". It omits that v0.9.27 measured it: no gain,
with about 94 bundles rebuilt on 99.9% of frames. The individual invalidation
sources were not attributed. Visibility and material changes are candidates,
not established causes. The native study describes one Lite invalidation:
`setMeshVisible` bumps a global visibility epoch observed by cached opaque
bundles. Classic `PVSCuller` already skips same-cluster updates and writes
`isVisible` only when it changes. Moving that same set into a candidate list
therefore does not by itself prove a bundle-stability gain. Membership and
invalidation attribution remain useful groundwork for both engines.

### 4. PVS hiding does not skip Babylon's per-mesh work (verified)

[PVSCuller](../../src/engine/loader/bsp/PVSCuller.ts) writes `mesh.isVisible`.
In installed `@babylonjs/core@9.31.2`, `Scene._evaluateActiveMeshes` runs this
per candidate, in order:

1. LOD bookkeeping, `isBlocked`, vertex counter
2. `mesh.isReady()`, `isEnabled()`, zero-scale test
3. `computeWorldMatrix()`, intersection-action check, `getLOD()`
4. `_preActivate()`
5. only then `isVisible`, `visibility`, layer mask and frustum test

A PVS-hidden enabled mesh still pays steps 1–4. A disabled pooled mesh reaches
`isReady()` and the enabled check, then stops at step 2. Readiness can reach
material/submesh checks. The candidate list is all
scene meshes unless a provider replaces `scene.getActiveMeshCandidates`. The
dm5 inventory recorded 616–618 scene meshes, of which about 133 are opaque
world meshes. [BspMeshBuilder](../../src/engine/loader/bsp/BspMeshBuilder.ts)
already freezes world matrices and sets `doNotSyncBoundingInfo`, so step 3 is
cheap for the world. Steps 2 and 4 are not. Which share of the 4.7 ms this
explains is unmeasured.

### 5. PVS is coarse at the current mesh granularity

World meshes are grouped by texture (and since layered lightmaps, across
lightmap pages); `r_bsp_cellsize` spatial batching defaults to 0. A texture mesh
spans the map, so PVS hides it only when none of its clusters is visible:
alpha3 saw about 134 of 178 opaque meshes drawn on dm5. Visible meshes draw
their whole index range. This is cheap on the profiling GPU (about 7 ms GPU)
but is real vertex and depth work on integrated GPUs, and it is repeated in
every depth pass.

### 6. WebGPU still draws two extra depth passes

[SceneDepthCapture](../../src/engine/rendering/SceneDepthCapture.ts) returns
`null` on WebGPU, so halos and water keep their own depth passes. Alpha3
measured them at about 150–190 draws per frame on dm5. The WebGPU attempt failed
on a depth texture bound as both sampled texture and attachment for three to
four frames after each map load; the cause was not found. This is the largest
single draw-count reduction left on the WebGPU path. It is not in the
groundwork plan's backend table.

**Resolved the same day:** path 3 below landed. WebGPU now reads the main
pass's depth; see the [alpha3 note's shipped section](v1.0.0-alpha3-performance.md#webgpu-attempt-not-shipped)
for the measurement.

### 7. Smaller documentation issues

- About 320 KB over eleven documents, with the same caveats repeated in each.
  The groundwork plan's progress matrix is the best entry point; the
  investigation's preamble now links this review too.
- Alpha3 and this review use `npm --prefix src/games/fps run benchmark:profile`;
  the script lives in the FPS package, not the engine root (alpha3 said
  `npm run benchmark:profile`, corrected there).
- Relative links and the evidence JSON files referenced by the set all exist.

## New paths

Each path is evaluated on the current WebGL2 and Babylon WebGPU renderers, with
what a future Lite backend would reuse. Nothing here is implemented.

| # | Path | Backends | Targets | Lite reuse |
| --- | --- | --- | --- | --- |
| 0 | Attributed baseline of the frame floor | Both | Choosing the next experiment | Matched workload and per-stage costs |
| 1 | Retained world draw set (PVS-driven candidates) | Both | Active-mesh selection; bundle churn | `LiteWorldDrawSet` membership and diff logic, unchanged |
| 2 | Render-bundle rebuild attribution | WebGPU | Submission CPU | List of invalidation sources Lite also has |
| 3 | WebGPU shared depth product | WebGPU | ~150–190 draws/frame on dm5 | Sampled-versus-attached depth ownership rules |
| 4 | Cluster-ordered world index ranges | Both | Vertex/depth work; culling granularity | Visible-range lists for indirect draws |
| 5 | Candidate registry for dynamic objects | Both | Scanning disabled pools and hidden actors | Explicit task membership for actors/effects |

### 0. Attributed baseline (measurement only)

**Done:** see the [frame-floor results](babylon-classic-frame-floor-2026-10-26.md).
WebGL2 selection is now 1.6–2.2 ms per frame (alpha3 about 4.7); the opaque
group (2.2–2.7 ms) is the largest renderer cost, and WebGPU's per-draw setup
is the CPU gap to WebGL2.

Run the existing profiler on the current branch, both backends, using the two
fixtures alpha3 and v0.9.27 used (`washoi_dm5` plasma FFA,
`benchmarks/recipes/wdm5-ffa6.json`; `washoi_dm2` 10-bot FFA):

```powershell
npm.cmd --prefix src/games/fps run benchmark:profile
```

Attribute CPU self/total time to `Scene._evaluateActiveMeshes`, `Mesh.isReady`,
`_preActivate`, `RenderingGroup` render, material `bindForSubMesh` and the
backend draw call, per camera and render target. Add a one-off probe (ignored,
like the dm5 inventory) counting active-mesh candidates per frame by category:
world/actor/weapon/effect/pool, and enabled/visible/in-frustum/drawn.

Exit: a table stating how many milliseconds selection and submission cost on
each backend today, and how many candidates never draw. If selection is small
now, path 1 shrinks to the bundle-stability argument alone.

### 1. Retained world draw set

Replace mesh-level `isVisible` writes with membership. On a cluster transition,
`PVSCuller` already computes the visible set; it would instead rebuild a
retained array of visible world meshes. A scene candidate provider would return
that array plus a dynamic registry (path 5). Between transitions the list is
unchanged; hidden world meshes are never visited.

The direct opportunity on both backends is fewer `isReady`/`_preActivate`
visits. A retained list also makes membership explicit for a future adapter.
Any WebGPU bundle-reuse improvement still needs a separate attributed result.

Constraints to carry from existing research:

- **One provider per scene.** [WeaponCameraCandidates](../../src/engine/rendering/WeaponCameraCandidates.ts)
  already replaces `getActiveMeshCandidates` and filters the "original" list.
  Both need one composed owner with per-camera lists (world, weapon, and any
  view that renders through `activeCamera`), not two wrappers stacked by
  installation order.
- **Per-view PVS.** The catalog's G5 warning applies: sky portal, water probes
  and other views need their own query or a conservative union, never the main
  camera's last set.
- **Readiness.** `isReady()` on hidden meshes is part of how the loading path
  learns surfaces are compiled; alpha3 moved the "World meshes were not ready"
  check to the world camera's pass. Map readiness must keep checking every
  world mesh explicitly (it already warms effects and waits for scene readiness
  in `MapLoader`) rather than relying on per-frame evaluation.
- **Fallbacks.** PVS disabled, maps without vis data, unknown camera cluster and
  noclip outside the map keep the full world list. Intersection-action meshes
  stay in the list, as `WeaponCameraCandidates` already does.
- **Membership equality is necessary, not sufficient.** Compare candidates with
  the current visibility map across a camera route, then verify active sets,
  action/LOD behavior and real GPU output. Removing readiness/pre-activation
  calls is itself a behavior change outside a proven static-world subset.

Lite: the native study's `LiteWorldDrawSet` uses `createRenderTask` with
`autoMirror: false`, `addMeshToTask` and `setMeshVisible` only on transitions.
The cluster-to-mesh membership, the transition diff and the per-view rules are
the same data. Build them once in an engine-neutral module (G5's `PvsQuery`
plus a membership diff) consumed by the classic provider now.

### 2. Attribute WebGPU bundle rebuilds

**Done:** see the [bundle attribution results](babylon-classic-webgpu-bundles-2026-10-26.md).
Rebuilds are now about 3 per frame (98.5% reuse); the only steady source is
Babylon's clustered-light tile mask alternating per-camera scene buffers. NCM
shows no clear frame-time gain yet and conflicts with water occlusion queries.

v0.9.27 stopped at "attribute rebuilds per mesh and material". Do that, after
path 1 or as its measurement. For each frame under `?renderer=webgpu&ncm=1`, record
which meshes and materials created bundles, then classify by cause: visible-set
change, material property change (powerup glow, `visibility` fades), vertex
updates (autosprites), effect pools. Known incompatibilities from v0.9.27
(`separateCullingPass` on pickup energy materials) stay.

Even if NCM stays opt-in, the classified list is a direct input to Lite: each
source invalidates Lite's cached opaque bundles in the same way. The fix differs
by source: membership instead of visibility, uniform data instead of material
mutation, separate pools for frequently changing draws.

### 3. WebGPU shared depth product

Finish the alpha3 WebGPU attempt. The conflict ("depth texture used as a
binding and a writable attachment in one render pass" for three to four frames
after load) needs attribution, not guessing. Label passes and wrap the
post-load frames in WebGPU error scopes to find which pass binds the main
depth texture. Candidates worth checking first are the post-load passes that
exist only then: readiness/warmup renders, and water cubemap and surface
captures. Until it is found, a lower-risk interim is alpha3's option 2 on WebGPU
only: one depth capture drawing the union of the halo and water filters (about
60–90 fewer draws on dm5).

A copy, as the WebGL2 path does, is not available without patching Babylon.
In 9.31.2, `WebGPUTextureManager` gives depth-stencil internal textures
`TextureBinding | RenderAttachment` usage only, with no `CopySrc`, so
`copyTextureToTexture` from the main depth is invalid. The route is the
alpha3 one: end the main pass, sample the main depth texture in a separate
convert pass that writes the camera-space Z target, then resume the main pass.
That convert pass never has the main depth attached, so the reported conflict
comes from some other pass, which is what needs finding.

Lite: the integration sketch already requires distinct sampled and attached
depth resources with declared ownership. The bug class here is exactly that
hazard. Whatever pass is found becomes a concrete rule in that design.

### 4. Cluster-ordered world index ranges (conditional)

**Estimated:** face-level PVS removes 20% (dm5), 46% (dm2) and 28% (dm11) of
the world triangles mesh-level PVS keeps; sorted sub-ranges would add draws,
so an index rewrite per mesh is the route. Still conditional on a GPU-limited
profile; see the [frame-floor results](babylon-classic-frame-floor-2026-10-26.md#path-4-face-level-pvs-estimate).

At build time, order each world mesh's triangles by cluster, keeping one draw
per material. On a cluster transition, write the indices of visible clusters
into the front of an updatable index buffer (`Mesh.updateIndices` exists in
9.31.2) and draw that count. This gives face-level PVS without the extra draws
that `r_bsp_cellsize` trades for culling. Faces that sit in several leaves need
a single owning range or duplication; bounds stay the union, as today.

Pursue only if path 0 or a low-end GPU profile shows vertex/depth work matters;
on the RTX 4070 SUPER the GPU is not the limit. Upload cost is bounded by
transitions, not frames.

Lite: the same visible-range list maps naturally onto WebGPU indirect draws. A
storage buffer of (first, count) ranges per material allows GPU-driven
submission later without changing the build-time ordering.

### 5. Candidate registry for dynamic objects

**Measured in alpha.7, not built:** dropping every disabled candidate from the
main camera saved nothing measurable; the weapon camera's full scan was the real
cost and is now filtered on every backend. See the
[alpha.7 results](babylon-classic-alpha7-results-2026-10-27.md#4-candidate-selection).

Path 1 removes the static world from scanning; the rest of the 616 meshes are
actors, weapons, pickups, gibs and effect pools, many disabled or pooled. Each
system already knows when its meshes become drawable. A registry where owners
add and remove drawable meshes lets the provider skip idle pools without
per-frame filtering. Effect pools that set `alwaysSelectAsActiveMesh` are the
simplest first members.

Lite: explicit task membership for actors and effects is the same registry. Do
this after path 0 shows how many non-world candidates never draw; if it is few,
skip it.

## What this changes in the existing plan

- The groundwork plan's "Draw-list/visibility scheduling" row should move from
  "later investigation" to the next candidate after path 0. The
  [matrix-free effect experiment](babylon-classic-matrix-free-effects-2026-10-26.md)
  is complete and remains outside gameplay because forced draws undercount
  scene statistics; its measured savings concern inputs and allocation.
- Path 3 belongs in the plan's backend table as a WebGPU-only row.
- The Lite viewer comparison should report candidate counts and bundle
  rebuilds per frame alongside draw counts, so classic and Lite numbers are
  comparable.

## Not recommended

- Whole-scene `freezeActiveMeshes` or `performancePriority = Aggressive`
  (sets `skipFrustumClipping` and `maintainStateBetweenFrames`): dynamic
  actors and effects spawn and move every frame. The existing research already
  rejects freezing the full scene.
- Babylon selection octrees: PVS already gives better static selection, and
  dynamic content would need its own handling anyway.
- Opaque sort changes: the default opaque group is already painter-sorted.

## Verification of this review

Read against installed `@babylonjs/core@9.31.2` (`scene.pure.js`
`_evaluateActiveMeshes`, `performancePriority` setter;
`Rendering/renderingGroup.js` opaque sort; `Meshes/mesh.pure.js`
`updateIndices`) and current source (`PVSCuller.ts`, `BspMeshBuilder.ts`
freeze/spatial batching, `WeaponCameraCandidates.ts`, `SceneDepthCapture.ts`,
`RenderingEngineFactory.ts`). Script names were checked in
`src/games/fps/package.json`.

Unverified: how much of the measured selection time the hidden-mesh path
explains on the current build, how many candidates never draw, and any frame
time change from these paths. No profiler or browser run was made for this
review.
