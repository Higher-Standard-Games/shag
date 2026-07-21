# Babylon 9 — Textured Area Lights & Volumetric Lighting

**Date:** 2026-07-21
**Status:** Investigation + working POC for textured area lights; volumetric scoped
**Scope:** Two new/expanded Babylon 9 lighting features and how they fit our
sci-fi FPS: (1) **textured rectangular area lights** (`RectAreaLight` +
emission texture), (2) **volumetric light scattering** (god rays / light
shafts). Renderer-facing only; no gameplay/determinism impact.
**Companion:** [BabylonJS-9-upgrade.md](./BabylonJS-9-upgrade.md) (WS1 clustered
lighting + the `maxSimultaneousLights` budget this interacts with).

---

## TL;DR

- **Textured area lights are a strong fit and work on WebGL2 today.** They turn
  any image into a physically-emitting rectangle — glowing wall signs, LED
  panels, holo-screens, monitor glow, the exact look of our sci-fi maps. A
  tested POC (`AreaLightPanel` + `arealight` console command) is in this branch.
- **One real constraint, already solved:** area lights fetch LTC lookup data
  from Babylon's CDN. We vendor it (64 KB) and redirect `Tools.AssetBaseUrl` to
  our mirror — the same no-CDN pattern as the Havok wasm and KTX2 transcoder.
- **Budget caveat:** area lights are **not** clustered (a
  `ClusteredLightContainer` only accepts point/spot), so each one occupies a
  real `maxSimultaneousLights` slot on every lit surface — budget them like the
  sun/ambient, sparingly, not like pooled effect glows.
- **Volumetric** has two paths: the classic `VolumetricLightScatteringPostProcess`
  (god rays, WebGL2-ready, mesh-anchored) — usable now for sun shafts through
  windows / bright emitters; and a new 9.0 Frame-Graph/compute volumetric task
  that rides on the in-flight WebGPU work — deferred.

---

## 1. Textured Area Lights (`RectAreaLight`)

### What it is

A rectangle in world space (position + width + height) that emits from its face
along local **−Z**, evaluated with **LTC (Linearly-Transformed Cosines)** for
physically-plausible soft area lighting. In 9.0 it gained an **emission texture**:
the rectangle radiates the image, so a lit LED sign actually casts its own
colored letters onto nearby geometry.

### Verified API (installed 9.17)

```ts
import "@babylonjs/core/Lights/rectAreaLight";          // SIDE EFFECT: registers the type
import { RectAreaLight } from "@babylonjs/core/Lights/rectAreaLight";
import { AreaLightTextureTools } from "@babylonjs/core/Misc/areaLightsTextureTools";

const light = new RectAreaLight("sign", position, width, height, scene);
light.intensity = 4;
light.diffuse = new Color3(...);            // tint

// Emission texture MUST be pre-processed (progressive-blur pyramid for LTC):
const tools = new AreaLightTextureTools(scene.getEngine());
light.emissionTexture = await tools.processAsync(sourceTexture);
tools.dispose();
```

- Emits local **−Z** — orient by parenting to a `TransformNode` (`lookAt`).
- `getTypeID()` → 4 (a distinct light type).
- `transferToNodeMaterialEffect` exists → area lights **work with NodeMaterials**
  (our Q3 `Q3NodeMaterialBuilder` surfaces can receive them).

### Requirements & constraints (all verified in source)

| Item | Detail | Our handling |
|---|---|---|
| **Side-effect import** | `import "@babylonjs/core/Lights/rectAreaLight"` runs `RegisterRectAreaLight()`. Without it the type is unregistered and the light silently no-ops — the exact class of the outline/physics regressions this cycle. | Imported in `AreaLightPanel.ts`; a NullEngine test asserts the type registers. |
| **LTC lookup textures** | The material path waits on `scene._ltcTextures.LTC1/LTC2.isReady()`, decoded from **`https://assets.babylonjs.com/core/areaLights/areaLightsLTC.bin`** (64 KB) via `Tools.GetAssetUrl`. A CDN fetch — blocked by our CSP/offline posture. | **Vendored** to `public/assets/babylon/core/areaLights/areaLightsLTC.bin`; `localizeBabylonAssetUrls()` sets `Tools.AssetBaseUrl = "/assets/babylon/core"` so `GetAssetUrl` rewrites the CDN URL to our mirror. One assignment redirects *all* future Babylon CDN assets too. |
| **Texture preprocessing** | Raw images can't be assigned directly — `AreaLightTextureTools.processAsync` builds the blur pyramid the LTC evaluation samples. | `AreaLightPanel` runs it for URL and `DynamicTexture` sources. |
| **Material support** | `StandardMaterial` (and PBR) support area lights via `AREALIGHT<i>` / `RECTAREALIGHTEMISSIONTEXTURE<i>` defines, in **both GLSL and WGSL** (`ltcHelperFunctions`). So WebGL2 **and** WebGPU. | Our world surfaces are PBR/Standard — compatible. |
| **NOT clustered** | `ClusteredLightContainer.IsLightSupported` accepts only point/spot. Area lights sit directly in `mesh.lightSources` and consume a `maxSimultaneousLights` slot. | Budget impact — see below. WS1 raised the budget to 6 (Standard) / 4 (PBR); a world surface already carries ambient + sun + up to 3 clusters, so there's ~1 slot of headroom. Area lights must be **local** (short range / few surfaces), not scene-wide, or the budget must rise. |
| **Cost** | LTC is a few texture lookups per light per pixel — cheap per light, but every lit surface in range pays it, and it's a hard shader slot. | Keep counts low; prefer them where the emissive detail matters (signs, screens). |

### Where this pays off for us

- **Emissive map surfaces → real light.** Today a glowing Q3 shader surface
  (sign, panel, strip light) is emissive-only — it looks bright but casts no
  light. A co-located `RectAreaLight` with that surface's texture makes it
  actually illuminate the corridor (the screenshot's "STORAGE ROOM" sign).
- **Screens / holo-displays / monitor glow** — animated `DynamicTexture` or
  video as the emission source → flickering screen light.
- **Skybox/window light panels** — a bright sky texture on a window-sized area
  light spills daylight into a room.

### POC in this branch (tested)

- `src/engine/lighting/AreaLightAssets.ts` — `localizeBabylonAssetUrls()` +
  `BABYLON_ASSET_BASE_URL`; redirects the CDN asset base to our vendored mirror.
- `src/engine/lighting/AreaLightPanel.ts` — creates a `RectAreaLight`, orients
  it via an anchor node, and pre-processes an emission texture (from a URL or a
  ready `DynamicTexture`/video). Registers the side-effect. Disposes cleanly.
- `src/engine/console/commands/AreaLightCommand.ts` — `arealight [<url>|off]`
  spawns a demo panel ahead of the camera (default: a procedurally-drawn sci-fi
  wall panel) to eyeball the effect and tune intensity/size/orientation.
- `src/engine/lighting/__tests__/AreaLightPanel.test.ts` — NullEngine: the type
  registers (id 4, in `scene.lights`), the asset redirect resolves the LTC URL
  to our mirror, dispose is clean. (Lit output is browser-validated — headless
  can't render, and the LTC decode needs a real XHR.)

**Owed (browser):** run `arealight`, confirm the panel lights nearby surfaces
and the sign texture projects; tune `faceDir` sign convention (the anchor
`lookAt` may need a flip), intensity, and size.

### Proposed integration path (beyond the POC)

1. **BSP entity** `light_area` (or reuse Q3 `light` with a `_area`/`_surface`
   key): classname → `AreaLightPanel` in `MapRenderer` (next to the existing
   `light` → `PointLight` path), with width/height/texture/intensity from
   entity properties. Vendored LTC makes it offline-safe.
2. **Auto-derive from emissive surfaces** (stretch): when the Q3 shader pipeline
   tags a surface emissive, optionally spawn a co-located area light using that
   surface's texture + bounds. Gated behind an `r_arealights` cvar and a small
   per-map cap (budget).
3. **Budget policy:** area lights are scene-lightsources, so cap them per-map
   and prefer `includedOnlyMeshes`/short range so distant surfaces don't pay the
   slot. Revisit `DynamicLightSafety` budget if maps want many.

---

## 2. Volumetric Light Scattering (god rays / light shafts)

Two implementations exist in 9.17:

### A. Classic `VolumetricLightScatteringPostProcess` — usable now (WebGL2)

Radial light-shaft post-process anchored to a **mesh** (a bright quad/plane at
the light source, or the skybox). Screen-space occlusion-aware god rays.

```ts
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
const godrays = new VolumetricLightScatteringPostProcess(
  "godrays", 1.0, camera, sourceMesh, /*samples*/ 60, Texture.BILINEAR_SAMPLINGMODE, engine);
godrays.exposure = 0.3; godrays.decay = 0.96815; godrays.weight = 0.58767; godrays.density = 0.926;
```

- **Fit:** sun shafts through the sci-fi hallway windows/grates; beams from a
  bright emissive source; pairs with `SkyLightSystem`'s directional sun (anchor
  the source mesh at the sun/sky direction).
- **Cost:** one extra full-screen pass + `samples` taps; tune `samples` by
  quality tier (`QualityDetector`).
- **Caveat:** it's a `PostProcess`, so it must slot into our
  `PostProcessingManager` pipeline order (after scene, around bloom). Occlusion
  uses a depth/render pass — verify it composes with SSAO2 + bloom.

### B. New 9.0 Frame-Graph volumetric (`volumetricLightingTask`) — deferred

`FrameGraph/Tasks/PostProcesses/volumetricLightingTask` + `volumetricLightingBlock`
— the "next-gen" volumetric that uses the Frame Graph and compute, taking full
advantage of **WebGPU compute shaders**. This rides directly on the in-flight
**WS6 WebGPU** work and the Frame Graph (which we don't otherwise use yet).
**Defer** until WebGPU is validated; then evaluate as the higher-quality path,
with the classic post-process as the WebGL2 fallback.

### Sky-shader pairing (the user's angle)

Our sky is `SkyLightSystem` (a directional sun + sky colors). A god-ray source
anchored to the sun direction gives time-of-day light shafts through windows.
This is the most self-contained volumetric win and doesn't touch the WebGPU/
texture work in flight. Suggested next POC: `SunGodRays` module + `godrays`
console command, mirroring the area-light POC shape.

---

## Risks / open questions

1. **Area-light orientation convention** — `RectAreaLight` emits −Z; the anchor
   `lookAt` sign needs a browser check (POC exposes `faceDir`).
2. **Budget** — area lights are hard shader slots (not clustered). Many per map
   would need a higher `maxSimultaneousLights` or `includedOnlyMeshes` scoping.
3. **LTC + WebGPU** — the LTC helper ships in both GLSL and WGSL, so area lights
   should work under WS6's WebGPU engine, but validate there too (NodeMaterial
   surfaces need `ShaderLanguage.WGSL`, already noted in the upgrade doc).
4. **Volumetric post-process ordering** — must compose cleanly with our existing
   bloom/SSAO2 pipeline; verify in `PostProcessingManager`.
5. **Frozen materials** — surfaces that receive a *new* area light after being
   `freeze()`d may need an unfreeze/recompile (same watch item as WS1's clusters).

## Sources

- Installed `@babylonjs/core@9.17`: `Lights/rectAreaLight`, `Lights/areaLight`,
  `Lights/LTC/ltcTextureTool` (CDN `areaLightsLTC.bin` via `Tools.GetAssetUrl`),
  `Misc/areaLightsTextureTools`, `Shaders*/ShadersInclude/ltcHelperFunctions`
  (GLSL+WGSL), `PostProcesses/volumetricLightScatteringPostProcess`,
  `FrameGraph/Tasks/PostProcesses/volumetricLightingTask`.
- Babylon docs: [Lights intro / area lights](https://doc.babylonjs.com/features/featuresDeepDive/lights/lights_introduction/),
  [Volumetric Light Scattering](https://doc.babylonjs.com/features/featuresDeepDive/lights/volumetricLightScattering/).
