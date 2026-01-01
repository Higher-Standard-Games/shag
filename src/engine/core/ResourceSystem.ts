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

export class ResourceSystem {
  private static resources: Map<string, ResourceDefinition> = new Map();
  private static amounts: Map<string, number> = new Map();
  private static changeCallbacks: Map<string, Array<(change: ResourceChange) => void>> = new Map();

  /**
   * Register a resource type
   */
  public static register(definition: ResourceDefinition): void {
    this.resources.set(definition.id, definition);
    if (!this.amounts.has(definition.id)) {
      this.amounts.set(definition.id, definition.minAmount ?? 0);
    }
  }

  /**
   * Register multiple resource types
   */
  public static registerMany(definitions: ResourceDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * Get current amount of a resource
   */
  public static get(resourceId: string): number {
    return this.amounts.get(resourceId) ?? 0;
  }

  /**
   * Get all resource amounts
   */
  public static getAll(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, amount] of this.amounts) {
      result[id] = amount;
    }
    return result;
  }

  /**
   * Get resources by category
   */
  public static getByCategory(category: string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, def] of this.resources) {
      if (def.category === category) {
        result[id] = this.amounts.get(id) ?? 0;
      }
    }
    return result;
  }

  /**
   * Set a resource to a specific amount
   */
  public static set(resourceId: string, amount: number, source?: string): boolean {
    const def = this.resources.get(resourceId);
    const oldAmount = this.amounts.get(resourceId) ?? 0;

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

    this.amounts.set(resourceId, newAmount);

    const change: ResourceChange = {
      resourceId,
      oldAmount,
      newAmount,
      delta: newAmount - oldAmount,
      source,
    };

    this.notifyChange(change);
    return true;
  }

  /**
   * Add to a resource
   */
  public static add(resourceId: string, amount: number, source?: string): number {
    const current = this.get(resourceId);
    this.set(resourceId, current + amount, source);
    return this.get(resourceId);
  }

  /**
   * Remove from a resource (will not go below min)
   */
  public static remove(resourceId: string, amount: number, source?: string): number {
    const current = this.get(resourceId);
    this.set(resourceId, current - amount, source);
    return this.get(resourceId);
  }

  /**
   * Consume a resource (fails if not enough)
   * @returns true if consumed, false if not enough
   */
  public static consume(resourceId: string, amount: number, source?: string): boolean {
    if (!this.hasEnough(resourceId, amount)) {
      EventBus.emit("resource:insufficient", { resourceId, required: amount, available: this.get(resourceId) });
      return false;
    }
    this.remove(resourceId, amount, source);
    return true;
  }

  /**
   * Check if there's enough of a resource
   */
  public static hasEnough(resourceId: string, amount: number): boolean {
    return this.get(resourceId) >= amount;
  }

  /**
   * Check if player can afford a cost (multiple resources)
   */
  public static canAfford(cost: ResourceCost): boolean {
    for (const [resourceId, amount] of Object.entries(cost)) {
      if (!this.hasEnough(resourceId, amount)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Pay a cost (multiple resources at once)
   * @returns true if all resources consumed, false if any failed (no partial consumption)
   */
  public static pay(cost: ResourceCost, source?: string): boolean {
    // First check if we can afford everything
    if (!this.canAfford(cost)) {
      const missing: Record<string, number> = {};
      for (const [resourceId, amount] of Object.entries(cost)) {
        const available = this.get(resourceId);
        if (available < amount) {
          missing[resourceId] = amount - available;
        }
      }
      EventBus.emit("resource:cannot_afford", { cost, missing });
      return false;
    }

    // Consume all resources
    for (const [resourceId, amount] of Object.entries(cost)) {
      this.remove(resourceId, amount, source);
    }

    EventBus.emit("resource:paid", { cost, source });
    return true;
  }

  /**
   * Receive multiple resources at once
   */
  public static receive(resources: ResourceCost, source?: string): void {
    for (const [resourceId, amount] of Object.entries(resources)) {
      this.add(resourceId, amount, source);
    }
    EventBus.emit("resource:received", { resources, source });
  }

  /**
   * Transfer resources between accounts/entities
   */
  public static transfer(
    resourceId: string,
    amount: number,
    _from: string,
    _to: string
  ): boolean {
    // For now, just consume and add (single-player)
    // In multiplayer, this would handle different accounts
    if (!this.hasEnough(resourceId, amount)) {
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
  public static onChange(resourceId: string, callback: (change: ResourceChange) => void): () => void {
    if (!this.changeCallbacks.has(resourceId)) {
      this.changeCallbacks.set(resourceId, []);
    }
    this.changeCallbacks.get(resourceId)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.changeCallbacks.get(resourceId);
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
  public static onAnyChange(callback: (change: ResourceChange) => void): () => void {
    return this.onChange("*", callback);
  }

  private static notifyChange(change: ResourceChange): void {
    // Notify specific listeners
    const callbacks = this.changeCallbacks.get(change.resourceId);
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
    const wildcardCallbacks = this.changeCallbacks.get("*");
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
  public static getDefinition(resourceId: string): ResourceDefinition | undefined {
    return this.resources.get(resourceId);
  }

  /**
   * Get all resource definitions
   */
  public static getAllDefinitions(): ResourceDefinition[] {
    return Array.from(this.resources.values());
  }

  /**
   * Load resource amounts from saved state
   */
  public static loadState(state: Record<string, number>): void {
    for (const [resourceId, amount] of Object.entries(state)) {
      this.amounts.set(resourceId, amount);
    }
  }

  /**
   * Get state for saving (only persistent resources)
   */
  public static getState(): Record<string, number> {
    const state: Record<string, number> = {};
    for (const [id, def] of this.resources) {
      if (def.persistent !== false) {
        state[id] = this.amounts.get(id) ?? 0;
      }
    }
    return state;
  }

  /**
   * Reset all resources to their minimum values
   */
  public static reset(): void {
    for (const [id, def] of this.resources) {
      this.amounts.set(id, def.minAmount ?? 0);
    }
  }

  /**
   * Clear all registrations and amounts
   */
  public static clear(): void {
    this.resources.clear();
    this.amounts.clear();
    this.changeCallbacks.clear();
  }
}

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
