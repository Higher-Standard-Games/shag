# Weapon system

Weapons cross shared definitions, authoritative server combat, client input/prediction, and first-person presentation.

## Ownership

| Layer | Responsibility |
| --- | --- |
| Shared/game definitions | Stable IDs and tunable weapon data |
| FPS server | Ammo, fire cadence, hit/projectile results, damage, knockback, drops |
| FPS client | Input requests, predicted local feedback, snapshots/events |
| Engine presentation | `WeaponViewManager`, model/material/effect rendering |
| HUD | Crosshair, ammo, hit/death feedback |

Washoi's concrete definitions and `WEAPONS` table live in
`src/games/fps/shared/entities/definitions/`, shared by its client and server.
The engine keeps the generic interfaces, defaults and `EntityRegistry` in
`src/shared/entities/`; that barrel does not export Washoi definitions.
The application registers Washoi's compatibility-ID resolver with
`registerWeaponIdResolver` before creating weapon views. The engine's
`WeaponViewManager` uses it for both direct loads and animated switches;
without a resolver, IDs pass through unchanged.

The server remains authoritative. A muzzle flash or predicted projectile must not apply damage locally.

The Blade's 48-unit step-in dash requires an accepted primary swing, forward
input without back input, and positive horizontal velocity along the view's
forward direction. Stationary, sideways-only and backward motion still allow
the melee attack but do not queue a dash. Forward diagonals qualify; vertical
velocity and view pitch do not affect eligibility. The server evaluates this
at swing acceptance and uses the existing collision-clamped displacement.

Blade energy effects use teal: pickup glow, swing/release flashes, charged
projectile light and trail, and its impact burst. First-person swings emit the
central flash plus a smaller flash within four screen pixels of the model's
tip. Both flashes fade over 0.16 seconds; the tip is resolved once from the
normalized model geometry and follows the viewmodel pose and weapon FOV.
The first-person swing ribbon has 22% peak opacity and feathered edges.
The charged projectile uses its original glow texture as an additive brightness
mask, recoloured teal. Black texture pixels contribute no visible light.

## View presentation

`src/engine/weapon/WeaponViewManager.ts` owns the first-person weapon scene resources and presentation lifecycle. It is integrated by the FPS controller/game; do not initialize a second manager in a feature.

When extending it:

- load assets through the PK3/model systems;
- preserve the separate viewmodel camera/layer behavior;
- route transient beams/projectiles through the existing effect renderers;
- dispose observers, materials, lights, particles, and models on reset;
- keep weapon bob synchronized with viewport/player state.

Projectile collision and velocity follow the server's eye-based aim ray. The
first-person **visible start** uses the weapon's authored `tag_flash` socket:
project through the weapon camera's FOV and map that pixel into the world camera.
This keeps the start aligned during ADS, sway and FOV changes. Presentation
converges onto the authoritative trajectory over 220ms; later mouse movement
does not steer an already spawned shot.

The viewmodel camera is parented at the main camera's local origin. Projectile
renderers receive an explicit visual muzzle instead of using `scene.activeCamera`,
which may refer to the last weapon-camera pass. Demo POV uses its own view manager.
Which local shot a projectile belongs to is inferred from its position and
forward velocity; projectiles do not carry an explicit owner for this.

Machinegun tracers spawn a warm impact light when their streak reaches the hit.
The light peaks at 0.25 intensity, uses a 60-unit range and expires with the
0.16-second impact effect. Local and remote machinegun presentation share this
tracer path.

## Console inspection

```text
developer 1
weapon info
weapon load <name> [pk3path]
weapon pos <x> <y> <z>
weapon offset <x> <y> <z>
weapon scale <value>
weapon preset <hip|ads|lowered>
weapon spawn
weapon debug
weapon hide
weapon show
weapon clear
giveweapon <weapon_id|all> [amount]
cl_wep_reset
```

None of `weapon`, `giveweapon` or `cl_wep_reset` requires developer mode.

Use `help weapon` for the active command metadata.

## Adding a weapon

1. Add the game/shared definition and stable ID.
2. Implement authoritative hitscan or projectile behavior.
3. Add snapshot/event representation where needed.
4. Connect client input and predicted audiovisual feedback.
5. Add viewmodel, world/drop, sound, and HUD assets.
6. Add pickup/loadout integration.
7. Test rate limits, ammo, self-damage, splash occlusion, knockback, death, and respawn.

## Validation

```bash
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
```

Then run a real client/server match for prediction, effects, and interpolation. Weapon/network changes are high-risk and require the full networking regressions in `AGENTS.md`.
