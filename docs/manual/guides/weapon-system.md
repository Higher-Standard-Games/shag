# Weapon System

The SHAG Engine weapon system provides first-person weapon rendering, animations, projectiles, and hitscan mechanics.

## Architecture

```
WeaponViewManager (Singleton)
    ├── weaponCamera - Separate camera for viewmodel rendering
    ├── loadWeapon() - Load MD3 model from pk3
    ├── fire() - Trigger fire effect and projectile
    ├── startReload() - Begin reload animation
    └── update(dt) - Per-frame updates (bob, sway, flash)

ProjectileManager (Singleton)
    ├── spawnProjectile() - Create projectile entity
    ├── update(dt) - Move and collide projectiles
    └── doHitscan() - Instant raycast damage
```

## Quick Start

```typescript
import { WeaponViewManager } from '@/engine/weapon';

const wvm = WeaponViewManager.getInstance();

// Initialize with scene and camera
wvm.init(scene, camera);

// Load a weapon
await wvm.loadWeapon('plasmagun', 'baseq3/pak0.pk3');

// In game loop
wvm.update(deltaTime);

// Fire (called by FPSController)
wvm.fire();
```

## WeaponViewManager API

### Loading

```typescript
// Load by weapon ID (looks up in entity registry)
await wvm.loadWeapon('machinegun');

// Load from specific pk3
await wvm.loadWeapon('rocketlauncher', 'baseq3/pak0.pk3');

// Clear current weapon
wvm.clear();
```

### Positioning

```typescript
// Use preset positions
wvm.setPosition('hip');      // Normal hold
wvm.setPosition('ads');      // Aim down sights
wvm.setPosition('lowered');  // Sprint/lowered

// Manual offset (x, y, z in camera local space)
wvm.setOffset(15, -8, 35);
wvm.setScale(2.0);
```

### Weapon Info

```typescript
const info = wvm.getWeaponInfo();
// { name: 'plasmagun', frames: 10, surfaces: 3 }

const pos = wvm.getCurrentPosition();
// { offset: Vector3, rotation: Vector3, scale: number }
```

### Fire and Reload

```typescript
wvm.fire();                    // Fire with effects
wvm.startReload(600);          // Start reload (ms)
wvm.cancelReload();            // Cancel reload
wvm.isReloading();             // Check state
wvm.getReloadProgress();       // 0-1 progress
```

## Handedness

Set weapon screen position via cvar:

```
cg_handedness 0   # Left hand
cg_handedness 1   # Right hand (default)
cg_handedness 2   # Center
```

Offset values:
- Right: +12 units
- Center: 0 units
- Left: -12 units

## Weapon Bob

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

## ADS (Aim Down Sights)

| CVar | Default | Description |
|------|---------|-------------|
| `cl_ads_time` | 0.08 | ADS transition time (s) |
| `cl_ads_offset_y` | 2.0 | Weapon Y offset when ADS |
| `cl_ads_fov_reduction` | 15 | FOV zoom (%) |
| `cl_ads_sensitivity` | 0.5 | Sensitivity multiplier |

## ProjectileManager

Handles projectile spawning and collision.

```typescript
const pm = getProjectileManager();

pm.init(scene);

// Spawn projectile
pm.spawnProjectile({
  position: muzzlePos,
  direction: fireDir,
  speed: 2000,
  damage: 20,
  radius: 8,
  lifetime: 10,
  type: 'plasma',
});

// Hitscan weapon
const hit = pm.doHitscan(origin, direction, range, damage);
if (hit.entity) {
  // Apply damage
}
```

## Weapon Definitions

Weapons are defined in the entity registry:

```typescript
interface WeaponDef {
  id: string;
  displayName: string;
  model: string;           // Path in pk3
  fireRate: number;        // Shots per second
  damage: number;
  projectileSpeed: number; // 0 = hitscan
  spread: number;          // Accuracy cone
  clipSize: number;
  reloadTime: number;      // ms
  ammoType: string;
}
```

## Console Commands

```
weapon <name>           - Equip weapon
give <weapon>           - Add weapon to inventory
give ammo               - Refill ammo
weapon_debug 1          - Show weapon debug info
```

## See Also

- [Camera System](./camera-system.md) - FPSController integration
- [Physics System](./physics-system.md) - Projectile collision
