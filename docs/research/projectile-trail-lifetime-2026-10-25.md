# Projectile trail crash during loading — 2026-10-25

## Finding and reproduction

Alpha5's slow US cold-load probe captured `Trail ribbon topology changed` in
`updateUnlitTrailRibbon`, called by `ProjectileManager.updateTrail` from the
scene's before-render observer. The render loop records and rethrows render
exceptions, so this exception can stop subsequent frames while networking and
downloads continue.

The user confirmed Quick Play with the default Balanced graphics preset for
the affected first load. The lifetime checks apply independently of preset.

`ClientMapLoader` runs `scene clear` before loading a map. `SceneCommand` disposes
every scene mesh with its material, including projectile models and the two
ribbon meshes. The projectile's parent is a `TransformNode`, so this mesh loop
leaves it alive. `ProjectileManager.update` checked only that parent. Its next
trail update read the disposed ribbon's empty geometry and failed the layout
check. Bot projectiles arriving before the map finishes loading expose this
lifetime boundary.

An isolated headless Edge probe on the real WebGL2 GPU reproduced the exact
exception using the committed pre-fix projectile module and the real `scene
clear` command. The private Vite server loaded that module from Git through a
probe-only plugin; the shared checkout retained the fix throughout the
comparison. Before clear, the shot had two live ribbons (240 vertices per
ribbon). Afterwards both were disposed, their parent was alive, and the manager
still contained the shot. The browser logged the same render exception with no
failed HTTP requests.

A second headless regression showed that an idle shot's shared trail material
also remained cached after scene clear disposed it. A subsequent shot reused
that retired material.

## Fix

- Retire an active visual before updating it if its parent or either ribbon has
  been disposed. The existing despawn path removes the server-entity lookup,
  releases its pooled light, disposes the remaining parts and rejects it from
  the idle shot pool.
- Reuse a cached trail material only while it remains in the current scene's
  material collection; otherwise create and cache its replacement.
- Keep fixed-layout geometry validation. No exception suppression or global
  render-loop recovery was added, and healthy shots keep their existing buffers
  and pooling behavior. The active guard checks three disposal flags without
  allocating a child-mesh list per shot per frame.

## Regression coverage

`src/engine/__tests__/ProjectileTrail.test.ts` adds three cases:

1. Actual scene-clear mesh disposal with a surviving parent retires the active
   shot without throwing or leaving orphaned meshes.
2. Idle-shot geometry and the shared material are replaced after scene clear.
3. Disposing only the crossing ribbon retires that shot while a healthy shot
   continues updating.

The first two tests failed before the fix: the first threw the captured
topology error, and the second reused the disposed material's unique ID.
The targeted trail, geometry and model-reload suite passed 14 tests afterwards.

## Validation

The first full run passed 734 files and failed the first Firefox/WebGL material
ownership case in `RemoteWeaponLeak.test.ts` at its one-second attachment wait:
5,723 tests passed, one failed, one skipped. Its isolated run alongside the trail
tests passed all 15 tests. The same cold lazy-import timeout had occurred during
alpha5 validation. That mocked test now explicitly waits for Vitest's tracked
dynamic imports before starting its attachment assertion; the runtime renderer
is unchanged. The synchronized pair also passed 15 tests. The failed full run is
retained in `.cache/beta-trail-full-tests.log` rather than counted as green.

| Exact command | Result |
| --- | --- |
| `npm.cmd run test:run -- src/engine/__tests__/ProjectileTrail.test.ts src/engine/__tests__/EffectGeometry.test.ts src/games/fps/client/__tests__/ProjectileManagerModelReload.test.ts` | Pass, 14 tests |
| `npm.cmd run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts src/engine/__tests__/ProjectileTrail.test.ts` | Pass, 15 tests, after explicit lazy-import synchronization |
| `npm.cmd run test:run` (final synchronized run) | Pass, 735 files; 5,725 tests passed, one skipped, 229.06 seconds |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run gate:biome` | Pass, 0 errors / 47 warnings, at baseline |
| `npm.cmd run build` | Pass; postbuild relocated 49 sourcemaps |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Pass, 7,475 faces |

Real-GPU headless Edge:

- `node .cache/beta-trail-gpu.mjs webgl2 baseline`: pre-fix failure captured as
  described above. The manager retained the stale shot and logged the topology
  exception.
- `node .cache/beta-trail-gpu.mjs webgl2 fixed`: three cycles passed. Each cycle
  spawned a shot with two live ribbons and a live material, cleared the scene,
  then observed zero stale projectiles and advancing scene frames. No console
  errors/exceptions or HTTP failures.
- `node .cache/beta-trail-gpu.mjs webgpu fixed`: the same three cycles passed
  with `isWebGPU: true`, no console errors/exceptions or HTTP failures.

The private Vite server on port 3127 and all probe browsers were stopped. No
lobby or game server was started for these browser checks. Probe code, JSON
results and screenshots remain under ignored `.cache/beta-trail-*`.

## Files

- `src/engine/weapon/ProjectileManager.ts`
- `src/engine/__tests__/ProjectileTrail.test.ts`
- `src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts` (test synchronization)
- `src/games/fps` (pin to the test synchronization commit)
- `docs/manual/guides/weapon-system.md`
- `docs/changelog/v1.0.0-alpha.6.md`
- `docs/research/projectile-trail-lifetime-2026-10-25.md`

## Scope and limits

Branch: `v1.0.0-beta-papercuts`. The existing living changelog is alpha6; this
repair does not change release versions or production. The browser reproduction
uses an isolated local scene and the same clear command as client map loading,
without a lobby, accounts or server changes. Slow production downloads and
unrelated audio timeouts are separate from this repair. The production log lacks
a disposed-mesh state capture; the local headless and real-GPU reproductions
establish the failing lifetime and matching exception, rather than proving
every possible trigger of that consistency check.

The final full suite also included another agent's concurrently committed FPS
papercuts. Their files were not edited as part of this repair. These changes
were validated locally; no branch was pushed or deployed as part of this repair.
