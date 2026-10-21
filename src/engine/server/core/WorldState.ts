/**
 * WorldState - Copy-on-Write (COW) game state container
 *
 * Implements efficient state management where:
 * - Reads are always safe and fast (no cloning)
 * - Writes clone only on first modification per tick
 * - Multiple references can share unmodified entities
 */

import type { Entity } from "../ecs/Entity";
import type { EntityId, PlayerId, TickNumber } from "../ecs/types";
import { EntityType, entityId, tickNumber } from "../ecs/types";

export class WorldState {
  // ═══════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════

  /** Current tick number */
  readonly tick: TickNumber;

  /** All entities in the world */
  private entities: Map<EntityId, Entity>;

  /** Entities modified this tick (for COW tracking) */
  private modified: Set<EntityId> = new Set();

  /** Next entity ID to assign */
  private nextEntityId: number = 1;

  /**
   * Clone an entity on its first write each tick, so earlier ticks' states
   * stay as they were. Only worth paying for when something keeps and reads
   * old states (whole-state history, re-sim checks); the live game server
   * keeps none and turns it off, writing entities in place.
   */
  copyOnWrite = true;

  // ═══════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════

  constructor(tick: TickNumber = tickNumber(0)) {
    this.tick = tick;
    this.entities = new Map();
  }

  // ═══════════════════════════════════════════════════════════════════
  // READ OPERATIONS (always safe, no cloning)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get entity by ID (read-only)
   */
  getEntity(id: EntityId): Readonly<Entity> | undefined {
    return this.entities.get(id);
  }

  /**
   * Check if entity exists
   */
  hasEntity(id: EntityId): boolean {
    return this.entities.has(id);
  }

  /**
   * Get all entities (read-only iterator)
   */
  *allEntities(): IterableIterator<Readonly<Entity>> {
    for (const entity of this.entities.values()) {
      yield entity;
    }
  }

  /**
   * Get entity count
   */
  get entityCount(): number {
    return this.entities.size;
  }

  /**
   * Get all player entities
   */
  *players(): IterableIterator<Readonly<Entity>> {
    for (const entity of this.entities.values()) {
      if (entity.type === EntityType.Player) {
        yield entity;
      }
    }
  }

  /**
   * Get player entity by player ID
   */
  getPlayerEntity(playerId: PlayerId): Readonly<Entity> | undefined {
    for (const entity of this.entities.values()) {
      if (entity.type === EntityType.Player && entity.ownerId === playerId) {
        return entity;
      }
    }
    return undefined;
  }

  /**
   * Query entities by type
   */
  *entitiesByType(type: EntityType): IterableIterator<Readonly<Entity>> {
    for (const entity of this.entities.values()) {
      if (entity.type === type) {
        yield entity;
      }
    }
  }

  /**
   * Get entity by owner ID
   */
  getEntityByOwner(ownerId: number): Readonly<Entity> | undefined {
    for (const entity of this.entities.values()) {
      if (entity.ownerId === ownerId) {
        return entity;
      }
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════
  // WRITE OPERATIONS (COW - clone on first write)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get entity for mutation (COW - clones on first access per tick)
   */
  getEntityMut(id: EntityId): Entity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;

    // Already modified this tick? Return existing mutable reference
    if (this.modified.has(id)) {
      return entity;
    }

    if (!this.copyOnWrite) {
      this.modified.add(id);
      return entity;
    }

    // First write this tick - clone the entity
    const cloned = entity.clone();
    this.entities.set(id, cloned);
    this.modified.add(id);

    return cloned;
  }

  /**
   * Add new entity to world
   */
  addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
    this.modified.add(entity.id);
  }

  /**
   * Remove entity from world
   */
  removeEntity(id: EntityId): boolean {
    return this.entities.delete(id);
  }

  /**
   * Generate next entity ID
   */
  generateEntityId(): EntityId {
    return entityId(this.nextEntityId++);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TICK TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create next tick state (preserves unmodified entity references)
   */
  nextTick(): WorldState {
    const next = new WorldState(tickNumber(this.tick + 1));

    // Share all entity references (COW will clone on write)
    next.entities = new Map(this.entities);
    next.nextEntityId = this.nextEntityId;
    next.copyOnWrite = this.copyOnWrite;

    // Clear modified set for new tick
    next.modified = new Set();

    return next;
  }

  /**
   * Clone entire state (for history buffer / snapshots)
   */
  clone(): WorldState {
    const cloned = new WorldState(this.tick);

    // Deep clone all entities
    for (const [id, entity] of this.entities) {
      cloned.entities.set(id, entity.clone());
    }

    cloned.nextEntityId = this.nextEntityId;
    cloned.copyOnWrite = this.copyOnWrite;

    return cloned;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECKSUM (for determinism verification)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Calculate state checksum for desync detection
   *
   * Uses a simple FNV-1a hash over entity positions.
   * More thorough checksums can be added for debugging.
   */
  checksum(): number {
    let hash = 2166136261; // FNV offset basis
    const prime = 16777619; // FNV prime

    // Sort entity IDs for deterministic order
    const sortedIds = [...this.entities.keys()].sort((a, b) => a - b);

    for (const id of sortedIds) {
      const entity = this.entities.get(id)!;

      // Hash entity ID
      hash ^= id;
      hash = Math.imul(hash, prime);

      // Hash position (quantized to avoid float issues)
      if (entity.transform) {
        const px = Math.round(entity.transform.position.x * 100);
        const py = Math.round(entity.transform.position.y * 100);
        const pz = Math.round(entity.transform.position.z * 100);

        hash ^= px;
        hash = Math.imul(hash, prime);
        hash ^= py;
        hash = Math.imul(hash, prime);
        hash ^= pz;
        hash = Math.imul(hash, prime);
      }
    }

    return hash >>> 0; // Ensure unsigned
  }

  // ═══════════════════════════════════════════════════════════════════
  // DEBUG
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get modified entity count (for debugging COW efficiency)
   */
  get modifiedCount(): number {
    return this.modified.size;
  }

  /**
   * Debug string representation
   */
  toString(): string {
    return `WorldState(tick=${this.tick}, entities=${this.entityCount}, modified=${this.modifiedCount})`;
  }
}
