# Scripted Gametype System - Design Document

**Date:** 2026-01-27  
**Status:** Planning

---

## Philosophy

Like Warsow's AngelScript gametypes, we want:
- **Scripted gametypes** that can be modified without recompiling
- **Unified API** for shared systems (weapons, items, entities)
- **Gametype-specific extensions** (e.g., bomb entity for Bomb/Defuse mode)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     GAMETYPE SCRIPT (TypeScript/JS)               │
│  - dm.js, ctf.js, bomb.js                                        │
│  - Implements Gametype interface                                 │
│  - Can define custom entities                                    │
└───────────────────────────────┬──────────────────────────────────┘
                                │ uses
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      GAMELIB API (Engine-provided)               │
├──────────────────────────────────────────────────────────────────┤
│  Weapons       │  Items        │  Entities      │  Utils         │
│  - Railgun     │  - Armor      │  - Player      │  - Vector math │
│  - Rocket      │  - Health     │  - Projectile  │  - Timers      │
│  - Plasma      │  - Powerups   │  - Trigger     │  - Events      │
│  - Grenade     │  - Ammo       │  - Door        │  - Spawns      │
└──────────────────────────────────────────────────────────────────┘
                                │ 
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                        ENGINE CORE                                │
│  - Entity/Component System                                       │
│  - Physics (collision, movement)                                 │
│  - Network (state sync, input)                                   │
│  - BSP loading                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Gamelib API

The engine provides a "game library" that all gametypes share:

### Weapons (shared)

```typescript
// gamelib/weapons/index.ts
export interface Weapon {
  id: string;
  name: string;
  ammoType: AmmoType;
  
  // Stats
  damage: number;
  fireRate: number;      // shots per second
  ammoPerShot: number;
  projectileSpeed?: number;
  
  // Behavior
  onFire(owner: Player, direction: Vec3): Projectile | HitscanResult;
  onAltFire?(owner: Player, direction: Vec3): void;
}

// Built-in weapons
export const weapons = {
  machinegun: new MachinegunWeapon(),
  shotgun: new ShotgunWeapon(),
  rocketlauncher: new RocketLauncherWeapon(),
  railgun: new RailgunWeapon(),
  plasmagun: new PlasmagunWeapon(),
  grenadelauncher: new GrenadeLauncherWeapon(),
  lightninggun: new LightningGunWeapon(),
};
```

### Items (shared)

```typescript
// gamelib/items/index.ts
export interface Item {
  id: string;
  name: string;
  type: 'health' | 'armor' | 'ammo' | 'weapon' | 'powerup';
  
  respawnTime: number;  // Default, gametype can override
  
  onPickup(player: Player): PickupResult;
  canPickup(player: Player): boolean;
}

export const items = {
  // Health
  health_small: new HealthItem(5),
  health_medium: new HealthItem(25),
  health_large: new HealthItem(50),
  health_mega: new MegaHealthItem(100),
  
  // Armor
  armor_shard: new ArmorItem(5),
  armor_combat: new ArmorItem(50),
  armor_body: new ArmorItem(100),
  armor_red: new RedArmorItem(200),
  
  // Ammo
  ammo_bullets: new AmmoItem('bullets', 50),
  ammo_shells: new AmmoItem('shells', 10),
  ammo_rockets: new AmmoItem('rockets', 5),
  // etc.
  
  // Powerups
  quad_damage: new QuadDamageItem(),
  haste: new HasteItem(),
  invisibility: new InvisibilityItem(),
};
```

### Entities (shared base + gametype extensions)

```typescript
// gamelib/entities/index.ts
export interface GameEntity {
  id: string;
  type: string;
  position: Vec3;
  rotation: Quaternion;
  
  think?(dt: number): void;
  touch?(other: GameEntity): void;
  takeDamage?(damage: number, attacker: Player | null): void;
  die?(): void;
}

// Built-in entity types
export class ProjectileEntity implements GameEntity { ... }
export class TriggerEntity implements GameEntity { ... }
export class DoorEntity implements GameEntity { ... }
export class TeleporterEntity implements GameEntity { ... }
```

### Gametype-Specific Entities

Gametypes can define their own entities:

```typescript
// gametypes/ctf/entities/flag.ts
export class FlagEntity implements GameEntity {
  team: TeamId;
  carrier: Player | null = null;
  atBase: boolean = true;
  
  touch(other: GameEntity): void {
    if (other instanceof PlayerEntity) {
      const player = other.player;
      if (player.team === this.team && !this.atBase) {
        // Return own flag
        this.returnToBase();
      } else if (player.team !== this.team) {
        // Take enemy flag
        this.carrier = player;
        this.atBase = false;
      }
    }
  }
}

// gametypes/bomb/entities/bomb.ts  
export class BombEntity implements GameEntity {
  planted: boolean = false;
  plantTime: number = 0;
  fuseTime: number = 45;
  
  think(dt: number): void {
    if (this.planted) {
      if (Date.now() - this.plantTime >= this.fuseTime * 1000) {
        this.explode();
      }
    }
  }
  
  plant(player: Player): void { ... }
  defuse(player: Player): void { ... }
  explode(): void { ... }
}
```

---

## Gametype Script Structure

```
gametypes/
├── dm/
│   ├── gametype.ts      # Main gametype class
│   └── config.json      # Default settings
│
├── ctf/
│   ├── gametype.ts
│   ├── config.json
│   └── entities/
│       └── flag.ts      # CTF-specific entities
│
├── bomb/
│   ├── gametype.ts
│   ├── config.json
│   └── entities/
│       ├── bomb.ts
│       └── bombsite.ts
│
├── race/
│   ├── gametype.ts
│   ├── config.json
│   └── entities/
│       ├── checkpoint.ts
│       └── startline.ts
│
└── instagib/
    └── gametype.ts      # Just modifies weapon loadout, no custom entities
```

---

## Gametype Loading

```typescript
// server/GametypeLoader.ts
class GametypeLoader {
  private gamelib: Gamelib;
  
  constructor() {
    // Initialize shared game library
    this.gamelib = new Gamelib();
  }
  
  async load(gametypeName: string): Promise<Gametype> {
    // Load gametype script
    const scriptPath = `gametypes/${gametypeName}/gametype.ts`;
    
    // Compile TypeScript to JS (if needed) or load pre-compiled
    const gametypeModule = await import(scriptPath);
    
    // Create instance, inject gamelib
    const gametype = new gametypeModule.default(this.gamelib);
    
    // Load gametype-specific entities
    await this.loadGametypeEntities(gametypeName, gametype);
    
    return gametype;
  }
  
  private async loadGametypeEntities(name: string, gt: Gametype): Promise<void> {
    const entitiesPath = `gametypes/${name}/entities/`;
    // Dynamic import all entity files
    // Register with entity factory
  }
}
```

---

## Gamelib Context

Passed to gametype scripts:

```typescript
interface Gamelib {
  // Shared systems
  weapons: typeof weapons;
  items: typeof items;
  
  // Entity management
  spawn<T extends GameEntity>(type: string, pos: Vec3, props?: object): T;
  remove(entity: GameEntity): void;
  findEntities(filter: (e: GameEntity) => boolean): GameEntity[];
  
  // Player management
  getPlayers(): Player[];
  getPlayer(id: string): Player | null;
  respawnPlayer(player: Player, spawnPoint: SpawnPoint): void;
  giveWeapon(player: Player, weapon: Weapon, ammo?: number): void;
  giveItem(player: Player, item: Item): void;
  
  // World
  getSpawnPoints(filter?: string): SpawnPoint[];
  trace(start: Vec3, end: Vec3): TraceResult;
  
  // Events
  broadcast(event: GametypeEvent): void;
  sendToPlayer(player: Player, event: GametypeEvent): void;
  
  // Timers
  setTimeout(callback: () => void, ms: number): TimerId;
  setInterval(callback: () => void, ms: number): TimerId;
  clearTimer(id: TimerId): void;
  
  // Config
  getConfig<T>(key: string, defaultValue: T): T;
  
  // Logging
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
```

---

## Example: Instagib Gametype

A minimal gametype that just modifies loadout:

```typescript
// gametypes/instagib/gametype.ts
import { BaseGametype } from '../BaseGametype';
import { Gamelib, SpawnConfig } from '../../gamelib';

export default class InstagibGametype extends BaseGametype {
  readonly name = "InstaGib";
  readonly shortName = "ig";
  readonly description = "One-shot railgun kills";
  
  constructor(gamelib: Gamelib) {
    super(gamelib);
    
    // Modify railgun to be one-shot kill
    this.customRailgun = {
      ...gamelib.weapons.railgun,
      damage: 9999,  // Instant kill
    };
  }
  
  onPlayerSpawn(player: Player): SpawnConfig {
    return {
      ...super.onPlayerSpawn(player),
      loadout: {
        weapons: [this.customRailgun],
        ammo: { cells: 999 },
        health: 100,
        armor: 0,  // No armor in instagib
      }
    };
  }
  
  getSpawnableItems(): ItemFlags {
    // No items spawn in instagib
    return ItemFlags.NONE;
  }
}
```

---

## Example: Bomb/Defuse Gametype

A complex gametype with custom entities:

```typescript
// gametypes/bomb/gametype.ts
import { BaseGametype, RoundBasedMixin } from '../BaseGametype';
import { BombEntity } from './entities/bomb';
import { BombsiteEntity } from './entities/bombsite';

export default class BombGametype extends RoundBasedMixin(BaseGametype) {
  readonly name = "Bomb & Defuse";
  readonly shortName = "bomb";
  readonly maxTeams = 2;
  
  private bombsites: BombsiteEntity[] = [];
  private bomb: BombEntity | null = null;
  
  init(context: GametypeContext): void {
    super.init(context);
    
    // Register custom entities
    this.gamelib.registerEntity('bomb', BombEntity);
    this.gamelib.registerEntity('bombsite', BombsiteEntity);
    
    // Find bombsites in map
    this.bombsites = this.gamelib.findEntities(e => e.type === 'bombsite');
  }
  
  onRoundStart(): void {
    // Give bomb to random attacker
    const attackers = this.getTeamPlayers('attackers');
    const carrier = attackers[Math.floor(Math.random() * attackers.length)];
    
    this.bomb = this.gamelib.spawn<BombEntity>('bomb', carrier.position);
    carrier.inventory.add(this.bomb);
  }
  
  onBombPlanted(player: Player, site: BombsiteEntity): void {
    this.bomb!.plant(player);
    this.gamelib.broadcast({ type: 'bomb_planted', site: site.id });
    
    // Start defuse timer
    this.gamelib.setTimeout(() => this.checkBombExplode(), 45000);
  }
  
  onBombDefused(player: Player): void {
    this.bomb!.defuse(player);
    this.endRound('defenders');
  }
}
```

---

## Runtime vs Compiled

### Option A: Compiled TypeScript (Recommended for now)
- Gametypes written in TypeScript
- Compiled to JS at build time
- Server loads compiled JS
- **Pros:** Type safety, familiar, fast
- **Cons:** Requires rebuild for changes

### Option B: Runtime Scripts
- Load .ts or .js at runtime
- Use `ts-node` or bundled TypeScript compiler
- **Pros:** Hot reload, modding-friendly
- **Cons:** Slower startup, larger bundle

**Decision:** Start with Option A (compiled), add Option B later for modding support.

---

## File Layout

```
src/
├── server/
│   ├── GameServer.ts
│   └── GametypeLoader.ts
│
├── gamelib/                    # Shared game library
│   ├── index.ts               # Exports all APIs
│   ├── weapons/
│   │   ├── Weapon.ts          # Base interface
│   │   ├── MachinegunWeapon.ts
│   │   ├── RocketLauncherWeapon.ts
│   │   └── ...
│   ├── items/
│   │   ├── Item.ts
│   │   ├── HealthItem.ts
│   │   └── ...
│   ├── entities/
│   │   ├── GameEntity.ts
│   │   ├── ProjectileEntity.ts
│   │   └── ...
│   └── Gamelib.ts             # Context passed to gametypes
│
└── gametypes/                  # Gametype scripts
    ├── BaseGametype.ts        # Common base class
    ├── dm/
    ├── tdm/
    ├── ctf/
    ├── duel/
    ├── instagib/
    └── bomb/
```

---

## Summary

| Layer | Description |
|-------|-------------|
| **Gametype Script** | Defines rules, scoring, custom entities |
| **Gamelib API** | Shared weapons, items, entities, utilities |
| **Engine Core** | Physics, network, ECS, rendering |

This gives us Warsow-style modding capability while keeping shared systems unified!
