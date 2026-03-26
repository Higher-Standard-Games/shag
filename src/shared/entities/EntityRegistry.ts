/**
 * EntityRegistry - Central registry for all entity definitions
 *
 * Singleton that holds all entity definitions and provides
 * type-safe lookup methods.
 */

import type { EntityDef } from "./EntityDef";
import type { EntityType } from "./EntityType";

export class EntityRegistry {
  private static instance: EntityRegistry;
  private definitions: Map<string, EntityDef> = new Map();

  private constructor() {}

  public static getInstance(): EntityRegistry {
    if (!EntityRegistry.instance) {
      EntityRegistry.instance = new EntityRegistry();
    }
    return EntityRegistry.instance;
  }

  /**
   * Register an entity definition
   */
  public register<T extends EntityDef>(def: T): void {
    if (this.definitions.has(def.id)) {
      console.warn(`[EntityRegistry] Overwriting existing definition: ${def.id}`);
    }
    this.definitions.set(def.id, def);
    console.log(`[EntityRegistry] Registered ${def.type}: ${def.id}`);
  }

  /**
   * Get definition by ID (type-safe with generic)
   */
  public get<T extends EntityDef>(id: string): T | undefined {
    return this.definitions.get(id) as T | undefined;
  }

  /**
   * Check if definition exists
   */
  public has(id: string): boolean {
    return this.definitions.has(id);
  }

  /**
   * Get all definitions of a specific type
   */
  public getByType<T extends EntityDef>(type: EntityType): T[] {
    return [...this.definitions.values()].filter((def) => def.type === type) as T[];
  }

  /**
   * Get all registered definition IDs
   */
  public getAllIds(): string[] {
    return [...this.definitions.keys()];
  }

  /**
   * Get count of registered definitions
   */
  public getCount(): number {
    return this.definitions.size;
  }

  /**
   * Clear all definitions (useful for testing)
   */
  public clear(): void {
    this.definitions.clear();
  }

  /**
   * Get definition by BSP/MAP classname (e.g., "weapon_plasmagun")
   * Used for spawning entities from map data
   */
  public getByClassname<T extends EntityDef>(classname: string): T | undefined {
    for (const def of this.definitions.values()) {
      if (def.classname === classname) {
        return def as T;
      }
      // Check aliases for backward compatibility
      if (def.classnameAliases?.includes(classname)) {
        return def as T;
      }
    }
    return undefined;
  }
}

// Convenience function
export function getEntityRegistry(): EntityRegistry {
  return EntityRegistry.getInstance();
}
