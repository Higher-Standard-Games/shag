# Owned pool membership: first gib-shard slice

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork` in both repositories.
Base engine: `d1baa695`; base FPS: `0759316308429c2ad36aa1e3bda1b111b22016e7`.
FPS integration commit: `16684b8` (the engine feature commit pins it).

This is the first bounded implementation of [review path 5](babylon-renderer-new-paths-2026-10-26.md#5-candidate-registry-for-dynamic-objects),
following [PVS candidate pruning](babylon-classic-pvs-candidates-2026-10-26.md)
and the [bundle investigation](babylon-classic-webgpu-bundles-2026-10-26.md).
It targets repeated readiness checks for explicitly owned, disabled pool members.
Both existing backends use the same implementation. No renderer setting changes.

## Inventory and scope

A WebGL2 dm5 demo inventory at 960 × 540 sampled scene membership after the
loading overlay closed, then ten and twenty seconds later:

| Snapshot | All meshes | Gib-prefixed meshes | Enabled | Disabled |
| --- | ---: | ---: | ---: | ---: |
| Initial | 611 | 1 | 0 | 1 |
| +10 seconds | 764 | 57 | 56 | 1 |
| +20 seconds | 873 | 141 | 56 | 85 |

The prefix includes one disabled template. The chosen runtime scope registers
actual shards, leaving that template outside the registry: the last snapshot
therefore contains 84 idle owned candidates, potentially visited by both
cameras. Damage numbers had only two disabled members. The larger "other"
category includes imported model hierarchies and other owners whose readiness,
animation and lifetime rules need independent review. They are not enrolled.

That baseline inventory logged WebGL `glGetProgramiv: Program object expected`
warnings during continued playback. It is an observational count record,
**not a clean renderer validation result**. Those warnings occurred before this
implementation and remain an unresolved separate reliability finding. The
isolated comparisons below have their own error checks.

## Implementation and invariants

`registerPooledMeshCandidate(mesh)` declares pool ownership. A scene has one
registry/filter regardless of pool size or number of owners. Babylon 9.31.2's
`onEffectiveEnabledStateChangedObservable` maintains an idle set, including
parent changes. No per-frame scan of the pool is needed to discover membership.
If the set is empty, this filter is disabled and does not force an additional
candidate copy/scan; other enabled scene filters can still run.

When idle members exist, the existing composed scene provider scans its source
in order and excludes only those owned members that are still disabled. It
checks actual `isEnabled()` before exclusion, so an unexpected external enable
fails open. This is bounded candidate pruning, **not** a retained replacement
for the entire scene list. It still pays the shared source scan while filtering.

Enabled shards remain candidates immediately. Unmanaged disabled meshes are
retained, action-manager meshes bypass filtering, and custom LOD selectors or
a missing camera retain the original provider. Scene membership, picking,
resource disposal, simulation and full-scene readiness are unchanged. Candidate
vertex bookkeeping can fall along with excluded meshes; that is not a reduction
in the rendered triangle count. Active-index and pixel comparisons are the
rendering acceptance checks.

The FPS `GibSystem` registers each newly allocated shard after disabling it.
It continues using its existing `setEnabled` calls on spawn, clear and expiry;
there is no second gameplay activation flag to synchronize. The registration
token permits early release, while mesh and scene disposal release ownership
automatically. Duplicate leases share one membership entry and observer pair.
The last release removes the pool filter without disturbing PVS or weapon
leases. A foreign replacement scene hook is preserved.

The current adapter uses Babylon mesh identities and notifications. Future Lite
work can reuse the ownership/activation contract; it should map it onto native
task membership rather than adopt a universal mesh facade or this provider's
buffer representation. A fully retained candidate list still needs source-order,
late-node, removal, mask, action and LOD invalidation evidence.

## Headless and GPU evidence

Headless checks cover unmanaged meshes, external enable, parent transitions,
duplicate leases, multiple owners/cameras, action/LOD fallbacks, immediate gib
reuse, clear/expiry, full-scene readiness and mesh-first/scene-first cleanup.
When all members are active, the provider returns the original scene array.
Observer cleanup uses Babylon's public `hasObservers()` state, because physical
observer-array removal is deferred. Initial test attempts also exposed a missing
active camera and an implicit default-material dependency in the fixtures;
the fixtures now explicitly provide both. These were not production changes.

The isolated real-GPU fixture passes four reference/candidate pairs per backend:
idle pool, external enable, action-manager member and custom LOD. All eight
pairs have identical pixel hashes, active-mesh names and active-index counts,
with nonempty output and no HTTP/render errors. For seven disabled members and
two cameras, readiness calls fall from 14 to zero. The action-manager member
retains two calls; custom LOD retains all 14. Active drawing remains unchanged.
This is counted work removal, not an FPS claim.

The live follow-up used ordinary WebGPU (compatibility mode), the same local dm5
demo, and three samples ten seconds apart. Its final sample had 838 scene meshes:
112 actual shards, 56 enabled and 56 disabled, plus the disabled template.
Both camera candidate lists retained 56 active shards and zero idle shards.
The primary list contained 699 meshes (83 PVS-hidden surfaces and 56 idle shards
excluded); the weapon list contained 782 (56 idle shards excluded). These are
same-snapshot membership observations, not inferred FPS savings. No HTTP or GPU
errors were logged in that live WebGPU run; common-root, map-entity, water-fallback
and one missing projectile-spawn warning remain recorded.

The [tracked evidence](renderer-evidence/2026-10-26-pooled-candidates.json) keeps
both inventories, their warnings, eight fixture comparisons and source-file
hashes at evidence assembly. The pre-change GL warnings are preserved separately.

### Reproduction

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3124
# Second shell:
node scripts/benchmarks/pooled-candidates.mjs webgl2 3124
node scripts/benchmarks/pooled-candidates.mjs webgpu 3124
```

The isolated fixture does not require map media. Raw comparison results are
`.cache/renderer-groundwork/pooled-{backend}.json`. Inventory records and the
controlled live follow-up are recorded separately; their changing POVs are not
a before/after performance benchmark. The live demo requires local
`washoi_dm5_ffa_20261025_170933.shagdemo` media.

### Exact changed files

Engine repository:

- `src/engine/rendering/PooledMeshCandidates.ts`.
- `src/engine/__tests__/PooledMeshCandidates.test.ts`.
- `src/engine/rendering/__qa__/PooledCandidatesFixture.ts`.
- `scripts/benchmarks/pooled-candidates.mjs`.
- `docs/manual/guides/bsp-system.md`.
- `docs/manual/guides/render-variables.md`.
- `docs/changelog/v1.0.0-alpha.6.md`.
- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`.
- `docs/research/babylon-classic-pooled-candidates-2026-10-26.md` (this report).
- `docs/research/renderer-evidence/2026-10-26-pooled-candidates.json`.
- `src/games/fps` gitlink, pinned after the FPS commit.

FPS repository:

- `client/GibSystem.ts`.
- `client/__tests__/GibSystemTrace.test.ts`.

### Validation commands

| Exact command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run test:run -- src/engine/__tests__/PooledMeshCandidates.test.ts src/engine/__tests__/PvsMeshCandidates.test.ts src/engine/__tests__/WeaponCameraCandidates.test.ts src/games/fps/client/__tests__/GibSystemTrace.test.ts --silent=true` | Pass: 18 tests |
| `npm.cmd run test:run -- --silent=true` | Pass: 739 files, 5,753 passed, one skipped |
| `npm.cmd run gate:biome` | Pass: zero errors, 47 baseline warnings |
| `npm.cmd run build` | Pass: 2,488 modules transformed; existing externalization/chunk warnings |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass: spawn Y maintained |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass: checksum 2768943778 |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass: checksum 2161407546 |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'` | Pass: 7,475 faces |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Pass: 91 ticks |
| `node --check scripts/benchmarks/pooled-candidates.mjs` | Pass |

Both GPU commands above pass. Raw gates are saved as
`.cache/renderer-groundwork/pool-*.log`. The full suite ran before the production
build to avoid generated-media writes during compiler tests.

Assumptions: normal single-scene ownership of each registered mesh, public
enabled-state changes and the installed Babylon notification semantics. The
first pool is procedural shards; imported actors, skeletal animation, shared
templates and other effects require separate ownership reviews. Integrated GPUs,
broader browsers/maps, full-match context restoration and unprofiled performance
remain unverified. Existing inventory GL warnings remain open.
