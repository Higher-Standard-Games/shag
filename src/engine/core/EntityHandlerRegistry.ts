/**
 * EntityHandlerRegistry - Extension point for custom entity handling
 * 
 * Allows game code to register handlers for entity types without
 * the engine needing to import game-specific systems.
 * 
 * Usage (in game code):
 *   EntityHandlerRegistry.register('build_zone', (entity, scene) => {
 *     BuildingSystem.getInstance().registerZone(entity);
 *   });
 * 
 *   EntityHandlerRegistry.register('npc_sprite', (entity, scene, options) => {
 *     return CharacterGenerator.createFromEntity(entity, scene);
 *   });
 * 
 * Usage (in engine MapRenderer):
 *   const handler = EntityHandlerRegistry.getHandler('build_zone');
 *   if (handler) {
 *     await handler(entity, scene);
 *   }
 */

import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * Entity data passed to handlers (matches MapParser Entity structure)
 */
export interface EntityData {
  classname: string;
  properties: Record<string, string>;
  brushes?: unknown[];
  patches?: unknown[];
}

/**
 * Options passed to entity handlers
 */
export interface EntityHandlerOptions {
  /** Parent node for created meshes */
  parent?: TransformNode;
  /** Whether to enable collisions */
  collisions?: boolean;
  /** Whether to cast shadows */
  shadows?: boolean;
  /** Additional custom options */
  [key: string]: unknown;
}

/**
 * Result from an entity handler
 */
export interface EntityHandlerResult {
  /** Created mesh/node (optional) */
  node?: TransformNode;
  /** Whether the entity was handled */
  handled: boolean;
  /** Any additional data to return */
  data?: Record<string, unknown>;
}

/**
 * Entity handler function signature
 */
export type EntityHandler = (
  entity: EntityData,
  scene: Scene,
  options?: EntityHandlerOptions
) => EntityHandlerResult | Promise<EntityHandlerResult>;

/**
 * Pre-render hook - called before MapRenderer processes entities
 */
export type PreRenderHook = (
  entities: EntityData[],
  scene: Scene
) => void | Promise<void>;

/**
 * Post-render hook - called after MapRenderer finishes
 */
export type PostRenderHook = (
  entities: EntityData[],
  scene: Scene,
  results: Map<string, EntityHandlerResult[]>
) => void | Promise<void>;

/**
 * Registry for entity handlers
 * Allows game code to extend MapRenderer without engine modifications
 */
export class EntityHandlerRegistry {
  private static handlers: Map<string, EntityHandler> = new Map();
  private static preRenderHooks: PreRenderHook[] = [];
  private static postRenderHooks: PostRenderHook[] = [];
  
  /**
   * Register a handler for an entity classname
   * @param classname Entity classname (e.g., 'build_zone', 'npc_sprite')
   * @param handler Handler function
   */
  public static register(classname: string, handler: EntityHandler): void {
    if (EntityHandlerRegistry.handlers.has(classname)) {
      console.warn(`[EntityHandlerRegistry] Overwriting handler for '${classname}'`);
    }
    EntityHandlerRegistry.handlers.set(classname, handler);
    console.log(`[EntityHandlerRegistry] Registered handler for '${classname}'`);
  }
  
  /**
   * Register multiple handlers at once
   */
  public static registerAll(handlers: Record<string, EntityHandler>): void {
    for (const [classname, handler] of Object.entries(handlers)) {
      EntityHandlerRegistry.register(classname, handler);
    }
  }
  
  /**
   * Unregister a handler
   */
  public static unregister(classname: string): void {
    EntityHandlerRegistry.handlers.delete(classname);
  }
  
  /**
   * Get a handler for a classname
   */
  public static getHandler(classname: string): EntityHandler | undefined {
    return EntityHandlerRegistry.handlers.get(classname);
  }
  
  /**
   * Check if a handler exists for a classname
   */
  public static hasHandler(classname: string): boolean {
    return EntityHandlerRegistry.handlers.has(classname);
  }
  
  /**
   * Get all registered classnames
   */
  public static getRegisteredClassnames(): string[] {
    return Array.from(EntityHandlerRegistry.handlers.keys());
  }
  
  /**
   * Add a pre-render hook
   */
  public static addPreRenderHook(hook: PreRenderHook): void {
    EntityHandlerRegistry.preRenderHooks.push(hook);
  }
  
  /**
   * Add a post-render hook
   */
  public static addPostRenderHook(hook: PostRenderHook): void {
    EntityHandlerRegistry.postRenderHooks.push(hook);
  }
  
  /**
   * Run all pre-render hooks
   */
  public static async runPreRenderHooks(entities: EntityData[], scene: Scene): Promise<void> {
    for (const hook of EntityHandlerRegistry.preRenderHooks) {
      await hook(entities, scene);
    }
  }
  
  /**
   * Run all post-render hooks
   */
  public static async runPostRenderHooks(
    entities: EntityData[],
    scene: Scene,
    results: Map<string, EntityHandlerResult[]>
  ): Promise<void> {
    for (const hook of EntityHandlerRegistry.postRenderHooks) {
      await hook(entities, scene, results);
    }
  }
  
  /**
   * Clear all handlers and hooks (for testing)
   */
  public static clear(): void {
    EntityHandlerRegistry.handlers.clear();
    EntityHandlerRegistry.preRenderHooks = [];
    EntityHandlerRegistry.postRenderHooks = [];
  }
  
  /**
   * Get debug info
   */
  public static getDebugInfo(): {
    handlers: string[];
    preRenderHooks: number;
    postRenderHooks: number;
  } {
    return {
      handlers: EntityHandlerRegistry.getRegisteredClassnames(),
      preRenderHooks: EntityHandlerRegistry.preRenderHooks.length,
      postRenderHooks: EntityHandlerRegistry.postRenderHooks.length,
    };
  }
}
