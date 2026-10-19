# Firefox WebGL profiling — v0.9.36

Date: 2026-10-19. Both repositories: `v0.9.36-firefox-webgl-profile`, from
engine `1e58122c` and FPS `17a9298`. This follows the v0.9.35 renderer, projectile
and weapon-preview fixes. WebGL is the target; no input/network rules changed.

## Result

Implemented one bounded optimization: Firefox WebGL remote held weapons reuse
their source's read-only native PBR materials. Each weapon still gets independent
meshes, transform nodes, skeletons and animation groups. Mesh outlines and hand
attachment remain per player. Chrome and WebGPU retain independent materials.

This reduces weapon setup work. It is **not** an established overall FPS gain:
the combat recordings still stalled/skipped frames, and broad wall times varied
substantially between captures. No quality setting or soft-particle effect was
disabled to obtain the saving.

## Environment and profiling

- Windows, Firefox 158, Chrome 155, Babylon 9.17, private browser profiles,
  headless WebGL2. The machine's RTX 4070 SUPER / ANGLE D3D11 was established in
  the [previous investigation](firefox_performance.md); this round did not repeat
  the unsanitized-adapter experiment.
- Private no-HMR Vite on loopback port 3100. GPU captures ran sequentially;
  user browser sessions and existing services were left alone.
- Fixed combat fixture: `wdm2-ffa10-v1-8c2e550fe162-e13755ef`, same 60-second
  source recording SHA-256
  `8c2e550fe16229615104dc13c4ee18d57ea42f1af3b40b6f8ed098eae6985662`.
  Twenty measured seconds, 2250×1084, ten recorded players, alternating saved
  freefly/first-person views, SSR/glow/day-night off and normal outlines on.
- Function wrappers locate CPU work. Inclusive times overlap and cannot be
  added, and profiling overhead prevents treating them as uninstrumented FPS.
  Firefox also coarsens CPU clocks. Native Linux was not measured.

The updated baseline profile measured these inclusive costs:

| Function/pass | Firefox ms/frame | Chrome ms/frame |
| --- | ---: | ---: |
| `Scene.render` | 18.765 | 10.166 |
| `Scene._evaluateActiveMeshes` | 3.956 | 2.466 |
| `RTT.q3-soft-depth` | 1.891 | 1.112 |
| `PBRMaterial.bindForSubMesh` | 1.778 | 1.137 |
| `Mesh.computeWorldMatrix` | 1.828 | 0.985 |
| `Mesh.clone` | 0.884 | below the leading entries in the summary |

Firefox baseline repeat medians were 21/21 ms; both were invalid because playback
skipped frames/events after stalls. Chrome repeats were valid at 14.70/14.15 ms.
These are reproduction/attribution observations, not an accepted browser speed
ratio. The route also retains the earlier visual-acceptance limitation.

## Why weapon materials can be shared

`RemotePlayerRenderer.updateWeaponModel` clones a cached source on weapon
switches. Its weapon styling changes mesh outline properties, rather than
individual material colors. The native weapon materials therefore need no
per-player copies. The cache's source remains in the scene, and the existing
`disposeModelResources` ownership scan keeps a shared material while another
source/instance still renders with it.

`ModelInstanceCache` now accepts an opt-in `shareStaticMaterials` constructor
option, default off. Sharing is restricted to native PBR materials with their
native clone implementation, no material or texture animations, and model
animation groups whose targets are all transform nodes. Unsupported or animated
materials use the original clone path. Callers opting in must keep the shared
material properties read-only. No material is frozen by this change.

Only the remote-weapon cache opts in, on `Firefox/` user agents with a non-WebGPU
engine. Browser/backend tests exercise two actual remote weapons: Firefox WebGL
shares materials while Chrome WebGL and Firefox WebGPU keep separate materials;
the attached weapon roots stay independent in every case.

### Alternating actual-asset setup test

The browser loads the packaged rocket launcher through the normal model loader:
six meshes, five PBR materials and a nine-bone rig, with transform-node animation
targets. Forty cached create/dispose lifecycles per block, in order
off/on/on/off/off/on/on/off, in the same scene. A counter on the actual material
prototype records clone calls. The first discarded probe counted a different
module's prototype; its zero counters are not evidence and are not used here.

| Browser | Off block times (ms) | On block times (ms) | Median ms/lifecycle, off → on |
| --- | --- | --- | --- |
| Firefox | 442, 453, 339, 254 | 418, 245, 265, 216 | 9.76 → 6.38 |
| Chrome (forced diagnostic option) | 245.1, 192.9, 199.3, 201.1 | 167.9, 177.5, 166.4, 145.6 | 5.00 → 4.18 |

Every off block creates **200 PBR material clones**; every on block creates
**zero**. Scene counts return to the same nine materials, seven meshes, one
skeleton and one animation group after each block. These counts include the
retained source and the scene's existing resources. The Firefox median lifecycle
cost falls about 35% in this microbenchmark. It includes setup and cleanup,
excludes initial import, and must not be translated into an FPS percentage.
Chrome's forced-option diagnostic is not its product default.

### Actual-asset rendering comparison

On both Firefox and Chrome WebGL, an isolated scene renders the same packaged
rocket launcher with sharing off/on/off. It uses the same source, fixed pose,
camera and two lights, and captures the 960×540 color buffer after readiness.
Each comparison has **zero changed pixels**, maximum channel delta zero, 11,136
active indices and the same nine-bone rig. The image contains the visible weapon;
this is not an empty-frame equality check. A scratch probe initially omitted the
loader's required position argument and failed before rendering; it was corrected
before accepting these results.

The check was then extended to every distinct held-weapon GLB: machinegun,
riotgun, grenade launcher, rocket launcher, plasma gun, Voltaic, electrobolt
and blade (duplicate model paths are tested once). All eight have identical
off/on/off images in both browsers. A further pass renders two independent
instances at different world positions simultaneously, to exercise shared
material binding across meshes. Both browsers pass all 24 captures (eight
weapons × off/on/off), with zero changed pixels, identical active-index counts
per weapon and nonempty rendered images. The paired captures have separate
rigs where the asset has a rig (nine bones for most guns, seven for Voltaic and
electrobolt, and none for the blade).

### Combat control capture

A second function-profile script adds material/cache clone counters. Its control
temporarily forces the cache option off inside `clone`, after the wrapper setup.
The corresponding shared/control windows measured:

| Metric | Sharing | Control |
| --- | ---: | ---: |
| All PBR material clones/s (including other consumers) | 4.12 | 13.70 |
| Model cache clones/s | 3.05 | 3.35 |
| Model cache clone µs/call | 8,388 | 8,987 |
| `Scene.render` ms/frame | 27.25 | 26.83 |

Both captures were invalid as benchmark scores. Shared repeat medians were
42/25 ms, control 36/34 ms; workload presentation and browser execution varied.
The material-clone reduction supports the mechanism, while the wall-time result
does **not** establish a combat FPS benefit or regression. The earlier baseline
also had fewer wrappers; compare its values only as attribution, not as a direct
A/B speed claim.

## Next candidates

1. Weapon-camera candidates: the existing experimental filter avoids running
   world meshes through readiness/world-matrix checks for the weapon camera.
   Repeat paused-view off/on/off tests with identical active sets and pixel
   output before changing its default. No default change was made here.
2. Full remote-weapon instance pooling: material sharing removes only one part
   of setup. Mesh cloning, bounds and skeleton cloning remain. Pooling needs
   explicit ownership across switches, ragdolls, late async loads, showcase and
   map/session disposal. Do not retain bodies or bone attachments accidentally.
3. Soft-particle depth: still about 1.9 ms/frame in the updated Firefox capture.
   It is a real extra scene pass. Reuse/filter/scale experiments need alpha-test,
   camera-switch, depth-edge and visual checks; simply disabling it loses the
   authored intersection fade and was not accepted here.
4. First-use shader stalls: prewarm the actual gameplay light/bone/material
   permutations. Map loading already has a shader/GPU warmup; determine which
   actor/effect permutations appear after that boundary rather than adding an
   indiscriminate second warmup.

## Files and reproduction

Engine:

- `src/engine/loader/model/ModelInstanceCache.ts`
- `src/engine/__tests__/ModelInstanceCache.test.ts`
- `docs/manual/guides/model-loading.md`
- `docs/changelog/v0.9.36.md`
- `docs/research/firefox_performance_v0.9.36.md`
- `docs/research/firefox_performance.md` (follow-up link/status)

FPS:

- `client/RemotePlayerRenderer.ts`
- `client/__tests__/RemoteWeaponLeak.test.ts`

Scratch commands/assets are ignored under `.cache/`:

```text
node .claude/skills/browser-probe/scripts/private-vite.mjs 3100
node .cache/fnprof.mjs firefox ff36-baseline
node .cache/fnprof.mjs chrome ff36-baseline
node .cache/fnprof36.mjs firefox ff36-shared
EXPERIMENT=.cache/ff36-share-off.js node .cache/fnprof36.mjs firefox ff36-control
node .cache/ff36-clone.mjs firefox
node .cache/ff36-clone.mjs chrome
node .cache/ff36-material-qa.mjs firefox
node .cache/ff36-material-qa.mjs chrome
```

The environment-assignment example uses shell shorthand; PowerShell uses
`$env:EXPERIMENT='.cache/ff36-share-off.js'` before launching Node. Chrome uses
`EDGE_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe` similarly.
Reports: `fnprof-*-ff36-*.json`, `ff36-clone-*.json`, `ff36-material-*.json`;
images: `ff36-material-{firefox,chrome}-{0,1,2}.png`. The CPU baseline/CLI logs
are `ff36-headless-{0,1,2}.log`; final gates use `ff36-validation-*.log`.
Extended visual captures use `ff36-allweapons.mjs` and
`ff36-pairedweapons.mjs` with `firefox` or `chrome` arguments. Their JSON and
numbered PNG files use matching `ff36-allweapons-*` and `ff36-pairedweapons-*`
prefixes. `ff36-biome-final.log` records the corrected gate result.

## Validation

The initial headless simulation, physics and indexed `washoi_dm2` load/replay
passed before browser testing. Final validation commands:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test:run` | 5,238 passed, 1 skipped, 5 known editor-asset failures |
| `npm run gate:biome` | Pass after fixing one new test import-order diagnostic: 0 errors, 320/339 warnings |
| `npm run build` | Pass |
| `npm run docs:build` | Pass |
| `npm run test:simulation` | Pass |
| `npm run test:physics` | Pass |
| `npm run server:tick` | Pass |
| `npm run server:fuzz -- --ticks 1000` | Pass |
| `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts --exec 'bsp load washoi_dm2; bsp info; sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'` | Pass; subprocess argument array preserves Windows quoting |
| `npm run test:run -- src/engine/__tests__/ModelInstanceCache.test.ts src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts` | Targeted runs passed; final full suite includes all 15 tests in these files |
| `git diff --check` in each repository | Pass |

The five full-suite failures are missing `textures/blx/blx_grid` in the existing
editor compile fixtures: ConvexCompile ×2, NaturalCompile, PlaytestCompile and
RoundPatchCompile. No other full-suite failure occurred. The full suite is not
reported as green. Commands used `npm.cmd` on Windows and approved execution
outside the sandbox for Vite/esbuild child processes.

Native Linux, complete game-mode visual coverage, dynamic lighting permutations
and production load remain unverified. The isolated captures use fixed poses;
independent rigs and animation targets, async races and disposal are also tested
headlessly. No commit, merge, push or release was requested for this round.
Private profiling browsers were closed and the owned port-3100 Vite server
was stopped after capture; existing user services were left running.
