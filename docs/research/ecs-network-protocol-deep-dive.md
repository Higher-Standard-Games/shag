# Deep Dive: Entity-Component System & Network Protocol

> **Date:** 2026-01-31  
> **Status:** Design Phase  
> **Goal:** COW-compatible ECS that works with BSP collision and efficient network sync

---

## Part 1: Entity-Component System (ECS)

### Current System Analysis

Our existing ECS is a **lightweight component container model**:

```typescript
// Current Entity - Simple component bag
class Entity {
  readonly id: EntityId;
  protected components: Map<string, IComponent>;
  
  getComponent<T>(type: string): T | undefined;
  addComponent(type: string, component: IComponent): void;
  clone(): Entity;
}

// Components implement serialize/deserialize/clone
interface IComponent {
  serialize(encoder: BinaryEncoder): void;
  deserialize(decoder: BinaryDecoder): void;
  clone(): IComponent;
}
```

**Strengths:**
- Simple, easy to understand
- Components already have clone() for snapshots
- Binary serialization built-in
- Works with our collision system

**Weaknesses:**
- String-based component lookup (Map overhead, typo-prone)
- No COW - full clone on every tick
- Iteration requires filtering all entities

---

### New Design: COW Entity System

#### Core Principles

1. **Entity is immutable after creation** - all modifications via `getEntityMut()`
2. **Components are data** - minimal methods, mostly fields
3. **Systems operate on queries** - don't iterate all entities
4. **BSP collision is stateless** - geometry queries, not entity owner

#### Entity Design

```typescript
// ═══════════════════════════════════════════════════════════════════
// BRANDED TYPES
// ═══════════════════════════════════════════════════════════════════

/** Server assigns, globally unique */
export type EntityId = number & { readonly __brand: 'entityId' };

/** Server assigns, player-scoped */  
export type PlayerId = number & { readonly __brand: 'playerId' };

/** Tick number - monotonic, resets on match start */
export type TickNumber = number & { readonly __brand: 'tick' };

// ═══════════════════════════════════════════════════════════════════
// ENTITY
// ═══════════════════════════════════════════════════════════════════

/**
 * Entity - Immutable container for components
 * 
 * Components stored as direct properties for performance.
 * Optional components are undefined when not present.
 */
export class Entity {
  readonly id: EntityId;
  readonly type: EntityType;
  
  // Core components (optional)
  transform?: TransformComponent;
  physics?: PhysicsComponent;
  input?: InputComponent;
  health?: HealthComponent;
  
  // Game-specific (FPS)
  weapon?: WeaponComponent;
  projectile?: ProjectileComponent;
  
  // Game-specific (RTS)
  unit?: UnitComponent;
  building?: BuildingComponent;
  
  constructor(id: EntityId, type: EntityType) {
    this.id = id;
    this.type = type;
  }
  
  /**
   * Clone entity - used by COW when first write occurs
   */
  clone(): Entity {
    const cloned = new Entity(this.id, this.type);
    
    // Clone each component that exists
    if (this.transform) cloned.transform = this.transform.clone();
    if (this.physics) cloned.physics = this.physics.clone();
    if (this.input) cloned.input = this.input.clone();
    if (this.health) cloned.health = this.health.clone();
    if (this.weapon) cloned.weapon = this.weapon.clone();
    if (this.projectile) cloned.projectile = this.projectile.clone();
    if (this.unit) cloned.unit = this.unit.clone();
    if (this.building) cloned.building = this.building.clone();
    
    return cloned;
  }
}

export enum EntityType {
  Player = 1,
  Projectile = 2,
  Item = 3,
  Trigger = 4,
  
  // RTS types
  Unit = 10,
  Building = 11,
  Resource = 12,
}
```

**Why direct properties instead of Map?**
- 3-5x faster access (no hash lookups)
- TypeScript knows which components exist
- Direct serialization without iteration
- Trade-off: Less dynamic, but we know our component types

#### Component Design

```typescript
// ═══════════════════════════════════════════════════════════════════
// TRANSFORM - Position and rotation in world space
// ═══════════════════════════════════════════════════════════════════

export class TransformComponent {
  // Use branded types for position
  position: PositionWorld;
  rotation: Rotation;  // Euler angles or quaternion
  
  constructor(pos?: PositionWorld, rot?: Rotation) {
    this.position = pos ?? position(0, 0, 0);
    this.rotation = rot ?? rotation(0, 0, 0);
  }
  
  clone(): TransformComponent {
    return new TransformComponent(
      { ...this.position } as PositionWorld,
      { ...this.rotation } as Rotation
    );
  }
  
  // Binary: 24 bytes (6 floats)
  serialize(encoder: BinaryEncoder): void {
    encoder.writeFloat32(this.position.x);
    encoder.writeFloat32(this.position.y);
    encoder.writeFloat32(this.position.z);
    encoder.writeFloat32(this.rotation.x);
    encoder.writeFloat32(this.rotation.y);
    encoder.writeFloat32(this.rotation.z);
  }
  
  deserialize(decoder: BinaryDecoder): void {
    this.position = {
      x: decoder.readFloat32(),
      y: decoder.readFloat32(),
      z: decoder.readFloat32(),
    } as PositionWorld;
    this.rotation = {
      x: decoder.readFloat32(),
      y: decoder.readFloat32(),
      z: decoder.readFloat32(),
    } as Rotation;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHYSICS - Velocity, mass, movement state
// ═══════════════════════════════════════════════════════════════════

export class PhysicsComponent {
  velocity: VelocityPerSec;
  grounded: boolean = false;
  
  // Optional physics properties
  mass: number = 1;
  bounceCoeff: number = 0;  // For projectiles
  
  constructor(vel?: VelocityPerSec) {
    this.velocity = vel ?? velocity(0, 0, 0);
  }
  
  clone(): PhysicsComponent {
    const c = new PhysicsComponent({ ...this.velocity } as VelocityPerSec);
    c.grounded = this.grounded;
    c.mass = this.mass;
    c.bounceCoeff = this.bounceCoeff;
    return c;
  }
  
  // Binary: 17 bytes (3 floats + flags + mass)
  serialize(encoder: BinaryEncoder): void {
    encoder.writeFloat32(this.velocity.x);
    encoder.writeFloat32(this.velocity.y);
    encoder.writeFloat32(this.velocity.z);
    encoder.writeUint8(this.grounded ? 1 : 0);
    encoder.writeFloat32(this.mass);
  }
  
  deserialize(decoder: BinaryDecoder): void {
    this.velocity = {
      x: decoder.readFloat32(),
      y: decoder.readFloat32(),
      z: decoder.readFloat32(),
    } as VelocityPerSec;
    this.grounded = decoder.readUint8() === 1;
    this.mass = decoder.readFloat32();
  }
}

// ═══════════════════════════════════════════════════════════════════
// INPUT - Player input state (from client)
// ═══════════════════════════════════════════════════════════════════

export class InputComponent {
  /** Bitmask of pressed buttons */
  buttons: number = 0;
  
  /** View angles from client */
  viewPitch: number = 0;
  viewYaw: number = 0;
  
  /** Normalized movement direction */
  wishDir: Vec3 = { x: 0, y: 0, z: 0 };
  
  /** Input sequence number for ack */
  sequence: number = 0;
  
  // Button flags
  static readonly JUMP = 1 << 0;
  static readonly CROUCH = 1 << 1;
  static readonly FIRE = 1 << 2;
  static readonly ALT_FIRE = 1 << 3;
  static readonly USE = 1 << 4;
  static readonly SPRINT = 1 << 5;
  
  isPressed(button: number): boolean {
    return (this.buttons & button) !== 0;
  }
  
  clone(): InputComponent {
    const c = new InputComponent();
    c.buttons = this.buttons;
    c.viewPitch = this.viewPitch;
    c.viewYaw = this.viewYaw;
    c.wishDir = { ...this.wishDir };
    c.sequence = this.sequence;
    return c;
  }
  
  // Binary: 22 bytes
  serialize(encoder: BinaryEncoder): void {
    encoder.writeUint16(this.buttons);
    encoder.writeFloat32(this.viewPitch);
    encoder.writeFloat32(this.viewYaw);
    encoder.writeFloat32(this.wishDir.x);
    encoder.writeFloat32(this.wishDir.z);  // Y is 0 (horizontal plane)
    encoder.writeUint16(this.sequence);
  }
  
  deserialize(decoder: BinaryDecoder): void {
    this.buttons = decoder.readUint16();
    this.viewPitch = decoder.readFloat32();
    this.viewYaw = decoder.readFloat32();
    this.wishDir.x = decoder.readFloat32();
    this.wishDir.y = 0;
    this.wishDir.z = decoder.readFloat32();
    this.sequence = decoder.readUint16();
  }
}
```

#### WorldState with COW

```typescript
/**
 * WorldState - The complete game state for one tick
 * 
 * Implements Copy-on-Write: reading returns shared refs,
 * writing clones on first access.
 */
export class WorldState {
  readonly tick: TickNumber;
  readonly mapId: string;
  
  private entities: Map<EntityId, Entity>;
  private modified: Set<EntityId> = new Set();
  
  // Immutable references (set once at init)
  readonly collisionWorld: CollisionWorld;
  readonly spawnPoints: PositionWorld[];
  
  // Checksum for determinism validation
  private cachedChecksum?: number;
  
  constructor(
    tick: TickNumber,
    mapId: string,
    collisionWorld: CollisionWorld,
    spawnPoints: PositionWorld[]
  ) {
    this.tick = tick;
    this.mapId = mapId;
    this.entities = new Map();
    this.collisionWorld = collisionWorld;
    this.spawnPoints = spawnPoints;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ENTITY ACCESS (COW)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get entity for READING (shared reference, no clone)
   */
  getEntity(id: EntityId): Readonly<Entity> | undefined {
    return this.entities.get(id);
  }
  
  /**
   * Get entity for WRITING (clones on first write)
   */
  getEntityMut(id: EntityId): Entity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    
    // Already modified this tick? Return existing
    if (this.modified.has(id)) {
      return entity;
    }
    
    // First write: clone it
    const cloned = entity.clone();
    this.entities.set(id, cloned);
    this.modified.add(id);
    this.cachedChecksum = undefined;  // Invalidate checksum
    
    return cloned;
  }
  
  /**
   * Add new entity to world
   */
  addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
    this.modified.add(entity.id);
    this.cachedChecksum = undefined;
  }
  
  /**
   * Remove entity from world
   */
  removeEntity(id: EntityId): boolean {
    const removed = this.entities.delete(id);
    if (removed) {
      this.cachedChecksum = undefined;
    }
    return removed;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get all entities (for iteration)
   */
  *allEntities(): IterableIterator<Readonly<Entity>> {
    for (const entity of this.entities.values()) {
      yield entity;
    }
  }
  
  /**
   * Query entities by type
   */
  *entitiesOfType(type: EntityType): IterableIterator<Readonly<Entity>> {
    for (const entity of this.entities.values()) {
      if (entity.type === type) yield entity;
    }
  }
  
  /**
   * Query entities with specific components
   */
  *entitiesWithComponents(...components: (keyof Entity)[]): IterableIterator<Readonly<Entity>> {
    for (const entity of this.entities.values()) {
      const hasAll = components.every(c => entity[c] !== undefined);
      if (hasAll) yield entity;
    }
  }
  
  /**
   * Get players (convenience)
   */
  *players(): IterableIterator<Readonly<Entity>> {
    yield* this.entitiesOfType(EntityType.Player);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // TICK TRANSITION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Create next tick's state (COW reset)
   */
  nextTick(): WorldState {
    const next = new WorldState(
      (this.tick + 1) as TickNumber,
      this.mapId,
      this.collisionWorld,
      this.spawnPoints
    );
    
    // Share entities (COW - will clone on write)
    next.entities = new Map(this.entities);
    // Reset modification tracking
    next.modified = new Set();
    
    return next;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DETERMINISM
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Compute checksum for determinism validation
   */
  checksum(): number {
    if (this.cachedChecksum !== undefined) {
      return this.cachedChecksum;
    }
    
    // Simple CRC32-like hash
    let hash = 0;
    hash = hashCombine(hash, this.tick);
    
    // Hash entities in sorted order for determinism
    const sortedIds = [...this.entities.keys()].sort((a, b) => a - b);
    for (const id of sortedIds) {
      const entity = this.entities.get(id)!;
      hash = this.hashEntity(hash, entity);
    }
    
    this.cachedChecksum = hash >>> 0;  // Force unsigned
    return this.cachedChecksum;
  }
  
  private hashEntity(hash: number, entity: Entity): number {
    hash = hashCombine(hash, entity.id);
    hash = hashCombine(hash, entity.type);
    
    if (entity.transform) {
      hash = hashCombine(hash, floatToInt(entity.transform.position.x));
      hash = hashCombine(hash, floatToInt(entity.transform.position.y));
      hash = hashCombine(hash, floatToInt(entity.transform.position.z));
    }
    
    if (entity.physics) {
      hash = hashCombine(hash, floatToInt(entity.physics.velocity.x));
      hash = hashCombine(hash, floatToInt(entity.physics.velocity.y));
      hash = hashCombine(hash, floatToInt(entity.physics.velocity.z));
      hash = hashCombine(hash, entity.physics.grounded ? 1 : 0);
    }
    
    return hash;
  }
}

// Hash utilities
function hashCombine(a: number, b: number): number {
  return ((a << 5) + a) ^ b;
}

function floatToInt(f: number): number {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = f;
  return new Uint32Array(buf)[0];
}
```

---

## Part 2: Network Protocol

### Message Types

```typescript
/**
 * Network message types
 * 
 * Direction:
 *   0x00-0x0F: Server → Client
 *   0x80-0x8F: Client → Server
 */
export enum MessageType {
  // ═══ Server → Client ═══
  
  /** Connection accepted, receive player ID */
  S_Welcome = 0x01,
  
  /** Full world state (on join or after desync) */
  S_FullSnapshot = 0x02,
  
  /** Delta snapshot (normal operation) */
  S_DeltaSnapshot = 0x03,
  
  /** Player joined notification */
  S_PlayerJoined = 0x04,
  
  /** Player left notification */
  S_PlayerLeft = 0x05,
  
  /** Chat message */
  S_Chat = 0x06,
  
  /** Connection rejected */
  S_Rejected = 0x0F,
  
  
  // ═══ Client → Server ═══
  
  /** Player input command */
  C_Input = 0x80,
  
  /** Request full snapshot (after desync) */
  C_RequestFullSnapshot = 0x81,
  
  /** Chat message */
  C_Chat = 0x82,
  
  /** Client ready to play */
  C_Ready = 0x83,
}
```

### Snapshot Protocol

```typescript
/**
 * Full Snapshot Format
 * 
 * Used on join and after desync. Contains complete world state.
 * 
 * Header:
 *   [1] MessageType.S_FullSnapshot
 *   [4] serverTick (uint32)
 *   [4] checksum (uint32)
 *   [2] entityCount (uint16)
 * 
 * Entities:
 *   For each entity:
 *     [4] entityId (uint32)
 *     [1] entityType (uint8)
 *     [1] componentFlags (bitmask of present components)
 *     [...] component data (based on flags)
 */

export class SnapshotEncoder {
  private encoder: BinaryEncoder;
  
  constructor(initialSize = 4096) {
    this.encoder = new BinaryEncoder(initialSize);
  }
  
  /**
   * Encode full snapshot
   */
  encodeFullSnapshot(state: WorldState): Uint8Array {
    this.encoder.writeUint8(MessageType.S_FullSnapshot);
    this.encoder.writeUint32(state.tick);
    this.encoder.writeUint32(state.checksum());
    
    const entities = [...state.allEntities()];
    this.encoder.writeUint16(entities.length);
    
    for (const entity of entities) {
      this.encodeEntity(entity);
    }
    
    return this.encoder.toBytes();
  }
  
  /**
   * Encode delta snapshot (only changed entities)
   */
  encodeDeltaSnapshot(
    current: WorldState,
    baseline: WorldState,
    ackedInputSeq: number
  ): Uint8Array {
    this.encoder.writeUint8(MessageType.S_DeltaSnapshot);
    this.encoder.writeUint32(current.tick);
    this.encoder.writeUint32(baseline.tick);
    this.encoder.writeUint16(ackedInputSeq);
    this.encoder.writeUint32(current.checksum());
    
    // Find changed, added, and removed entities
    const changes = this.computeDelta(current, baseline);
    
    // Added/Changed entities
    this.encoder.writeUint16(changes.changed.length);
    for (const entity of changes.changed) {
      const baselineEntity = baseline.getEntity(entity.id);
      this.encodeEntityDelta(entity, baselineEntity);
    }
    
    // Removed entities (just IDs)
    this.encoder.writeUint16(changes.removed.length);
    for (const id of changes.removed) {
      this.encoder.writeUint32(id);
    }
    
    return this.encoder.toBytes();
  }
  
  private encodeEntity(entity: Readonly<Entity>): void {
    this.encoder.writeUint32(entity.id);
    this.encoder.writeUint8(entity.type);
    
    // Component flags
    const flags = this.computeComponentFlags(entity);
    this.encoder.writeUint8(flags);
    
    // Encode present components
    if (entity.transform) entity.transform.serialize(this.encoder);
    if (entity.physics) entity.physics.serialize(this.encoder);
    if (entity.input) entity.input.serialize(this.encoder);
    if (entity.health) entity.health.serialize(this.encoder);
    // ... other components
  }
  
  private encodeEntityDelta(
    entity: Readonly<Entity>,
    baseline: Readonly<Entity> | undefined
  ): void {
    this.encoder.writeUint32(entity.id);
    
    if (!baseline) {
      // New entity - encode full
      this.encoder.writeUint8(0xFF);  // Flag: new entity
      this.encoder.writeUint8(entity.type);
      this.encodeEntity(entity);
      return;
    }
    
    // Delta encode - only changed components
    const changedFlags = this.computeChangedComponents(entity, baseline);
    this.encoder.writeUint8(changedFlags);
    
    if (changedFlags & ComponentFlags.Transform) {
      entity.transform!.serialize(this.encoder);
    }
    if (changedFlags & ComponentFlags.Physics) {
      entity.physics!.serialize(this.encoder);
    }
    // ... other components
  }
  
  private computeDelta(current: WorldState, baseline: WorldState) {
    const changed: Entity[] = [];
    const removed: EntityId[] = [];
    
    // Find changed/added
    for (const entity of current.allEntities()) {
      const baselineEntity = baseline.getEntity(entity.id);
      if (!baselineEntity || this.entityChanged(entity, baselineEntity)) {
        changed.push(entity as Entity);
      }
    }
    
    // Find removed
    for (const entity of baseline.allEntities()) {
      if (!current.getEntity(entity.id)) {
        removed.push(entity.id);
      }
    }
    
    return { changed, removed };
  }
  
  private entityChanged(a: Readonly<Entity>, b: Readonly<Entity>): boolean {
    // Quick checks
    if (a.type !== b.type) return true;
    
    // Position comparison (most common change)
    if (a.transform && b.transform) {
      const t1 = a.transform, t2 = b.transform;
      if (t1.position.x !== t2.position.x) return true;
      if (t1.position.y !== t2.position.y) return true;
      if (t1.position.z !== t2.position.z) return true;
    }
    
    // Velocity comparison
    if (a.physics && b.physics) {
      const p1 = a.physics, p2 = b.physics;
      if (p1.velocity.x !== p2.velocity.x) return true;
      if (p1.velocity.y !== p2.velocity.y) return true;
      if (p1.velocity.z !== p2.velocity.z) return true;
      if (p1.grounded !== p2.grounded) return true;
    }
    
    // ... check other components
    
    return false;
  }
}

/** Component presence flags */
enum ComponentFlags {
  Transform = 1 << 0,
  Physics = 1 << 1,
  Input = 1 << 2,
  Health = 1 << 3,
  Weapon = 1 << 4,
  Projectile = 1 << 5,
  Unit = 1 << 6,
  Building = 1 << 7,
}
```

### Input Protocol

```typescript
/**
 * Input Command Format
 * 
 * Client sends at input tick rate (125Hz).
 * 
 * Format:
 *   [1] MessageType.C_Input
 *   [2] sequence (uint16, wraps at 65535)
 *   [2] buttons (bitmask)
 *   [4] viewPitch (float32)
 *   [4] viewYaw (float32)
 *   [4] wishDirX (float32)
 *   [4] wishDirZ (float32)
 * 
 * Total: 21 bytes per input
 */

export class InputEncoder {
  static encode(input: InputCommand): Uint8Array {
    const encoder = new BinaryEncoder(32);
    
    encoder.writeUint8(MessageType.C_Input);
    encoder.writeUint16(input.sequence & 0xFFFF);
    encoder.writeUint16(input.buttons);
    encoder.writeFloat32(input.viewPitch);
    encoder.writeFloat32(input.viewYaw);
    encoder.writeFloat32(input.wishDir.x);
    encoder.writeFloat32(input.wishDir.z);
    
    return encoder.toBytes();
  }
  
  static decode(data: Uint8Array): InputCommand {
    const decoder = new BinaryDecoder(data);
    
    const type = decoder.readUint8();
    if (type !== MessageType.C_Input) {
      throw new Error(`Expected C_Input, got ${type}`);
    }
    
    return {
      sequence: decoder.readUint16(),
      buttons: decoder.readUint16(),
      viewPitch: decoder.readFloat32(),
      viewYaw: decoder.readFloat32(),
      wishDir: {
        x: decoder.readFloat32(),
        y: 0,
        z: decoder.readFloat32(),
      },
    };
  }
}

export interface InputCommand {
  sequence: number;
  buttons: number;
  viewPitch: number;
  viewYaw: number;
  wishDir: Vec3;
}
```

### Bandwidth Analysis

```
═══════════════════════════════════════════════════════════════════
BANDWIDTH ANALYSIS
═══════════════════════════════════════════════════════════════════

CLIENT → SERVER (Per client)
─────────────────────────────
Input at 125Hz:
  21 bytes × 125/sec = 2,625 bytes/sec = 2.6 KB/s

SERVER → CLIENT (Per client)
─────────────────────────────
Full snapshot (16 players):
  Header: 11 bytes
  Per player: ~60 bytes (transform + physics + input flags)
  Total: 11 + (16 × 60) = 971 bytes

Delta snapshot (typical, 4 players moved):
  Header: 15 bytes
  Changed entities: 4 × 45 bytes = 180 bytes
  Total: 195 bytes

At 60 snapshots/sec:
  195 × 60 = 11,700 bytes/sec = 11.4 KB/s

TOTAL BANDWIDTH (Per client)
───────────────────────────
Upload:   2.6 KB/s
Download: 11.4 KB/s
Total:    14 KB/s

Compare to target: < 10 KB/s (we're slightly over)

OPTIMIZATION OPPORTUNITIES
─────────────────────────────
1. Quantized positions (3 × int16 instead of float32) = saves 6 bytes/entity
2. Skip unchanged components = saves ~20 bytes/entity on avg
3. Reduce snapshot rate to 30Hz = halves bandwidth
4. Interest management (only send nearby entities)
```

---

## Part 3: Integration with BSP Collision

### Collision World as Stateless Query

```typescript
/**
 * CollisionWorld - Stateless geometry query interface
 * 
 * Does NOT own entities. Systems query it with positions.
 * Works with our BSP loader and HeadlessBSPCollisionWorld.
 */
export interface CollisionWorld {
  /**
   * Trace a ray/capsule through the world
   */
  trace(
    start: PositionWorld,
    end: PositionWorld,
    bounds: CollisionBounds
  ): TraceResult;
  
  /**
   * Q3-style collision with stair stepping
   */
  stepSlideMove(
    position: PositionWorld,
    movement: DisplacementPerTick,
    bounds: CollisionBounds
  ): StepSlideMoveResult;
  
  /**
   * Check content type at position (water, lava, etc.)
   */
  pointContents(position: PositionWorld): ContentsFlags;
  
  /**
   * Find spawn point that doesn't overlap with entities
   */
  findValidSpawn(
    spawnPoints: PositionWorld[],
    existingPositions: PositionWorld[],
    bounds: CollisionBounds
  ): PositionWorld | null;
}

export interface TraceResult {
  readonly hit: boolean;
  readonly fraction: number;  // 0-1, how far before hit
  readonly endPos: PositionWorld;
  readonly normal: Vec3;
  readonly contents: ContentsFlags;
}

export interface StepSlideMoveResult {
  readonly endPos: PositionWorld;
  readonly velocity: VelocityPerSec;  // Clipped by collision
  readonly grounded: boolean;
  readonly hitCount: number;
}
```

### Physics System Using Collision

```typescript
/**
 * PhysicsSystem - Runs at 125Hz
 * 
 * Handles gravity, collision, and ground detection.
 * Uses BSP collision for geometry queries.
 */
export class PhysicsSystem implements Subsystem {
  readonly tickRate = 125;
  readonly priority = 0;
  
  tick(state: WorldState, dt: number): void {
    const GRAVITY = 800;  // units/sec²
    
    // Process all entities with physics
    for (const entity of state.entitiesWithComponents('transform', 'physics')) {
      // Get mutable reference (COW will clone if needed)
      const mutableEntity = state.getEntityMut(entity.id);
      if (!mutableEntity) continue;
      
      const transform = mutableEntity.transform!;
      const physics = mutableEntity.physics!;
      
      // Apply gravity if not grounded
      if (!physics.grounded) {
        physics.velocity = velocity(
          physics.velocity.x,
          physics.velocity.y - GRAVITY * dt,
          physics.velocity.z
        );
      }
      
      // Calculate displacement for this tick
      const movement = toDisplacement(physics.velocity, dt);
      
      // Collision detection via BSP
      const result = state.collisionWorld.stepSlideMove(
        transform.position,
        movement,
        PLAYER_BOUNDS
      );
      
      // Apply collision results
      transform.position = result.endPos;
      physics.velocity = result.velocity;
      physics.grounded = result.grounded;
    }
  }
}

const PLAYER_BOUNDS: CollisionBounds = {
  radius: 16,
  height: 56,
  stepHeight: 18,
};
```

---

## Summary: Design Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Entity storage** | Direct properties | 3-5x faster than Map lookup |
| **Component access** | `getEntity()` / `getEntityMut()` | COW pattern |
| **EntityId type** | Branded number | Type safety, compact serialization |
| **Serialization** | Custom binary | Optimal size, we know the format |
| **Delta compression** | Component-level | Only send changed fields |
| **Collision** | Stateless query | BSP is geometry, not entity owner |
| **Snapshot rate** | 60Hz (configurable) | Balance bandwidth/smoothness |
| **Input rate** | 125Hz | Match physics for responsiveness |

---

## Next Steps

1. **Implement COW WorldState** - Core data structure
2. **Port existing components** - Adapt TransformComponent, VelocityComponent
3. **Build SnapshotEncoder** - Binary serialization with delta
4. **Create CLI test** - `sim tick` to test one tick
5. **Integrate with HeadlessBSPCollisionWorld** - Use existing collision backend
