# Babylon.js 9 Upgrade — Deep Research & Migration Plan

**Date:** 2026-07-21 (deep-audit revision — supersedes the first draft's claims)
**Status:** Investigation + upgrade plan (no code changes yet)
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
| Physics v2 (`IPhysicsEnginePlugin` 6, `havokPlugin`, `physicsAggregate`, `ragdoll`, `physicsEngineComponent`, `@babylonjs/havok` wasm) | Client-side pickup toss/ragdoll only | **Stable**; `@babylonjs/havok` versions independently (keep 1.3.11, watch peer warnings) |
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

## Upgrade plan (revised)

### Phase 0 — mechanical bump (1 session)
1. Branch; bump `@babylonjs/core` + `@babylonjs/loaders` → `^9.17.0`; `npm i`
   (watch `@babylonjs/havok` peer warnings; keep 1.3.11).
2. Gates in order: `tsc` both repos (TS bump here if typings demand — isolated
   commit) → `test:run` (134 NullEngine files are the real audit) → biome →
   `server:tick` → headless smokes (`bsp load`, `sim replay`), including the
   CLI's clustered-container leak test.
3. Compile check the six `ShadersInclude` imports (thin-instance custom shaders).

### Phase 1 — browser validation pass
Maps (world materials/lightmaps/skybox/patches/fog) → weapons (voltaic, rail,
muzzle styles, tracers, explosions; first-shot smoothness) → pickups v4
(fresnel grading, edge widths, collect burst) → post pipeline (bloom/exposure/
contrast + SSAO + RenderVars round-trip) → GLB player models/viewmodels
(skeletons, animation groups, sockets) → post-match flow → demo record/playback.
*(Audio dropped from the checklist — HTMLAudio only.)*

### Phase 2 — migrations A–C
Can start **before or independent of** Phase 0 (all three are 8.56-compatible);
A is the FPS payoff, B+C are hygiene PRs. If the upgrade lands first, do them on 9.

### Phase 3 — `r_webgpu` experiment (separate cycle)
As scoped above, with the three named work items.

### Rollback
Single-commit revert of the package bump (lockfile included). Migrations A–C
are independent commits, individually revertible, and don't depend on 9.

---

## Measurements to capture
- FPS + frame-time p95 (desktop GPU + one iGPU laptop, fixed route) before/after
  Phase 0 and after Migration A.
- Shader-compile hitch trace around first shots pre/post Migration A;
  `EffectPreloader` warmup time (should shrink as permutations collapse).
- Bundle size before/after Phase 0 and after Migration C (`npm run build`).

## Open questions
1. TS floor for 9.17 typings (Phase 0 resolves).
2. Frozen materials × clustered-light texture updates (Migration A test).
3. Havok 1.3.11 × core 9.x peer expectations (`npm i` + ragdoll/toss smoke).
4. Exact 8.x minor that shipped clustered lighting (curiosity only — we have it).

## Sources
- npm registry: `@babylonjs/core` latest **9.17.0** (9.16.x published 2026-07)
- [Babylon.js 9.0 announcement (Medium)](https://babylonjs.medium.com/welcome-to-babylon-js-9-0-c3edc9ee6428) · [Windows Dev Blog](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/) · [Part 3: engine updates](https://blogs.windows.com/windowsdeveloper/2026/04/02/part-3-babylon-js-9-0-openpbr-and-additional-engine-updates/)
- [Official breaking-changes doc](https://doc.babylonjs.com/breaking-changes/) (newest: 8.10.1) · [CHANGELOG](https://github.com/BabylonJS/Babylon.js/blob/master/CHANGELOG.md) · [Forum: 9.16.x UMD ES2015](https://forum.babylonjs.com/t/breaking-changes-in-version-9-16-x/63772)
- [Clustered Lighting docs](https://doc.babylonjs.com/features/featuresDeepDive/lights/clusteredLighting/) · [feature thread](https://forum.babylonjs.com/t/clustered-lights-support/56111)
- [SceneLoader deprecation discussion](https://forum.babylonjs.com/t/what-is-an-alternative-for-deprecated-sceneloader-importmeshasync/56566) · [Loading file types docs](https://doc.babylonjs.com/features/featuresDeepDive/importers/loadingFileTypes) — module-level loader functions
- [WebGPU Support](https://doc.babylonjs.com/setup/support/webGPU) · [Snapshot Rendering](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering)
- In-repo evidence: `MapRenderer.ts` (clustered static map lights, tuned tiles/slices), `StreetLampSystem.ts` (lazy container), `headless-game.ts` (container leak test), `DynamicLightSafety.ts` (2/1 clamps), `PointLightPool.ts` (4-light ration), `Q3NodeMaterialBuilder.ts` (NodeMaterial usage), `AudioManager.ts` (HTMLAudio only)
