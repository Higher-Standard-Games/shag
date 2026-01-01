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
import { GameTimer } from "../../game/GameTimer";

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

export class TimerManager {
  private static timers: Map<string, TimerState> = new Map();
  private static callbacks: Map<string, TimerOptions> = new Map();
  private static updateTaskId: string = "timer_manager_update";
  private static isRunning: boolean = false;

  /**
   * Create a new timer
   * @param category Timer category (e.g., "cooldown", "crafting", "spawn")
   * @param id Unique ID within category (e.g., abilityId, itemId)
   * @param duration Duration in milliseconds
   * @param onComplete Callback when timer completes
   * @param options Additional options
   * @returns Timer key (category:id)
   */
  public static create(
    category: string,
    id: string,
    duration: number,
    onComplete?: () => void,
    options: Omit<TimerOptions, "onComplete"> = {}
  ): string {
    const key = this.getKey(category, id);
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

    this.timers.set(key, state);
    this.callbacks.set(key, { ...options, onComplete });

    // Start update loop if not running
    if (!this.isRunning) {
      this.startUpdateLoop();
    }

    EventBus.emit("timer:created", { category, id, duration, key });
    return key;
  }

  /**
   * Get timer key from category and id
   */
  public static getKey(category: string, id: string): string {
    return `${category}:${id}`;
  }

  /**
   * Parse timer key into category and id
   */
  public static parseKey(key: string): { category: string; id: string } {
    const [category, ...idParts] = key.split(":");
    return { category, id: idParts.join(":") };
  }

  /**
   * Get a timer's current state
   */
  public static get(category: string, id: string): TimerState | undefined {
    return this.timers.get(this.getKey(category, id));
  }

  /**
   * Get timer by key
   */
  public static getByKey(key: string): TimerState | undefined {
    return this.timers.get(key);
  }

  /**
   * Get all timers in a category
   */
  public static getByCategory(category: string): TimerState[] {
    const result: TimerState[] = [];
    for (const [, state] of this.timers) {
      if (state.category === category) {
        result.push(state);
      }
    }
    return result;
  }

  /**
   * Get progress (0-1) of a timer
   */
  public static getProgress(category: string, id: string): number {
    const state = this.get(category, id);
    if (!state) return 0;
    return Math.min(1, state.elapsed / state.duration);
  }

  /**
   * Get time remaining in ms
   */
  public static getTimeRemaining(category: string, id: string): number {
    const state = this.get(category, id);
    if (!state) return 0;
    return Math.max(0, state.duration - state.elapsed);
  }

  /**
   * Pause a timer
   */
  public static pause(category: string, id: string): boolean {
    const key = this.getKey(category, id);
    const state = this.timers.get(key);
    if (!state || state.isPaused || state.isComplete) return false;

    state.isPaused = true;
    state.pausedAt = GameTimer.getInstance().getGameTime();

    EventBus.emit("timer:paused", { category, id, key });
    return true;
  }

  /**
   * Resume a paused timer
   */
  public static resume(category: string, id: string): boolean {
    const key = this.getKey(category, id);
    const state = this.timers.get(key);
    if (!state || !state.isPaused || state.isComplete) return false;

    state.isPaused = false;
    state.pausedAt = undefined;

    EventBus.emit("timer:resumed", { category, id, key });
    return true;
  }

  /**
   * Cancel a timer
   */
  public static cancel(category: string, id: string): boolean {
    const key = this.getKey(category, id);
    const state = this.timers.get(key);
    if (!state) return false;

    const callbacks = this.callbacks.get(key);
    if (callbacks?.onCancel) {
      try {
        callbacks.onCancel();
      } catch (error) {
        console.error("TimerManager: Error in onCancel callback:", error);
      }
    }

    this.timers.delete(key);
    this.callbacks.delete(key);

    EventBus.emit("timer:cancelled", { category, id, key });
    return true;
  }

  /**
   * Add time to a timer (extend duration)
   */
  public static addTime(category: string, id: string, additionalMs: number): boolean {
    const state = this.get(category, id);
    if (!state || state.isComplete) return false;

    state.duration += additionalMs;
    EventBus.emit("timer:extended", { category, id, additionalMs, newDuration: state.duration });
    return true;
  }

  /**
   * Reduce time from a timer (speed up)
   */
  public static reduceTime(category: string, id: string, reduceMs: number): boolean {
    const state = this.get(category, id);
    if (!state || state.isComplete) return false;

    state.duration = Math.max(state.elapsed, state.duration - reduceMs);
    EventBus.emit("timer:reduced", { category, id, reduceMs, newDuration: state.duration });
    return true;
  }

  /**
   * Complete a timer immediately
   */
  public static complete(category: string, id: string): boolean {
    const key = this.getKey(category, id);
    const state = this.timers.get(key);
    if (!state || state.isComplete) return false;

    state.elapsed = state.duration;
    state.isComplete = true;

    const callbacks = this.callbacks.get(key);
    if (callbacks?.onComplete) {
      try {
        callbacks.onComplete();
      } catch (error) {
        console.error("TimerManager: Error in onComplete callback:", error);
      }
    }

    EventBus.emit("timer:completed", { category, id, key });

    // Clean up
    this.timers.delete(key);
    this.callbacks.delete(key);

    return true;
  }

  /**
   * Check if a timer exists
   */
  public static exists(category: string, id: string): boolean {
    return this.timers.has(this.getKey(category, id));
  }

  /**
   * Check if a timer is paused
   */
  public static isPaused(category: string, id: string): boolean {
    return this.get(category, id)?.isPaused ?? false;
  }

  /**
   * Check if a timer is complete
   */
  public static isComplete(category: string, id: string): boolean {
    return this.get(category, id)?.isComplete ?? false;
  }

  /**
   * Update all timers (called from game loop)
   */
  public static update(deltaMs: number): void {
    for (const [key, state] of this.timers) {
      if (state.isPaused || state.isComplete) continue;

      state.elapsed += deltaMs;
      const progress = Math.min(1, state.elapsed / state.duration);
      const timeRemaining = Math.max(0, state.duration - state.elapsed);

      // Call progress callback
      const callbacks = this.callbacks.get(key);
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
        this.timers.delete(key);
        this.callbacks.delete(key);
      }
    }
  }

  private static startUpdateLoop(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const gameTimer = GameTimer.getInstance();
    gameTimer.scheduleTask(this.updateTaskId, 100, () => {
      // Get scaled delta time (100ms real = 100ms * timeScale game time)
      const deltaMs = 100 * gameTimer.getTimeScale();
      this.update(deltaMs);
    });
  }

  /**
   * Stop the update loop
   */
  public static stopUpdateLoop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    const gameTimer = GameTimer.getInstance();
    gameTimer.cancelTask(this.updateTaskId);
  }

  /**
   * Get all timer states for saving
   */
  public static getState(): TimerState[] {
    return Array.from(this.timers.values()).filter(t => t.metadata?.persistent !== false);
  }

  /**
   * Load timer states (without callbacks - those must be re-registered)
   */
  public static loadState(states: TimerState[]): void {
    for (const state of states) {
      const key = this.getKey(state.category, state.id);
      this.timers.set(key, state);
    }

    if (states.length > 0 && !this.isRunning) {
      this.startUpdateLoop();
    }
  }

  /**
   * Re-attach callbacks to loaded timers
   */
  public static attachCallbacks(category: string, id: string, options: TimerOptions): void {
    const key = this.getKey(category, id);
    if (this.timers.has(key)) {
      this.callbacks.set(key, options);
    }
  }

  /**
   * Get count of active timers
   */
  public static getActiveCount(): number {
    let count = 0;
    for (const state of this.timers.values()) {
      if (!state.isPaused && !state.isComplete) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all timers
   */
  public static clear(): void {
    this.timers.clear();
    this.callbacks.clear();
    this.stopUpdateLoop();
  }
}
