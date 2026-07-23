# Babylon.js 9 Upgrade — Deep Research & Migration Plan

**Date:** 2026-07-21 (deep-audit revision — supersedes the first draft's claims)
**Status:** Active migration — WS1–WS4 complete; KTX2 remains default-on; **WebGPU postponed** (opt-in `?renderer=webgpu` only) — blocked by a 12-UBO/vertex-stage ceiling + the WS7 native-WGSL shader port; WebGL2 is the sole default backend (see the WebGPU re-test conclusion below)
**Scope:** `@babylonjs/core` + `@babylonjs/loaders` 8.56 → 9.17.x; what the jump
*actually* requires given our measured API surface; which modern APIs we can
migrate into (some without upgrading at all)
**Risk:** Renderer-facing only. The server simulation imports no Babylon
rendering paths; the determinism gate is out of blast radius.
**Companion doc:** [ENGINE_FPS_OPTIMIZATION.md](./ENGINE_FPS_OPTIMIZATION.md)

---

## Key corrections from the deep audit

1. **Clustered lighting is NOT 9.0-gated — it ships in our installed 8.56 and
   we already use it on the WebGL2 production paths.** `MapRenderer` (the FPS world
   renderer) already puts static map point lights into a
   `ClusteredLightContainer` ("allows many lights without hitting WebGL uniform
   buffer limits", tuned `depthSlices = 4`, `horizontalTiles = 8`);
   `StreetLampSystem` creates one lazily; the headless CLI even leak-tests the
   container across map clears. Babylon *headlined* the feature at 9.0, but it
   landed in late 8.x. Consequence: the biggest lighting win — clustering the
   **dynamic** effect lights and deleting the scarcity clamps — is available
   **today**, upgrade or not. The Babylon 9.17 WebGPU path is currently gated
   off by `supportsClusteredLighting()` in `DynamicLightCluster`; see the WS1 browser finding below.
2. **Babylon audio changes are irrelevant to us.** `AudioManager` is pure
   `HTMLAudioElement` — zero `@babylonjs/core/Audio` imports. The 9.0 "audio
   engine refinements" drop off our validation checklist.
3. **The WGSL/WebGPU caveat is concrete, not theoretical.** We DO build
   `NodeMaterial`s — `Q3NodeMaterialBuilder` (via `Q3ShaderMaterialFactory`)
   generates node materials for Q3 surface shaders. Under a future WebGPU
   engine, node materials that receive clustered lights must be created with
   `ShaderLanguage.WGSL`. Irrelevant under WebGL2; a named work item for the
   `r_webgpu` experiment.

---

## Measured API surface (what the upgrade actually touches)

`@babylonjs/core` **794** imports over **83 unique module paths**, `@babylonjs/loaders`
**10**, `@babylonjs/havok` **1**. No `@babylonjs/gui`, no `@babylonjs/materials`, no UMD
bundles. Census by cluster, with 9.x status:

| Usage cluster (top import counts) | Our usage | 9.x status / action |
|---|---|---|
| Scene/math/meshes (`scene` 139, `math.vector` 116, `math.color` 63, `mesh` 49, `meshBuilder` 27, `transformNode` 25, `vertexData` 13, `abstractMesh` 12) | Everywhere | **Stable.** No known changes; covered by tsc + suites |
| Materials (`standardMaterial` 38, `texture` 27, `shaderMaterial` 13, `effect` 7, `pbrMaterial` 7, `rawTexture` 7, `dynamicTexture` 4, `fresnelParameters` 1) | Q3 surfaces, effects, pickups v4 | **Stable.** Seven authored GLSL families currently need WebGPU's runtime translation: BSP fog, filter blend, glow overlay, cel outline, muzzle, rail, and voltaic. Dual native WGSL is now a measured optimization opportunity; see WS7 |
| Cameras (`freeCamera` 22, `camera` 22, `arcRotateCamera` 7) | Gameplay + diorama + tools | **Stable.** The 8.10.1 right-handed break never applied (we're left-handed) |
| `nullEngine` 17 | 134 test files + headless CLI | **Stable** — and our broadest automatic 9.x audit |
| Lights (`pointLight` 14, `hemisphericLight` 5, `directionalLight` 2, `spotLight` 1, `shadowGenerator` 2, **`Clustered/*` 2+2**) | Map/effect/UI lights; clustered already in `MapRenderer`/`StreetLampSystem` | **Stable**; clustered API present in 8.56 — see Migration A |
| Loading (`sceneLoader` 10 → 8 call sites of `SceneLoader.ImportMeshAsync`/`ImportAnimationsAsync`; `@babylonjs/loaders/glTF` 8) | GLB models/animations (player models, barrels, anim tools) | **Soft-deprecated.** Class remains, but module-level `ImportMeshAsync`/`ImportAnimationsAsync`/`LoadAssetContainerAsync` are the maintained path (better tree-shaking, loader options pass-through). See Migration B |
| Bare barrel `@babylonjs/core` imports (**15 files**, mostly `src/engine/animation/*`, `games/tower`, 2 fps client files) | Convenience imports | **Works but bloats**: barrel imports weaken per-module tree-shaking and slow dev-server transforms. See Migration C |
| Physics v2 (`IPhysicsEnginePlugin` 6, `havokPlugin`, `physicsAggregate`, `ragdoll`, `physicsEngineComponent`, `@babylonjs/havok` wasm) | Client-side pickup toss/ragdoll only | **Stable**; upgraded independently to 1.3.13 and covered by the physics/toss gates |
| Particles (`particleSystem` 4: Debris/LocalDebris/Rain/Explosion) | Classic CPU particles | **Stable.** Node particles (9.0) optional later — not a need |
| Node materials (`Materials/Node/*` 11 imports in `Q3NodeMaterialBuilder`) | Q3 shader → NodeMaterial path | **Stable under WebGL2.** WGSL work item under WebGPU (see corrections #3) |
| Post (`defaultRenderingPipeline`, `ssao2RenderingPipeline`, `postProcess`, `depthRendererSceneComponent`) | Bloom/exposure/contrast, SSAO | **Stable**; visual pass owed |
| Misc (`observable` 15, `constants` 11, `ray` 12, `edgesRenderer`, `trailMesh`, `linesMesh` 3, `skeleton` 3, `animationGroup` 3, `screenshotTools`, `tgaTextureLoader`, `engineStore`, `abstractEngine`, `physicsViewer`, `instancesVertex/Declaration` shader includes 6) | Various | **Stable.** The `ShadersInclude` imports (thin-instance support in custom shaders) are worth a compile check in Phase 0 |

**Private-API exposure: none.** A scan for `._foo` access on Babylon objects
found only our own stash keys (RenderVars originals, seed counters). Nothing
rides Babylon internals — the classic major-version landmine is absent.

### Breaking-changes evidence (8.56 → 9.17)

- Official breaking-changes doc: **newest entry is 8.10.1** — nothing listed for
  any 9.x. The 9.0.0 changelog section is bugfix-level; 9.0 was an additive major.
- The one publicized 9.x break: **9.16.x enforces ES2015 for UMD builds** — we
  consume ESM through Vite 6; not applicable.
- Toolchain: TS 5.2 / Vite 6.3 / vitest 3.2. Only contingency: 9.17 typings may
  want a newer TypeScript — resolved by an isolated TS bump in Phase 0 if `tsc`
  objects.

**Bottom line: the upgrade needs a version bump, a possible TS bump, and a
behavioral validation pass. No API migration is *required*.** Everything below
is opportunity, not obligation.

---

## Migrations we can move into

### Available NOW on 8.56 (no upgrade required)

**A. Cluster the dynamic effect lights; delete the scarcity system.**
Static map lights are already clustered; the *dynamic* lights (muzzle flash,
explosion/charge glows via the 4-light `PointLightPool`, pickup glows) still
live outside it, which is why `DynamicLightSafety` clamps every material to
2 lights (Standard) / 1 (PBR) and why `EffectPreloader` pre-warms light×material
shader permutations to mask recompile hitches. Migration: route pooled effect
lights into a (second, gameplay-tuned) `ClusteredLightContainer` — perspective
tuning, not the ortho-tuned 4-slice config MapRenderer uses — then retire the
clamps and most permutation warmups. FPS win + restores a sacrificed feature
(a corridor can hold rocket + muzzle + pickup glows at once).
*Watch item:* frozen materials — verify cluster texture updates reach
`material.freeze()`d surfaces; worst case unfreeze world materials at map load
(cheap once per-light define churn is gone).

**B. `SceneLoader` → module-level loader functions (8 call sites).**
`SceneLoader.ImportMeshAsync/ImportAnimationsAsync` is soft-deprecated: the
class stays, but module functions (`ImportMeshAsync(url, scene, options)`,
`ImportAnimationsAsync`, `LoadAssetContainerAsync`) get all future improvements,
tree-shake better, and accept loader options directly. Call sites:
`PlayerModelManager` (2), `AnimationLoader` (1), `AnimTestCommand` (2),
`headless-game.ts` (3), plus `FPSPickup._loadBarrels` (dynamic import). Mostly a
mechanical signature change (single URL replaces rootUrl+filename split).

**C. Kill the 15 bare `@babylonjs/core` barrel imports.**
`src/engine/animation/*` (7), `AnimTestCommand`, `DebugCommand`,
`CartoonHitEffect`, `DemoService`, `GameEvents`, `Game.ts`, `TowerGame`. Replace
with per-module paths (the style the other ~780 imports already use). Bundle
size + dev-transform win; zero behavior change; biome-friendly mechanical PR.

### Gated on the 9.x upgrade

| Migration | What it replaces / adds | Assessment |
|---|---|---|
| **Outline renderer** (9.0) | Our custom team-tint/outline presentation (RemotePlayerRenderer, showcase styling) | Evaluate after upgrade — likely simpler + batched; keep ours if look regresses |
| **Nav mesh improvements** (9.0) | Complements `BotNavGraph` (active bot-improvements work) | Flag to the bot effort; not this upgrade's scope |
| **SDF text** (9.0) | Future HUD/nameplate crispness | Optional, low priority |
| **Frame Graph v1** (9.0) | Hand-rolled pipeline order; up to ~40% GPU memory savings in complex pipelines | Ours is simple (Default + SSAO2); revisit if passes grow |
| **Inspector v2** (9.0) | Dev tooling (we don't ship `@babylonjs/inspector` today) | Nice-to-have dev dependency |
| **GPU particles / flow maps / attractors** (9.x) | Rain/snow now use `GPUParticleSystem` for as many as 2,000 particles | Precipitation migration complete on WebGL2; automatic CPU fallback only when transform feedback is unavailable. Flow maps/attractors remain a later map-effects feature. |

### Staged after both (flag-gated)

**`r_webgpu` — `WebGPUEngine` with WebGL2 fallback.** Payoffs: background
pipeline compilation (first-shot hitch class), lower JS submit overhead, compute
for future effects, storage-buffer clustered lights. `Q3NodeMaterialBuilder`
already selects `ShaderLanguage.WGSL` on WebGPU. The remaining authored shader
surface is seven GLSL families (BSP fog, filter blend, glow overlay, cel
outline, muzzle, rail, voltaic), currently translated at runtime. Snapshot
rendering remains limited to genuinely static contexts, never gameplay.

### 2026-07-21 opportunity audit — what should come next

> **Superseded ordering (2026-07-22):** SHAG is intentionally shipping WebGL2
> for now. Native WGSL, WebGPU NCM and snapshot work remain documented for a
> later renderer phase, but are not near-term tasks. Renderer instrumentation
> and static BSP world-matrix freezing have also landed since this table was
> written.

This pass compared Babylon 9's shipped APIs and official optimization guidance
against the current branch, not against a generic Babylon demo. The ordering is
deliberately optimization-first. Every renderer change stays flag-gated until
the normal lobby-spawned game path passes; direct `?map=` startup is not an
acceptance path.

| Priority | Candidate | Concrete fit in SHAG | Decision / gate |
|---|---|---|---|
| **1** | **Native WGSL for our seven custom shader families** | WebGPU startup currently imports GLSLang + TWGSL JS/WASM unconditionally: **2,737,181 raw bytes (~2.61 MiB)** in the production build, before compression. Babylon's built-in shaders are native WGSL and `Q3NodeMaterialBuilder` already emits WGSL, so these seven are the remaining reason for the translation toolchain. Keep GLSL beside WGSL for WebGL2; register/select the backend-native version per family. | Implement one family at a time with shader-compile tests and visual parity. After all seven pass, call `WebGPUEngine.initAsync()` without translator assets and verify the four compiler files disappear from `dist`. This is the best next code task: direct startup/download/compile-time payoff, isolated diffs, no gameplay semantics. |
| **2** | **Real renderer instrumentation** | `stats detailed` currently reads private `engine._drawCalls` and exposes only instantaneous FPS/delta. Babylon's public `EngineInstrumentation` measures GPU frame and shader compilation time; `SceneInstrumentation` measures draw calls, render/active-mesh/particle/physics/animation time. WebGPU also exposes bundle creation/reuse counters. | Add a bounded `perf capture <seconds>`/report path that records backend, map, KTX2 state, CPU render p50/p95, GPU p50/p95 when supported, draw calls, shader compile time, active meshes, particles, and WebGPU bundle counters. This turns all later decisions into data and replaces the private stat access. |
| **3** | **WebGPU non-compatibility mode (NCM / fast path)** | Our static BSP is promising: meshes are grouped by texture+lightmap, PVS only changes visibility at cluster boundaries, and rail/voltaic/muzzle update existing thin-instance buffers with `thinInstanceBufferUpdated` (the pattern Babylon recommends). NCM caches reusable render bundles and can reduce JS submission cost. | Spike behind `r_webgpu_fast 0`; adopt/default-on only if p95 CPU render time improves and stabilized `numBundleCreationNonCompatMode` is near zero. Known blockers first: procedural pickup energy materials use `separateCullingPass` (officially unsupported in NCM); BSP autosprites and explosion fireballs update vertex data and will recreate bundles. Material render-state changes after startup need `resetDrawCache`. Occlusion queries cannot be combined with NCM (we do not currently use them). |
| **4** | **Static BSP freeze audit** (not 9-specific) | BSP texture-group meshes do not transform after load, but no world-matrix freeze is currently applied. PVS changes `isVisible`, not transforms. | Try `freezeWorldMatrix()` and stable bounding-info flags only on static BSP groups—not autosprites, brush movers, entities, pickups, or effects. Keep only if instrumentation shows an active-mesh/world-matrix CPU win and picking/PVS remain correct. Do not globally freeze active meshes; that would fight PVS and dynamic gameplay. |
| **5** | **Frame Graph post stack** | Installed 9.17 has object/cull, bloom, image processing, SSAO2, custom post, tonemap and volumetric tasks plus texture-allocation reuse. Our current stack is HDR `DefaultRenderingPipeline` + bloom/image processing + optional SSAO2 + custom depth cel outline. | Prototype behind `r_framegraph 0` only after instrumentation. Reproduce the current image exactly before adding effects; compare transient render-target memory and GPU p95. Babylon reports 40%+ memory savings in some complex scenes, not a promise for our relatively small stack. Adopt only for a measured win or because a chosen Frame Graph-only feature requires it. |
| **6** | **GPU precipitation first** | Rain can reach 2,000 CPU particles and is the cleanest sustained workload. Babylon 9.17 can create a `GPUParticleSystem` from a CPU system; the newer flow-map/attractor APIs can later make teleporter, jumppad and weather volumes follow map-authored fields. | Profile particle time first. Migrate rain/snow behind a capability fallback before short 40-particle explosion bursts. Node Particle Editor output is an asset-authoring option, not by itself a runtime optimization. |

### 2026-07-22 WebGL2-only next-task ranking

This is the active ordering while WebGPU is postponed:

| Priority | Candidate | Why it fits now | Exit gate |
|---|---|---|---|
| **1** | **GPU rain/snow — implemented** | `RainEffect` now uses `GPUParticleSystem` with capacity up to 2,000 and `emitRateControl`, moving both simulation and rendering to WebGL2 transform feedback. The CPU implementation remains only as an automatic capability fallback for a non-WebGL2 context; there is no legacy toggle. | Type/unit gates pass. Browser-check rain, snow, live wind/intensity changes, rapid stop/restart, map reset and disposal. |
| **2** | **Selective static BSP material freeze** | Static world matrices are already frozen, but immutable opaque BSP materials still pay readiness/define checks. Babylon explicitly recommends `material.freeze()` for immutable materials. | Classify materials after textures/lightmaps and clustered lighting are attached. Never freeze tcMod/animMap/rgbGen/alphaGen materials, autosprites, movers, fog, or runtime effect materials. Flag-gate it and verify clustered lights, area lights, map reset and shader animation before defaulting on. Do not use scene-wide performance-priority modes because their always-active meshes and disabled clears conflict with PVS and the multi-camera/post stack. |
| **3** | **Lightmap 2D-array prototype** | BSP meshes are currently grouped by `(base texture, lightmap index)`, so the same base texture can produce many meshes, materials and draw calls. WebGL2 texture arrays could store equal-sized BSP lightmaps as layers and carry the layer index per vertex, allowing grouping primarily by base texture. | First report potential draw-call reduction per map without changing rendering. Prototype only the opaque static path behind a flag; it requires a custom/NodeMaterial path and exact lightmap visual parity, so it is higher reward but substantially riskier than particle conversion or freezing. |
| **4** | **Frame Graph post stack** | Frame Graph works on WebGL2 and can reuse transient render textures, but our post stack is changing while area lights/god rays are being developed. Migrating now would create avoidable overlap. | Revisit after the post stack stabilizes. Reproduce current HDR, bloom, image processing, SSAO2, outline and volumetric output first; retain only for measured GPU-memory or GPU-time improvement. |

GPU debris/explosions come after precipitation: their particle counts are lower
and some use more specialized behavior, so they offer less return for the first
conversion. Occlusion queries, `freezeActiveMeshes()` and Babylon's
Intermediate/Aggressive scene performance modes remain poor fits because BSP
PVS intentionally changes mesh visibility during play.

#### Why snapshot rendering is not the gameplay fast path

Snapshot rendering records one frame's draw calls and replays them. Gameplay
continuously adds/removes projectiles, dropped weapons, particles, gibs and
transient effects; PVS changes the visible BSP set as the camera crosses
clusters. Babylon recommends `alwaysSelectAsActiveMesh` for snapshot scenes,
which would undermine our PVS design. Fast snapshot mode can be managed for
some moving meshes/skeletons through `SnapshotRenderingHelper`, but it still
does not fit this scene lifecycle. Revisit it only for a future static 3D menu,
viewer or showroom; the current lobby is DOM and has nothing useful to freeze.

#### Babylon 9 feature fit (after optimization work)

| Feature | Map/engine bridge | Priority |
|---|---|---|
| **Textured rectangular area lights** | Strong sci-fi-map fit: explicit `light_area` entity first, then capped opt-in derivation from planar emissive Q3 surfaces. They support Standard/PBR and both backends, but are not clustered and consume real per-material light slots. A companion POC/research workstream is already present in [BABYLON9_AREA_VOLUMETRIC_LIGHTS.md](./BABYLON9_AREA_VOLUMETRIC_LIGHTS.md); avoid duplicating it here. | **High art value**, but performance-budgeted and browser-validated before map auto-generation. |
| **Volumetric lighting** | Existing parsed `fogparms` plus worldspawn/directional-sun data form a natural bridge. The classic post-process can cover WebGL2; the 9.x Frame Graph task can use WebGPU compute with fallback. | **Medium**. Cinematic feature, not an optimization; follow the Frame Graph decision and expose a quality/cvar fallback. |
| **Particle flow maps + attractors** | Add optional effect-volume/map entities for wind tunnels, teleporter vortices, jumppad streams and environmental debris. Both CPU and GPU particle systems support the controls. | **Medium** after GPU-particle profiling; good map-data extension without changing simulation. |
| **Audio Engine V2** | The engine currently uses cloned `HTMLAudioElement`s for music, UI and pickup sounds and has no real spatial sound path. Babylon's modular WebAudio V2 provides decoded sound buffers, listener/source spatialization, buses and async unlock. The installed PK3 set already contains weapon fire/impact/fly sounds, tiered item pickups, footsteps, jumps/walljumps, pain/death, teleport/jumppad/respawn, hit feedback and announcer lines. | **High gameplay value; recommended next Babylon 9 feature project.** Keep the engine layer minimal (device/unlock, buses, buffer cache, music/UI and generic 2D/3D playback). Put sound-bank policy and all event wiring in `src/games/fps`. |
| **SDF text** | Best used for world signage, location labels, debug markers and future map-authored displays. The main HUD is DOM and should not be rewritten for this. | **Low/medium** feature task. |
| **Animation retargeting** | Lets multiple GLB player rigs share the locomotion/combat library. Useful to the player-model asset pipeline, not BSP maps. | **Low** until model variety needs it. |
| **OpenPBR / dynamic IBL shadows** | OpenPBR helps future GLB authoring, but Q3 BSP is primarily baked lightmaps plus Standard/custom materials. Dynamic IBL shadows would compete with that authored lighting and add cost. | **Defer**; showroom/hero assets only. |
| **GPU picker / nav mesh / occlusion queries** | GPU picking can help editor/debug tools, but gameplay hit tests must remain server/BSP authoritative. Babylon nav mesh is still a poor fit for deterministic `BotNavGraph`. Occlusion queries duplicate PVS and conflict with NCM. | **Skip for runtime gameplay**. |

---

## Recommended execution plan

> **Execution status (2026-07-21):** WS0 (benchmark baseline) **skipped by
> decision** — forward-only, no A/B against 8.56. **WS3 (the 9.17 bump)
> executed first** on `feature/babylon-9-upgrade` (both repos): total fallout
> was **three `Buffer` → `Uint8Array` typing sites** (TS 5.9 strict view
> generics surfaced by 9.17's typings — DemoRecorder, ReSimBundle,
> test-spawn-coords) and one environment repair (npm install clobbers
> tfjs-node's `tensorflow.dll` placement on Windows — now auto-fixed by
> `scripts/postinstall.mjs`, which replaced the Havok-only postinstall
> one-liner). No Babylon API broke. Gates: tsc ×2 clean, **1511/1511 tests**,
> biome below baseline, `server:tick` checksum unchanged (`2768943778` — T3
> determinism guardrail met), headless movement smoke ✓. TS stayed at the
> already-installed 5.9.3 (open question 1 resolved: no TS bump needed).
> Browser validation checklist still owed in playtest.
>
> **WS2 executed** (same branch): all 14 `SceneLoader.ImportMeshAsync/
> ImportAnimationsAsync` call sites moved to the module-level loader functions
> (data-URL sites get explicit `pluginExtension: ".glb"`; animation call sites
> preserve exact old semantics by reading `scene.animationGroups`, since the
> old static API returned the scene), and all 14 bare `@babylonjs/core` barrel
> imports replaced with per-module paths. Biome baseline ratcheted 925/586 →
> **913/583**. Gates: tsc ×2, 1511/1511, determinism unchanged.
>
> **Playtest finding (WS3 validation):** enemy-model team outlines broke — the
> barrel imports had been implicitly loading `Rendering/outlineRenderer`, and
> nothing imported it explicitly, so removing the last barrels silently
> unregistered `mesh.renderOutline`. Fixed with explicit side-effect imports at
> the three usage owners (PlayerModelManager, WeaponViewManager, WeaponCharge)
> and locked by a new regression test (`BabylonSideEffectImports.test.ts`) that
> probes the Scene augmentations through the real app import chains
> (`beginAnimation` audited too — loads transitively, fine). Lesson recorded:
> any future barrel-import removal must audit Babylon's side-effect-registered
> features (`renderOutline`, `showBoundingBox`, `beginAnimation`, …).
>
> **WS1 executed** (clustered dynamic lights + retiring the scarcity system):
> new `DynamicLightCluster` module — one scene-scoped `ClusteredLightContainer`
> for gameplay dynamic world lights, lazy-created, torn down on scene dispose
> without disposing member lights. The `PointLightPool` (raised 4→8) and the
> charge glows (GameEvents + DemoService, cap relaxed 2→6) now render through
> it. The muzzle-flash light stays OUT (it's `includedOnlyMeshes`-scoped to the
> viewmodel, which per-light scoping the container can't preserve). Crucially,
> `DynamicLightSafety` was inverted from a **clamp** (2 Standard / 1 PBR — which
> would now truncate the cluster off surfaces, since a container occupies one
> `maxSimultaneousLights` slot with a `CLUSTLIGHT` define) into a **budget**
> (6/4) that admits ambient + sun + static-map cluster + dynamic cluster
> (+ street-lamp cluster). Two NullEngine test suites added; note that
> clustered lighting itself no-ops headlessly (batch size 0 without float-blend
> caps), so the tests cover the module's lifecycle and membership/rendering is
> browser-validated. Gates: tsc ×2, 1520/1520, determinism unchanged, biome
> ratcheted to 913/582.
>
> **WS1 browser-validation items (owed):** dynamic lights actually lighting
> world surfaces (rocket/muzzle-world-glow/pickup/charge all at once, no
> truncation); first-shot smoothness preserved (cluster keeps the light set
> stable — no define churn); and weapon-viewmodel lighting under the raised PBR
> budget (4, was 1) — confirm GLB weapons don't pick up world clusters wrongly
> (fix if so: exclude the dynamic cluster from `WEAPON_LAYER_MASK`).
>
> **WebGPU failure investigation (re-tested — POSTPONED):**
> real lobby testing produced missing clustered resources
> (`lightDataTexture3` / `tileMaskBuffer3`) and pipelines using 14â€“16
> vertex-stage UBOs against the adapter limit of 12. Once a binding/pipeline
> failed, the WebGPU command encoder became invalid and the browser kept showing
> its last submitted frame: initially white, later a frozen partial BSP frame.
> Pointer lock still changed normally, proving this was renderer freeze rather
> than dead input. The code also exposed a direct regression: WS1 had inverted
> the former 2/1 material clamps into 6/4 minimums even though the existing
> safety note documents the 12-UBO ceiling. WebGPU now bypasses Babylon 9.17
> clustered containers at all three owners (map, gameplay dynamics, street
> lamps) and clamps Standard/PBR forward lights to 2/1. WebGL2 retains the 6/4
> clustered optimization.
>
> **Re-test result (2026-07-22) — postponed.** `?renderer=webgpu` on wdm2 still
> fails: a pipeline needs **14 uniform buffers in the vertex stage** against the
> adapter limit of **12**, cascading to invalid bind-group/pipeline layouts,
> device errors, and a frozen/white frame. Two fixes were tried and ruled out:
> (a) `WebGPUEngine` `setMaximumLimits: true` + `enableAllFeatures: true` — this
> Chrome/Dawn adapter reports the spec-floor `maxUniformBuffersPerShaderStage` of
> 12, so the ceiling **cannot be raised** in config; (b) the existing 2/1 forward
> clamp does **not** bring the offending material under 12, so either a material
> bypasses `applySafeMaxSimultaneousLights` or the count is dominated by
> non-light UBOs (Scene/Mesh/Material/bones/NodeMaterial blocks). Pinning the
> exact material needs pipeline-build instrumentation. **Decision:** WebGPU is
> **postponed** behind the `?renderer=webgpu` opt-in. Two real blockers remain,
> each multi-day: **(1)** reduce per-material vertex-stage UBOs below 12 (fewer
> simultaneous lights / trim the always-on sun+moon+ambient set — a lighting
> fidelity tradeoff), and **(2)** the WS7 native-WGSL port of the seven authored
> GLSL shader families (they don't validate on WebGPU regardless of #1). Revisit
> when WS7 lands; until then WebGL2 is the sole supported/default backend and
> carries all the shipped wins (Babylon 9, KTX2, clustered lighting, area lights,
> god rays).
>
> **Playtest finding #2 (WS3 validation, corrected):** map weapon pickups were
> invisible while dropped weapons were fine. The initial `__root__` winding
> diagnosis and geometry-bake fix were explicitly reverted after diagnostics
> disproved it. The real defect was lifecycle ordering: map entity constructors
> launched detached model work before BSP/assets/material finalization, and map
> teardown did not own those independent entity roots. The final fix moves
> entity spawning to the last map-load phase, awaits each pickup's `whenReady()`,
> and disposes the entity generation on map unload. The companion FPS change
> resets transient warmup state at match start, rebuilds dropped-weapon visuals
> after map unload, and preserves composite weapon attachment points (including
> the plasmagun rotator). User playtest confirmed initial weapons now render.
>
> **WS4 implemented (generation/playtest pending):** `PK3TextureLoader` now
> checks a versioned `data/ktx2cache/manifest.json` before source resolution,
> with `r_ktx2 0` as an immediate fallback. Babylon's official
> `@babylonjs/ktx2decoder` runs from bundled local modules in an
> `AutoReleaseWorkerPool`; it no longer depends on Babylon's decoder CDN.
> The converter now indexes the effective alphabetical PK3 override filesystem,
> normalizes TGA/PNG/JPEG sources to PNG, emits ETC1S for color and UASTC for
> normal/detail data, and writes incremental manifest entries. A dry audit of
> the local data set found **94 PK3s / 3020 unique textures** (2463 ETC1S, 557
> UASTC). The production build emits the decoder worker and all eight decoder
> WASM modules locally. Gates: typecheck and build clean, **1527/1527 tests**,
> simulation/server tick/1000-tick fuzz/headless wdm2 load clean; the existing
> physics diagnostic still exits successfully while warning on its standalone
> `StepSlideMove` Y delta.
>
> **WS4 generation completed:** the official stable Khronos KTX-Software 4.4.2
> encoder generated all **3020/3020** sidecars with zero missing manifest
> entries. The cache is **88,051,152 bytes (~84 MiB)**; all 3020 containers pass
> `ktx validate`, and the production `dist/data/ktx2cache` copy has exact
> file-count/byte-count parity. The discovery pass also hardened the converter
> for KTX 4.x/5.x codec naming, indexed-color TGA variants, and PK3 filenames
> containing commas. `public/data` is deliberately gitignored, so deployments
> must publish `ktx2cache` with the external game-data payload. If it is absent,
> the manifest request misses and the unchanged PK3 source path remains active.
> The actual browser decoder path plus T4's visual A/B/VRAM/load-time
> measurements remain owed.
>
> **WS5 audit completed:** keep the current outline path. The player and weapon
> presentation already uses Babylon's built-in per-mesh `OutlineRenderer`; it
> was not a new Babylon 9 replacement and the 9.x implementation offers no
> migration win over the feature we already ship. Babylon navigation remains a
> poor fit for the server-authoritative, BSP-derived `BotNavGraph`, so the bot
> workstream keeps its deterministic graph/analyzer path. Inspector v2 remains
> an optional developer tool rather than a shipped dependency.
>
> **WS6 foundation implemented (experimental opt-in):** startup now goes through an
> async renderer factory. `r_webgpu 1` selects `WebGPUEngine` after a
> reload; `?renderer=webgpu`/`?renderer=webgl2` provide session-only A/B
> overrides without changing persisted settings. Unsupported adapters and all
> initialization failures fall back to WebGL2. GLSLang and TWGSL JS/WASM are
> bundled locally instead of fetched from Babylon's CDN, Q3 `NodeMaterial`s
> select WGSL under WebGPU, and gameplay resource recovery uses Babylon's
> renderer-agnostic context-loss observables (including WebGPU device loss).
> The production build emits the compiler assets and the factory/fallback unit
> suite is green. This is the safe entry point, not completion of T6: the
> seven custom shader families, post stack, KTX1-only fallbacks, lobby-spawned map
> lifecycle, and performance targets still require browser validation. WebGPU
> is temporarily restricted to explicit `?renderer=webgpu` test sessions;
> WebGL2 is the shipping default until the real lobby-spawned pipeline is valid.
> Initialization failures still fall back without blocking startup. KTX2
> remains default-on (`r_ktx2 1`).
>
> **WS6 KTX1 compatibility audit:** the effective 94-PK3 filesystem contains
> 396 KTX1-only textures: 280 ETC1-compressed and 116 uncompressed. ETC1 already
> software-decodes to RGBA when no WebGL context exists; RGB, RGBA, luminance,
> and luminance-alpha were likewise portable. The remaining hole was 56 legacy
> alpha-only textures, now explicitly expanded to white RGBA with the original
> alpha channel before upload, making that path backend-independent too.
>
> **WS7 implementation checkpoint (2026-07-22):** **perf capture [seconds]**
> now records bounded 1-60 second reports through Babylon's public
> EngineInstrumentation and SceneInstrumentation: backend, map, KTX2 state,
> frame/CPU/GPU p50+p95, active-mesh evaluation, particle/animation/physics
> time, draw calls, active meshes, triangles, shader compilation, and WebGPU
> render-bundle creation/reuse. Its render observer and both instrumentation
> objects are always disposed after capture.
>
> **Native-WGSL trial rolled back:** the first broad pass was type/build clean
> but the real lobby-spawned WebGPU game rendered as a fullscreen white frame.
> Disabling the cel-outline post-process immediately restored the scene, proving
> its WGSL path was not runtime-correct despite passing static gates. All six
> attempted family ports were reverted to the known-good GLSL translation path;
> no translator assets were removed. Resume one family per browser checkpoint,
> beginning with a mesh-local shader and leaving fullscreen post-processes until
> last. A family is not counted as native until the real WebGPU shader compiles
> and passes visual parity.

Ordering rationale: **measure first** (targets are meaningless without a
baseline), then take the biggest win on the version we already run (WS1 —
clustered dynamic lights needs no upgrade), then shrink the upgrade diff with
the hygiene migrations (WS2), then bump (WS3) when the codebase is already on
the maintained API paths, then the independent texture pipeline (WS4), and only
then the experiments that ride on all of it (WS5–WS6). Every workstream is an
independent branch + commit chain, individually revertible, merged via the
fps-first ritual; nothing here blocks or mixes with the in-flight bot work.

| WS | Work | Gate to exit | Effort |
|---|---|---|---|
| **WS0** | **Benchmark baseline.** Record one canonical combat-heavy demo on wdm2 (kept in-repo as the perf demo). Protocol: play it via demo playback (deterministic route), capture avg FPS + p95 frame time (`showfps`/`stats` + a DevTools performance trace), on two tiers: dev dGPU + one iGPU laptop. Also capture: `EffectPreloader` warmup ms, texture VRAM (`stats`), gzip bundle size (`npm run build`). Write numbers into this doc | Baseline table filled in below | ½ session |
| **WS1** | **Cluster the dynamic effect lights** (Migration A): pooled effect lights + pickup/charge glows into a perspective-tuned `ClusteredLightContainer`; retire `DynamicLightSafety` clamps + `PointLightPool` rationing + light-permutation warmups. | Targets T1 on WebGL2; WebGPU uses capped forward lights until Babylon's cluster bindings pass validation | implemented on WebGL2; WebGPU bypass active |
| **WS2** | **Hygiene migrations** (B: `SceneLoader` → module loader functions, 8 sites; C: 15 barrel imports → per-module paths). Do BEFORE the bump so the 9.x diff is pure | Targets T2; tests green; zero behavior diff | 1 session |
| **WS3** | **Babylon 9.17 bump** (old Phase 0+1): bump core+loaders, contingent TS bump (isolated commit), full gates (`tsc` ×2 → `test:run` → biome → `server:tick` → headless smokes incl. clustered-container leak test + `ShadersInclude` compile check), then the browser validation checklist (maps → weapons → pickups v4 → post pipeline → GLB models → post-match → demo playback) | Targets T3; checklist signed off in playtest | 1–2 sessions |
| **WS4** | **KTX2 texture pipeline — code and generation complete.** PK3-aware converter → 3020 manifest-indexed `.ktx2` sidecars, loader preference, local worker transcoder, `r_ktx2` fallback | Publish cache with game data, then pass T4 + browser A/B visual checks | 1–2 sessions |
| **WS5** | **9-gated adoption audit complete.** Keep Babylon's existing per-mesh outline path; keep deterministic BSP bot navigation; leave Inspector v2 optional/unshipped | Decisions recorded above; no speculative dependencies or renderer rewrite | complete |
| **WS6** | **WebGPU compatibility foundation implemented, default rolled back:** async `WebGPUEngine` selection, local GLSLang/TWGSL, WebGL2 fallback, WGSL Q3 NodeMaterials, renderer-neutral context recovery, and backend-independent KTX1 alpha uploads. Real lobby play currently produces invalid pipeline layouts/white frames, so only `?renderer=webgpu` opts in. | Targets T6; do not restore the default until T6 is met on both hardware tiers | active |
| **WS7** | **Native WGSL + instrumentation:** port BSP fog, filter blend, glow overlay, cel outline, muzzle, rail and voltaic to dual backend-native shaders; add bounded public-API renderer capture; then remove GLSLang/TWGSL startup assets | Target T7; compiler assets absent, WebGL2/WebGPU parity, reproducible perf report | **active (instrumentation done; shader trial rolled back)** |
| **WS8** | **WebGPU fast-path spike:** fix/replace `separateCullingPass` on procedural pickups, expose `r_webgpu_fast`, report render-bundle create/reuse counts, and audit dynamic vertex/material mutations | Target T8; default remains off until bundle churn is low and CPU p95 wins | queued |
| **WS9** | **WebGL2 follow-ups:** static BSP world-matrix freezing and GPU precipitation are complete; selective static-material freezing is next; defer Frame Graph until the area-light/god-ray post stack stabilizes | Preserve PVS, animated shaders, weather lifecycle and map reset behavior | active |
| **WS10** | **Audio V2 foundation + FPS soundscape — first checkpoint implemented:** short SFX now use a minimal Babylon Audio V2 backend with one SFX bus, PK3-index package resolution, shared decoded buffers, bounded spatial sources and listener attachment. The FPS bank wires authoritative weapon fire, projectile impact, Bobot pain/death, attacker hit confirmation and the Warsow kill echo. Distance-driven Bobot jumps/footsteps are spatial for other players and use BSP `METALSTEPS`/`NOSTEPS`; demo playback reuses the same presentation functions. HTML media remains only for the existing streaming playlist/music path. Next: pickups, teleport/jumppad/respawn, continuous weapon loops/stops and announcer policy. | Browser unlock through the lobby loading gesture; accepted local fire matches muzzle/recoil timing; remote combat/movement is spatialized; bounded source cleanup; map/demo discontinuities reset movement cadence | active — checkpoint implemented |
| **WS11** | **Lightmap-array feasibility:** report how many `(base texture, lightmap)` groups could collapse when lightmaps use WebGL2 2D-array layers; prototype only if the predicted draw-call reduction is material | Opaque BSP parity plus a measured draw-call/GPU win; no regression to PVS, patches or animated shaders | research |

**Rollback:** WS3 is a single-commit revert (lockfile included). WS1/WS2/WS4
are independent commit chains, individually revertible, none depend on 9.

---

## Optimization targets

Provisional until WS0 fills the baseline — targets are then re-stated as
absolute numbers against it. "No feature sacrificed" guardrails apply to every
workstream: determinism checksum unchanged, full suite green, no visual
regression on the WS3 checklist, `r_`-cvar fallback for every behavior swap.

**Baseline (WS0 — to fill):**

| Metric | dGPU | iGPU |
|---|---|---|
| Avg FPS / p95 frame time (perf demo) | _TBD_ | _TBD_ |
| Shader-compile events in 60 s combat (post-warmup) | _TBD_ | _TBD_ |
| EffectPreloader warmup ms | _TBD_ | — |
| Texture VRAM after wdm2 load | _TBD_ | — |
| Gzip bundle (main chunk) | _TBD_ | — |
| Map load to playable (wdm2) | _TBD_ | _TBD_ |

**T1 — clustered dynamic lights (WS1):**
- ≥ 8 simultaneous dynamic lights lighting any surface (today: 2 Standard /
  1 PBR) at ≤ 5% frame-time cost vs baseline.
- **Zero** light-driven shader recompile events in the 60 s combat trace after
  warmup (the hitch class EffectPreloader exists to mask).
- EffectPreloader warmup time −30% or better (permutation collapse).
- `DynamicLightSafety` clamp code deleted, not bypassed.

**T2 — hygiene (WS2):** main-chunk gzip strictly not larger; goal −3%+ (barrel
removal + loader-function tree-shaking). Zero runtime behavior diff (suite +
demo-playback screenshot compare).

**T3 — 9.17 bump (WS3):** avg FPS and p95 frame time within **±2%** of
baseline on both tiers (a major upgrade must be perf-neutral before it pays
rent via WS5/WS6); all ~1500 tests green; `server:tick` checksum unchanged;
bundle within +2%.

**T4 — KTX2 (WS4):** texture VRAM **−60% or better** on wdm2; map load
−20%; iGPU avg frame time −10% (bandwidth relief is the point); zero
readability regressions in the A/B pass (UASTC override list for any trim that
bands under ETC1S).

**T6 — WebGPU (WS6, acceptance gate for restoring it as the default):** first-shot frame
spike < 16.7 ms for every weapon (background pipeline compilation doing its
job); JS main-thread render time −15% vs WebGL2 on the same demo; full WS3
visual checklist passes under WebGPU on both tiers; automatic WebGL2 fallback
verified on a non-WebGPU browser profile.

**T7 — native WGSL + instrumentation (WS7):** all seven authored shader
families compile natively on WebGPU and retain their GLSL WebGL2 path; visual
parity on fog/decal/glow/cel plus every procedural weapon effect; the four
GLSLang/TWGSL artifacts (**2,737,181 raw bytes today**) are absent from the
production build and WebGPU initialization; a timed capture reports public-API
CPU/GPU/shader/draw/particle counters without reading `engine._drawCalls`.

**T8 — WebGPU NCM (WS8):** after a 10-second stabilized capture,
`numBundleReuseNonCompatMode` is non-zero and bundle creation is ≤ 1% of reuse
outside deliberate spawn/despawn bursts; CPU render p95 improves by at least
10% vs WebGPU compatibility mode; procedural pickups, PVS transitions,
autosprites, explosions, post-processing and model animation remain correct.
If the target is missed, keep compatibility mode—NCM is not inherently faster
for every scene.

**Aspirational floors once WS1+WS4 land** (sanity anchors, not gates): iGPU
(Iris Xe class) sustained ≥ 60 FPS / p95 ≤ 16.7 ms at 1080p on the perf demo;
dGPU ≥ 240 FPS avg for competitive play.

## Open questions
1. Frozen materials × clustered-light texture updates (WS1 browser test).
2. Exact 8.x minor that shipped clustered lighting (curiosity only — we have it).
3. Which demo becomes the canonical perf demo (WS0) — record fresh on wdm2 with
   bots for repeatable combat density, or reuse an existing one.
4. Whether the UASTC override list needs expansion after the WS4 texture A/B.
5. Whether the 396 KTX1-only assets should eventually be folded into the
   generated KTX2 cache; their current runtime paths are now backend-independent.
6. Which authored shader should be the first WGSL slice. Suggested order:
   filter blend → glow overlay → muzzle → rail → voltaic → BSP fog → cel
   outline, moving from small/self-contained to depth/post-process-sensitive.
7. Whether NCM's measured CPU win survives PVS cluster transitions and combat
   bursts after the explicit `separateCullingPass` incompatibility is removed.

## Manual WebGPU acceptance path

Use the normal lobby lifecycle (not direct `?map=` loading):

1. Start the client and lobby server normally.
2. Open `/?renderer=webgpu`, click through the loading screen, then join a
   lobby-spawned match. A normal URL now uses the known-good WebGL2 renderer.
3. Confirm `window.rendererBackend === "webgpu"` and the console reports
   `[Main] Rendering backend: webgpu`. A fallback reports its reason and leaves
   `window.rendererBackend === "webgl2"`.
4. Join, capture the mouse, move continuously for 30 seconds, and confirm the
   frame keeps advancing with no clustered-resource or UBO-limit errors.
5. Exercise BSP/Q3 animated shaders, all weapon shader families, outlines,
   KTX2 textures, post-processing, death/drop/respawn, map reset, and match end.
6. Repeat with `/?renderer=webgl2` for the visual/performance comparison.

## Sources
- npm registry: `@babylonjs/core` latest **9.17.0** (9.16.x published 2026-07)
- [Babylon.js 9.0 announcement (Medium)](https://babylonjs.medium.com/welcome-to-babylon-js-9-0-c3edc9ee6428) · [Windows Dev Blog](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/) · [Part 3: engine updates](https://blogs.windows.com/windowsdeveloper/2026/04/02/part-3-babylon-js-9-0-openpbr-and-additional-engine-updates/)
- [Official breaking-changes doc](https://doc.babylonjs.com/breaking-changes/) (newest: 8.10.1) · [CHANGELOG](https://github.com/BabylonJS/Babylon.js/blob/master/CHANGELOG.md) · [Forum: 9.16.x UMD ES2015](https://forum.babylonjs.com/t/breaking-changes-in-version-9-16-x/63772)
- [Clustered Lighting docs](https://doc.babylonjs.com/features/featuresDeepDive/lights/clusteredLighting/) · [feature thread](https://forum.babylonjs.com/t/clustered-lights-support/56111)
- [SceneLoader deprecation discussion](https://forum.babylonjs.com/t/what-is-an-alternative-for-deprecated-sceneloader-importmeshasync/56566) · [Loading file types docs](https://doc.babylonjs.com/features/featuresDeepDive/importers/loadingFileTypes) — module-level loader functions
- [WebGPU Support](https://doc.babylonjs.com/setup/support/webGPU) · [native WGSL guidance](https://doc.babylonjs.com/setup/support/webGPU/webGPUWGSL) · [non-compatibility mode / render bundles](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUNonCompatibilityMode) · [snapshot rendering](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering) · [miscellaneous WebGPU optimization](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUMiscellaneous/)
- [Official scene optimization and instrumentation guide](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene) · [Babylon.js releases](https://github.com/BabylonJS/Babylon.js/releases)
- [Official GPU particle guide](https://doc.babylonjs.com/features/featuresDeepDive/particles/particle_system/gpu_particles) · [`GPUParticleSystem.fromParticleSystem`](https://doc.babylonjs.com/typedoc/classes/BABYLON.GPUParticleSystem) · [WebGL2 features (transform feedback and 2D texture arrays)](https://doc.babylonjs.com/setup/support/webGL2)
- [Frame Graph concepts and transient-texture reuse](https://doc.babylonjs.com/features/featuresDeepDive/frameGraph/frameGraphBasicConcepts/)
- [Babylon Audio V2: playing sounds, spatial audio and buses](https://doc.babylonjs.com/features/featuresDeepDive/audio/playingSoundsMusic) · [`CreateAudioEngineAsync`](https://doc.babylonjs.com/typedoc/functions/BABYLON.CreateAudioEngineAsync)
- [Babylon.js ES6 KTX2 decoder setup](https://doc.babylonjs.com/setup/frameworkPackages/es6Support) · [KhronosTextureContainer2 API](https://doc.babylonjs.com/typedoc/classes/BABYLON.KhronosTextureContainer2)
- [Khronos `ktx create` reference](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html) · [KTX-Software repository](https://github.com/KhronosGroup/KTX-Software)
- In-repo evidence: `MapRenderer.ts` (clustered static map lights, tuned tiles/slices), `StreetLampSystem.ts` (lazy container), `headless-game.ts` (container leak test), `DynamicLightSafety.ts` (2/1 clamps), `PointLightPool.ts` (4-light ration), `Q3NodeMaterialBuilder.ts` (backend-native NodeMaterial language), `RenderingEngineFactory.ts` (translator bootstrap), `StatsCommand.ts` (private/instantaneous instrumentation gap), `BspMeshBuilder.ts` + `PVSCuller.ts` (static grouping and PVS), procedural pickup materials (`separateCullingPass` NCM blocker), and the seven authored GLSL shader owners listed in WS7
