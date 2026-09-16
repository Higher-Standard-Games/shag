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

The server remains authoritative. A muzzle flash or predicted projectile must not apply damage locally.

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
Projectile ownership is still inferred from nearby position/forward velocity;
reliable owner metadata is a tracked follow-up in the v0.9.23 QA ledger.

## Console inspection

```text
developer 1
weapon info
weapon load <name> [pk3path]
weapon pos <x> <y> <z>
weapon scale <value>
weapon preset <hip|ads|lowered>
weapon hide
weapon show
weapon clear
giveweapon <name>
cl_wep_reset
```

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
npm run test:simulation
npm run server:tick
npm run server:fuzz -- --ticks 1000
```

Then run a real client/server match for prediction, effects, and interpolation. Weapon/network changes are high-risk and require the full networking regressions in `AGENTS.md`.
