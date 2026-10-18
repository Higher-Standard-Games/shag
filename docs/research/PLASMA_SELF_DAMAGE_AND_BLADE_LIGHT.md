# Close-wall plasma self-damage and blade charge light

2026-10-18.

## Reproduction and fix

Plasma already uses the shared blast path: radius 45, centre damage 15,
edge damage 5, linear falloff, then the gametype's self-damage multiplier.
The small blast missed the shooter because projectile spawning blindly added
50 units in front of the firing view. A wall closer than that placed the bolt
inside or beyond the wall; its reported impact was too far from the shooter.

A headless weapon-to-projectile test reproduced this with a wall 24 units in
front of the shooter. Before the fix, the projectile spawned 50 units forward
and there was no self-damage. The fix traces the muzzle offset against solid
world geometry with the same small bounds and shot mask as projectile travel,
then nudges a blocked spawn slightly toward the firing side of the wall.
Both ordinary and charged projectile spawning use the helper.

Projectiles also ignore direct contact with their owner. This prevents a bolt
clipped back near its shooter from immediately applying a full direct hit to
them. Self-harm instead comes through the existing splash path, with the same
falloff, damage type, armor rules and self-damage multiplier used by other
projectile explosions. Enemy direct hits still skip additional splash on that
same victim. No plasma radius, damage, visual or knockback values changed.

The new tests check an actual health reduction through CombatSystem, expected
blast falloff, a half self-damage multiplier, zero self-damage when disabled,
and a real wall impact outside the small radius causing no self-damage.

The remaining red light was the remote-player charge glow in GameEvents.
Its diffuse and specular colors now both use `(0.05, 1.0, 0.9)`, matching the
existing blade charge/projectile theme. Its intensity, range and cleanup are
unchanged. This path also serves demo playback.

## Files changed

- `src/games/fps/server/systems/WeaponSystem.ts`
- `src/games/fps/server/systems/ProjectileSystem.ts`
- `src/games/fps/server/systems/__tests__/PlasmaSelfDamage.test.ts`
- `src/games/fps/client/GameEvents.ts`
- `src/games/fps/docs/manual/player/combat.md`
- `docs/changelog/v0.9.32.md`
- This note.

## Validation

```text
npm run test:run -- src/games/fps/server/systems/__tests__/PlasmaSelfDamage.test.ts
npm run test:run -- src/games/fps/server/systems/__tests__/PlasmaSelfDamage.test.ts src/games/fps/server/systems/__tests__/WeaponSystem.test.ts src/games/fps/server/systems/__tests__/ProjectileSystem.test.ts
npm run typecheck
npm run gate:biome
npm run test:run
npm run build
npm run build:server
npm run docs:fps:build
npm run docs:build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
node .cache/run-map-bsp.mjs
```

The first run before implementation reproduced two failures and one passing
outside-radius case. The final focused run passed all 58 tests. Logs use
`.cache/plasma-*.log`. The last command directly invokes the headless CLI with
one complete `--exec` argument to load and inspect all three production BSPs.

Typecheck, Biome, client/server builds, both manual builds, simulation, physics,
server tick, fuzz (1,000 ticks) and all three BSP inspections passed. The full
suite passed 5,152 tests, skipped one and retained the same five failures in
four SHAGGED compiler test files caused by missing archived editor textures
(`textures/blx/blx_grid`; ConvexCompile also mentions `noshader`). No new failure
was introduced. Server bundles were rebuilt for newly spawned matches.

Assumptions: the existing small plasma radius and damage are intended; self
damage should respect each gametype's configuration. The new wall trace applies
to all projectile muzzles to keep spawning consistent with world collision.
The original live wall shot and bot charge light still need in-game confirmation;
no new wire fields, demo fields or prediction state were introduced.
