# Frame floor after alpha6 renderer work, and face-level PVS

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`, engine
`9e3d812c` plus another agent's uncommitted water occlusion change (the profiler
records the dirty tree). Babylon 9.31.2. Paths 0 and 4 of the
[renderer review](babylon-renderer-new-paths-2026-10-26.md#new-paths).
No runtime code changed.

## Summary

- **The selection share of the frame has halved.** On the washoi_dm5 plasma
  timedemo, WebGL2 active-mesh selection costs 1.6–2.2 ms per frame, against
  about 4.7 ms in the alpha3 profile. `Mesh.isReady` inside it is now about
  0.1 ms: the PVS candidate pruning removed the hidden-mesh readiness work the
  review identified.
- **Rendering is still most of the CPU frame.** Of a 6.5–7.8 ms profiled WebGL2
  frame callback, camera rendering is 5.4–6.3 ms: selection 1.6–2.2, opaque group
  2.2–2.7, transparent 0.7–1.0, material binding and readiness about 1–1.2.
  Game systems in `onBeforeRender` observers take 1.4–1.7 ms.
- **WebGPU is about 1.3× slower on the CPU,** as in v0.9.27: 8.7–10.3 ms
  callbacks, with Babylon's WebGPU `_draw` at about 1.2 ms per frame (vertex
  buffer setup, pipeline lookup, bind groups) where WebGL2's draw calls are
  under 0.1 ms.
- **Face-level PVS would remove 20–46% of world triangles** that mesh-level PVS
  keeps, without extra draws, by rewriting each texture mesh's index buffer on
  cluster changes. That saving is GPU vertex/depth work; it matters only where
  the GPU limits the frame.

## Path 0: attributed baseline

`npm --prefix src/games/fps run benchmark:profile -- --fixture wdm5-ffa6-v1-f0615d305875-006f520e --port 3143`,
visible Edge, RTX 4070 SUPER, 1280×720, 250 µs CPU sampling, one profiled run
per backend. Raw output: `public/data/benchmarks/results/2026-10-26-path0-baseline/`
(gitignored). Profiling adds overhead; these are attribution numbers, not an
unprofiled benchmark.

| Phase | Backend | Frames | Wall ms/frame | Frame callback | Selection | Opaque group | Transparent | Material bind | Game observers |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| freefly-start | WebGL2 | 1,330 | 8.72 | 7.75 | 2.01 | 2.61 | 0.74 | 0.82 | 1.69 |
| fps-gunplay-a | WebGL2 | 1,425 | 8.15 | 7.42 | 2.15 | 2.35 | 0.70 | 0.80 | 1.47 |
| freefly-return | WebGL2 | 1,012 | 8.60 | 7.53 | 1.57 | 2.65 | 0.99 | 0.93 | 1.70 |
| fps-gunplay-b | WebGL2 | 1,525 | 7.60 | 6.53 | 1.64 | 2.17 | 0.74 | 0.74 | 1.35 |
| fps-gunplay-a | WebGPU | 991 | 11.32 | 10.34 | 2.70 | 3.75 | 1.03 | 1.00 | 1.84 |
| fps-gunplay-b | WebGPU | 1,212 | 9.58 | 8.69 | 1.91 | 3.36 | 1.09 | 0.96 | — |

Columns after "Wall" are inclusive CPU ms per frame. "Material bind" is the
largest `bindForSubMesh` entry; the two map material families together are
about 1.4 ms on WebGL2 gunplay-a. The WebGL2 run reported `stableSource=false`
(another agent edited the tree during the run). The WebGPU run is flagged
invalid by the timedemo because playback skipped recorded frames after one
stall; its per-phase attribution is still shown, but treat its frame counts
with care.

Inside WebGL2 selection (gunplay-a, 2.15 ms): the loop itself 0.49 ms self,
world-matrix work on moving objects about 0.4 ms (`computeWorldMatrix`, matrix
compose/multiply), `getLOD` 0.08, `_preActivate` 0.07, `isReady` about 0.09.
What remains is per-candidate overhead across all scene meshes and transforms
of dynamic objects, which is what a registry of drawable dynamic objects
(review path 5) would address.

Inside WebGPU `_draw` (gunplay-a, 1.19 ms): `setVertexBuffer` 0.19,
pipeline lookup 0.16, buffer comparisons 0.10, `setBindGroup` 0.09. Render
bundles would replay these; the [bundle note](babylon-classic-webgpu-bundles-2026-10-26.md)
shows bundles are now reusable but did not show a clear frame-time gain.

### Comparison with alpha3

Alpha3's 4.7 ms selection and 7 ms draw-issuing figures came from the dm2
10-bot fixture with a sampling profile on an older build; its dm5 plasma
measurements used `perf capture` (median frame 8.9–9.4 ms after depth
sharing). Methods and fixtures differ, so the only like-for-like claim here is
the share: selection was the second-largest renderer cost and is now about a
quarter of camera rendering. The opaque group is now the largest single cost.

## Path 4: face-level PVS estimate

[face-pvs-estimate.ts](babylon-lite-evidence/face-pvs-estimate.ts) reads the
BSP through the PK3 index, groups world polygon/mesh faces by texture (the
grouping the GPU path uses after layered lightmaps; patches are excluded and
counted separately), and at each authored deathmatch spawn compares:

- mesh level: every face of a texture group whose clusters include a visible one;
- face level: only faces in a visible cluster;
- ranges: contiguous index ranges per visible group if faces were sorted by
  their lowest cluster.

| Map | Spawns | Meshes drawn | Mesh-level triangles | Face-level triangles | Removed | Ranges if sorted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| washoi_dm5 | 7 | 133 | 94,015 | 75,226 | 20% | 197 |
| washoi_dm2 | 6 | 82 | 29,141 | 15,661 | 46% | 309 |
| washoi_dm11 | 11 | 95 | 119,209 | 85,727 | 28% | 134 |

The dm5 mesh count matches the GPU's 133 opaque map meshes. The PVS audit
(`npm run audit:pvs -- washoi_dm5`, NullEngine with per-page lightmap meshes)
agrees: mesh-level PVS keeps about 108k of 113k world triangles.

Drawing visible sub-ranges would add draws (up to 3.8× on dm2), which costs CPU,
the scarce resource here. The route that keeps one draw per mesh is an
updatable index buffer per texture mesh, rewritten with visible faces on
cluster transitions (`Mesh.updateIndices` exists in 9.31.2), with patches and
multi-cluster faces handled explicitly. That saves vertex and depth work in
every pass that draws the world, including the WebGL2 fallback depth passes,
and costs index uploads on transitions only.

Decision: keep path 4 conditional. On the RTX 4070 SUPER the GPU is not the
limit; it becomes worth building when a lower-end GPU profile shows vertex or
depth work in the frame. The same visible-face lists map directly onto Lite
indirect draws.

## What to do next

1. **Opaque group (2.2–2.7 ms WebGL2, 3.4–3.8 ms WebGPU):** attribute it per
   material family (map Standard/PBR with plugins, players, weapons) to see
   whether binding, readiness or draw dominates. This is now the largest cost.
2. **Dynamic candidates (path 5):** count scene candidates that never draw;
   the selection loop's self time scales with them.
3. **WebGPU `_draw`:** the CPU gap to WebGL2 sits in per-draw setup. Repeat the
   NCM comparison on a CPU-limited device before deciding about bundles.

## Not established

- Unprofiled frame times and run-to-run variance (one profiled run per backend).
- The amphi and dm2 fixtures, live matches and lower-end hardware.
- Any GPU-time result; face-level PVS savings are a triangle count, not a
  measured GPU win.
