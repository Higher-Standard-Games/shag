# Weapon System

The SHAG Engine weapon system provides server-authoritative combat with first-person weapon rendering, projectile physics, knockback, crosshairs, and weapon drops.

## Architecture

```
Server Side                          Client Side
──────────                           ───────────
WeaponSystem                         WeaponViewManager (Singleton)
├── fire() → CombatSystem               ├── weaponCamera (separate for viewmodel)
├── switchWeapon()                       ├── loadWeapon() → MD3 from pk3
├── ammo tracking                        ├── update(dt) → bob, sway, flash
└── WeaponDefs (per-weapon config)       └── syncBobCycle() → ViewportEffects

ProjectileSystem                     Crosshair (Singleton)
├── tick() → move + collide              ├── per-weapon styles
├── splash damage                        ├── hit markers
└── snapshot entities (proj_*)           └── cg_crosshair* CVars

CombatSystem                         GibSystem
├── processDamage()                      ├── bone-mapped gibs
├── knockback impulse queue              ├── Havok physics
└── splash radius falloff                └── object pooling

DroppedWeaponSystem                  DroppedWeaponRenderer
├── spawnDrop() on death                 ├── Havok physics rendering
├── pickup detection                     └── model + collision
└── respawn timers
```

## Server-Side Weapon Definitions

Weapons are defined with full combat properties:

```typescript
interface WeaponDef {
  id: string;
  displayName: string;
  model: string;           // Viewmodel path in pk3
  fireRate: number;        // Shots per second
  damage: number;          // Direct hit damage
  projectileSpeed: number; // 0 = hitscan
  splashDamage: number;    // Splash damage at epicenter
  splashRadius: number;    // Splash damage radius
  knockbackScale: number;  // Knockback multiplier
  selfDamageMultiplier: number; // Self-damage reduction
  spread: number;          // Accuracy cone
  ammoType: string;
  ammoPerShot: number;
  maxAmmo: number;
}
```

Each game defines its own weapon roster via `WeaponDef` objects (e.g. in `WeaponDefs.ts`). The engine provides the framework — fire rates, splash damage, knockback, projectile speeds — but specific values are game configuration.

## Client-Side Rendering

### WeaponViewManager API

```typescript
import { WeaponViewManager } from '@/engine/weapon';

const wvm = WeaponViewManager.getInstance();

// Initialize with scene and camera
wvm.init(scene, camera);

// Load a weapon
await wvm.loadWeapon('rlauncher', 'basewsw/pak0.pk3');

// In game loop
wvm.update(deltaTime);

// Fire (called by FPSController)
wvm.fire();
```

### Weapon Bob

Syncs with player movement via ViewportEffectsManager:

| CVar | Default | Description |
|------|---------|-------------|
| `cl_gunbob` | 1 | Enable weapon bob |
| `cl_gunbob_amplitude` | 1.5 | Bob intensity |
| `cl_gunbob_speed` | 1.0 | Bob speed multiplier |
| `cl_gunbob_sprint_tilt` | 10 | Upward tilt when sprinting (°) |
| `cl_gunbob_sprint_inward` | 30 | Inward yaw when sprinting (°) |
| `cl_gunbob_jump` | 2.0 | Jump bob intensity |
| `cl_gunbob_land` | 3.0 | Landing bob intensity |

### Handedness

Set weapon screen position via cvar:

```
cg_handedness 0   # Left hand
cg_handedness 1   # Right hand (default)
cg_handedness 2   # Center
```

### ADS (Aim Down Sights)

| CVar | Default | Description |
|------|---------|-------------|
| `cl_ads_time` | 0.08 | ADS transition time (s) |
| `cl_ads_offset_y` | 2.0 | Weapon Y offset when ADS |
| `cl_ads_fov_reduction` | 15 | FOV zoom (%) |
| `cl_ads_sensitivity` | 0.5 | Sensitivity multiplier |

## Crosshair System

Configurable per-weapon crosshairs with hit markers:

| CVar | Default | Description |
|------|---------|-------------|
| `cg_crosshairSize` | 24 | Crosshair size in pixels |
| `cg_crosshairColor` | white | Crosshair color |
| `cg_crosshairAlpha` | 0.8 | Crosshair opacity |

**Hit markers:** Brief crosshair flash on confirmed damage event from server.

## Server-Authoritative Projectiles

Projectiles are fully server-side:

1. Player fires → server creates `proj_` entity with position + velocity
2. Server moves projectile each tick, checks BSP collision
3. Snapshots include `proj_` entities → client interpolates via SnapshotBuffer
4. On collision → server applies damage + splash damage + knockback
5. `projectile_spawn` event tells client which model/trail to render

**Client-predicted explosions:** Local client shows explosion on impact immediately. Server event is deduplicated via position + defId matching.

## Knockback & Splash Damage

```
Damage = splashDamage × (1 - distance / splashRadius)
KB Direction = normalize(victim - epicenter) with upward bias
KB Magnitude = damage × knockbackScale
```

- **Server-side impulse queue** — KB applied as velocity change before movement sim
- **Client-predicted KB** — `V2NetworkClient.applyKnockback()` for instant self-damage feedback
- **Self-damage** — Reduced by `selfDamageMultiplier` (typically 0.5)

## Weapon Drops

On player death:

1. Server spawns `DroppedWeapon` entity at death position
2. Client renders with Havok physics (tumbling, bouncing)
3. Other players can pick up dropped weapons (walk over them)
4. Dropped weapons grant the weapon + remaining ammo

## Console Commands

```
weapon <name>           - Equip weapon
give <weapon>           - Add weapon to inventory
give ammo               - Refill ammo
weapon_debug 1          - Show weapon debug info
weapon load <name>      - Load weapon model
weapon pos <x> <y> <z>  - Set position offset
weapon scale <n>        - Set weapon scale
weapon clear            - Remove current weapon
```

## See Also

- [Camera System](./camera-system.md) - FPSController integration
- [Networking System](./networking.md) - Server-authoritative architecture
- [Viewport Effects](./viewport-effects.md) - Walk bob, landing impact
