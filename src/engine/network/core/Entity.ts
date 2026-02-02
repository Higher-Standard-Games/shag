import type { IComponent, StateEncoder } from './Component';

/**
 * Unique identifier for entities
 */
export type EntityId = string;

/**
 * Unique identifier for players
 */
export type PlayerId = string;

/**
 * Entity types for the network simulation
 */
export enum EntityType {
  Player = 'player',
  Projectile = 'projectile',
  Item = 'item',
  Trigger = 'trigger',
  Effect = 'effect',
}

/**
 * Base entity class - container for components.
 * Games use this directly, adding their custom components.
 */
export class Entity {
  readonly id: EntityId;

  /** Entity type for filtering and identification */
  type: EntityType = EntityType.Player;

  /** Owner player ID (for projectiles, owned items, etc.) */
  ownerId?: PlayerId;

  protected components: Map<string, IComponent> = new Map();

  constructor(id: EntityId, type: EntityType = EntityType.Player) {
    this.id = id;
    this.type = type;
  }

  /**
   * Add a component to this entity
   */
  addComponent<T extends IComponent>(type: string, component: T): void {
    this.components.set(type, component);
  }

  /**
   * Get a component by type
   */
  getComponent<T extends IComponent>(type: string): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  /**
   * Check if entity has a component
   */
  hasComponent(type: string): boolean {
    return this.components.has(type);
  }

  /**
   * Remove a component
   */
  removeComponent(type: string): boolean {
    return this.components.delete(type);
  }

  /**
   * Get all component type names (for debugging)
   */
  getComponentNames(): string[] {
    return Array.from(this.components.keys());
  }

  /**
   * Serialize entity state to binary
   */
  serialize(encoder: StateEncoder): void {
    // Entity metadata
    encoder.writeString(this.type);
    encoder.writeString(this.ownerId ?? '');

    // Components
    encoder.writeUint8(this.components.size);
    for (const [type, component] of this.components) {
      encoder.writeString(type);
      component.serialize(encoder);
    }
  }

  /**
   * Create a clone of this entity for snapshots
   */
  clone(): Entity {
    const cloned = new Entity(this.id, this.type);
    cloned.ownerId = this.ownerId;
    for (const [type, component] of this.components) {
      cloned.addComponent(type, component.clone());
    }
    return cloned;
  }
}

