/**
 * TimerManager - Unified timer/cooldown system for game processes
 *
 * Manages timed events like ability cooldowns, crafting progress,
 * spawn timers, and other duration-based game mechanics.
 *
 * @example
 * ```typescript
 * TimerManager.create("cooldown", abilityId, duration, onComplete);
 * TimerManager.create("crafting", itemId, duration, onComplete, { onProgress });
 * TimerManager.pause("cooldown", abilityId);
 * TimerManager.getProgress("crafting", itemId);
 * ```
 */

import { EventBus } from "./EventBus";
import { GameTimer } from "./GameTimer";

export interface TimerOptions {
  onProgress?: (progress: number, timeRemaining: number) => void;
  onComplete?: () => void;
  onCancel?: () => void;
  autoStart?: boolean; // Default: true
  persistent?: boolean; // Save to game state (default: true)
  metadata?: Record<string, unknown>; // Custom data attached to timer
}

export interface TimerState {
  category: string;
  id: string;
  duration: number; // Total duration in ms
  elapsed: number; // Elapsed time in ms
  startedAt: number; // Game time when started
  pausedAt?: number; // Game time when paused (if paused)
  isPaused: boolean;
  isComplete: boolean;
  metadata?: Record<string, unknown>;
}

const timers: Map<string, TimerState> = new Map();
const timerCallbacks: Map<string, TimerOptions> = new Map();
const updateTaskId: string = "timer_manager_update";
let isRunning: boolean = false;

/**
 * Create a new timer
 * @param category Timer category (e.g., "cooldown", "crafting", "spawn")
 * @param id Unique ID within category (e.g., abilityId, itemId)
 * @param duration Duration in milliseconds
 * @param onComplete Callback when timer completes
 * @param options Additional options
 * @returns Timer key (category:id)
 */
function create(
  category: string,
  id: string,
  duration: number,
  onComplete?: () => void,
  options: Omit<TimerOptions, "onComplete"> = {},
): string {
  const key = TimerManager.getKey(category, id);
  const gameTimer = GameTimer.getInstance();

  const state: TimerState = {
    category,
    id,
    duration,
    elapsed: 0,
    startedAt: gameTimer.getGameTime(),
    isPaused: options.autoStart === false,
    isComplete: false,
    metadata: options.metadata,
  };

  if (options.autoStart === false) {
    state.pausedAt = state.startedAt;
  }

  timers.set(key, state);
  timerCallbacks.set(key, { ...options, onComplete });

  // Start update loop if not running
  if (!isRunning) {
    startUpdateLoop();
  }

  EventBus.emit("timer:created", { category, id, duration, key });
  return key;
}

/**
 * Get timer key from category and id
 */
function getKey(category: string, id: string): string {
  return `${category}:${id}`;
}

/**
 * Parse timer key into category and id
 */
function parseKey(key: string): { category: string; id: string } {
  const [category, ...idParts] = key.split(":");
  return { category, id: idParts.join(":") };
}

/**
 * Get a timer's current state
 */
function get(category: string, id: string): TimerState | undefined {
  return timers.get(TimerManager.getKey(category, id));
}

/**
 * Get timer by key
 */
function getByKey(key: string): TimerState | undefined {
  return timers.get(key);
}

/**
 * Get all timers in a category
 */
function getByCategory(category: string): TimerState[] {
  const result: TimerState[] = [];
  for (const [, state] of timers) {
    if (state.category === category) {
      result.push(state);
    }
  }
  return result;
}

/**
 * Get progress (0-1) of a timer
 */
function getProgress(category: string, id: string): number {
  const state = TimerManager.get(category, id);
  if (!state) return 0;
  return Math.min(1, state.elapsed / state.duration);
}

/**
 * Get time remaining in ms
 */
function getTimeRemaining(category: string, id: string): number {
  const state = TimerManager.get(category, id);
  if (!state) return 0;
  return Math.max(0, state.duration - state.elapsed);
}

/**
 * Pause a timer
 */
function pause(category: string, id: string): boolean {
  const key = TimerManager.getKey(category, id);
  const state = timers.get(key);
  if (!state || state.isPaused || state.isComplete) return false;

  state.isPaused = true;
  state.pausedAt = GameTimer.getInstance().getGameTime();

  EventBus.emit("timer:paused", { category, id, key });
  return true;
}

/**
 * Resume a paused timer
 */
function resume(category: string, id: string): boolean {
  const key = TimerManager.getKey(category, id);
  const state = timers.get(key);
  if (!state?.isPaused || state.isComplete) return false;

  state.isPaused = false;
  state.pausedAt = undefined;

  EventBus.emit("timer:resumed", { category, id, key });
  return true;
}

/**
 * Cancel a timer
 */
function cancel(category: string, id: string): boolean {
  const key = TimerManager.getKey(category, id);
  const state = timers.get(key);
  if (!state) return false;

  const callbacks = timerCallbacks.get(key);
  if (callbacks?.onCancel) {
    try {
      callbacks.onCancel();
    } catch (error) {
      console.error("TimerManager: Error in onCancel callback:", error);
    }
  }

  timers.delete(key);
  timerCallbacks.delete(key);

  EventBus.emit("timer:cancelled", { category, id, key });
  return true;
}

/**
 * Add time to a timer (extend duration)
 */
function addTime(category: string, id: string, additionalMs: number): boolean {
  const state = TimerManager.get(category, id);
  if (!state || state.isComplete) return false;

  state.duration += additionalMs;
  EventBus.emit("timer:extended", { category, id, additionalMs, newDuration: state.duration });
  return true;
}

/**
 * Reduce time from a timer (speed up)
 */
function reduceTime(category: string, id: string, reduceMs: number): boolean {
  const state = TimerManager.get(category, id);
  if (!state || state.isComplete) return false;

  state.duration = Math.max(state.elapsed, state.duration - reduceMs);
  EventBus.emit("timer:reduced", { category, id, reduceMs, newDuration: state.duration });
  return true;
}

/**
 * Complete a timer immediately
 */
function complete(category: string, id: string): boolean {
  const key = TimerManager.getKey(category, id);
  const state = timers.get(key);
  if (!state || state.isComplete) return false;

  state.elapsed = state.duration;
  state.isComplete = true;

  const callbacks = timerCallbacks.get(key);
  if (callbacks?.onComplete) {
    try {
      callbacks.onComplete();
    } catch (error) {
      console.error("TimerManager: Error in onComplete callback:", error);
    }
  }

  EventBus.emit("timer:completed", { category, id, key });

  // Clean up
  timers.delete(key);
  timerCallbacks.delete(key);

  return true;
}

/**
 * Check if a timer exists
 */
function exists(category: string, id: string): boolean {
  return timers.has(TimerManager.getKey(category, id));
}

/**
 * Check if a timer is paused
 */
function isPaused(category: string, id: string): boolean {
  return TimerManager.get(category, id)?.isPaused ?? false;
}

/**
 * Check if a timer is complete
 */
function isComplete(category: string, id: string): boolean {
  return TimerManager.get(category, id)?.isComplete ?? false;
}

/**
 * Update all timers (called from game loop)
 */
function update(deltaMs: number): void {
  for (const [key, state] of timers) {
    if (state.isPaused || state.isComplete) continue;

    state.elapsed += deltaMs;
    const progress = Math.min(1, state.elapsed / state.duration);
    const timeRemaining = Math.max(0, state.duration - state.elapsed);

    // Call progress callback
    const callbacks = timerCallbacks.get(key);
    if (callbacks?.onProgress) {
      try {
        callbacks.onProgress(progress, timeRemaining);
      } catch (error) {
        console.error("TimerManager: Error in onProgress callback:", error);
      }
    }

    // Check for completion
    if (state.elapsed >= state.duration) {
      state.isComplete = true;

      if (callbacks?.onComplete) {
        try {
          callbacks.onComplete();
        } catch (error) {
          console.error("TimerManager: Error in onComplete callback:", error);
        }
      }

      EventBus.emit("timer:completed", {
        category: state.category,
        id: state.id,
        key,
        metadata: state.metadata,
      });

      // Clean up completed timer
      timers.delete(key);
      timerCallbacks.delete(key);
    }
  }
}

function startUpdateLoop(): void {
  if (isRunning) return;
  isRunning = true;

  const gameTimer = GameTimer.getInstance();
  gameTimer.scheduleTask(updateTaskId, 100, () => {
    // Get scaled delta time (100ms real = 100ms * timeScale game time)
    const deltaMs = 100 * gameTimer.getTimeScale();
    TimerManager.update(deltaMs);
  });
}

/**
 * Stop the update loop
 */
function stopUpdateLoop(): void {
  if (!isRunning) return;
  isRunning = false;

  const gameTimer = GameTimer.getInstance();
  gameTimer.cancelTask(updateTaskId);
}

/**
 * Get all timer states for saving
 */
function getState(): TimerState[] {
  return Array.from(timers.values()).filter((t) => t.metadata?.persistent !== false);
}

/**
 * Load timer states (without callbacks - those must be re-registered)
 */
function loadState(states: TimerState[]): void {
  for (const state of states) {
    const key = TimerManager.getKey(state.category, state.id);
    timers.set(key, state);
  }

  if (states.length > 0 && !isRunning) {
    startUpdateLoop();
  }
}

/**
 * Re-attach callbacks to loaded timers
 */
function attachCallbacks(category: string, id: string, options: TimerOptions): void {
  const key = TimerManager.getKey(category, id);
  if (timers.has(key)) {
    timerCallbacks.set(key, options);
  }
}

/**
 * Get count of active timers
 */
function getActiveCount(): number {
  let count = 0;
  for (const state of timers.values()) {
    if (!state.isPaused && !state.isComplete) {
      count++;
    }
  }
  return count;
}

/**
 * Clear all timers
 */
function clear(): void {
  timers.clear();
  timerCallbacks.clear();
  TimerManager.stopUpdateLoop();
}

export const TimerManager = {
  create,
  getKey,
  parseKey,
  get,
  getByKey,
  getByCategory,
  getProgress,
  getTimeRemaining,
  pause,
  resume,
  cancel,
  addTime,
  reduceTime,
  complete,
  exists,
  isPaused,
  isComplete,
  update,
  stopUpdateLoop,
  getState,
  loadState,
  attachCallbacks,
  getActiveCount,
  clear,
};
