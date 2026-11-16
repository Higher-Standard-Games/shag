/**
 * ResourceSystem - Unified resource management for currencies, items, and stats
 *
 * @example
 * ```typescript
 * ResourceSystem.add("gold", 500);
 * ResourceSystem.consume("wood", 10);
 * ResourceSystem.canAfford({ gold: 100, wood: 5 });
 * ResourceSystem.get("gold");
 * ResourceSystem.transfer("gold", 100, "player", "vendor");
 * ```
 */

import { EventBus } from "./EventBus";

export interface ResourceDefinition {
  id: string;
  name: string;
  maxAmount?: number; // Optional cap
  minAmount?: number; // Optional floor (default: 0)
  persistent?: boolean; // Save to game state (default: true)
  category?: string; // For grouping (e.g., "currency", "item", "stat")
}

export interface ResourceChange {
  resourceId: string;
  oldAmount: number;
  newAmount: number;
  delta: number;
  source?: string;
}

export type ResourceCost = Record<string, number>;

const resourceDefinitions: Map<string, ResourceDefinition> = new Map();
const amounts: Map<string, number> = new Map();
const changeCallbacks: Map<string, Array<(change: ResourceChange) => void>> = new Map();

/**
 * Register a resource type
 */
function register(definition: ResourceDefinition): void {
  resourceDefinitions.set(definition.id, definition);
  if (!amounts.has(definition.id)) {
    amounts.set(definition.id, definition.minAmount ?? 0);
  }
}

/**
 * Register multiple resource types
 */
function registerMany(definitions: ResourceDefinition[]): void {
  for (const def of definitions) {
    ResourceSystem.register(def);
  }
}

/**
 * Get current amount of a resource
 */
function get(resourceId: string): number {
  return amounts.get(resourceId) ?? 0;
}

/**
 * Get all resource amounts
 */
function getAll(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, amount] of amounts) {
    result[id] = amount;
  }
  return result;
}

/**
 * Get resources by category
 */
function getByCategory(category: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, def] of resourceDefinitions) {
    if (def.category === category) {
      result[id] = amounts.get(id) ?? 0;
    }
  }
  return result;
}

/**
 * Set a resource to a specific amount
 */
function set(resourceId: string, amount: number, source?: string): boolean {
  const def = resourceDefinitions.get(resourceId);
  const oldAmount = amounts.get(resourceId) ?? 0;

  // Apply min/max constraints
  let newAmount = amount;
  if (def) {
    if (def.maxAmount !== undefined) {
      newAmount = Math.min(newAmount, def.maxAmount);
    }
    if (def.minAmount !== undefined) {
      newAmount = Math.max(newAmount, def.minAmount);
    }
  } else {
    newAmount = Math.max(0, newAmount); // Default min is 0
  }

  amounts.set(resourceId, newAmount);

  const change: ResourceChange = {
    resourceId,
    oldAmount,
    newAmount,
    delta: newAmount - oldAmount,
    source,
  };

  notifyChange(change);
  return true;
}

/**
 * Add to a resource
 */
function add(resourceId: string, amount: number, source?: string): number {
  const current = ResourceSystem.get(resourceId);
  ResourceSystem.set(resourceId, current + amount, source);
  return ResourceSystem.get(resourceId);
}

/**
 * Remove from a resource (will not go below min)
 */
function remove(resourceId: string, amount: number, source?: string): number {
  const current = ResourceSystem.get(resourceId);
  ResourceSystem.set(resourceId, current - amount, source);
  return ResourceSystem.get(resourceId);
}

/**
 * Consume a resource (fails if not enough)
 * @returns true if consumed, false if not enough
 */
function consume(resourceId: string, amount: number, source?: string): boolean {
  if (!ResourceSystem.hasEnough(resourceId, amount)) {
    EventBus.emit("resource:insufficient", {
      resourceId,
      required: amount,
      available: ResourceSystem.get(resourceId),
    });
    return false;
  }
  ResourceSystem.remove(resourceId, amount, source);
  return true;
}

/**
 * Check if there's enough of a resource
 */
function hasEnough(resourceId: string, amount: number): boolean {
  return ResourceSystem.get(resourceId) >= amount;
}

/**
 * Check if player can afford a cost (multiple resources)
 */
function canAfford(cost: ResourceCost): boolean {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (!ResourceSystem.hasEnough(resourceId, amount)) {
      return false;
    }
  }
  return true;
}

/**
 * Pay a cost (multiple resources at once)
 * @returns true if all resources consumed, false if any failed (no partial consumption)
 */
function pay(cost: ResourceCost, source?: string): boolean {
  // First check if we can afford everything
  if (!ResourceSystem.canAfford(cost)) {
    const missing: Record<string, number> = {};
    for (const [resourceId, amount] of Object.entries(cost)) {
      const available = ResourceSystem.get(resourceId);
      if (available < amount) {
        missing[resourceId] = amount - available;
      }
    }
    EventBus.emit("resource:cannot_afford", { cost, missing });
    return false;
  }

  // Consume all resources
  for (const [resourceId, amount] of Object.entries(cost)) {
    ResourceSystem.remove(resourceId, amount, source);
  }

  EventBus.emit("resource:paid", { cost, source });
  return true;
}

/**
 * Receive multiple resources at once
 */
function receive(resources: ResourceCost, source?: string): void {
  for (const [resourceId, amount] of Object.entries(resources)) {
    ResourceSystem.add(resourceId, amount, source);
  }
  EventBus.emit("resource:received", { resources, source });
}

/**
 * Transfer resources between accounts/entities
 */
function transfer(resourceId: string, amount: number, _from: string, _to: string): boolean {
  // For now, just consume and add (single-player)
  // In multiplayer, this would handle different accounts
  if (!ResourceSystem.hasEnough(resourceId, amount)) {
    return false;
  }
  // In a real implementation, we'd track per-entity resources
  // For now, this is a placeholder for future expansion
  EventBus.emit("resource:transferred", { resourceId, amount, from: _from, to: _to });
  return true;
}

/**
 * Subscribe to changes for a specific resource
 */
function onChange(resourceId: string, callback: (change: ResourceChange) => void): () => void {
  if (!changeCallbacks.has(resourceId)) {
    changeCallbacks.set(resourceId, []);
  }
  changeCallbacks.get(resourceId)!.push(callback);

  // Return unsubscribe function
  return () => {
    const callbacks = changeCallbacks.get(resourceId);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  };
}

/**
 * Subscribe to all resource changes
 */
function onAnyChange(callback: (change: ResourceChange) => void): () => void {
  return ResourceSystem.onChange("*", callback);
}

function notifyChange(change: ResourceChange): void {
  // Notify specific listeners
  const callbacks = changeCallbacks.get(change.resourceId);
  if (callbacks) {
    for (const cb of callbacks) {
      try {
        cb(change);
      } catch (error) {
        console.error("ResourceSystem: Error in change callback:", error);
      }
    }
  }

  // Notify wildcard listeners
  const wildcardCallbacks = changeCallbacks.get("*");
  if (wildcardCallbacks) {
    for (const cb of wildcardCallbacks) {
      try {
        cb(change);
      } catch (error) {
        console.error("ResourceSystem: Error in wildcard callback:", error);
      }
    }
  }

  // Emit global event
  EventBus.emit("resource:changed", change);
}

/**
 * Get resource definition
 */
function getDefinition(resourceId: string): ResourceDefinition | undefined {
  return resourceDefinitions.get(resourceId);
}

/**
 * Get all resource definitions
 */
function getAllDefinitions(): ResourceDefinition[] {
  return Array.from(resourceDefinitions.values());
}

/**
 * Load resource amounts from saved state
 */
function loadState(state: Record<string, number>): void {
  for (const [resourceId, amount] of Object.entries(state)) {
    amounts.set(resourceId, amount);
  }
}

/**
 * Get state for saving (only persistent resources)
 */
function getState(): Record<string, number> {
  const state: Record<string, number> = {};
  for (const [id, def] of resourceDefinitions) {
    if (def.persistent !== false) {
      state[id] = amounts.get(id) ?? 0;
    }
  }
  return state;
}

/**
 * Reset all resources to their minimum values
 */
function reset(): void {
  for (const [id, def] of resourceDefinitions) {
    amounts.set(id, def.minAmount ?? 0);
  }
}

/**
 * Clear all registrations and amounts
 */
function clear(): void {
  resourceDefinitions.clear();
  amounts.clear();
  changeCallbacks.clear();
}

export const ResourceSystem = {
  register,
  registerMany,
  get,
  getAll,
  getByCategory,
  set,
  add,
  remove,
  consume,
  hasEnough,
  canAfford,
  pay,
  receive,
  transfer,
  onChange,
  onAnyChange,
  getDefinition,
  getAllDefinitions,
  loadState,
  getState,
  reset,
  clear,
};

// ==================== Common Resource Definitions ====================

export const COMMON_RESOURCES: ResourceDefinition[] = [
  {
    id: "money",
    name: "Money",
    minAmount: 0,
    category: "currency",
  },
  {
    id: "xp",
    name: "Experience",
    minAmount: 0,
    category: "stat",
  },
  {
    id: "reputation",
    name: "Reputation",
    minAmount: 0,
    maxAmount: 100,
    category: "stat",
  },
];
