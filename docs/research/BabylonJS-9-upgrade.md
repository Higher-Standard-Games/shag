# Babylon.js 9 Upgrade — Research & Migration Plan

**Date:** 2026-07-21
**Status:** Investigation + upgrade plan (no code changes yet)
**Scope:** `@babylonjs/core` + `@babylonjs/loaders` 8.56 → 9.17.x; the features
the jump unlocks (clustered lighting first); staged WebGPU afterwards
**Risk:** Renderer-facing only. Gameplay, networking, and the server simulation
do not import Babylon rendering paths; the determinism gate is expected to be
unaffected.
**Companion doc:** [ENGINE_FPS_OPTIMIZATION.md](./ENGINE_FPS_OPTIMIZATION.md)
(why: the two recommended optimization points that motivate this upgrade).

---

## Summary

We run Babylon **8.56.0** (`^8.44.1` in `package.json`) on a classic WebGL2
`Engine`. Current stable is **9.17.0**; 9.0 shipped **2026-03-26**. The
investigation below found the 8→9 jump to be unusually low-risk for us:

- The **official breaking-changes doc lists no breaking changes for 9.0** (its
  newest entry is 8.10.1). The 9.0.0 changelog section is bugfix-level. Babylon
  9.0 was an *additive* major.
- The one publicized 9.x breakage (9.16.x) is **UMD builds now requiring
  ES2015** — we consume the **ESM packages** through Vite 6 with modular
  per-path imports, so it does not apply.
- A codebase scan for Babylon **private-API usage** (`._foo` on Babylon objects)
  found none — only our own stash keys (`_originalBumpLevel` etc. in RenderVars)
  and our own class fields. Nothing rides Babylon internals.
- We never enable `useRightHandedSystem`, so the 8.10.1 right-handed camera
  behavior change (the only scary 8.x entry) never applied to us — and we are
  already past it on 8.56 regardless.

The main work is therefore **behavioral validation** (custom shaders, NullEngine
suites, post pipeline), not API migration.

---

## Verified current surface

| Item | Value |
|---|---|
| Packages | `@babylonjs/core ^8.44.1` (8.56.0 installed), `@babylonjs/loaders ^8.44.1`, `@babylonjs/havok 1.3.11` (independent versioning; wasm copied to `public/wasm/` by postinstall) |
| Not used | `@babylonjs/gui`, `@babylonjs/materials`, `babylonjs` UMD bundles — nothing else to migrate |
| Import breadth | **794** `@babylonjs/core` import statements over **83 unique module paths** (modular ESM style preserved → tree-shaking intact under 9) |
| Engine | `new Engine(canvas, true, { stencil: false })` (`src/main.ts:63`), plus `NullEngine` in headless CLI + **134 test files** |
| Toolchain | Vite 6.3, TypeScript 5.2, vitest 3.2. TS version is an audit item — Babylon 9 typings may want a newer TS; bump TS if `tsc` complains (low risk, TS minors are cheap) |
| Handedness | Left-handed default everywhere (Q3→Babylon axis swap is done manually at load) |

### Behavioral hot spots to validate (not expected to break, but owed a pass)

1. **Custom GLSL `ShaderMaterial`s** — voltaic beam, electrobolt rail, muzzle
   flash (thin-instanced batches, custom attributes `iStartSeed/iEndImpact/…`,
   `ALPHA_PREMULTIPLIED`, `forceCompilationAsync` prewarm). Attribute/define
   plumbing is the most version-sensitive thing we own. Unit suites cover
   lifecycle; look is a browser pass.
2. **NullEngine suites** (134 files / ~1500 tests) — our broadest automatic
   safety net; any 9.x NullEngine regression shows up here immediately.
3. **v4 procedural pickups** — `FresnelParameters` (emissive + opacity) and
   `enableEdgesRendering()` (edge line width semantics), clone-of-prototype
   geometry sharing.
4. **PostProcessingManager** — `DefaultRenderingPipeline` (bloom/exposure/
   contrast + RenderVars multipliers stash/restore).
5. **Q3 shader parser → StandardMaterial** — alpha modes, `transparencyMode`,
   lightmap/emissive levels, `material.freeze()` interplay.
6. **Loaders** — MD3 is our own loader (unaffected); GLB weapons/models go
   through `@babylonjs/loaders` (9.x added animation retargeting — additive,
   but confirm GLB skeleton/animation groups still bind identically).
7. **Havok** — `@babylonjs/havok` versions independently; keep 1.3.11 and
   verify the plugin still initializes (client-side pickups/ragdoll only; the
   server sim does not use it, so determinism is out of blast radius).
8. **Thin instances** — buffer update paths (`thinInstanceSetBuffer` /
   `thinInstanceBufferUpdated`) used by every effect renderer.

---

## What 9.x gives us (relevant subset)

| Feature | Relevance |
|---|---|
| **Clustered lighting** (`ClusteredLightContainer`, WebGL2 **and** WebGPU) | **The headline for us.** Replaces the light-scarcity system: `DynamicLightSafety` clamps materials to 2 lights (Standard) / 1 (PBR); weapon effects ration a 4-light `PointLightPool`; `EffectPreloader` pre-warms light×material shader permutations to hide recompile hitches. Clustered lighting removes the cap (hundreds of lights), removes most permutation recompiles, and turns rationing code into dead weight. FPS win + un-sacrifices a feature. WebGL2 path uses textures (no storage buffers needed); WGSL caveat applies only to node materials on WebGPU (we use none for lit surfaces). |
| **WebGPU maturity + snapshot rendering** | Enables the staged `r_webgpu` experiment (see plan §Phase 3). Background pipeline compilation attacks the first-shot shader hitch class at the driver level. Snapshot rendering is for mostly-static scenes → menus/lobby/post-match diorama only, never gameplay. |
| **Outline renderer** (new in 9.0) | Potential replacement/upgrade for our cel/team-outline presentation (RemotePlayerRenderer team outlines, post-match showcase styling). Evaluate after upgrade — could simplify custom outline code. |
| **Nav mesh improvements** (9.0) | Flagging for the **bot-improvements work**: Babylon 9's nav-mesh system upgrades (pathfinding accuracy + performance) may be useful alongside/instead of parts of `BotNavGraph`. Not part of this upgrade's scope; worth a look once on 9. |
| **SDF text rendering** | Resolution-independent text — possible future HUD/nameplate quality win. Not scoped. |
| Frame Graph v1, OpenPBR, IBL shadows, particles, geospatial/floating origin | Not needed now. Frame graph (up to ~40% GPU memory savings) worth revisiting if our post pipeline grows. |

---

## Upgrade plan

### Phase 0 — mechanical bump (1 session)

1. Branch (per current workflow: whatever feature branch is active — do **not**
   mix with unfinished bot work in the same commit).
2. `package.json`: `@babylonjs/core` + `@babylonjs/loaders` → `^9.17.0`
   (keep `@babylonjs/havok` at 1.3.11 unless install warns). `npm i`.
3. Gates, in order:
   - `npx tsc --noEmit` (outer + `src/games/fps`) — if typings demand it, bump
     TypeScript here (isolated commit).
   - `npm run test:run` — the 134 NullEngine suites are the real audit.
   - `node scripts/biome-gate.mjs`.
   - `npm run server:tick` — expected untouched (no Babylon in the sim path).
   - Headless smokes: `npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"`,
     `sim replay` movement smoke.
4. Fix fallout; commit fps-first if submodule files are touched.

### Phase 1 — browser validation pass (playtest checklist)

- Map load (wdm2 + one companion map): world materials, lightmaps, skybox,
  patches, fog.
- Weapons: voltaic beam, electrobolt rail, muzzle flashes (all styles), tracers,
  explosions — first-shot smoothness (prewarm still effective).
- Procedural pickups v4: fresnel shell grading, edge-line width, collect burst.
- Post pipeline: bloom/exposure/contrast + `r_*` multipliers round-trip.
- Post-match: diorama camera, showcase model, dances, endgame music (audio
  engine was "refined" in 9.0 — verify `AudioManager` playlists unaffected).
- GLB weapon viewmodels + player models (skins, animation groups, sockets).
- Demos: record + playback (presentation-only paths).

### Phase 2 — cash in: clustered lighting (1–2 sessions)

1. Introduce a `ClusteredLightContainer` per scene; route map `PointLight`s and
   the effect/pickup/charge-glow lights into it.
2. Retire the scarcity layer: `DynamicLightSafety` clamps →
   no-op/delete; `PointLightPool` becomes a plain allocation cache (keep
   pooling, drop rationing); `EffectPreloader` light-permutation warmups
   reduced to the single clustered variant.
3. Visual pass: corridors with rocket + muzzle + pickup glows simultaneously —
   the previously-dropped lights now render; tune intensities down where the old
   clamp was acting as an accidental art direction.
4. Perf capture before/after (see Measurements).

### Phase 3 — staged WebGPU experiment (separate cycle)

- `r_webgpu` cvar (default 0): `WebGPUEngine` via async factory with automatic
  WebGL2 fallback; GLSL `ShaderMaterial`s run through Babylon's runtime
  GLSL→WGSL conversion — the flag exists precisely to validate that conversion
  on our four custom shaders before any default flip.
- Snapshot rendering evaluated only for lobby/menu/diorama scenes.

### Rollback

Single-commit revert of the package bump (lockfile included). No data or asset
migrations anywhere in the plan; Phase 2 is a separate commit chain on top.

---

## Measurements to capture

- Before/after FPS + frame-time p95 on: dev desktop GPU and one iGPU laptop,
  same map/route (the bandwidth-bound iGPU case is the target audience).
- Shader-compile hitch count around first shots (DevTools performance trace)
  pre/post clustered lighting.
- `EffectPreloader` warmup time (it shrinks when light permutations collapse).
- Bundle size delta (ESM tree-shaking should keep it near-flat; verify
  `npm run build` output sizes).

## Open questions

1. Does Babylon 9.17 typings require TS > 5.2? (Resolved in Phase 0 step 3.)
2. `ClusteredLightContainer` + `material.freeze()` interaction — do frozen
   materials pick up cluster texture updates without unfreeze? (Test in
   Phase 2; worst case: unfreeze world materials once at map load — they were
   only frozen to skip dirty-checks, and clustered lighting removes the
   per-light define churn that made freezing valuable.)
3. Havok 1.3.11 against core 9.x — plugin API is stable, but confirm at
   `npm i` (peer warnings) + ragdoll/pickup-toss smoke.
4. Audio engine "refinements" in 9.0 — any behavior change in `Sound`/streaming
   used by `AudioManager` playlists?

## Sources

- npm registry: `@babylonjs/core` latest **9.17.0**; 9.16.x published 2026-07
- [Babylon.js 9.0 announcement (Medium)](https://babylonjs.medium.com/welcome-to-babylon-js-9-0-c3edc9ee6428) — clustered lighting (WebGL2+WebGPU), frame graph, 9.0 feature set
- [Announcing Babylon.js 9.0 — Windows Dev Blog](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/) (2026-03-26) + [Part 3: engine updates](https://blogs.windows.com/windowsdeveloper/2026/04/02/part-3-babylon-js-9-0-openpbr-and-additional-engine-updates/) — outline renderer, SDF text, nav mesh, audio refinements
- [Official breaking-changes doc](https://doc.babylonjs.com/breaking-changes/) — newest entry 8.10.1; nothing listed for 9.x
- [Babylon.js CHANGELOG](https://github.com/BabylonJS/Babylon.js/blob/master/CHANGELOG.md) — 9.0.0 section is bugfix-level
- [Forum: Breaking Changes in 9.16.x](https://forum.babylonjs.com/t/breaking-changes-in-version-9-16-x/63772) — UMD ES2015 enforcement (ESM consumers unaffected)
- [Clustered Lighting docs](https://doc.babylonjs.com/features/featuresDeepDive/lights/clusteredLighting/) + [feature thread](https://forum.babylonjs.com/t/clustered-lights-support/56111) — `ClusteredLightContainer`, WebGL2 texture path, WGSL-for-node-materials caveat
- [WebGPU Support](https://doc.babylonjs.com/setup/support/webGPU) / [Snapshot Rendering](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering)
