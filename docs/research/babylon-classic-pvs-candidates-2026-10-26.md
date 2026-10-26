# Primary-view PVS candidate pruning

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`.

The next bounded step after the [bottleneck review](babylon-renderer-new-paths-2026-10-26.md)
is to exclude already hidden, PVS-owned world meshes from Babylon's primary
active-mesh candidates. This works on WebGL2 and WebGPU. It does not implement
a retained draw list or change geometry, visibility decisions or material ordering.

## Ownership and behavior

`BspManager.enablePVS` records the exact camera whose view the culler evaluated.
The candidate filter requires that camera to remain the single primary view.
A temporary foreign camera cannot become eligible merely because an RTT changes
`scene.activeCamera`. Multiple world cameras, absent/invalid PVS, custom LOD
selectors and unmanaged meshes retain the original candidate path. Meshes with
action managers remain candidates because Babylon processes intersection actions
before its visibility and layer tests.

One scene-owned provider composes the PVS and weapon-camera filters. It preserves
the original provider's order, reuses separate camera buffers and observes live
membership on every query. Late meshes and changed action managers need no new
registry. Releasing the PVS lease leaves weapon leases intact; the last release
restores the original provider only if nobody replaced it. Scene-first cleanup
and camera disposal are covered. Full-scene loading readiness remains unchanged.

Only authored static world meshes registered with `PVSCuller` are eligible.
Existing PVS visibility is global; returning the full candidate list for a
secondary camera does not introduce per-view PVS visibility. The provider still
scans the original candidates. Its extra filtering cost must remain part of any
future performance comparison.

## GPU and live evidence

The isolated fixture compares reference and candidate rendering on the installed
Babylon 9.31.2 renderers, using real-GPU headless Edge at 256 × 256. Each backend
passed ten pairs with identical pixel hashes, active-mesh lists and active-index
counts, with nonempty rendered images:

- Primary + weapon views and primary alone.
- Foreign single view and multiple primary views.
- Action-manager mesh and custom LOD selector.
- Late mesh and cluster transition.
- Disabled PVS and unknown camera cluster.

In the primary-only case the hidden world's `isReady` calls drop from one to
zero. The primary + weapon case removes one candidate from the eye list while
retaining the weapon list. The fixture explicitly enables weapon filtering to
exercise composition on both backends; normal weapon-filter defaults are unchanged.

Live probes loaded `washoi_dm5_ffa_20261025_170933.shagdemo` at 960 × 540, waited
for the loading overlay to close, then paused playback. They compare the same
PVS state with only its candidate lease disabled/enabled; PVS visibility itself
stays enabled throughout. Each count window spans 120 rendered frames.

| Measurement | WebGL2 reference → candidate | WebGPU reference → candidate |
| --- | --- | --- |
| PVS cluster / registered world meshes | 16 / 238, unchanged | 16 / 238, unchanged |
| Hidden world candidates per primary pass | 20 → 0 | 20 → 0 |
| Primary candidates per pass | 615 → 595 | 604.7 → 584 |
| Weapon candidates per pass | 615 → 615 | 604.7 → 604 |

The WebGPU reference window includes expiring transient meshes, accounting for
the additional 0.7 difference in both camera lists. Its raw totals are 72,564
reference candidates per camera; the candidate phase has 70,080 primary and
72,480 weapon candidates. Hidden-world totals are exactly 2,400 → 0 in the
primary view and 2,400 → 2,400 in the weapon view. This is evidence for the
specific pruning decision, not whole-scene membership stability across time.

Short CPU samples attribute work without establishing a frame-rate improvement:

| Inclusive sampled milliseconds per observed frame | WebGL2 reference → candidate | WebGPU reference → candidate |
| --- | --- | --- |
| `_evaluateActiveMeshes`, including provider | 1.784 → 1.732 | 2.108 → 1.734 |
| Candidate provider | 0.008 → 0.061 | 0.006 → 0.060 |

These are single sequential, profiled windows with CDP boundary uncertainty,
transient expiry and concurrent headless tests. Inclusive samples overlap and
include profiling overhead. They are unsuitable for an FPS claim or a precise
speedup percentage. The accepted result is bounded work reduction with matched
synthetic output. No render-bundle invalidation cause or replay improvement was
measured.

No failed HTTP requests or browser errors occurred. Existing warnings included
glTF common-root messages, unsupported map entities, a non-flat water fallback
and one missing projectile-spawn event in the WebGPU demo probe. These were not
silently classified as new failures or fixed by this change.

Both live runs recorded stable source during capture at outer HEAD `7e6b56ff`,
with working source fingerprint
`55b85be82c0a3efd7c7d742b574722370c2d918343e2f87c11154e55e67fe58e`.
That working-diff fingerprint includes the other agent's uncommitted `SceneDepthCapture.ts`
work. It is a combined workspace snapshot, not a clean-commit depth baseline.
The isolated fixtures do not use that depth system. FPS remains at
`0759316308429c2ad36aa1e3bda1b111b22016e7`.

## Files and reproduction

Runtime files:

- `src/engine/rendering/SceneMeshCandidates.ts`: shared scene-hook ownership.
- `src/engine/rendering/PvsMeshCandidates.ts`: primary-view eligibility.
- `src/engine/rendering/WeaponCameraCandidates.ts`: existing policy through the shared provider.
- `src/engine/loader/bsp/PVSCuller.ts`: conservative owned-hidden candidate query.
- `src/engine/loader/bsp/BspManager.ts`: PVS view/lease lifecycle.

Validation files:

- `src/engine/__tests__/PvsMeshCandidates.test.ts`.
- `src/engine/rendering/__qa__/PvsCandidatesFixture.ts`.
- `scripts/benchmarks/pvs-candidates.mjs`.

Documentation files in the implementation commit:

- `docs/manual/guides/bsp-system.md`.
- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`.
- `docs/research/babylon-classic-pvs-candidates-2026-10-26.md` (this report).
- `docs/changelog/v1.0.0-alpha.6.md` (only the PVS entry).

The preceding documentation commit `7e6b56ff` reviewed these files separately:

- `docs/research/babylon-renderer-new-paths-2026-10-26.md`.
- `docs/research/babylon-lite-renderer-investigation-2026-10-25.md`.
- `docs/research/v1.0.0-alpha3-performance.md`.

Further depth-pass edits to the first and third of those research files, plus
`docs/manual/guides/shader-system.md`, the depth changelog entry and
`src/engine/rendering/SceneDepthCapture.ts`, belong to the other agent and are
excluded from the PVS commit.

Start the private server, then run these probes one at a time:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3121
node scripts/benchmarks/pvs-candidates.mjs webgl2 fixture 3121
node scripts/benchmarks/pvs-candidates.mjs webgpu fixture 3121
node scripts/benchmarks/pvs-candidates.mjs webgl2 live 3121
node scripts/benchmarks/pvs-candidates.mjs webgpu live 3121
```

The driver writes source identities, counters, hashes and browser diagnostics to
`.cache/renderer-groundwork/pvs-candidates-{mode}-{backend}.json`, with raw CPU
profiles alongside live records. Local game data and the named demo are required.
The live harness replaces the PVS candidate lease through diagnostic access;
it is not a player-facing setting. Production code keeps the default PVS path.

## Validation and remaining scope

| Exact command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run test:run -- --silent=true` | Pass: 738 files, 5,745 passed, one skipped |
| `npm.cmd run test:run -- src/engine/__tests__/PvsMeshCandidates.test.ts src/engine/__tests__/WeaponCameraCandidates.test.ts src/engine/loader/bsp/__tests__/PVSCuller.test.ts --silent=true` | Pass: 41 tests |
| `npm.cmd run gate:biome` | Pass: baseline zero errors, 47 warnings |
| `npm.cmd run build` | Pass: 2,487 modules transformed; existing chunk/externalization warnings |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass: maintained spawn Y |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass: repeat seed checksums match |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass: repeat seed checksums match |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'` | Pass: 7,475 faces |
| `node --check scripts/benchmarks/pvs-candidates.mjs` | Pass |

The four GPU commands above passed. Local raw gate output is saved as
`.cache/renderer-groundwork/pvs-*.log`. The full test suite completed before the
production build to avoid generated-media writes during asset-dependent tests.

Assumption: a single primary world view with an optional weapon camera, following
the existing PVS policy. Broad map/POV coverage, actual reflection/portal scenes,
Firefox/Opera, mobile GPUs, context restoration of a complete live match and
unprofiled performance remain unverified. The synthetic foreign-camera and
lifecycle cases do not substitute for those live scenarios.

A retained list would need evidence that scanning costs matter, safe invalidation
for late/removal/mask/action/LOD changes and full per-pass membership tests. Shared
main-pass depth is separate work owned by the other agent. Native Lite adapters
can reuse the view and lifetime rules; they should define their own resource and
draw-list representation.
