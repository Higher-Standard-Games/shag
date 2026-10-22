/**
 * Subsystem - Base interface for game subsystems with state management
 *
 * All major game systems should implement this interface to ensure
 * consistent save/load behavior and lifecycle management.
 *
 * Usage:
 *   class MySystem implements Subsystem<MyState> {
 *     getState(): MyState { ... }
 *     loadState(state: MyState): void { ... }
 *     clear(): void { ... }
 *     dispose(): void { ... }
 *   }
 */

/**
 * Interface for subsystems that can save/load their state
 * @template T The state type for this subsystem
 */
export interface Subsystem<T = unknown> {
  /**
   * Get the current state for serialization
   * This should return a plain object that can be JSON.stringify'd
   */
  getState(): T;

  /**
   * Load state from saved data
   * Should handle partial/missing data gracefully for backwards compatibility
   */
  loadState(state: Partial<T>): void;

  /**
   * Clear all state (for new game)
   */
  clear(): void;

  /**
   * Dispose of resources (timers, event listeners, etc.)
   * Called when the system is being shut down
   */
  dispose(): void;
}

/**
 * Interface for subsystems that need initialization
 */
export interface InitializableSubsystem<T = unknown> extends Subsystem<T> {
  /**
   * Initialize the subsystem
   * Called once during game startup
   */
  init(): void;

  /**
   * Check if the subsystem is initialized
   */
  isInitialized(): boolean;
}

/**
 * Registry for tracking all subsystems
 * Useful for batch operations like saveAll, loadAll, clearAll
 */
export class SubsystemRegistry {
  private static subsystems: Map<string, Subsystem> = new Map();

  /**
   * Register a subsystem
   */
  public static register(name: string, subsystem: Subsystem): void {
    SubsystemRegistry.subsystems.set(name, subsystem);
  }

  /**
   * Unregister a subsystem
   */
  public static unregister(name: string): void {
    SubsystemRegistry.subsystems.delete(name);
  }

  /**
   * Get a registered subsystem
   */
  public static get<T extends Subsystem>(name: string): T | undefined {
    return SubsystemRegistry.subsystems.get(name) as T | undefined;
  }

  /**
   * Get all registered subsystems
   */
  public static getAll(): Map<string, Subsystem> {
    return new Map(SubsystemRegistry.subsystems);
  }

  /**
   * Collect state from all registered subsystems
   */
  public static collectAllStates(): Record<string, unknown> {
    const states: Record<string, unknown> = {};
    for (const [name, subsystem] of SubsystemRegistry.subsystems) {
      states[name] = subsystem.getState();
    }
    return states;
  }

  /**
   * Load state into all registered subsystems
   */
  public static loadAllStates(states: Record<string, unknown>): void {
    for (const [name, subsystem] of SubsystemRegistry.subsystems) {
      if (states[name]) {
        subsystem.loadState(states[name]);
      }
    }
  }

  /**
   * Clear all registered subsystems
   */
  public static clearAll(): void {
    for (const subsystem of SubsystemRegistry.subsystems.values()) {
      subsystem.clear();
    }
  }

  /**
   * Dispose all registered subsystems
   */
  public static disposeAll(): void {
    for (const subsystem of SubsystemRegistry.subsystems.values()) {
      subsystem.dispose();
    }
    SubsystemRegistry.subsystems.clear();
  }
}
