# Engine FPS Optimization — Modern Alternatives Research

**Date:** 2026-07-21
**Status:** Investigation / recommendation (no code changes yet)
**Goal:** 1–2 concrete optimization points for maximum FPS **without sacrificing
any features** — modern replacements for something we currently do in the WebGL
environment.

---

## Verified current state (what we actually run)

| Area | Today | Evidence |
|---|---|---|
| Babylon version | `@babylonjs/core ^8.44.1` (8.56.0 installed). **Latest is 9.17.0** (9.0 shipped 2026-03-26) | `package.json:94`, `npm view` |
| Engine | Classic WebGL2 `new Engine(canvas, true, { stencil: false })` — no WebGPU anywhere in src | `src/main.ts:63` |
| Dynamic lights | **Hard-rationed**: `maxSimultaneousLights` clamped to **2** (StandardMaterial) / **1** (PBRMaterial) to avoid shader uniform overflow; weapon effects share a **4-light `PointLightPool`** ("intensity-parked"); `EffectPreloader` pre-warms light×material shader permutations to hide recompile hitches | `DynamicLightSafety.ts:4-5`, `PointLightPool.ts:25`, `EffectPreloader.ts` |
| Textures | `PK3TextureLoader` CPU-decodes TGA (`parseTGA`) → **uncompressed RGBA8** in VRAM; legacy `.ktx` (KTX1) is **software-decoded** (DXT1/3/5, ETC1) then uploaded raw. No GPU-compressed formats survive to the GPU | `PK3TextureLoader.ts` |
| Scene opts already in place | `material.freeze()` (map/models/RenderVars), `skipPointerMovePicking`, thin-instanced effect batches (voltaic/rail/muzzle), `forceCompilationAsync` prewarm | various |
| Not in place | `scene.freezeActiveMeshes()`, `freezeWorldMatrix()` on static BSP, WebGPU, GPU-compressed textures, clustered lighting | — |

The two structural costs that stand out:

1. **Lighting is a scarcity system.** The 1–2 light-per-material clamp exists
   because forward-lit Standard/PBR materials compile a shader permutation per
   light configuration and blow uniform limits fast. Consequences we pay *today*:
   muzzle flashes, pickup glows, charge glows and explosions fight over 4 pooled
   lights; most surfaces can react to at most 2 of them; the EffectPreloader
   exists to mask the recompile hitches this causes. That is both an FPS cost
   (shader permutation compiles, per-light forward cost) and a *feature already
   sacrificed* (light count).
2. **Every texture is uncompressed in VRAM.** Q3-era TGAs decode to RGBA8:
   a 512² texture is 1 MB + mips (~1.33 MB); a map's worth of world textures +
   lightmaps + model skins adds up to hundreds of MB of VRAM and — more
   importantly for FPS — raw texture **bandwidth** every frame. Integrated GPUs
   (the FPS floor for players) are bandwidth-starved first.

---

## Brainstorm (wide net, then narrowed)

| Idea | Verdict |
|---|---|
| **Babylon 8.56 → 9.x upgrade** | ✅ **Recommended (part of #1)** — prerequisite for everything below; majors are the only place Babylon takes breaking changes, so the jump must be audited, but the payoff list is long |
| **Clustered lighting (`ClusteredLightContainer`)** | ✅ **Recommended (#1)** — removes the light clamp entirely; works on **WebGL2 and WebGPU**. **Deep-audit correction:** available in our installed 8.56 and already used for static map lights in `MapRenderer` — the dynamic-light migration is NOT gated on the 9 upgrade (see BabylonJS-9-upgrade.md) |
| **KTX2/Basis GPU-compressed textures** | ✅ **Recommended (#2)** — modern replacement for the CPU TGA→RGBA8 path; pure win, fallback keeps zero feature loss |
| **WebGPU backend (`WebGPUEngine`)** | 🔜 Staged follow-up behind a cvar once on 9.x (see below) — *the* modern alternative to WebGL, but should land after the upgrade, not with it |
| WebGPU snapshot rendering (record+replay draw calls, up to ~10× JS-side) | ❌ for gameplay — requires a *mostly static* scene; an arena full of players, projectiles, thin-instance effect flushes and procedural pickups invalidates the snapshot constantly. Viable later for menus/lobby/diorama only |
| `freezeActiveMeshes()` / `freezeWorldMatrix()` on BSP world | 🟡 Cheap micro-win, but risks fighting PVS-style visibility toggling; not a "modern alternative", just tuning. Do opportunistically |
| OffscreenCanvas + worker render thread | ❌ big architectural surgery (input latency, UI interop) for unproven win here |
| Frame Graph (9.0) | 🟡 interesting (up to 40% GPU memory savings) but our post pipeline is simple; revisit if we grow render passes |
| meshopt/Draco model compression | ❌ our MD3/GLB models are small; load-time only, no FPS effect |
| Hardware scaling / resolution drop | ❌ rejected — sacrifices visual quality (a feature) |

---

## Recommendation #1 — Babylon 9.x + Clustered Lighting (replace the light-clamp system)

**The modern alternative to:** per-material forward light clamping
(`DynamicLightSafety`, `PointLightPool` rationing, EffectPreloader permutation
warmups).

**What it is:** `ClusteredLightContainer` groups point/spot lights into
screen-space tiles × depth slices; each pixel only evaluates lights that
actually touch it. Supported on **both WebGPU and WebGL 2** ("hundreds or even
thousands of lights" — headlined at 9.0, but present in late 8.x: our installed
8.56 has it, and `MapRenderer` already clusters static map lights with it).
Usage shape:

```ts
const cluster = new ClusteredLightContainer("clustered", [/* point/spot lights */], scene);
```

**Why it's a pure win for us:**

- **FPS:** one lighting path instead of N shader permutations → fewer shader
  recompiles (the hitch class EffectPreloader exists to mask), and per-pixel
  light cost bounded by the cluster, not by scene light count.
- **Features gained, not sacrificed:** the 2-light (Standard) / 1-light (PBR)
  cap and the 4-light effect pool stop being gameplay-visible constraints.
  Rocket + muzzle + pickup glow + charge glow can all light a corridor at once.
- **Deletion of complexity:** `DynamicLightSafety` clamps, pool rationing
  policies, and most warmup permutations become unnecessary (keep the pool as an
  allocation cache; drop the scarcity logic).

**Costs / risks (honest):**

- The 8→9 major must be audited against `doc.babylonjs.com/breaking-changes`
  (Babylon only breaks API at majors; the jump 8.56→9.17 is ~4 months of
  releases). Our custom `ShaderMaterial`s (voltaic/rail/muzzle) and the Q3
  shader pipeline are the audit hot spots.
- WebGL2 clustered implementation uses textures (not storage buffers); the
  WebGPU path uses storage buffers — node materials on WebGPU need
  `ShaderLanguage.WGSL`. We don't use node materials for lit surfaces, so this
  mostly doesn't bite; our custom ShaderMaterials are unlit and unaffected.
- Regression surface: lighting look changes subtly when lights stop being
  dropped. That's the *point*, but it needs a visual pass.

**Effort:** ~1 session for the version bump + gates; ~1 session to introduce the
container in `LightManager`/effect paths + delete clamps; playtest pass.

## Recommendation #2 — KTX2/Basis GPU-compressed texture pipeline

**The modern alternative to:** CPU TGA decode → uncompressed RGBA8 uploads
(and software-decoded KTX1).

**What it is:** a build step transcodes pk3 textures once into `.ktx2`
(Basis Universal: ETC1S for albedo-like maps, UASTC for normal/detail maps) as a
sidecar cache (e.g. `public/data/ktx2cache/…` mirroring pk3 paths).
`PK3TextureLoader.resolveAndLoadTexture` prefers the `.ktx2` sidecar; Babylon's
built-in `KhronosTextureContainer2` transcodes in **worker threads** to whatever
the GPU natively eats (BC7/ASTC/ETC2) — textures **stay block-compressed in
VRAM**. Ship the Basis transcoder wasm locally (fits our no-CDN/dist posture).

**Why it's a pure win:**

- **4–8× less VRAM and texture bandwidth** — this is a *per-frame* FPS win on
  fill/bandwidth-bound hardware (iGPUs, the machines that need it most), not
  just a load-time win.
- Mips generated offline (better quality than runtime gen); map load gets
  faster (no CPU TGA parse per texture, no main-thread uploads of raw MBs).
- **Zero feature sacrifice:** the TGA/PNG/JPG path stays as automatic fallback
  for anything without a sidecar; quality delta of UASTC is near-lossless, and
  these assets were DXT-compressed in the original engines anyway.
- Independent of #1; works identically under WebGL2 today and WebGPU later.

**Costs / risks:**

- A build-tool step (`basisu`/`toktx`) + cache-invalidation convention.
- ETC1S on very noisy trims can band — the converter should allow a per-path
  UASTC override list.
- Slight first-load transcode cost (worker-parallel, cached by the browser).

**Effort:** ~1 session for the converter script + loader preference + wasm
hosting; validation via existing texture tests + visual A/B (`r_` cvar to force
the legacy path).

## Staged follow-up — WebGPU backend (after the 9.x upgrade)

The literal "modern alternative to WebGL": swap `new Engine(...)` for
`EngineFactory.CreateAsync` / `WebGPUEngine` with automatic WebGL fallback,
behind an `r_webgpu` cvar. Real wins for us: **background pipeline compilation**
(kills the first-shot shader hitch class at the driver level), lower JS
draw-call overhead, compute shaders for future effects, and it upgrades both
recommendations above (clustered lights get storage buffers; KTX2 works as-is).
Our GLSL `ShaderMaterial`s run via Babylon's runtime GLSL→WGSL conversion — that
conversion is exactly what the flag-gated rollout must validate. Snapshot
rendering stays off for gameplay (dynamic scene) but could later accelerate
lobby/menu/post-match diorama scenes.

---

## Proposed order of attack

1. Babylon 9.17 bump on a branch → full gates + breaking-changes audit.
2. `ClusteredLightContainer` for map + effect lights → delete light rationing.
3. KTX2 sidecar pipeline (independent; can run in parallel with 2).
4. `r_webgpu` flag-gated `WebGPUEngine` experiment once 1–3 are stable.

## Open measurements (to take during implementation)

- Per-map texture count + VRAM before/after KTX2 (headless `bsp info` currently
  chokes on CLI arg quoting for multi-command exec — fix or measure in-browser
  via `engine.getGlInfo()` + heap/VRAM tooling).
- Shader-compile hitch telemetry before/after clustered lighting (count
  `forceCompilationAsync`/effect-warmup work made redundant).
- FPS on an iGPU laptop (bandwidth-bound case) before/after each step.

## Sources

- [Babylon.js 9.0 announcement (Medium)](https://babylonjs.medium.com/welcome-to-babylon-js-9-0-c3edc9ee6428) — clustered lighting on WebGL2+WebGPU, frame graph memory savings
- [Announcing Babylon.js 9.0 (Windows Dev Blog)](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/)
- [Clustered Lighting docs](https://doc.babylonjs.com/features/featuresDeepDive/lights/clusteredLighting/) + [feature thread](https://forum.babylonjs.com/t/clustered-lights-support/56111) — `ClusteredLightContainer`, WebGL2 texture path vs WebGPU storage-buffer path, WGSL caveat for node materials
- [WebGPU Snapshot Rendering docs](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering) — up to ~10× JS-side, mostly-static scene constraint
- [WebGPU Support docs](https://doc.babylonjs.com/setup/support/webGPU) / [status](https://doc.babylonjs.com/setup/support/webGPU/webGPUStatus)
- [Babylon.js breaking changes](https://doc.babylonjs.com/breaking-changes/) — majors-only breakage policy
- npm registry: `@babylonjs/core` latest **9.17.0** (9.16.x published 2026-07)
