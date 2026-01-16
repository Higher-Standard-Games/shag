# Weapon System Design

A comprehensive system for handling first-person weapons, including view models, aiming, spread, ammunition, and integration with movement mechanics.

## Overview

The weapon system handles:
1. **View Models** - 3D weapon models attached to the camera
2. **Aiming** - Hip-fire vs ADS (Aim Down Sights)
3. **Spread/Accuracy** - Bullet deviation based on player state
4. **Ammunition** - Clips, reloading, ammo pools
5. **Weapon States** - Idle, firing, reloading, switching, etc.
6. **Movement Integration** - Weapon sway from movement, ledge grab, wall jump, etc.

## Architecture: Q3-Style Client/Server Separation

Following Quake 3's architecture, we separate weapon logic:

```
┌────────────────────────────────────────────────────────────────┐
│                         SERVER (Authoritative)                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ WeaponServerSystem                                       │   │
│  │ - Which weapons each player owns                         │   │
│  │ - Current weapon equipped                                │   │
│  │ - Ammo counts (clip + reserve)                          │   │
│  │ - Fire requests → hit detection → damage                │   │
│  │ - Reload timing validation                               │   │
│  │ - Weapon pickup/drop                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ GameState + Events               │
│                              ▼                                  │
├────────────────────────────────────────────────────────────────┤
│                         CLIENT (Cosmetic)                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ WeaponViewManager                                        │   │
│  │ - Load/display weapon view model (MD3)                   │   │
│  │ - Position on screen (hip/ADS/lowered)                   │   │
│  │ - Animation playback (fire, reload, switch)              │   │
│  │ - Weapon sway/bob integration                            │   │
│  │ - Muzzle flash, shell casings (effects)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ WeaponClientPredictor                                    │   │
│  │ - Predict fire immediately (before server confirms)      │   │
│  │ - Play fire animation/sound instantly                    │   │
│  │ - Reconcile with server state                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### Server Responsibilities (Authoritative)
| Component | Purpose |
|-----------|---------|
| `WeaponInventory` | Which weapons player owns |
| `AmmoState` | Clip counts, reserve ammo |
| `FireHandler` | Validate fire, spawn projectile/hitscan |
| `HitDetection` | Ray/projectile collision, damage calc |
| `ReloadHandler` | Validate reload timing, update ammo |
| `PickupSystem` | Weapon spawns, pickups, drops |

### Client Responsibilities (Cosmetic)
| Component | Purpose |
|-----------|---------|
| `WeaponViewManager` | Load MD3, position on screen |
| `WeaponAnimator` | Fire/reload/switch animations |
| `WeaponSway` | Sway/bob following movement |
| `EffectsPlayer` | Muzzle flash, tracers, sounds |
| `ClientPredictor` | Immediate feedback before server |

### Shared Definitions (Both)
| Component | Purpose |
|-----------|---------|
| `WeaponDef` | Weapon stats (damage, fire rate, etc.) |
| `WeaponType` | Enum of weapon types |
| `AmmoType` | Enum of ammo types |

### Network Messages
```typescript
// Client → Server
interface FireRequest {
  weaponType: WeaponType;
  aimDirection: Vector3;
  timestamp: number;
}

interface ReloadRequest {
  weaponType: WeaponType;
}

interface SwitchRequest {
  toWeapon: WeaponType;
}

// Server → Client (in GameState)
interface PlayerWeaponState {
  currentWeapon: WeaponType;
  clipAmmo: number;
  reserveAmmo: number;
  weaponState: 'idle' | 'firing' | 'reloading' | 'switching';
}

// Server → Client (Events)
interface WeaponFiredEvent {
  playerId: string;
  weaponType: WeaponType;
  origin: Vector3;
  direction: Vector3;
}

interface HitConfirmEvent {
  targetId: string;
  damage: number;
  hitLocation: 'head' | 'body' | 'limb';
}
```

### Console Commands (Client-Side)
```
weapon_equip <name>     - Request server to switch weapon
weapon_fire             - Bound to Mouse1, sends FireRequest
weapon_reload           - Bound to R, sends ReloadRequest
weapon_next             - Scroll through weapons
weapon_prev             - Scroll through weapons

# Debug/Dev commands
weapon_give <name>      - (Cheats) Give weapon
weapon_viewmodel 0|1    - Show/hide view model
weapon_debug            - Show weapon state info
```

### Implementation Order

**Phase 1: Client View Model Only (MVP)**
Focus: Get a weapon rendering on screen, no gameplay.
```
1. Load data0_15pure.pk3
2. Parse plasmagun.md3 with MD3Loader
3. Create WeaponViewManager (engine side)
4. Attach to camera, position in hip-fire
5. Console commands: weapon_load, weapon_pos

No server, no firing, just visual.
```

**Phase 2: Weapon Definitions**
```
1. Define WeaponDef interface (shared)
2. Create weapon definitions (game side)
3. Support loading from weapon.cfg files
```

**Phase 3: Server Weapon State**
```
1. Add weapon state to Entity/GameState
2. Server tracks weapon ownership/ammo
3. Network weapon state to clients
```

**Phase 4: Firing System**
```
1. Client sends FireRequest
2. Server validates, does damage/projectile
3. Server broadcasts WeaponFiredEvent
4. Client plays effects on event
```

**Phase 5: Full Integration**
```
1. Reload system
2. Weapon switching
3. Pickups
4. Client-side prediction
```


## View Model System

### Attachment Hierarchy
```
Camera
  └── WeaponRoot (parented to camera)
        ├── WeaponModel (the 3D mesh)
        │     ├── MuzzleFlash (particle emitter point)
        │     ├── EjectionPort (shell casing origin)
        │     └── Sights (ADS alignment point)
        └── Hands (optional hand models)
```

### View Model Rendering - Critical Issues & Solutions

**Problem 1: Weapon clips through walls**
The view model is rendered in the same pass as the world, so it intersects with
nearby geometry when the player is close to walls.

**Problem 2: Weapon FOV should be different**
High game FOV (100-120) makes weapons look stretched/thin. Quake uses separate
weapon FOV (60-75) so weapons look natural regardless of game FOV.

**Solution: Separate Rendering Pass with Depth Clear**

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDER PIPELINE                          │
├─────────────────────────────────────────────────────────────┤
│ Pass 1: World Rendering (cg_fov = 100)                      │
│   - Skybox                                                  │
│   - BSP geometry                                            │
│   - World models (pickups, other players)                   │
│   - Effects                                                 │
├─────────────────────────────────────────────────────────────┤
│ CLEAR DEPTH BUFFER (keep color buffer)                      │
├─────────────────────────────────────────────────────────────┤
│ Pass 2: View Model Rendering (cg_weaponfov = 65)            │
│   - Weapon model                                            │
│   - Hand model                                              │
│   - Muzzle flash                                            │
│   - Shell casings (near camera)                             │
└─────────────────────────────────────────────────────────────┘
```

**Babylon.js Implementation Options:**

**Option A: Render Layers (Recommended)**
```typescript
// Create separate render layer for view model
const weaponLayer = new Layer("weaponLayer", null, scene);
weaponMesh.renderingGroupId = 1;  // Separate group

// Clear depth before rendering group 1
scene.setRenderingAutoClearDepthStencil(1, true, false, false);
```

**Option B: Separate Camera**
```typescript
// Create overlay camera for weapon only
const weaponCamera = new FreeCamera("weaponCam", camera.position, scene);
weaponCamera.fov = 65 * Math.PI / 180;  // Weapon FOV
weaponCamera.layerMask = 0x10000000;     // Only weapon layer
weaponMesh.layerMask = 0x10000000;

// Main camera doesn't see weapon
mainCamera.layerMask = 0x0FFFFFFF;
```

**Option C: MaterialDepthFunction (Simple but limited)**
```typescript
// Make weapon always render on top
weaponMaterial.depthFunction = Engine.ALWAYS;
// But this breaks weapon self-occlusion
```

### CVars for View Model
```
cg_handedness 0|1|2  - Weapon hand (0=left, 1=right, 2=center)
cg_weaponfov 65      - Weapon model FOV (separate from game FOV)
cg_gunx 0            - Weapon X offset adjustment
cg_guny 0            - Weapon Y offset adjustment  
cg_gunz 0            - Weapon Z offset adjustment
cg_drawgun 1         - Show/hide weapon model
```

### Positioning
```typescript
interface WeaponViewPosition {
  // Hip-fire position (normal)
  hipPosition: Vector3;      // e.g., (0.3, -0.3, 0.5)
  hipRotation: Quaternion;

  // ADS position (aimed)
  adsPosition: Vector3;      // e.g., (0, -0.15, 0.3)
  adsRotation: Quaternion;

  // Lowered position (sprinting, ledge grab)
  loweredPosition: Vector3;  // e.g., (0.4, -0.5, 0.3)
  loweredRotation: Quaternion;
}
```

### Warsow Weapon File Structure
Located in `data0_15pure.pk3` under `models/weapons/`:

```
models/weapons/plasmagun/
├── plasmagun.md3          # Main weapon model
├── plasmagun_hand.md3     # Hand/arm model
├── plasmagun_flash.md3    # Muzzle flash effect model
├── plasmagun.cfg          # Weapon configuration
├── plasmagun.jpg          # Diffuse texture
├── plasmagun.tga          # Diffuse texture (alt)
├── plasmagun_gloss.tga    # Specular/gloss map
├── plasmagun_norm.tga     # Normal map
├── plasmagun_fx.tga       # Effects texture
├── f_plasma.jpg           # First-person texture
└── f_plasma_2.jpg         # First-person texture variant
```

Same structure for other weapons (rlauncher, etc.)

Hit effects are in `models/weapon_hits/`

### Model Loading
Using MD3Loader from the engine:
```typescript
import { getMD3Loader, MD3LoadResult } from '@engine/loader/model';

// Initialize with scene
const md3 = getMD3Loader();
md3.init(scene);

// Load from PK3
const buffer = await pk3.getFile('models/weapons/plasmagun/plasmagun.md3');
const model = md3.parseMD3(buffer);
const result = md3.createMeshes(model, 'plasmagun', {
  textureUrl: 'models/weapons/plasmagun/plasmagun.jpg'
});

// Attach to camera
result.root.parent = camera;
result.root.position = hipPosition;

// Get tag for hand attachment
const handTag = result.getTag('tag_hand');
```


## Weapon States

```
                    ┌──────────┐
                    │   IDLE   │◄────────────────┐
                    └────┬─────┘                 │
                         │ fire input            │
                         ▼                       │
                    ┌──────────┐                 │
                    │  FIRING  │─────────────────┤
                    └────┬─────┘  animation done │
                         │ empty clip            │
                         ▼                       │
                    ┌──────────┐                 │
                    │ RELOADING│─────────────────┤
                    └────┬─────┘  reload done    │
                         │ switch weapon         │
                         ▼                       │
                    ┌──────────┐                 │
                    │ SWITCHING│─────────────────┘
                    └──────────┘
```

### State Definitions

| State | Duration | Can Fire | Can ADS | Can Switch |
|-------|----------|----------|---------|------------|
| IDLE | - | ✓ | ✓ | ✓ |
| FIRING | ~0.1s | ✗ | ✓ | ✗ |
| RELOADING | ~2s | ✗ | ✗ | ✗ |
| SWITCHING | ~0.5s | ✗ | ✗ | ✗ |
| LOWERED | - | ✗ | ✗ | ✓ |

## Aiming System

### Hip-Fire
- Default stance
- Weapon visible in lower-right viewport
- Crosshair active
- Full movement speed

### Aim Down Sights (ADS)
- Right-click to engage
- Weapon moves to center, sights align
- FOV zoom (optional)
- Reduced spread
- Movement speed penalty

### ADS Transition
```typescript
const adsProgress = 0 to 1;  // 0 = hip, 1 = full ADS

// Interpolate position
weaponRoot.position = Vector3.Lerp(hipPosition, adsPosition, adsProgress);
weaponRoot.rotation = Quaternion.Slerp(hipRotation, adsRotation, adsProgress);

// FOV adjustment
const adsFOVMultiplier = 0.85;  // 15% zoom
currentFOV = baseFOV * (1 - adsProgress * (1 - adsFOVMultiplier));
```

### Transition Speed
```typescript
const adsSpeed = 8;  // Transitions per second
adsProgress += (targetADS - adsProgress) * deltaTime * adsSpeed;
```

## Spread/Accuracy System

### Base Spread
Each weapon has a base spread value:
```typescript
interface WeaponSpread {
  baseSpread: number;        // Degrees, hip-fire
  adsSpread: number;         // Degrees, aimed
  movingMultiplier: number;  // 1.5x when walking
  sprintingMultiplier: number; // 3x when sprinting
  jumpingMultiplier: number; // 2x in air
  ledgeGrabMultiplier: number; // 5x while grabbing
  wallJumpMultiplier: number;  // 3x during wall jump
}
```

### Spread Calculation
```typescript
function calculateSpread(weapon: Weapon, playerState: PlayerState): number {
  let spread = weapon.baseSpread;
  
  // ADS reduces spread
  if (isAiming) {
    spread = weapon.adsSpread;
  }
  
  // Movement modifiers
  if (playerState.horizontalSpeed > 200) {
    spread *= weapon.movingMultiplier;
  }
  if (playerState.horizontalSpeed > 350) {
    spread *= weapon.sprintingMultiplier;
  }
  if (!playerState.isGrounded) {
    spread *= weapon.jumpingMultiplier;
  }
  
  // Special states
  if (playerState.ledgeGrabState === 'grabbing') {
    spread *= weapon.ledgeGrabMultiplier;
  }
  if (playerState.wallJumpState === 'charging') {
    spread *= weapon.wallJumpMultiplier;
  }
  
  return spread;
}
```

### Applying Spread
```typescript
function applySpread(direction: Vector3, spreadDegrees: number): Vector3 {
  const spreadRad = spreadDegrees * Math.PI / 180;
  
  // Random deviation within cone
  const angle = Math.random() * Math.PI * 2;
  const deviation = Math.random() * spreadRad;
  
  // Apply rotation to direction
  // ... quaternion math ...
  
  return deviatedDirection;
}
```

## Weapon Sway (Movement Integration)

### Idle Sway
Subtle breathing motion when standing still:
```typescript
const idleSwayX = Math.sin(time * 1.5) * 0.002;
const idleSwayY = Math.sin(time * 2.0) * 0.001;
```

### Movement Sway
Weapon lags behind camera rotation:
```typescript
// Track velocity of camera rotation
const rotationDelta = currentRotation - lastRotation;

// Apply lag
swayOffset.x += rotationDelta.y * swayAmount;
swayOffset.y += rotationDelta.x * swayAmount;

// Decay back to center
swayOffset *= 0.9;
```

### Walk Bob
Weapon follows walk bob cycle:
```typescript
// Sync with viewport walk bob
weaponOffset.y += Math.sin(walkCycle * 2) * bobAmount;
weaponOffset.x += Math.cos(walkCycle) * bobAmount * 0.5;
```

### Special States
```
┌────────────────┬─────────────────────────────────┐
│ State          │ Weapon Behavior                 │
├────────────────┼─────────────────────────────────┤
│ Sprinting      │ Lowered, more sway              │
│ Ledge Grab     │ One-handed, lowered, high spread│
│ Wall Jump      │ Quick tuck during charge        │
│ Landing        │ Impact dip (sync with viewport) │
│ Reloading      │ Animation + lower position      │
└────────────────┴─────────────────────────────────┘
```

## Ammunition System

### Ammo Types
```typescript
enum AmmoType {
  BULLETS = 'bullets',
  SHELLS = 'shells',
  ROCKETS = 'rockets',
  CELLS = 'cells',    // Plasma/energy
  SLUGS = 'slugs',
  GRENADES = 'grenades',
}
```

### Weapon Ammo Config
```typescript
interface WeaponAmmoConfig {
  ammoType: AmmoType;
  clipSize: number;       // Rounds per clip
  maxReserve: number;     // Max ammo (not in clip)
  reloadTime: number;     // Seconds
  fireRate: number;       // Rounds per second
  burstCount?: number;    // For burst-fire weapons
}
```

### Ammo State
```typescript
interface WeaponAmmoState {
  currentClip: number;    // Rounds in magazine
  reserveAmmo: number;    // Ammo not in clip
}
```

### Reload Logic
```typescript
function reload() {
  if (state !== 'IDLE') return;
  if (currentClip === clipSize) return;  // Already full
  if (reserveAmmo === 0) return;  // No ammo
  
  state = 'RELOADING';
  playAnimation('reload');
  
  setTimeout(() => {
    const needed = clipSize - currentClip;
    const available = Math.min(needed, reserveAmmo);
    currentClip += available;
    reserveAmmo -= available;
    state = 'IDLE';
  }, reloadTime * 1000);
}
```

## Weapon Definitions

### Example: Plasma Gun
```typescript
const plasmaGun: WeaponDefinition = {
  name: 'Plasma Gun',
  model: 'models/weapons/plasmagun/plasmagun.md3',
  
  // Positioning
  hipPosition: new Vector3(0.25, -0.25, 0.4),
  adsPosition: new Vector3(0, -0.12, 0.25),
  loweredPosition: new Vector3(0.35, -0.45, 0.3),
  
  // Spread
  baseSpread: 2.0,
  adsSpread: 0.5,
  movingMultiplier: 1.3,
  jumpingMultiplier: 1.8,
  
  // Ammo
  ammoType: AmmoType.CELLS,
  clipSize: 50,
  maxReserve: 200,
  reloadTime: 2.5,
  fireRate: 10,  // 10 shots/sec
  
  // Effects
  muzzleFlash: 'plasma_muzzle',
  projectile: 'plasma_bolt',
  fireSound: 'weapons/plasma/fire.wav',
  reloadSound: 'weapons/plasma/reload.wav',
};
```

## Weapon Stats & Classes

Different weapon types have fundamentally different stat profiles that affect gameplay:

### Weapon Stats Interface
```typescript
interface WeaponStats {
  // === DAMAGE ===
  damage: number;              // Base damage per shot
  damageType: 'hitscan' | 'projectile' | 'explosive';
  headshotMultiplier: number;  // 1.5 = +50% headshot damage
  
  // === ACCURACY ===
  baseSpread: number;          // Degrees, hip-fire spread cone
  adsSpread: number;           // Degrees, ADS spread (usually much lower)
  firstShotAccuracy: boolean;  // First shot always accurate?
  spreadRecovery: number;      // Degrees/sec, how fast spread recovers
  recoilPattern: Vector2[];    // Recoil kick pattern per shot
  
  // === MOVEMENT MODIFIERS ===
  movingSpreadMult: number;    // Spread multiplier when walking
  sprintingSpreadMult: number; // Spread multiplier when sprinting
  jumpingSpreadMult: number;   // Spread multiplier in air
  crouchingSpreadMult: number; // Spread multiplier when crouched (bonus)
  
  // === HANDLING ===
  adsSpeed: number;            // Time to ADS (seconds)
  adsMovementMult: number;     // Movement speed while ADS (0.5 = 50%)
  swapSpeed: number;           // Time to equip/holster
  weight: number;              // Affects movement speed when held
  
  // === FIRE RATE ===
  fireRate: number;            // Rounds per second
  fireMode: 'auto' | 'semi' | 'burst';
  burstCount?: number;         // Shots per burst
  burstDelay?: number;         // Delay between bursts
  
  // === AMMUNITION ===
  clipSize: number;
  maxReserve: number;
  reloadTime: number;          // Full reload time
  reloadType: 'magazine' | 'single';  // Magazine swap vs single shell
  
  // === RANGE ===
  range: number;               // Max effective range (units)
  falloffStart: number;        // Distance where damage starts dropping
  falloffEnd: number;          // Distance where damage is minimum
  minDamageMult: number;       // Minimum damage at max range (0.5 = 50%)
}
```

### Weapon Class Presets

#### SMG (Submachine Gun)
Fast fire rate, low damage, high mobility, significant spread
```typescript
const smgPreset: Partial<WeaponStats> = {
  damage: 15,
  damageType: 'hitscan',
  headshotMultiplier: 1.4,
  
  baseSpread: 4.0,           // High hip spread
  adsSpread: 1.5,            // Still notable spread ADS
  firstShotAccuracy: false,
  spreadRecovery: 15,        // Fast recovery
  
  movingSpreadMult: 1.1,     // Low moving penalty
  sprintingSpreadMult: 1.8,
  jumpingSpreadMult: 2.0,
  crouchingSpreadMult: 0.7,
  
  adsSpeed: 0.15,            // Fast ADS
  adsMovementMult: 0.85,     // Good mobility in ADS
  weight: 0.9,               // Light
  
  fireRate: 12,              // 720 RPM
  fireMode: 'auto',
  
  clipSize: 30,
  reloadTime: 1.8,
  
  range: 800,
  falloffStart: 300,
  falloffEnd: 600,
  minDamageMult: 0.6,
};
```

#### Assault Rifle
Balanced all-rounder, moderate stats across the board
```typescript
const assaultRiflePreset: Partial<WeaponStats> = {
  damage: 25,
  damageType: 'hitscan',
  headshotMultiplier: 1.5,
  
  baseSpread: 2.5,           // Moderate hip spread
  adsSpread: 0.3,            // Very accurate ADS
  firstShotAccuracy: true,   // First shot on point
  spreadRecovery: 10,
  
  movingSpreadMult: 1.4,
  sprintingSpreadMult: 2.5,
  jumpingSpreadMult: 3.0,
  crouchingSpreadMult: 0.6,
  
  adsSpeed: 0.25,            // Medium ADS
  adsMovementMult: 0.65,
  weight: 1.0,
  
  fireRate: 8,               // 480 RPM
  fireMode: 'auto',
  
  clipSize: 30,
  reloadTime: 2.2,
  
  range: 1500,
  falloffStart: 500,
  falloffEnd: 1000,
  minDamageMult: 0.7,
};
```

#### Sniper Rifle
High damage, very high accuracy, slow handling
```typescript
const sniperPreset: Partial<WeaponStats> = {
  damage: 100,
  damageType: 'hitscan',
  headshotMultiplier: 2.5,   // One-shot headshot
  
  baseSpread: 8.0,           // Terrible hip-fire
  adsSpread: 0.0,            // Perfect ADS accuracy
  firstShotAccuracy: true,
  spreadRecovery: 5,         // Slow recovery
  
  movingSpreadMult: 3.0,     // Heavy moving penalty
  sprintingSpreadMult: 5.0,
  jumpingSpreadMult: 8.0,    // Basically unusable in air
  crouchingSpreadMult: 0.5,
  
  adsSpeed: 0.45,            // Slow ADS
  adsMovementMult: 0.35,     // Very slow while scoped
  weight: 1.3,               // Heavy
  
  fireRate: 0.8,             // Bolt action ~48 RPM
  fireMode: 'semi',
  
  clipSize: 5,
  reloadTime: 3.5,
  
  range: 5000,               // Very long range
  falloffStart: 2000,
  falloffEnd: 4000,
  minDamageMult: 0.9,        // Maintains damage at range
};
```

#### Shotgun
High close-up damage, spread pellets, poor range
```typescript
const shotgunPreset: Partial<WeaponStats> = {
  damage: 12,                // Per pellet, 8 pellets = 96 max
  damageType: 'hitscan',
  headshotMultiplier: 1.2,
  
  baseSpread: 6.0,           // Wide pellet spread
  adsSpread: 4.0,            // Still wide ADS
  firstShotAccuracy: false,
  
  movingSpreadMult: 1.0,     // Same moving
  sprintingSpreadMult: 1.3,
  jumpingSpreadMult: 1.5,
  crouchingSpreadMult: 0.85,
  
  adsSpeed: 0.2,
  adsMovementMult: 0.7,
  weight: 1.1,
  
  fireRate: 1.2,             // Pump action
  fireMode: 'semi',
  
  clipSize: 8,
  reloadTime: 0.5,           // Per shell
  reloadType: 'single',
  
  range: 400,                // Short range
  falloffStart: 50,
  falloffEnd: 200,
  minDamageMult: 0.2,        // Very weak at range
};
```

#### LMG (Light Machine Gun)
High capacity, sustained fire, heavy and slow
```typescript
const lmgPreset: Partial<WeaponStats> = {
  damage: 28,
  damageType: 'hitscan',
  headshotMultiplier: 1.4,
  
  baseSpread: 5.0,           // Poor hip accuracy
  adsSpread: 1.0,            // Better ADS but not great
  firstShotAccuracy: false,
  spreadRecovery: 6,         // Slow recovery
  
  movingSpreadMult: 1.8,
  sprintingSpreadMult: 4.0,  // Terrible while sprinting
  jumpingSpreadMult: 5.0,
  crouchingSpreadMult: 0.5,  // Designed for mounted/crouched
  
  adsSpeed: 0.4,             // Slow ADS
  adsMovementMult: 0.4,      // Very slow ADS movement
  weight: 1.5,               // Very heavy
  
  fireRate: 10,              // 600 RPM
  fireMode: 'auto',
  
  clipSize: 100,             // Large magazine
  reloadTime: 5.0,           // Long reload
  
  range: 1200,
  falloffStart: 400,
  falloffEnd: 800,
  minDamageMult: 0.65,
};
```

#### Pistol / Sidearm
Backup weapon, fast swap, moderate stats
```typescript
const pistolPreset: Partial<WeaponStats> = {
  damage: 22,
  damageType: 'hitscan',
  headshotMultiplier: 1.8,
  
  baseSpread: 2.0,
  adsSpread: 0.5,
  firstShotAccuracy: true,
  spreadRecovery: 20,        // Very fast recovery
  
  movingSpreadMult: 1.1,
  sprintingSpreadMult: 1.5,
  jumpingSpreadMult: 1.8,
  crouchingSpreadMult: 0.7,
  
  adsSpeed: 0.12,            // Very fast ADS
  adsMovementMult: 0.9,      // Great mobility
  swapSpeed: 0.3,            // Fast swap
  weight: 0.6,               // Very light
  
  fireRate: 6,               // Semi-auto
  fireMode: 'semi',
  
  clipSize: 12,
  reloadTime: 1.5,
  
  range: 600,
  falloffStart: 200,
  falloffEnd: 400,
  minDamageMult: 0.5,
};
```

### Weapon Class Comparison Table

| Stat | SMG | AR | Sniper | Shotgun | LMG | Pistol |
|------|-----|----|----|---------|-----|--------|
| **Damage** | 15 | 25 | 100 | 12×8 | 28 | 22 |
| **Fire Rate** | 12 | 8 | 0.8 | 1.2 | 10 | 6 |
| **Base Spread** | 4.0° | 2.5° | 8.0° | 6.0° | 5.0° | 2.0° |
| **ADS Spread** | 1.5° | 0.3° | 0.0° | 4.0° | 1.0° | 0.5° |
| **ADS Speed** | 0.15s | 0.25s | 0.45s | 0.2s | 0.4s | 0.12s |
| **Clip Size** | 30 | 30 | 5 | 8 | 100 | 12 |
| **Reload Time** | 1.8s | 2.2s | 3.5s | 4s | 5.0s | 1.5s |
| **Weight** | 0.9 | 1.0 | 1.3 | 1.1 | 1.5 | 0.6 |
| **Range** | 800 | 1500 | 5000 | 400 | 1200 | 600 |

### Movement Penalty by Weapon Class
Heavier weapons reduce movement speed:
```typescript
const baseSpeed = 280;  // sv_movementSpeed
const actualSpeed = baseSpeed * (1 - (weapon.weight - 1) * 0.15);

// Examples:
// Pistol (0.6): 280 * 1.06 = 297 (faster)
// AR (1.0): 280 * 1.0 = 280 (normal)
// LMG (1.5): 280 * 0.925 = 259 (slower)
```

## CVars

### Weapon View
| Cvar | Default | Description |
|------|---------|-------------|
| `cg_weaponfov` | 75 | Weapon model FOV |
| `cg_weaponsway` | 1.0 | Weapon sway amount |
| `cg_weaponbob` | 1.0 | Weapon bob amount |
| `cg_drawweapon` | 1 | Show weapon model |

### Aiming
| Cvar | Default | Description |
|------|---------|-------------|
| `cg_adsspeed` | 8 | ADS transition speed |
| `cg_adsfov` | 0.85 | FOV multiplier when ADS |

### Spread
| Cvar | Default | Description |
|------|---------|-------------|
| `sv_spreadmultiplier` | 1.0 | Global spread scale |

## Implementation Plan

### Phase 1: View Model Foundation
1. Create WeaponViewManager class
2. Load MD3 model and attach to camera
3. Position weapon in hip-fire stance
4. Basic idle sway animation

### Phase 2: Weapon States
1. Implement state machine
2. Create firing state with cooldown
3. Add reload state with animation
4. Weapon switching

### Phase 3: Aiming System
1. ADS toggle/hold implementation
2. Position interpolation hip ↔ ADS
3. FOV zoom during ADS
4. Spread reduction

### Phase 4: Spread & Accuracy
1. Base spread calculation
2. Movement modifiers
3. Special state modifiers
4. Apply spread to projectile/hitscan

### Phase 5: Movement Integration
1. Sync with viewport walk bob
2. Camera rotation sway
3. Lowered weapon during sprint
4. Ledge grab/wall jump reactions

### Phase 6: Ammunition
1. Clip and reserve tracking
2. Reload mechanic
3. Ammo pickup system
4. HUD display

## File Structure

```
src/
├── engine/
│   └── weapon/
│       ├── WeaponViewManager.ts   // View model management
│       ├── WeaponState.ts         // State machine
│       ├── WeaponSway.ts          // Movement integration
│       └── index.ts
│
└── game/
    └── weapons/
        ├── WeaponDefinition.ts    // Weapon config interface
        ├── WeaponInventory.ts     // Ammo, switching
        ├── WeaponSpread.ts        // Spread calculation
        ├── definitions/
        │   ├── PlasmaGun.ts
        │   ├── RocketLauncher.ts
        │   └── ...
        └── index.ts
```

## Integration Points

### FPSController
Expose player state for spread calculation:
- Movement speed
- Grounded state
- Ledge grab state
- Wall jump state

### Viewport Effects
Weapon should react to same effects:
- Walk bob
- Landing impact
- Strafe lean

### Input System
New bindings needed:
- Fire (Mouse1)
- ADS (Mouse2)
- Reload (R)
- Switch weapons (1-9, scroll)

## Future Enhancements

1. **Dual wielding** - Two weapon view models
2. **Melee weapons** - Different state machine
3. **Throwables** - Grenades with arc preview
4. **Attachments** - Sights, suppressors, etc.
5. **Procedural recoil** - Camera kick patterns
6. **Shell casings** - Ejected brass particles
7. **Dynamic crosshairs** - Spread visualization
