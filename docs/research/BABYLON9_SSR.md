# Babylon 9 — Screen-Space Reflections (SSR)

**Date:** 2026-07-22
**Status:** Design + v1 in progress (off-by-default engine feature)
**Scope:** Dynamic real-time reflections on glossy surfaces (metal floors/walls)
via Babylon 9's `SSRRenderingPipeline`, building on the existing PBR gloss +
skybox-cubemap reflection. Renderer-facing only; no gameplay/determinism impact.
**Companion:** [BabylonJS-9-upgrade.md](./BabylonJS-9-upgrade.md),
[BABYLON9_AREA_VOLUMETRIC_LIGHTS.md](./BABYLON9_AREA_VOLUMETRIC_LIGHTS.md).

---

## TL;DR + decisions

- **What:** turn the *static skybox-cubemap* reflection currently on the glossy
  metal into a **dynamic reflection of the live scene** (players, projectiles,
  geometry). The diamond-plate / hex floors reflect the actual game.
- **How the surface set is chosen:** SSR is **material-driven** — it only
  reflects pixels whose reflectivity is above `reflectivityThreshold`, which we
  *already write* via `reflectivityTexture` (gloss maps) / PBR metallic. Glossy
  metal reflects; matte concrete/rubber stays flat. **No per-surface tagging.**
- **Decisions (agreed):**
  1. **Off by default** — great engine feature, but competitive players run
     flat-out. Opt-in via `r_ssr`, GPU-tier-gated when on.
  2. **Water:** support the Warsow reflective-shader key later, *or* build an
     "epic new water" that replaces all Warsow water shaders — a separate,
     bigger workstream. Not in v1.
  3. **Subtle** — a wet-sheen look (low strength, high falloff), not a mirror.

---

## How Babylon SSR works

`SSRRenderingPipeline` is a post-process pipeline riding on a **geometry prepass**
(depth + normals + reflectivity, via `PrePassRenderer`/`GeometryBufferRenderer`).
Per pixel it ray-marches in **screen space** along the reflection vector and
samples whatever it hits. WebGL2-capable.

- **`reflectivityThreshold`** gates which surfaces reflect (material reflectivity).
- **`environmentTexture`** (a `CubeTexture`) is the **fallback** for rays that
  shoot off-screen — screen-space can't reflect what the camera can't see.
- **Cost** = the prepass + per-pixel ray march; `step`/`maxSteps`/`maxDistance`
  and target resolution dominate. There is also a lighter `thinSSRRenderingPipeline`.

## What gets SSR'd (and why it's cheap to wire)

Automatic, from data we already have:

| Already in the engine | Role for SSR |
|---|---|
| `reflectivityTexture` (gloss maps → BSP materials) / PBR metallic | Decides *where* SSR reflects (above `reflectivityThreshold`) — the glossy metal, for free |
| Skybox `reflectionTexture` (cubemap, `SkyboxLoader`) | SSR's `environmentTexture` **fallback** for off-screen rays — the existing static reflection becomes the graceful edge filler |
| `PostProcessingManager` `DefaultRenderingPipeline` on the camera | SSR slots in beside bloom; camera-swap handling already exists as a pattern |

So the marquee result — glossy floors reflecting the live scene, cubemap-filled
at the screen edges — reuses the gloss + cubemap already present.

## Water / mirrors (future, not v1)

SSR can do water, but for a large **flat** water/mirror a **planar reflection**
(`MirrorTexture` on the plane) is crisper and correct at grazing angles (SSR
degrades there and can't reflect off-screen). Two future directions:

1. **Tag-and-planar:** find the qfusion reflective-surface shader key (same move
   as `q3map_surfacelight`; likely a `portal`/`mirror`/reflection stage), tag those
   surfaces, and give flat ones a `MirrorTexture`. The water's own normal-map /
   `tcMod turb` supplies the wobble.
2. **Epic new water:** a custom water material (animated normals + planar
   reflection + refraction + depth-based shore/foam) that *replaces* all Warsow
   water shaders wherever they appear. Bigger, more distinctive; own workstream.

## Performance — the real constraint

For a competitive FPS this is the whole risk, so gate it hard:

- **`r_ssr` cvar** — default **0** (off); `1` enables. Restart/next-map-safe.
- **GPU-tier quality** (via `QualityDetector`): `step`/`maxSteps`/`maxDistance`
  and a **downsampled** SSR target (half-res common) scale with tier.
- **`reflectivityThreshold`** tuned so only genuinely-glossy surfaces pay.
- Benchmark the **`thinSSRRenderingPipeline`** variant with the `perf capture`
  tool; adopt if the quality delta is acceptable.

## v1 implementation plan

- **Babylon gotcha — use the GeometryBufferRenderer, not the PrePass.** SSR's
  PrePass path compiles a reflectivity write into each material's *own* shader,
  and Babylon's **StandardMaterial** prepass output references an undeclared
  `specularMapColor` (only declared in the skipped lighting block) — so
  specular-textured Standard surfaces (most of our BSP world) fail to compile
  (`FRAGMENT SHADER ERROR: 'specularMapColor' : undeclared identifier`).
  Constructing the pipeline with `forceGeometryBuffer: true` renders the
  reflectivity/normal/depth buffers with the GeometryBufferRenderer's dedicated
  geometry shader instead, sidestepping the bug. Slightly costlier (an extra
  geometry pass) but compatible.
- **`SSREffect`** module (mirrors `GlowEffect`): owns one `SSRRenderingPipeline`,
  cvar-gated, GPU-tier-tuned, camera-swap-aware. Off unless `r_ssr >= 1`.
  - Subtle defaults: low `strength`, higher `reflectionSpecularFalloffExponent`
    (fainter), `enableSmoothReflections`, small `blurDispersionStrength`.
  - `environmentTexture` = the map's skybox cubemap when present.
  - Guards `isSupported`; disposes cleanly; toggles live on `r_ssr` change.
- **`r_ssr`** (+ optional `r_ssr_strength`) cvar in `RenderVars`.
- Init once with the scene in `main.ts` (like `GlowEffect`); rebuild on camera
  controller change.
- NullEngine test for the enable/disable/dispose lifecycle; the reflection itself
  is browser-validated + tuned.

## Open items

- Browser-tune subtle strength/falloff/threshold on the metal floors.
- Decide half-res vs full-res SSR per tier after `perf capture` numbers.
- Water workstream (tag-and-planar vs epic new water) — separate.
