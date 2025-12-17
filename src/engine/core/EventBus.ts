/**
 * EventBus - Global event system for decoupled communication between systems
 * 
 * Usage:
 *   EventBus.emit("plant:harvested", { plantId, yield, quality });
 *   EventBus.on("plant:harvested", (data) => { ... });
 *   EventBus.off("plant:harvested", handler);
 *   EventBus.once("player:levelup", (data) => { ... });
 */

export type EventCallback<T = unknown> = (data: T) => void;

interface EventSubscription {
  callback: EventCallback<unknown>;
  once: boolean;
  priority: number;
}

export class EventBus {
  private static listeners: Map<string, EventSubscription[]> = new Map();
  private static eventHistory: Array<{ event: string; data: unknown; timestamp: number }> = [];
  private static historyEnabled: boolean = false;
  private static maxHistorySize: number = 100;

  /**
   * Subscribe to an event
   * @param event Event name (e.g., "plant:harvested", "shop:purchased")
   * @param callback Function to call when event is emitted
   * @param priority Higher priority handlers run first (default: 0)
   * @returns Unsubscribe function
   */
  public static on<T = unknown>(
    event: string,
    callback: EventCallback<T>,
    priority: number = 0
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const subscription: EventSubscription = {
      callback: callback as EventCallback<unknown>,
      once: false,
      priority,
    };

    const subs = this.listeners.get(event)!;
    subs.push(subscription);
    // Sort by priority (higher first)
    subs.sort((a, b) => b.priority - a.priority);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   */
  public static once<T = unknown>(
    event: string,
    callback: EventCallback<T>,
    priority: number = 0
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const subscription: EventSubscription = {
      callback: callback as EventCallback<unknown>,
      once: true,
      priority,
    };

    const subs = this.listeners.get(event)!;
    subs.push(subscription);
    subs.sort((a, b) => b.priority - a.priority);

    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   */
  public static off<T = unknown>(event: string, callback: EventCallback<T>): void {
    const subs = this.listeners.get(event);
    if (!subs) return;

    const index = subs.findIndex(s => s.callback === callback);
    if (index !== -1) {
      subs.splice(index, 1);
    }
  }

  /**
   * Emit an event to all subscribers
   * @param event Event name
   * @param data Data to pass to handlers
   */
  public static emit<T = unknown>(event: string, data?: T): void {
    // Record in history if enabled
    if (this.historyEnabled) {
      this.eventHistory.push({
        event,
        data,
        timestamp: Date.now(),
      });
      // Trim history if too large
      if (this.eventHistory.length > this.maxHistorySize) {
        this.eventHistory.shift();
      }
    }

    const subs = this.listeners.get(event);
    if (!subs || subs.length === 0) return;

    // Create a copy to avoid issues if handlers modify the list
    const toCall = [...subs];
    const toRemove: EventSubscription[] = [];

    for (const sub of toCall) {
      try {
        sub.callback(data);
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch (error) {
        console.error(`EventBus: Error in handler for "${event}":`, error);
      }
    }

    // Remove one-time handlers
    for (const sub of toRemove) {
      const index = subs.indexOf(sub);
      if (index !== -1) {
        subs.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event and wait for async handlers
   */
  public static async emitAsync<T = unknown>(event: string, data?: T): Promise<void> {
    const subs = this.listeners.get(event);
    if (!subs || subs.length === 0) return;

    const toCall = [...subs];
    const toRemove: EventSubscription[] = [];

    for (const sub of toCall) {
      try {
        await sub.callback(data);
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch (error) {
        console.error(`EventBus: Error in async handler for "${event}":`, error);
      }
    }

    for (const sub of toRemove) {
      const index = subs.indexOf(sub);
      if (index !== -1) {
        subs.splice(index, 1);
      }
    }
  }

  /**
   * Check if an event has any listeners
   */
  public static hasListeners(event: string): boolean {
    const subs = this.listeners.get(event);
    return subs !== undefined && subs.length > 0;
  }

  /**
   * Get count of listeners for an event
   */
  public static listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /**
   * Remove all listeners for an event (or all events if no event specified)
   */
  public static clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Enable/disable event history recording (useful for debugging)
   */
  public static setHistoryEnabled(enabled: boolean, maxSize: number = 100): void {
    this.historyEnabled = enabled;
    this.maxHistorySize = maxSize;
    if (!enabled) {
      this.eventHistory = [];
    }
  }

  /**
   * Get event history (if enabled)
   */
  public static getHistory(): Array<{ event: string; data: unknown; timestamp: number }> {
    return [...this.eventHistory];
  }

  /**
   * Get all registered event names
   */
  public static getEventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

// ==================== Standard Event Types ====================
// These provide type safety for common events

export interface PlantEvents {
  "plant:planted": { plantId: string; strain: string; position: { x: number; y: number; z: number } };
  "plant:watered": { plantId: string; waterLevel: number };
  "plant:fertilized": { plantId: string; speedBoost: number };
  "plant:stage_change": { plantId: string; oldStage: number; newStage: number };
  "plant:harvested": { plantId: string; strain: string; yield: number; quality: number };
  "plant:died": { plantId: string; reason: string };
}

export interface ShopEvents {
  "shop:purchased": { itemId: string; quantity: number; cost: number };
  "shop:sold": { itemId: string; quantity: number; revenue: number };
  "shop:restocked": { itemId: string; newStock: number };
}

export interface BuildingEvents {
  "building:started": { objectId: string; templateId: string; zoneId: string };
  "building:progress": { objectId: string; progress: number };
  "building:completed": { objectId: string; templateId: string; zoneId: string };
  "building:demolished": { objectId: string; templateId: string };
}

export interface PlayerEvents {
  "player:levelup": { oldLevel: number; newLevel: number };
  "player:xp_gained": { amount: number; source: string };
  "player:money_changed": { oldAmount: number; newAmount: number; delta: number };
}

export interface CuringEvents {
  "curing:started": { barrelId: string; strainId: string; amount: number };
  "curing:completed": { barrelId: string; strainId: string; amount: number };
  "curing:decayed": { itemId: string; amount: number };
}

export interface GameEvents {
  "game:saved": { timestamp: number };
  "game:loaded": { timestamp: number };
  "game:day_changed": { day: number };
  "game:paused": Record<string, never>;
  "game:resumed": Record<string, never>;
}

// Union of all event types for type-safe emit/on
export type AllEvents = PlantEvents & ShopEvents & BuildingEvents & PlayerEvents & CuringEvents & GameEvents;
