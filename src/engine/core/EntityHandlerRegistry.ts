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

import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "./DevLog";

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
  options?: EntityHandlerOptions,
) => EntityHandlerResult | Promise<EntityHandlerResult>;

/**
 * Pre-render hook - called before MapRenderer processes entities
 */
export type PreRenderHook = (entities: EntityData[], scene: Scene) => void | Promise<void>;

/**
 * Post-render hook - called after MapRenderer finishes
 */
export type PostRenderHook = (
  entities: EntityData[],
  scene: Scene,
  results: Map<string, EntityHandlerResult[]>,
) => void | Promise<void>;

const handlersByClass: Map<string, EntityHandler> = new Map();
let preRenderHooks: PreRenderHook[] = [];
let postRenderHooks: PostRenderHook[] = [];

/**
 * Register a handler for an entity classname
 * @param classname Entity classname (e.g., 'build_zone', 'npc_sprite')
 * @param handler Handler function
 */
function register(classname: string, handler: EntityHandler): void {
  if (handlersByClass.has(classname)) {
    console.warn(`[EntityHandlerRegistry] Overwriting handler for '${classname}'`);
  }
  handlersByClass.set(classname, handler);
  devLog(`[EntityHandlerRegistry] Registered handler for '${classname}'`);
}

/**
 * Register multiple handlers at once
 */
function registerAll(handlers: Record<string, EntityHandler>): void {
  for (const [classname, handler] of Object.entries(handlers)) {
    EntityHandlerRegistry.register(classname, handler);
  }
}

/**
 * Unregister a handler
 */
function unregister(classname: string): void {
  handlersByClass.delete(classname);
}

/**
 * Get a handler for a classname
 */
function getHandler(classname: string): EntityHandler | undefined {
  return handlersByClass.get(classname);
}

/**
 * Check if a handler exists for a classname
 */
function hasHandler(classname: string): boolean {
  return handlersByClass.has(classname);
}

/**
 * Get all registered classnames
 */
function getRegisteredClassnames(): string[] {
  return Array.from(handlersByClass.keys());
}

/**
 * Add a pre-render hook
 */
function addPreRenderHook(hook: PreRenderHook): void {
  if (!preRenderHooks.includes(hook)) {
    preRenderHooks.push(hook);
  }
}

/**
 * Add a post-render hook
 */
function addPostRenderHook(hook: PostRenderHook): void {
  postRenderHooks.push(hook);
}

/**
 * Run all pre-render hooks
 */
async function runPreRenderHooks(entities: EntityData[], scene: Scene): Promise<void> {
  for (const hook of preRenderHooks) {
    await hook(entities, scene);
  }
}

/**
 * Run all post-render hooks
 */
async function runPostRenderHooks(
  entities: EntityData[],
  scene: Scene,
  results: Map<string, EntityHandlerResult[]>,
): Promise<void> {
  for (const hook of postRenderHooks) {
    await hook(entities, scene, results);
  }
}

/**
 * Clear all handlers and hooks (for testing)
 */
function clear(): void {
  handlersByClass.clear();
  preRenderHooks = [];
  postRenderHooks = [];
}

/**
 * Get debug info
 */
function getDebugInfo(): {
  handlers: string[];
  preRenderHooks: number;
  postRenderHooks: number;
} {
  return {
    handlers: EntityHandlerRegistry.getRegisteredClassnames(),
    preRenderHooks: preRenderHooks.length,
    postRenderHooks: postRenderHooks.length,
  };
}

/**
 * Registry for entity handlers
 * Allows game code to extend MapRenderer without engine modifications
 */
export const EntityHandlerRegistry = {
  register,
  registerAll,
  unregister,
  getHandler,
  hasHandler,
  getRegisteredClassnames,
  addPreRenderHook,
  addPostRenderHook,
  runPreRenderHooks,
  runPostRenderHooks,
  clear,
  getDebugInfo,
};
