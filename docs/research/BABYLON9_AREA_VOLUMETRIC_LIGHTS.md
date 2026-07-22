# Babylon 9 — Textured Area Lights & Volumetric Lighting

**Date:** 2026-07-21 (volumetric POC added 2026-07-22)
**Status:** Working POCs for both — textured area lights *and* volumetric god rays
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
- **Volumetric god rays are implemented (POC).** `SunGodRays` +
  `GodRaysController` + a `godrays` console command wrap the classic
  `VolumetricLightScatteringPostProcess` in two modes: **sun** (source tracks the
  camera along the `SkyLightSystem` sun direction, skybox excluded from the
  occlusion pass → sky shafts through windows/grates) and **anchored** (a fixed
  bright emitter → localized shafts). BSP maps opt in via a worldspawn `godrays`
  key. Only **one** full-screen VLS pass runs at a time (sun *or* one emitter);
  true per-light/per-brush volumetrics are the WebGPU Frame-Graph task, deferred.

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

### Integration — map feature (implemented)

1. **`light_area` BSP entity (implemented).** `AreaLightManager.loadFromMap`
   reads `light_area` entities at BSP map-load (`ClientMapLoader`, next to the
   sky/god-ray hooks) and builds `AreaLightPanel`s. Keys: `origin` (required),
   `angle` (yaw; -1 up, -2 down) or `_arealight_dir`, `_size "W H"`, `_color`,
   `light` (intensity), `_arealight_image` (optional projected texture). Vendored
   LTC keeps it offline-safe. Parsing is the pure, unit-tested `MapAreaLightEntities`
   module (Quake→Babylon coords + angle→emit-direction locked).
2. **Budget policy (implemented as a count cap).** Area lights are NOT clustered:
   each consumes a real per-surface `maxSimultaneousLights` slot, and BSP world
   meshes are texture-grouped (map-wide), so `includedOnlyMeshes`/`range` can't
   localize them — the only safe lever is **count**. `r_arealights` is the master
   gate (default on); `r_arealights_max` caps the number per map (default 4). A
   world surface's realistic slot load is ambient + sun + a couple of clusters,
   leaving ~1-2 slots, so budget a few hero panels, not many.
3. **Auto-derive from emissive surfaces (deferred).** Spawning panels from the
   brightest emissive Q3 surfaces (reusing their texture) is the compelling next
   step, but it needs per-face surface extraction (BSP is texture-grouped, so
   group bounds span the map) and is budget-hostile at scale — so it stays a
   capped/gated follow-up.

---

## 2. Volumetric Light Scattering (god rays / light shafts) — POC in this branch

Screen-space radial light-shaft post-process. A bright **source mesh** is
smeared outward from its projected screen position and occluded by scene
geometry, so a wall/grate/window between the camera and the source carves the
classic shaft silhouette (GPU Gems 3, ch. 13). Verified API (installed 9.17):

```ts
import "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess"; // SIDE EFFECT: registers PP + shaders
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
const vls = new VolumetricLightScatteringPostProcess(
  "godrays", 1.0, camera, sourceMesh, /*samples*/ 60, Texture.BILINEAR_SAMPLINGMODE, engine);
vls.exposure = 0.32; vls.decay = 0.965; vls.weight = 0.5; vls.density = 0.92;
vls.excludedMeshes = [skybox];   // sky doesn't occlude → shafts fill the visible sky
vls.dispose(camera);             // NOTE: dispose() takes the camera to detach from
```

- **Side-effect import** registers the post-process *and* its four shaders — same
  class of hazard as the outline/physics/area-light regressions this cycle.
  Without it the class is unregistered and the effect silently no-ops.
- **Radial center** = the source mesh's projected screen position (or
  `useCustomMeshPosition`/`customMeshPosition`). We just move an emissive
  billboard and the rays follow.
- **`excludedMeshes`** render as empty in the internal pass, so they don't block
  the source. The skybox goes here in sun mode: the sky reads as open and only
  solid world geometry carves the shafts.

### POC in this branch (tested)

- `src/engine/lighting/SunGodRays.ts` — wraps the VLS post-process with a bright
  emissive billboard source (radial-glow `DynamicTexture`, degrades to flat
  emissive where no canvas exists so it's headless-safe). Two modes:
  - **`"sun"`** — the source tracks the active camera at a large distance along
    −(sun direction), so it behaves like a sun at infinity (a `scene.onBeforeRender`
    observer repositions it each frame). Sky shafts through windows/grates.
  - **`"anchored"`** — the source sits at a fixed world position (a bright lamp,
    portal, energy conduit). Localized, static shafts.
- `src/engine/lighting/GodRaysController.ts` — the **single owner** of the one
  active VLS pass (screen-space VLS is one full-screen pass, so exactly one runs
  at a time). `enableSun()` reads the live sun from `SkyLightSystem` and excludes
  the skybox; `enableAnchored()` fixes an emitter; `loadFromWorldspawn()` reads
  the map's opt-in keys. Both the console command and BSP map-load drive it here.
- `src/engine/console/commands/GodRaysCommand.ts` — `godrays [sun|here|off]`.
- Tests (NullEngine): `SunGodRays.test.ts` (PP registers/class, source tracks the
  sun opposite the light direction, anchored + excluded-mesh forwarding, clean
  dispose) and `GodRaysController.test.ts` (enable/disable, single-pass swap,
  missing-sun fallback). Shafts + occlusion silhouettes are browser-validated.

### Integration — implemented as a map feature

`GodRaysController.loadFromWorldspawn(scene, camera)` runs at BSP map-load
(`ClientMapLoader`, next to `SkyLightSystem.loadFromWorldspawn()`) and activates
the one VLS pass by priority, master-gated by the `r_godrays` cvar (default on):

**1. Warsow/Q3 sun entity (implemented).** The strongest hook: many Warsow maps
(the recent `wbomb1‑6` especially) author a **targeted sun light** — a `light`
with `target "sun"`/`"_sun"` plus a marker entity with the matching `targetname`.
`resolveMapSunDirection()` derives the sun *travel* direction from that link, so
shafts follow the map's real authored sun rather than the engine's synthetic
day/night sun. Auto-enables when present. (Sign convention is the common Radiant
one; browser-validate against a real map and flip in `MapGodRayEntities` if the
shafts point the wrong way.) Maps without a sun entity (e.g. `wdm2`) can add one.

**2. worldspawn `godrays "1"` (implemented).** Sun shafts along `SkyLightSystem`'s
directional sun, for maps with no sun entity. Optional per-map look overrides:

```
"godrays"           "1"            // enable sun shafts
"godrays_color"     "1 0.95 0.8"   // tint (0-1 or 0-255)
"godrays_exposure" / _decay / _weight / _density / _samples   // per-map look
```

**3. `light_volumetric` point entity (implemented).** A mapper-placed anchored
emitter (a reactor, portal, bright fixture): `origin` (required) + optional
`_color`, `godrays_exposure`, `size`. **Ceiling:** screen-space VLS is *one*
full-screen pass, so only **one** `light_volumetric` is active at a time (the
first), and it can't do true light **confined to a brush volume** — that's the
Frame-Graph path below.

**Live look / tuning.** The `r_godrays_*` cvars (`exposure`/`decay`/`weight`/
`density` live, `samples` on next activation) are the persisted global look and
tune the active pass in real time (`GodRaysController` subscribes to them); the
`godrays` console command and per-map keys/entities layer on top. `r_godrays 0`
kills the pass live. Entity parsing lives in the pure, unit-tested
`MapGodRayEntities` module (coordinate + sun-direction conventions locked).

### Frame-Graph volumetric (`volumetricLightingTask`) — deferred

`FrameGraph/Tasks/PostProcesses/volumetricLightingTask` + `volumetricLightingBlock`
— the 9.0 "next-gen" volumetric on the Frame Graph + compute, taking full
advantage of **WebGPU compute shaders** and supporting real per-light /
brush-volume scattering (path B's ceiling). Rides on the in-flight **WS6 WebGPU**
work and the Frame Graph (unused elsewhere yet). **Defer** until WebGPU is
validated; then adopt as the higher-quality path, with this screen-space POC as
the WebGL2 fallback.

**Owed (browser):** run `godrays` in a windowed/skylit map; confirm shafts read
and are carved by geometry; tune exposure/decay/weight/density and the source
`size`/`distance`; verify composition order vs bloom + SSAO2 in
`PostProcessingManager` (VLS is a separate PP on the camera — check it slots
before image-processing so bloom picks up the shafts).

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
