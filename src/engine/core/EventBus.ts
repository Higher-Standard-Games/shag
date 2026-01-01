/**
 * EventBus - Global event system for decoupled communication between systems
 * 
 * Provides a publish-subscribe pattern for loose coupling between engine
 * and game systems. Supports priority ordering, one-time subscriptions,
 * and optional event history for debugging.
 * 
 * @example
 * ```typescript
 * // Subscribe to an event
 * EventBus.on("entity:spawned", (data) => console.log(data.id));
 * 
 * // Emit an event
 * EventBus.emit("entity:spawned", { id: "player1", type: "character" });
 * 
 * // One-time subscription
 * EventBus.once("scene:ready", () => startGame());
 * 
 * // Unsubscribe
 * const unsubscribe = EventBus.on("update", handler);
 * unsubscribe();
 * ```
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
   * @param event Event name (e.g., "map:loaded", "entity:created")
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

// ==================== Engine Event Types ====================
// These are generic engine-level events, not game-specific

/**
 * Map/Scene lifecycle events
 */
export interface MapEvents {
  "map:loading": { mapName: string };
  "map:loaded": { mapName: string };
  "map:unloading": { mapName: string };
  "map:transition": { from: string; to: string };
}

/**
 * App lifecycle events (mobile/desktop)
 */
export interface AppEvents {
  "app:state_change": { isActive: boolean };
  "app:back_button": { canGoBack: boolean };
  "app:resize": { width: number; height: number };
  "app:orientation_change": { orientation: "portrait" | "landscape" };
}

/**
 * Input events
 */
export interface InputEvents {
  "input:click": { x: number; y: number; target?: string };
  "input:key": { key: string; action: "down" | "up" };
}

/**
 * Asset loading events
 */
export interface AssetEvents {
  "assets:progress": { loaded: number; total: number; current: string };
  "assets:complete": { duration: number };
  "assets:error": { asset: string; error: string };
}

/**
 * Audio events
 */
export interface AudioEvents {
  "audio:music_started": { track: string };
  "audio:music_ended": { track: string };
  "audio:music_changed": { from: string; to: string };
}

/**
 * Union of all engine event types
 */
export type EngineEvents = MapEvents & AppEvents & InputEvents & AssetEvents & AudioEvents;

/**
 * Helper type to get event data type by event name
 */
export type EngineEventData<K extends keyof EngineEvents> = EngineEvents[K];
