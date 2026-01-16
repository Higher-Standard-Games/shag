# Entity Definition System

A comprehensive system for defining game entities with shared server/client definitions, enabling authoritative gameplay with rich client-side visuals.

## Overview

The Entity Definition System provides:
1. **Shared Definitions** - Same data structures used by server and client
2. **Server Authority** - Critical gameplay values enforced server-side
3. **Client Visuals** - Rich rendering, sounds, effects on client
4. **Network Efficiency** - Only IDs transmitted, not full definitions
5. **Extensibility** - Easy to add new entity types

## The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ENTITY DEFINITION SYSTEM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    SHARED DEFINITIONS (src/shared/)                  │    │
│  │                                                                      │    │
│  │   EntityDef (base)                                                   │    │
│  │     ├── id, name, type                                               │    │
│  │     ├── modelPath, textures, scale                                   │    │
│  │     └── sounds, effects                                              │    │
│  │                                                                      │    │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │   │ WeaponDef│ │Projectile│ │ PickupDef│ │ PlayerDef│ │ PropDef  │  │    │
│  │   │          │ │   Def    │ │          │ │          │ │          │  │    │
│  │   │ fireRate │ │ speed    │ │ quantity │ │ health   │ │ physics  │  │    │
│  │   │ damage   │ │ damage   │ │ respawn  │ │ hitbox   │ │ breakable│  │    │
│  │   │ ammo     │ │ splash   │ │ effect   │ │ speed    │ │ mass     │  │    │
│  │   │ spread   │ │ lifetime │ │          │ │          │ │          │  │    │
│  │   └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                    ┌───────────────┴───────────────┐                        │
│                    ▼                               ▼                        │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │         SERVER              │  │              CLIENT                  │  │
│  │                             │  │                                      │  │
│  │  Uses definitions for:      │  │  Uses definitions for:               │  │
│  │  ✓ Damage calculation       │  │  ✓ Model loading                     │  │
│  │  ✓ Fire rate validation     │  │  ✓ Animation playback                │  │
│  │  ✓ Hit detection            │  │  ✓ Sound effects                     │  │
│  │  ✓ Ammo management          │  │  ✓ Particle effects                  │  │
│  │  ✓ Respawn timing           │  │  ✓ Muzzle flash                      │  │
│  │  ✓ Anti-cheat validation    │  │  ✓ Client prediction                 │  │
│  │                             │  │                                      │  │
│  │  EntityInstance             │  │  EntityInstance + Visual             │  │
│  │  (gameplay state only)      │  │  (state + meshes + effects)          │  │
│  └─────────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Requirements

### 1. Server Authority
- All gameplay-critical values MUST be server-authoritative
- Client cannot modify: damage, fire rate, health, ammo, timing
- Client CAN modify: visual effects, sounds, model LOD (but not hitbox)

### 2. Shared Code
- Definitions must be importable by both server and client
- No browser-specific or Node-specific code in shared definitions
- Use abstract types that work everywhere

### 3. Network Efficiency
- Only entity IDs transmitted over network
- Both sides have same definition registry
- State changes are deltas, not full objects

### 4. Extensibility
- Easy to add new entity types
- Easy to add new properties to existing types
- Backward compatible when adding fields

### 5. Loading Sources
- Hardcoded TypeScript (development, core entities)
- JSON files in PK3s (modding, custom content)
- Server-sent definitions (dynamic content)

## Entity Type Hierarchy

```typescript
// Base entity definition - everything shares this
interface EntityDef {
    // === IDENTITY ===
    id: string;              // Unique identifier (e.g., "plasmagun", "health_large")
    name: string;            // Display name
    type: EntityType;        // Type enum for categorization
    
    // === VISUALS ===
    modelPath?: string;      // Primary 3D model (MD3/GLB path)
    texturePaths?: string[]; // Texture overrides
    scale?: number;          // Model scale
    
    // === SOUNDS ===
    sounds?: {
        [key: string]: string;  // Named sounds (e.g., "spawn", "pickup", "idle")
    };
    
    // === EFFECTS ===
    effects?: {
        [key: string]: string;  // Named effects (e.g., "trail", "impact", "glow")
    };
}

// Entity type enumeration
enum EntityType {
    WEAPON = 'weapon',
    PROJECTILE = 'projectile',
    PICKUP = 'pickup',
    PLAYER = 'player',
    PROP = 'prop',
    TRIGGER = 'trigger',
    EFFECT = 'effect',
}
```

## Specialized Definitions

### WeaponDef
```typescript
interface WeaponDef extends EntityDef {
    type: EntityType.WEAPON;
    
    // === SERVER-AUTHORITATIVE (gameplay) ===
    damage: number;
    fireRate: number;           // Rounds per second
    clipSize: number;
    maxAmmo: number;
    reloadTime: number;
    spread: WeaponSpread;       // Accuracy settings
    projectileId?: string;      // If projectile weapon
    hitscan?: boolean;          // If instant hit
    range: number;
    
    // === CLIENT-SIDE (visuals) ===
    viewModel: ViewModelDef;    // First-person model settings
    worldModel?: string;        // Third-person/pickup model
    
    muzzleFlash: MuzzleFlashDef;
    shellEject?: ShellEjectDef;
    
    sounds: {
        fire: string;
        reload: string;
        empty: string;
        switchTo?: string;
        switchAway?: string;
    };
    
    // === ADS (Aim Down Sights) ===
    ads: ADSDef;
}

interface ViewModelDef {
    modelPath: string;
    handModelPath?: string;
    hipOffset: Vector3;
    hipRotation: Vector3;
    adsOffset: Vector3;
    adsRotation: Vector3;
    scale: number;
}

interface ADSDef {
    time: number;              // Time to ADS (seconds)
    fovReduction: number;      // FOV reduction percentage
    sensitivity: number;       // Sensitivity multiplier (0-1)
    movementPenalty: number;   // Movement speed penalty (0-1)
}

interface MuzzleFlashDef {
    color: { r: number; g: number; b: number };
    intensity: number;
    range: number;
    duration: number;
    modelPath?: string;        // Flash sprite/model
}
```

### ProjectileDef
```typescript
interface ProjectileDef extends EntityDef {
    type: EntityType.PROJECTILE;
    
    // === SERVER-AUTHORITATIVE ===
    speed: number;
    damage: number;
    splashDamage?: number;
    splashRadius?: number;
    lifetime: number;          // Max time before despawn
    gravity?: number;          // Gravity multiplier (0 = none)
    bounces?: number;          // Number of bounces (0 = explode on hit)
    
    // === CLIENT-SIDE ===
    trailEffect?: string;      // Particle trail
    impactEffect?: string;     // Impact/explosion effect
    lightColor?: { r: number; g: number; b: number };
    lightIntensity?: number;
    
    sounds: {
        fly?: string;          // Loop while flying
        impact: string;        // On hit
        bounce?: string;       // On bounce
    };
}
```

### PickupDef
```typescript
interface PickupDef extends EntityDef {
    type: EntityType.PICKUP;
    
    // === SERVER-AUTHORITATIVE ===
    pickupType: 'health' | 'armor' | 'ammo' | 'weapon' | 'powerup';
    quantity: number;          // Amount to give
    maxQuantity?: number;      // Cap (don't pick up if player at max)
    respawnTime: number;       // Seconds until respawn (0 = no respawn)
    weaponId?: string;         // If weapon pickup, which weapon
    ammoType?: string;         // If ammo pickup, which type
    
    // === CLIENT-SIDE ===
    bobHeight?: number;        // Floating bob amplitude
    bobSpeed?: number;         // Floating bob speed
    rotateSpeed?: number;      // Rotation speed
    glowColor?: { r: number; g: number; b: number };
    
    sounds: {
        pickup: string;
        respawn?: string;
    };
}
```

## Entity Registry

Central registry for all entity definitions:

```typescript
class EntityRegistry {
    private static instance: EntityRegistry;
    private definitions: Map<string, EntityDef> = new Map();
    
    // Register a definition
    register<T extends EntityDef>(def: T): void {
        this.definitions.set(def.id, def);
    }
    
    // Get by ID (type-safe)
    get<T extends EntityDef>(id: string): T | undefined {
        return this.definitions.get(id) as T;
    }
    
    // Get all of a type
    getByType<T extends EntityDef>(type: EntityType): T[] {
        return [...this.definitions.values()]
            .filter(def => def.type === type) as T[];
    }
    
    // Get weapon specifically
    getWeapon(id: string): WeaponDef | undefined {
        const def = this.get(id);
        return def?.type === EntityType.WEAPON ? def as WeaponDef : undefined;
    }
    
    // Load from JSON (for PK3 content)
    async loadFromJSON(path: string): Promise<void> {
        // Parse JSON, validate, register
    }
}
```

## Server/Client Split

### What Server Owns (Authoritative)
| Property | Reason |
|----------|--------|
| `damage` | Prevent damage hacks |
| `fireRate` | Prevent rapid fire hacks |
| `clipSize`, `maxAmmo` | Prevent infinite ammo |
| `reloadTime` | Prevent instant reload |
| `speed` (projectile) | Prevent speed hacks |
| `respawnTime` | Prevent spawn camping exploits |
| `health`, `armor` (player) | Prevent god mode |

### What Client Owns (Cosmetic)
| Property | Reason |
|----------|--------|
| `modelPath` | Visual only |
| `muzzleFlash` | Effect only |
| `sounds` | Audio only |
| `effects` | Particles only |
| `bobHeight`, `rotateSpeed` | Animation only |
| `scale` (visual) | Display only |

### Hybrid Properties
| Property | Server Uses | Client Uses |
|----------|-------------|-------------|
| `spread` | Calculate hit chance | Show crosshair bloom |
| `range` | Limit hit detection | Fade tracers |
| `adsTime` | Validate aim timing | Animate transition |

## Network Protocol

### Entity Spawn
```typescript
// Server → Client
interface EntitySpawnMessage {
    entityId: number;        // Runtime instance ID
    defId: string;           // Definition ID (e.g., "plasmagun")
    position: Vector3;
    rotation: Quaternion;
    state?: Record<string, unknown>;  // Initial state
}
```

### Entity Update
```typescript
// Server → Client  
interface EntityUpdateMessage {
    entityId: number;
    position?: Vector3;
    rotation?: Quaternion;
    state?: Record<string, unknown>;  // Changed state only
}
```

### Weapon Fire
```typescript
// Client → Server
interface FireRequestMessage {
    weaponId: string;
    aimDirection: Vector3;
    timestamp: number;
}

// Server → All Clients
interface WeaponFiredMessage {
    playerId: string;
    weaponId: string;
    origin: Vector3;
    direction: Vector3;
    // Client uses weaponId to look up muzzle flash, sound, etc.
}
```

## File Structure

```
src/
├── shared/                      # Shared between server and client
│   └── entities/
│       ├── EntityDef.ts         # Base interface
│       ├── EntityType.ts        # Type enum
│       ├── EntityRegistry.ts    # Registry class
│       ├── WeaponDef.ts         # Weapon interface
│       ├── ProjectileDef.ts     # Projectile interface
│       ├── PickupDef.ts         # Pickup interface
│       └── definitions/         # Actual definitions
│           ├── weapons/
│           │   ├── plasmagun.ts
│           │   ├── rocketlauncher.ts
│           │   └── index.ts
│           ├── projectiles/
│           │   ├── plasma_bolt.ts
│           │   └── rocket.ts
│           └── pickups/
│               ├── health.ts
│               └── armor.ts
│
├── engine/                      # Client-side engine
│   └── entity/
│       ├── EntityManager.ts     # Client entity management
│       ├── EntityRenderer.ts    # Render entities with definitions
│       └── EntityEffects.ts     # Apply effects from definitions
│
└── server/                      # Server-side (future)
    └── entity/
        ├── EntityManager.ts     # Server entity management
        └── EntityValidator.ts   # Validate client requests
```

## Loading Priority

1. **Core Definitions** (TypeScript)
   - Built into game, always available
   - Weapons, projectiles, pickups from base game

2. **PK3 Definitions** (JSON)
   - Loaded from game data files
   - Can override core definitions
   - Mods can add new definitions

3. **Server Overrides** (Network)
   - Server can send modified definitions
   - For custom game modes, balance tweaks
   - Client must accept or disconnect

## Open Questions

1. **Version compatibility?**
   - What if server has newer definition?
   - Graceful degradation for unknown fields?

2. **Validation schema?**
   - How to validate JSON definitions?
   - What errors are fatal vs warnings?

3. **Hot reloading?**
   - Can definitions reload during gameplay?
   - How to handle instances with old definitions?

4. **Inheritance?**
   - Can definitions extend others?
   - `plasmagun_rapid` extends `plasmagun` with different `fireRate`?

5. **Localization?**
   - Where do display names come from?
   - Separate localization files?

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `src/shared/entities/` structure
- [ ] Implement `EntityDef` base interface
- [ ] Implement `EntityRegistry` singleton
- [ ] Migrate existing `WeaponDef` to new system

### Phase 2: Weapon Definitions
- [ ] Define full `WeaponDef` interface
- [ ] Create plasmagun definition
- [ ] Update `WeaponViewManager` to use registry
- [ ] Muzzle flash from definition

### Phase 3: Projectiles
- [ ] Implement `ProjectileDef`
- [ ] Create plasma bolt definition
- [ ] Basic projectile spawning (visual only)

### Phase 4: Pickups
- [ ] Implement `PickupDef`
- [ ] Create health/armor definitions
- [ ] Pickup rendering with effects

### Phase 5: Server Integration
- [ ] Server entity validation
- [ ] Network spawn/update messages
- [ ] Client prediction

## References

- Quake 3 Arena entity system
- Warsow weapon definitions
- Source Engine entity system
- Unity ScriptableObjects pattern
