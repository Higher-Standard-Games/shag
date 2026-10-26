# WebGPU render bundles: rebuild attribution after alpha6

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`, engine
`445ae85a` (after PVS candidate pruning and WebGPU shared depth), Babylon
9.31.2. Path 2 of the [renderer review](babylon-renderer-new-paths-2026-10-26.md#2-attribute-webgpu-bundle-rebuilds).
No runtime code changed; the non-compatibility mode stays an opt-in
(`?renderer=webgpu&ncm=1`).

## Summary

**The bundle churn that made NCM useless in v0.9.27 is gone.** v0.9.27 measured
about 94 bundles created and 236 reused per frame, with rebuilds on 99.9% of
frames. On washoi_dm5 demo playback now, about 3 are created and 160–200
reused per frame: 98.5% of draws replay a cached bundle. Two of the three
come from one Babylon-internal source, described below.

**NCM still shows no clear frame-time gain.** Two alternating sessions per mode
measured frame p50 10.1 / 9.6 ms in compatibility mode and 8.5 / 9.6 ms with
NCM. The ranges overlap; more runs or a CPU-bound device are needed before
calling it a win. NCM also triggers WebGPU validation errors from water
occlusion queries (below), so it is not ready as a default either way.

## Today's changes do not explain the drop

One NCM session, toggled in place (PVS pruning by patching
`PVSCuller.prototype.canSkipCandidate`, shared depth by patching
`SceneDepthCapture.prototype.supports`), 8 s per segment, Babylon's own
`engine.countersLastFrame`:

| Segment | Bundles created / frame | Reused / frame | Draws / frame |
| --- | ---: | ---: | ---: |
| PVS pruning + shared depth | 2.9 | 187.5 | 190.5 |
| No PVS pruning | 3.4 | 204.8 | 208.1 |
| No shared depth | 3.4 | 232.8 | 236.0 |
| Neither | 3.6 | 340.1 | 344.6 |
| Both again | 3.2 | 162.0 | 165.2 |

Creation stays at about 3 per frame in every configuration. Today's changes
remove draws (345 → 165–190); the rebuild sources were already fixed between
v0.9.27 and alpha5 (material sharing, light-cap recompiles, batched effects and
other mid-fight work). The workloads also differ: v0.9.27 used the dm2 10-bot
timedemo, this the dm5 FFA demo.

## What still rebuilds

The probe wraps `engine._draw` and records why each creation happened: a
changed buffer identity on the draw context (`setBuffer`), a changed texture or
sampler on the material context, a reset context, or a first draw. Owners map
draw contexts back to submesh/material/pass, with the current effect and render
target as the fallback.

| Per frame | Source | Cause |
| ---: | --- | --- |
| 2.00 | Clustered lights' tile mask (`lightProxy` effect into `TileMaskTexture`) | `Scene` uniform buffer identity changes |
| ~0.4 | First draws of new contexts (post-process target, outlines, pickups) | Expected once per context |
| ~0.3 | Context resets (shine overlays, teleport bursts, player and weapon parts) | Material or mesh changes |
| ~0.02 | Water `uLightVisibility` texture swaps | Material texture change |

The tile mask is the only steady source. `ClusteredLightContainer` renders its
mask once per camera that sees clustered lights (world and weapon), through one
proxy mesh and one draw context. Each pass binds that camera's scene uniform
buffer, so the context alternates between two buffers and rebuilds twice a
frame. This is Babylon's design; two small bundles a frame are not worth a
workaround.

## NCM blocker: water occlusion queries

Each NCM session logged two WebGPU validation errors: "The occlusionQuerySet in
RenderPassDescriptor is not set", while beginning an occlusion query in the
`PostProcessRTT-imageProcessing` render pass. Each invalidates that frame's
command buffer. The source is [LiquidSurfaceSystem](../../src/engine/rendering/water/LiquidSurfaceSystem.ts),
which sets `OCCLUSION_TYPE_STRICT` on water surfaces; it was added after
v0.9.27's NCM audit, which found no occlusion queries. Babylon documents
occlusion queries as incompatible with NCM. Compatibility mode logged no errors.

If NCM is pursued, water must skip occlusion queries when
`engine.compatibilityMode === false` (or use another visibility test there).

## For Babylon Lite

Lite's cached opaque bundles are invalidated through a global visibility epoch
and by changed bindings, like Babylon's per-draw-context checks here. The
sources to design around are therefore: a draw shared by several cameras with
per-camera uniform buffers (keep one draw context per pass, or make camera data
a dynamic offset rather than a different buffer), per-frame material texture
swaps, and context churn from short-lived effects. The visible-set churn that
dominated in v0.9.27 is no longer present on this content.

## Reproduction

Private no-HMR server, then the probes (kept outside the repository; they patch
live instances in the page and restore them):

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3141
# attribution by cause/owner, 10 s:
node bundle-probe.mjs 3141 10
# in-session A/B of PVS pruning and shared depth:
node bundle-ab.mjs 3141 8
# alternating compatibility/NCM sessions with `perf capture 20`:
node ncm-ab.mjs 3141 20 2
```

Headless Edge, RTX 4070 SUPER, 1280×720, `washoi_dm5_ffa_20261025_170933.shagdemo`.
GPU frame time is unavailable in these runs. The `perf capture` "CPU render"
value (0.4–0.5 ms) comes from Babylon's `renderTimeCounter` and covers only part
of the frame; frame p50/p95 is the comparison used above.

## Not established

- A frame-time benefit from NCM: four sessions are too few, and this machine is
  not CPU-bound on this content.
- Bundle behaviour in live matches, other maps or the dm2 10-bot timedemo.
- Whether the remaining resets come from avoidable material changes; at about
  0.3 per frame they are not worth chasing before NCM shows a benefit.
