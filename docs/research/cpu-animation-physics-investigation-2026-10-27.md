# CPU investigation: animation and physics

Date: October 27, 2026. Babylon 9.31.2. Initial research used reversible probes;
the first cache-animation implementation is recorded below. Follow-up to the
[CPU study](cpu-optimization-study-2026-10-27.md).

The follow-up [implementation options and decision matrix](cpu-animation-physics-solutions-2026-10-27.md)
compares code changes, WebAssembly, workers, baked bone textures and compute
shaders, including actual player-pack storage estimates and integration blockers.

## Findings and order of work

| Priority | Finding | Evidence | Decision |
| --- | --- | --- | --- |
| 1 | Hidden pickup-source GLBs run constant imported animations | Six disabled sources, 150 constant channels; reversible A/B removed their work | First implementation: settle constant source clips and stop them; preserve meaningful/uncertain animation |
| 2 | Ragdoll world-space bone writes repeatedly rebuild the rig | About 15 full absolute-matrix rebuilds per sync on a 65-bone rig | Implemented: batched visual pose with real-rig parity and unchanged Havok |
| 3 | Linked bones can rebuild skin matrices even without pose changes | Installed source, headless reproduction, then 87% of real builds found redundant | Implemented: linked-value equality gate; builds 3.7 → 0.75 per frame |
| 4 | Hidden one-shot animations remain possible | One hidden one-shot observed; the visibility path controls the locomotion group | Lower priority: quantify, then preserve the action clock/expiry when suppressing evaluation |
| Hold | Disabling ragdoll pre-step removes writes but changes physics | Synthetic same-configuration control matches; modified trajectory differs | Do not ship as a transparent CPU optimization |
| Rejected lead | Static bodies need redundant transform syncing | Observed static bodies already disable both pre-step and sync | No blanket static-body patch needed |

These are not equivalent costs. Player movement/prediction uses the deterministic
shared simulation; the Havok work below concerns scene rigid bodies. Reducing
ragdoll visual work does not require changing movement frequency or collision rules.

## Capture method and limits

The existing dm5 six-player FFA fixture was replayed with the profiler extended
in ignored `.cache/cpu-study/`. Probes wrap scene animation, skeleton preparation,
absolute-matrix rebuilds, ragdoll sync, Havok stepping and body transform transfers.
State samples every 500 ms record body motion types, active rigs and playing groups.
Class identity comes from actual loaded instances, avoiding duplicate Babylon
modules in the probe.

Two traces were retained:

- `2026-10-27-animation-physics-webgl2`: CPU sampler plus wrappers; stable source
  but **invalid replay**, because a stall skipped recorded frames/events. Diagnostic
  structure only; it cannot establish normal event density or timing improvements.
- `2026-10-27-animation-physics-counts-webgl2`: sampler disabled, wrappers retained;
  **complete, valid replay, stable source** at engine `460ad5f5`, FPS `ca018d1`.
  The launcher flag `--timing-only` disables its V8 sampler, not these custom
  wrappers. This remains an instrumented diagnostic, not a clean timing baseline.

Raw profiles, trace JSON, screenshots and copied probe sources are under
`public/data/benchmarks/results/` in those directories. The
[extracted evidence](cpu-evidence/2026-10-27-animation-physics.json) includes raw
checksums, phase counts, group identities, A/B results and synthetic experiments.
The machine is the same Ryzen 7 7700X / RTX 4070 SUPER used by the CPU study.

Illustrative inclusive wrapper ms per measured frame in the valid counts trace:

| Phase | Animation evaluation | Skeleton prepare | Havok execute | Native world step | Ragdoll bone sync |
| --- | ---: | ---: | ---: | ---: | ---: |
| Freefly start | 0.274 | 0.522 | 0.346 | 0.234 | 0.097 |
| POV gunplay A | 0.353 | 0.479 | 0.270 | 0.158 | 0.061 |
| Freefly return | 0.312 | 0.449 | 0.283 | 0.183 | 0.078 |
| POV gunplay B | 0.301 | 0.264 | 0.196 | 0.130 | 0.044 |

Do not add these columns: native stepping is inside Havok execute, and wrapper
spans are inclusive. Instrumentation, state sampling, body population and camera
phase affect the values. Structural call counts are stronger evidence than the
last decimal of these timings. This round does not establish a gameplay FPS gain
or a WebGL/WebGPU speed ratio. The identified JavaScript paths are shared, but
these new browser probes ran WebGL2 only.

## 1. Constant animations on hidden cached models

[AssetPreloader](../../src/engine/loader/AssetPreloader.ts) imports pickup GLBs
through `ImportMeshAsync`, then disables their roots and meshes for caching.
It retains their `animationGroups` without stopping them. Its pickup clone path
returns an empty animation-group array. Disabling the source hierarchy does not
stop scene-owned animation evaluation.

The inspected templates were:

| Source | Playing imported group | Channels | Channels with identical values at every key |
| --- | --- | ---: | ---: |
| Voltaic | `AWeapon` | 21 | 21 |
| Electrobolt | `AWeapon` | 21 | 21 |
| Plasmagun | `AWeapon` | 27 | 27 |
| Rocket launcher | `AWeapon` | 27 | 27 |
| Grenade launcher | `AWeapon` | 27 | 27 |
| Riotgun | `AWeapon` | 27 | 27 |

All six roots were disabled. These are cached pickup sources, not a count of guns
visible on screen. The check compared authored key values; it does not prove that
every custom asset the loader may encounter is constant.

A separate fresh headless Edge session loaded the real dm5 demo, played it,
paused at a fixed playhead, and ran A–B–B–A intervals. A restarts the originally
playing template groups; B stops only those groups. Each measurement follows a
600 ms settling interval and lasts about four seconds. Other animation groups,
rendering and normal demo pause behavior remain present in both states.

| Interval | Template groups | Scene animation calls | Active animatables | Mean `scene._animate` ms |
| --- | --- | ---: | ---: | ---: |
| A1 | Running | 660 | 634 | 0.284 |
| B1 | Stopped | 654 | 484 | 0.209 |
| B2 | Stopped | 662 | 484 | 0.208 |
| A2 | Restored | 661 | 634 | 0.296 |

The playhead was identical in all four intervals. Stopping the groups removed
150 active animatables; restoring them restored both the count and the higher
animation cost. This is roughly 0.08 ms per animation call in this paused scene,
not a promise of that exact saving during every game frame. The browser recorded
no runtime exceptions or HTTP failures.

The raw A/B `stableSource` flag is false because another agent committed the
highlight-export document during capture. A read-only Git comparison verified
that the only path changed between its two HEADs was
`docs/research/highlight_video_export.md`; runtime worktree diffs were empty at
both boundaries and the FPS commit was unchanged. The extracted evidence records
the raw flag and this runtime-equivalence check separately.

### First implementation

Template ownership is explicit at the pickup GLB import boundary in
`AssetPreloader`. Active groups containing only constant transform curves settle
their authored pose once, then stop without animation-end callbacks. If any
active group is not proven constant, the source keeps its active set unchanged.
This preserves animated custom pickups whose clones share the source skeleton.

The conservative check accepts owned TransformNode position/rotation/scale
channels with identical Vector3/Quaternion values and cycle playback. Tangents,
events, blending, weights, additive playback, animation overrides, observed
group end/loop behavior and unknown targets retain the existing path. A constant
cubic curve may therefore keep running; equal endpoints alone cannot prove it
constant between keys. Attachment points are collected after settling the pose.

Do not globally disable GLB animations in `ModelLoader`: visible viewmodels,
barrels and independently animated assets have different lifetimes.

[ModelInstanceCache](../../src/engine/loader/model/ModelInstanceCache.ts) already
captures source autoplay state, stops source groups, and starts the appropriate
clone groups. Preserve that policy. Verify pickup clone skinning/attachment poses
and map reload/disposal. Custom animated pickups need an explicit intended
ownership policy; do not assume every future asset has constant channels.

`AssetPreloaderAnimations.test.ts` exercises the import/cache boundary with real
Babylon groups and a linked skeleton on NullEngine. It covers first-frame pose
settling, stable clone skin matrices, source cleanup with a surviving clone,
cache reuse, unrelated held animation, and preservation of changing, cubic,
event-bearing and blended curves. The focused loader/cache run passed 24 tests
across four files. Full gates and browser checks are recorded below.

## 2. Ragdoll pose transfer rebuilds the skeleton repeatedly

The installed `Physics/v2/ragdoll.js` synchronizes each collider orientation by
calling `Bone.setRotationQuaternion(..., Space.WORLD, rootTransformNode)`.
That conversion reads absolute bone/parent matrices, then marks the rig dirty.
The next world-space bone write can rebuild the entire absolute hierarchy again.

The real Vanguard ragdoll has **65 bones and 15 collider-controlled bones**.
The valid trace measured 14.996–14.998 dirty full-rig rebuilds per ragdoll sync
across the four phases. At that structure, about 975 bone visits are implied
per sync, before other pose/render work. The trace estimates visits from dirty
full-rig rebuilds and bone count; it does not instrument every recursive visit.

A direct 64-bone headless reproduction separately counted 960 recursive bone
visits for 16 world-space rotation writes, supporting the mechanism. This is a
real repeated-work candidate, but the observed average ragdoll-sync span was only
about 0.044–0.097 ms/frame in this fixture. Do not turn a structural improvement
factor into an equally large whole-frame claim.

### Batched visual pose experiment

The retained [batched-bone proof](cpu-evidence/batched-bone-proof.mjs) compares
native world-space writes against parent-first conversion into local rotations.
In 32 seeded synthetic trials, each with 64 bones and 16 controlled rotations:

- native path: 512 dirty absolute rebuilds, including final preparation;
- batched local-write path: 32 rebuilds;
- maximum absolute bone-matrix component difference: `9.5367431640625e-7`.

The proof covers positive uniform mesh scale and arbitrary tested rotations.
It does not cover Vanguard's bind conventions, negative/nonuniform scale, root
position transfer, contact simulation or visual parity in auxiliary render passes.

Conceptual implementation, not a ready replacement:

```typescript
// Cached rig order, collider mappings, bind corrections and scratch arrays.
readColliderPoses();
for (const bone of parentFirstRig) {
  // Include all ancestors, even those without a collider.
  const parentWorld = resolvedParentRotation(bone);
  const desiredWorld = colliderRotationOrInheritedPose(bone, parentWorld);
  const desiredLocal = inverse(parentWorld) * desiredWorld;
  writeLocalRotationWithoutReadingAbsoluteMatrices(bone, desiredLocal);
}
writeRootPositionWithCorrectMeshSpaceConversion();
prepareAbsoluteHierarchyOnce();
```

An initial adapter could live beside `RagdollSystem`, for example
`src/games/fps/client/ragdoll/BatchedPoseSync.ts`. Keep Havok simulation intact;
this experiment concerns the visual bone transfer. If replacing Babylon's built-in
sync, use its public `pauseSync` ownership switch and install/clean up the game
adapter at the same render stage. Production code should not monkey-patch
`node_modules` or depend on the probe's private-field introspection.

### Batched visual pose: implementation

[BatchedPoseSync](../../src/games/fps/client/ragdoll/BatchedPoseSync.ts) takes
the visual transfer over from Babylon's built-in sync through `pauseSync`, on the
same `onBeforeRenderObservable` stage, right after `ragdoll()`. Each frame it
reads the collider rotations, walks the rig parent-first (including bones without
a collider), writes local rotations and the root position, and rebuilds the
absolute hierarchy once. Havok bodies are untouched.

It declines, leaving Babylon's sync in charge, when the rig has linked transform
nodes, a pose matrix, a mirrored/nonuniform/sheared mesh or bone transform, a
duplicate or missing collider bone, or a configured bone whose configured
ancestor comes after it. A later frame whose mesh scale stops qualifying uses the
native world-space setters on that frame and returns to batching when the scale
does. Disposing the ragdoll, the adapter or the mesh hands `pauseSync` back.

Headless tests ([BatchedPoseSync.test.ts](../../src/games/fps/client/ragdoll/__tests__/BatchedPoseSync.test.ts))
use the real Vanguard rig (65 bones, 15 colliders, extracted to a fixture) on
NullEngine with Havok:

| Check | Result |
| --- | --- |
| 100 random collider poses at three yaws with a rotated root | Absolute matrices within 1e-5, sockets within 0.001, skin palettes within 1e-5 |
| Hierarchy rebuilds per sync | One |
| Mirrored, nonuniform or parent-scaled mesh at creation | Declines; `pauseSync` and observers unchanged |
| Mesh scale changed after creation, then restored | Matches native on every frame |
| 500-step contacting fall at 125 Hz | Collider positions, rotations and velocities exactly equal to native |
| Disposal, double disposal, mesh disposal | Observers removed, `pauseSync` released |

Browser check (headless Edge, RTX 4070 SUPER, `washoi_dm5_ffa_20261025_170933`
demo, WebGL2 and WebGPU):

| Check | WebGL2 | WebGPU |
| --- | --- | --- |
| Ragdolls batched / created in 20 s | 7 / 7 | 7 / 7 |
| Sync per ragdoll per frame, native → batched, same rig and colliders, five rounds of 400 | 36–57 µs → 5–9 µs (two sessions) | 35–49 µs → 5–8 µs |
| Paused frame aimed at a ragdoll, batched again (noise) | Identical | Identical |
| Same frame after handing the ragdoll back to native sync | Ragdoll identical; 0.016% of pixels differ, all in the HUD's FPS counter and a fading kill-feed line | Identical |

The native timing includes one `computeAbsoluteMatrices()` after the native
writes, so both sides end with a prepared hierarchy. In both modes the same two
of twelve ragdolls fell out of the map (hips from y ≈ 50 to below −7,600), so
that is the demo's own deaths, not the adapter.

At four ragdolls, the cap, the saving is roughly 0.1–0.2 ms a frame. Live death,
slow motion, seek and repeated maps were not driven separately; demo playback
covers death, pause and expiry.

## 3. Pose stepping and skin-matrix preparation are separate

[PlayerModelManager](../../src/engine/animation/PlayerModelManager.ts) already
steps medium-distance locomotion at the selected pose rate and pauses off-screen
locomotion. Existing tests cover the sampled clip phase, speed changes and
one-shot ownership. Those safeguards should remain.

However, the installed `Skeleton.prepare()` copies linked TransformNode position,
rotation and scale into bones before checking dirty state. The setters mark bones
dirty even when values match. Consequently a paused/stepped clip can avoid curve
evaluation while still rebuilding skin matrices when its visible mesh is prepared.

The [linked-bone proof](cpu-evidence/linked-bone-prepare-proof.mjs) holds one
linked bone's input pose unchanged for 16 render IDs. It observes 16 skin-matrix
builds. An unlinked control observes zero after settling. **Unlinking bones is a
diagnostic control, not a proposed fix**: glTF animation depends on those links.

The full-game trace measures skeleton preparation but does not attribute each
skin-matrix upload to a particular stepped actor. Next measure actual Vanguard
`_computeTransformMatrices` calls and texture uploads between pose samples.
Only then consider an instance-owned pose-version gate for stepped actors. It
must invalidate on one-shots, clip switches, root-motion correction, scale/pose
changes and transitions back to full-rate evaluation. A global skeleton freeze
would be unsafe.

### Skin preparation gate: measurement and implementation

Measured first, with the dm5 FFA demo on WebGL2 (12 s windows, 93–106 fps): 45
skeletons rebuilt about 1,130–1,220 palettes a second, and 87% of the builds had
linked inputs identical to the same skeleton's previous build. Player skeletons
(65 bones, 20–30 µs a build) were 61–87% redundant; weapon and pickup skeletons
(1–9 bones, about 4 µs) 98–100%. Every gated skeleton in play had all bones
linked, `needInitialSkinMatrix` off, quaternion rotations and a matrix texture;
ragdolls had none linked.

[SkinPreparationGate](../../src/engine/animation/SkinPreparationGate.ts),
installed by `createBrowserScene`, wraps each skeleton's `prepare()`. With every
bone linked, the palette is a function of the linked position, rotation and
scale values alone; the gate compares them with the values of the last build
and calls Babylon's `prepare()` only on a change. An unlinked bone, an Euler
node rotation or `needInitialSkinMatrix` leaves the skeleton to Babylon. It
writes no Babylon state. [Its tests](../../src/engine/animation/__tests__/SkinPreparationGate.test.ts)
check builds against changes, a frame-by-frame palette match against an
ungated twin, the ragdoll and Euler fallbacks, forced preparation and scene
installation.

Browser check, same demo and machine:

| Check | WebGL2 | WebGPU |
| --- | --- | --- |
| Skin preparation, alternating 1 s windows, 12 s each mode | 0.096 → 0.048 ms/frame | 0.146 → 0.055 ms/frame |
| Palette builds per frame | 3.6 → 0.7 | 3.9 → 0.8 |
| Palettes prepared in a frame against a native rebuild from the same nodes | About 82,600 checked; only the frame below differs | About 26,650 checked; only the frame below differs |

The palette check found one differing frame per run, on `player_2` about
40 s into the demo, with about 50 bones' nodes changed after that skeleton had
prepared. The same check with the gate removed finds the same frame, skeleton
and drift, so it is how that frame is written, not the gate.

The saving scales with the number of animated models in view; the earlier
census window (about 12 builds per frame) suggests roughly 0.15 ms there. A
revision gate driven by every pose writer could also skip the comparison, but
needs every writer to take part.

## 4. Physics pre-step is not a behavior-free toggle

Babylon initially creates ragdoll colliders as animated bodies with pre-step
enabled. Entering ragdoll mode changes them to dynamic bodies without disabling
that pre-step. The trace observes 15 pre-step and 15 sync calls per active
ragdoll per physics step. The physics plugin's teleport pre-step writes the node
transform back to the body before advancing Havok.

The [Havok proof](cpu-evidence/havok-prestep.mjs) runs a three-body jointed ragdoll
over a floor for 1,200 steps at 125 Hz:

| Check | Result |
| --- | --- |
| Two unchanged control runs | Exact matching recorded components |
| Baseline pre-step calls | 3,600 |
| With pre-step disabled | 0 |
| First component difference above `1e-4` | Step index 121 |
| Maximum position-component difference | 0.05356 synthetic world units |
| Maximum linear-velocity-component difference | 3.5374 units/second |

These are contact-sensitive trajectories. Quaternion component differences are
also recorded, but quaternion signs make raw component differences unsuitable as
orientation-error measurements. The position/velocity result alone rejects this
as a proven equivalent optimization. It might be a deliberate physics behavior
change in a later task; that is a different acceptance decision.

Static bodies are already guarded: a sampled scene with 131 static bodies and no
ragdolls had no body pre-step/sync work enabled. In the measured trace, no static
body sync calls were recorded. Avoid attributing all scene-body count to repeated
transform transfers.

## Validation and remaining work

Commands run from the assembled root:

```powershell
npm.cmd run test:run -- src/engine/__tests__/PlayerModelPoseStepping.test.ts src/engine/__tests__/PlayerModelClipGroups.test.ts src/engine/__tests__/PlayerModelDisposal.test.ts src/games/fps/client/__tests__/DemoAnimationTimeline.test.ts
node docs/research/cpu-evidence/batched-bone-proof.mjs
node docs/research/cpu-evidence/havok-prestep.mjs
node docs/research/cpu-evidence/linked-bone-prepare-proof.mjs
```

The focused headless suite passed all 14 tests. It logged the existing duplicate
`SHAG_renderer_light_policy` extension-registration warning. The retained
reproductions run on NullEngine; Havok uses the local WASM bytes, not a remote
fetch. Syntax, research links and evidence checksums were also checked.

Browser commands (ignored scratch harnesses, copied with raw evidence):

```powershell
node .cache/cpu-study/profile-animation-physics.mjs --fixture wdm5-ffa6-v1-f0615d305875-006f520e --backends webgl2 --port 3170 --out public/data/benchmarks/results/2026-10-27-animation-physics-webgl2
node .cache/cpu-study/profile-animation-physics.mjs --fixture wdm5-ffa6-v1-f0615d305875-006f520e --backends webgl2 --port 3170 --timing-only --out public/data/benchmarks/results/2026-10-27-animation-physics-counts-webgl2
node .cache/cpu-study/cache-animation-ab.mjs
```

The first browser trace failed replay validity and remains marked as such; the
second passed. The A/B run's documentation-only HEAD change is qualified above.
The initial investigation did not implement a runtime optimization or deploy
to production. The following section records the first implementation's checks.

## First implementation validation: constant pickup sources

The [validation record](cpu-evidence/2026-10-27-pickup-source-validation.json)
contains commands/results, runtime source identity and the selected raw-report
checksum. Engine source changed only in `AssetPreloader.ts`; the new NullEngine
test uses `AnimationEvent`, requiring one generated Vite dependency-list entry.
The model-loading manual and alpha.7 changelog describe the cache policy.

| Command from assembled root | Result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run test:run` | 743 files passed; 5,776 tests passed, one skipped |
| `npm.cmd run gate:biome` | Pass, baseline unchanged: zero errors, 47 warnings |
| `npm.cmd run build` | Production build and sourcemap relocation completed |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass, expected position diagnostic |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass, matching deterministic checksums |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass, zero errors and matching repeated checksum |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Pass, 7,475 faces |

The first full-suite attempt found the missing generated `AnimationEvent`
dependency. `npm.cmd run deps:babylon` added that entry and the full rerun passed.
PowerShell stderr redirection reported shell errors for otherwise successful
test/build output; their complete runner/postbuild summaries were checked.
Subsequent redirected commands explicitly returned `$LASTEXITCODE`, including
a confirming manual build. This was a capture-wrapper issue, not a hidden test
failure.

The completed browser command was:

```powershell
node .cache/cpu-study/pickup-source-verified.mjs
```

Its copied harness/helper, raw JSON and screenshots are retained under
`public/data/benchmarks/results/2026-10-27-pickup-source-verified/`. It creates
an isolated real-GPU scene and calls the actual pickup preloader on the six
published weapon GLBs, then creates live clones. It is not a full gameplay
replay or a timing benchmark. WebGL2 was checked by `webGLVersion === 2` and
WebGPU by `isWebGPU`; inherited engine class names alone are insufficient.

| Check | WebGL2 | WebGPU |
| --- | ---: | ---: |
| Cached GLB sources | 6 | 6 |
| Active source channels after normal preload | 0 | 0 |
| Active source channels after restarting the clips as a control | 150 | 150 |
| Active source channels after applying settlement again | 0 | 0 |
| Source poses, attachment values and skin palettes equal across states | Exact match | Exact match |
| Live clones sharing a source skeleton observed | Yes | Yes |
| Runtime exceptions / HTTP failures | 0 / 0 | 0 / 0 |

Runtime source remained stable throughout the selected run. Each backend retained
six existing `/skins/0: Failed to find common root` warnings. Earlier harness
attempts are excluded: the full-demo attempt did not finish; an isolated attempt
used duplicate Babylon imports; another assumed the wrong engine class name.
The selected run uses Vite-resolved Babylon modules consistently.

The owned browsers and Vite server were closed after capture. Full-game Quick
Play/spectating, weak-hardware timing, arbitrary custom assets and production
deployment remain unverified for this implementation. Moving/cubic/event/blending
custom-source behavior is covered by headless tests. Batched ragdoll visual
synchronization followed; see [its implementation](#batched-visual-pose-implementation).
