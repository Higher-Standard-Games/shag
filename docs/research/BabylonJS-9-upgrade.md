# Babylon.js 9 Upgrade — Deep Research & Migration Plan

**Date:** 2026-07-21 (deep-audit revision — supersedes the first draft's claims)
**Status:** Active migration — WS1–WS3 implemented; WS4 runtime/build pipeline and asset generation complete, browser visual/performance validation pending
**Scope:** `@babylonjs/core` + `@babylonjs/loaders` 8.56 → 9.17.x; what the jump
*actually* requires given our measured API surface; which modern APIs we can
migrate into (some without upgrading at all)
**Risk:** Renderer-facing only. The server simulation imports no Babylon
rendering paths; the determinism gate is out of blast radius.
**Companion doc:** [ENGINE_FPS_OPTIMIZATION.md](./ENGINE_FPS_OPTIMIZATION.md)

---

## Key corrections from the deep audit

1. **Clustered lighting is NOT 9.0-gated — it ships in our installed 8.56 and
   we already use it in production paths.** `MapRenderer` (the FPS world
   renderer) already puts static map point lights into a
   `ClusteredLightContainer` ("allows many lights without hitting WebGL uniform
   buffer limits", tuned `depthSlices = 4`, `horizontalTiles = 8`);
   `StreetLampSystem` creates one lazily; the headless CLI even leak-tests the
   container across map clears. Babylon *headlined* the feature at 9.0, but it
   landed in late 8.x. Consequence: the biggest lighting win — clustering the
   **dynamic** effect lights and deleting the scarcity clamps — is available
   **today**, upgrade or not.
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
| Materials (`standardMaterial` 38, `texture` 27, `shaderMaterial` 13, `effect` 7, `pbrMaterial` 7, `rawTexture` 7, `dynamicTexture` 4, `fresnelParameters` 1) | Q3 surfaces, effects, pickups v4 | **Stable.** Custom GLSL via `Effect.ShadersStore` (muzzle/rail/voltaic) is the long-standing registration path; validate visually |
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
| **Node Particle Editor / flow maps / attractors** (9.0) | Classic `ParticleSystem` in Debris/Rain/Explosion | Only if we redesign those effects; no perf need identified |

### Staged after both (flag-gated)

**`r_webgpu` — `WebGPUEngine` with WebGL2 fallback.** Payoffs: background
pipeline compilation (first-shot hitch class), lower JS submit overhead, compute
for future effects, storage-buffer clustered lights. Named work items from this
audit: (1) our four GLSL `ShaderMaterial` families run through runtime
GLSL→WGSL conversion — validate each; (2) `Q3NodeMaterialBuilder` output needs
`ShaderLanguage.WGSL` if those surfaces receive clustered lights; (3) snapshot
rendering only for static contexts (menus/lobby/diorama), never gameplay.

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
| **WS1** | **Cluster the dynamic effect lights** (Migration A): pooled effect lights + pickup/charge glows into a perspective-tuned `ClusteredLightContainer`; retire `DynamicLightSafety` clamps + `PointLightPool` rationing + light-permutation warmups. Verify frozen-material interaction (open question 2) | Targets T1; visual pass (no dropped lights, no double-lighting); all gates green | 1–2 sessions |
| **WS2** | **Hygiene migrations** (B: `SceneLoader` → module loader functions, 8 sites; C: 15 barrel imports → per-module paths). Do BEFORE the bump so the 9.x diff is pure | Targets T2; tests green; zero behavior diff | 1 session |
| **WS3** | **Babylon 9.17 bump** (old Phase 0+1): bump core+loaders, contingent TS bump (isolated commit), full gates (`tsc` ×2 → `test:run` → biome → `server:tick` → headless smokes incl. clustered-container leak test + `ShadersInclude` compile check), then the browser validation checklist (maps → weapons → pickups v4 → post pipeline → GLB models → post-match → demo playback) | Targets T3; checklist signed off in playtest | 1–2 sessions |
| **WS4** | **KTX2 texture pipeline — code and generation complete.** PK3-aware converter → 3020 manifest-indexed `.ktx2` sidecars, loader preference, local worker transcoder, `r_ktx2` fallback | Publish cache with game data, then pass T4 + browser A/B visual checks | 1–2 sessions |
| **WS5** | **9-gated adoption evaluations** (cheap spikes, adopt only on win): outline renderer vs custom team outlines; nav-mesh improvements → handoff note to the bot workstream; inspector v2 as dev dep | Keep-or-drop decision per item, noted here | ½ session each |
| **WS6** | **`r_webgpu` experiment**: `WebGPUEngine` + WebGL2 fallback behind the cvar; validate the four GLSL `ShaderMaterial` families under runtime GLSL→WGSL; `Q3NodeMaterialBuilder` WGSL variant if clustered lights touch those surfaces; snapshot rendering only for lobby/menu/diorama | Targets T6; default stays WebGL2 until T6 met on both hardware tiers | separate cycle |

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

**T6 — WebGPU (WS6, gate to ever flipping the default):** first-shot frame
spike < 16.7 ms for every weapon (background pipeline compilation doing its
job); JS main-thread render time −15% vs WebGL2 on the same demo; full WS3
visual checklist passes under WebGPU on both tiers; automatic WebGL2 fallback
verified on a non-WebGPU browser profile.

**Aspirational floors once WS1+WS4 land** (sanity anchors, not gates): iGPU
(Iris Xe class) sustained ≥ 60 FPS / p95 ≤ 16.7 ms at 1080p on the perf demo;
dGPU ≥ 240 FPS avg for competitive play.

## Open questions
1. Frozen materials × clustered-light texture updates (WS1 browser test).
2. Exact 8.x minor that shipped clustered lighting (curiosity only — we have it).
3. Which demo becomes the canonical perf demo (WS0) — record fresh on wdm2 with
   bots for repeatable combat density, or reuse an existing one.
4. Whether the UASTC override list needs expansion after the WS4 texture A/B.

## Sources
- npm registry: `@babylonjs/core` latest **9.17.0** (9.16.x published 2026-07)
- [Babylon.js 9.0 announcement (Medium)](https://babylonjs.medium.com/welcome-to-babylon-js-9-0-c3edc9ee6428) · [Windows Dev Blog](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/) · [Part 3: engine updates](https://blogs.windows.com/windowsdeveloper/2026/04/02/part-3-babylon-js-9-0-openpbr-and-additional-engine-updates/)
- [Official breaking-changes doc](https://doc.babylonjs.com/breaking-changes/) (newest: 8.10.1) · [CHANGELOG](https://github.com/BabylonJS/Babylon.js/blob/master/CHANGELOG.md) · [Forum: 9.16.x UMD ES2015](https://forum.babylonjs.com/t/breaking-changes-in-version-9-16-x/63772)
- [Clustered Lighting docs](https://doc.babylonjs.com/features/featuresDeepDive/lights/clusteredLighting/) · [feature thread](https://forum.babylonjs.com/t/clustered-lights-support/56111)
- [SceneLoader deprecation discussion](https://forum.babylonjs.com/t/what-is-an-alternative-for-deprecated-sceneloader-importmeshasync/56566) · [Loading file types docs](https://doc.babylonjs.com/features/featuresDeepDive/importers/loadingFileTypes) — module-level loader functions
- [WebGPU Support](https://doc.babylonjs.com/setup/support/webGPU) · [Snapshot Rendering](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering)
- [Babylon.js ES6 KTX2 decoder setup](https://doc.babylonjs.com/setup/frameworkPackages/es6Support) · [KhronosTextureContainer2 API](https://doc.babylonjs.com/typedoc/classes/BABYLON.KhronosTextureContainer2)
- [Khronos `ktx create` reference](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html) · [KTX-Software repository](https://github.com/KhronosGroup/KTX-Software)
- In-repo evidence: `MapRenderer.ts` (clustered static map lights, tuned tiles/slices), `StreetLampSystem.ts` (lazy container), `headless-game.ts` (container leak test), `DynamicLightSafety.ts` (2/1 clamps), `PointLightPool.ts` (4-light ration), `Q3NodeMaterialBuilder.ts` (NodeMaterial usage), `AudioManager.ts` (HTMLAudio only)
