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

const listeners: Map<string, EventSubscription[]> = new Map();
let eventHistory: Array<{ event: string; data: unknown; timestamp: number }> = [];
let historyEnabled: boolean = false;
let maxHistorySize: number = 100;

/**
 * Subscribe to an event
 * @param event Event name (e.g., "map:loaded", "entity:created")
 * @param callback Function to call when event is emitted
 * @param priority Higher priority handlers run first (default: 0)
 * @returns Unsubscribe function
 */
function on<T = unknown>(event: string, callback: EventCallback<T>, priority: number = 0): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }

  const subscription: EventSubscription = {
    callback: callback as EventCallback<unknown>,
    once: false,
    priority,
  };

  const subs = listeners.get(event)!;
  subs.push(subscription);
  // Sort by priority (higher first)
  subs.sort((a, b) => b.priority - a.priority);

  // Return unsubscribe function
  return () => EventBus.off(event, callback);
}

/**
 * Subscribe to an event once (auto-unsubscribes after first call)
 */
function once<T = unknown>(event: string, callback: EventCallback<T>, priority: number = 0): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }

  const subscription: EventSubscription = {
    callback: callback as EventCallback<unknown>,
    once: true,
    priority,
  };

  const subs = listeners.get(event)!;
  subs.push(subscription);
  subs.sort((a, b) => b.priority - a.priority);

  return () => EventBus.off(event, callback);
}

/**
 * Unsubscribe from an event
 */
function off<T = unknown>(event: string, callback: EventCallback<T>): void {
  const subs = listeners.get(event);
  if (!subs) return;

  const index = subs.findIndex((s) => s.callback === callback);
  if (index !== -1) {
    subs.splice(index, 1);
  }
}

/**
 * Emit an event to all subscribers
 * @param event Event name
 * @param data Data to pass to handlers
 */
function emit<T = unknown>(event: string, data?: T): void {
  // Record in history if enabled
  if (historyEnabled) {
    eventHistory.push({
      event,
      data,
      timestamp: Date.now(),
    });
    // Trim history if too large
    if (eventHistory.length > maxHistorySize) {
      eventHistory.shift();
    }
  }

  const subs = listeners.get(event);
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
async function emitAsync<T = unknown>(event: string, data?: T): Promise<void> {
  const subs = listeners.get(event);
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
function hasListeners(event: string): boolean {
  const subs = listeners.get(event);
  return subs !== undefined && subs.length > 0;
}

/**
 * Get count of listeners for an event
 */
function listenerCount(event: string): number {
  return listeners.get(event)?.length ?? 0;
}

/**
 * Remove all listeners for an event (or all events if no event specified)
 */
function clear(event?: string): void {
  if (event) {
    listeners.delete(event);
  } else {
    listeners.clear();
  }
}

/**
 * Enable/disable event history recording (useful for debugging)
 */
function setHistoryEnabled(enabled: boolean, maxSize: number = 100): void {
  historyEnabled = enabled;
  maxHistorySize = maxSize;
  if (!enabled) {
    eventHistory = [];
  }
}

/**
 * Get event history (if enabled)
 */
function getHistory(): Array<{ event: string; data: unknown; timestamp: number }> {
  return [...eventHistory];
}

/**
 * Get all registered event names
 */
function getEventNames(): string[] {
  return Array.from(listeners.keys());
}

export const EventBus = {
  on,
  once,
  off,
  emit,
  emitAsync,
  hasListeners,
  listenerCount,
  clear,
  setHistoryEnabled,
  getHistory,
  getEventNames,
};

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
  /** The player switched between touch and keyboard and mouse (`InputDevice`). */
  "input:device_changed": { device: "touch" | "keyboard_mouse" | "gamepad" };
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
