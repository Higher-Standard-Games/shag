/**
 * ActionSystem - Central command/action system for game actions
 *
 * Provides a unified interface for executing, validating, and undoing
 * game actions with middleware support for logging and analytics.
 *
 * @example
 * ```typescript
 * // Register an action
 * ActionSystem.register("build", buildHandler, buildValidator);
 *
 * // Execute an action
 * ActionSystem.execute("build", { entityId: "tower_1", position: { x: 10, y: 0 } });
 *
 * // Check if action can be executed
 * ActionSystem.canExecute("build", { entityId: "tower_1" });
 *
 * // Undo last action (if supported)
 * ActionSystem.undo();
 * ```
 */

import { devLog } from "./DevLog";
import { EventBus } from "./EventBus";

export interface ActionContext<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  undoData?: unknown;
}

export type ActionHandler = (payload: unknown) => unknown | Promise<unknown>;
export type ActionValidator = (payload: unknown) => boolean | string;
export type ActionUndoHandler = (payload: unknown, undoData: unknown) => void | Promise<void>;

interface ActionDefinition {
  handler: ActionHandler;
  validator?: ActionValidator;
  undoHandler?: ActionUndoHandler;
  generateUndoData?: (payload: unknown) => unknown;
}

export type ActionMiddleware = (context: ActionContext, next: () => Promise<unknown>) => Promise<unknown>;

export interface ActionResult<R = unknown> {
  success: boolean;
  result?: R;
  error?: string;
}

export class ActionSystem {
  private static actions: Map<string, ActionDefinition> = new Map();
  private static middleware: ActionMiddleware[] = [];
  private static history: ActionContext[] = [];
  private static undoStack: ActionContext[] = [];
  private static redoStack: ActionContext[] = [];
  private static maxHistorySize: number = 100;
  private static historyEnabled: boolean = true;

  /**
   * Register an action handler
   * @param type Action type name (e.g., "move", "interact", "build")
   * @param handler Function that executes the action
   * @param validator Optional function to check if action can be executed
   * @param undoHandler Optional function to undo the action
   * @param generateUndoData Optional function to capture state before action for undo
   */
  public static register(
    type: string,
    handler: ActionHandler,
    validator?: ActionValidator,
    undoHandler?: ActionUndoHandler,
    generateUndoData?: (payload: unknown) => unknown,
  ): void {
    ActionSystem.actions.set(type, {
      handler,
      validator,
      undoHandler,
      generateUndoData,
    });
  }

  /**
   * Unregister an action
   */
  public static unregister(type: string): void {
    ActionSystem.actions.delete(type);
  }

  /**
   * Check if an action can be executed
   * @returns true if valid, or error message string if invalid
   */
  public static canExecute<T = unknown>(type: string, payload: T): true | string {
    const action = ActionSystem.actions.get(type);
    if (!action) {
      return `Unknown action type: ${type}`;
    }

    if (action.validator) {
      const result = action.validator(payload);
      if (result === true) return true;
      if (result === false) return `Action "${type}" validation failed`;
      return result; // Error message string
    }

    return true;
  }

  /**
   * Execute an action
   * @param type Action type
   * @param payload Data for the action
   * @returns ActionResult with success status and result/error
   */
  public static async execute<T = unknown, R = unknown>(type: string, payload: T): Promise<ActionResult<R>> {
    const action = ActionSystem.actions.get(type);
    if (!action) {
      return { success: false, error: `Unknown action type: ${type}` };
    }

    // Validate
    const canExecute = ActionSystem.canExecute(type, payload);
    if (canExecute !== true) {
      EventBus.emit("action:failed", { type, payload, error: canExecute });
      return { success: false, error: canExecute };
    }

    // Create context
    const context: ActionContext<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    // Generate undo data if supported
    if (action.generateUndoData) {
      context.undoData = action.generateUndoData(payload);
    }

    // Emit before event
    EventBus.emit("action:before", { type, payload });

    try {
      // Execute through middleware chain
      const result = await ActionSystem.executeWithMiddleware(context, async () => {
        return await action.handler(payload);
      });

      // Record in history
      if (ActionSystem.historyEnabled) {
        ActionSystem.history.push(context);
        if (ActionSystem.history.length > ActionSystem.maxHistorySize) {
          ActionSystem.history.shift();
        }

        // Add to undo stack if undoable
        if (action.undoHandler) {
          ActionSystem.undoStack.push(context);
          ActionSystem.redoStack = []; // Clear redo stack on new action
        }
      }

      // Emit after event
      EventBus.emit("action:after", { type, payload, result });
      EventBus.emit(`action:${type}`, { payload, result });

      return { success: true, result: result as R };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      EventBus.emit("action:error", { type, payload, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute action synchronously (for simple actions)
   */
  public static executeSync<T = unknown, R = unknown>(type: string, payload: T): ActionResult<R> {
    const action = ActionSystem.actions.get(type);
    if (!action) {
      return { success: false, error: `Unknown action type: ${type}` };
    }

    const canExecute = ActionSystem.canExecute(type, payload);
    if (canExecute !== true) {
      return { success: false, error: canExecute };
    }

    try {
      const result = action.handler(payload) as R;

      const context: ActionContext<T> = {
        type,
        payload,
        timestamp: Date.now(),
      };

      if (ActionSystem.historyEnabled) {
        ActionSystem.history.push(context);
        if (action.undoHandler && action.generateUndoData) {
          context.undoData = action.generateUndoData(payload);
          ActionSystem.undoStack.push(context);
          ActionSystem.redoStack = [];
        }
      }

      EventBus.emit(`action:${type}`, { payload, result });
      return { success: true, result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Undo the last undoable action
   */
  public static async undo(): Promise<boolean> {
    const context = ActionSystem.undoStack.pop();
    if (!context) return false;

    const action = ActionSystem.actions.get(context.type);
    if (!action?.undoHandler) return false;

    try {
      await action.undoHandler(context.payload, context.undoData);
      ActionSystem.redoStack.push(context);
      EventBus.emit("action:undone", { type: context.type, payload: context.payload });
      return true;
    } catch (error) {
      console.error("ActionSystem: Undo failed:", error);
      return false;
    }
  }

  /**
   * Redo the last undone action
   */
  public static async redo(): Promise<boolean> {
    const context = ActionSystem.redoStack.pop();
    if (!context) return false;

    const action = ActionSystem.actions.get(context.type);
    if (!action) return false;

    try {
      await action.handler(context.payload);
      ActionSystem.undoStack.push(context);
      EventBus.emit("action:redone", { type: context.type, payload: context.payload });
      return true;
    } catch (error) {
      console.error("ActionSystem: Redo failed:", error);
      return false;
    }
  }

  /**
   * Check if undo is available
   */
  public static canUndo(): boolean {
    return ActionSystem.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  public static canRedo(): boolean {
    return ActionSystem.redoStack.length > 0;
  }

  /**
   * Add middleware to the action pipeline
   * Middleware runs in order for each action
   */
  public static use(middleware: ActionMiddleware): void {
    ActionSystem.middleware.push(middleware);
  }

  /**
   * Remove middleware
   */
  public static removeMiddleware(middleware: ActionMiddleware): void {
    const index = ActionSystem.middleware.indexOf(middleware);
    if (index !== -1) {
      ActionSystem.middleware.splice(index, 1);
    }
  }

  private static async executeWithMiddleware(
    context: ActionContext,
    handler: () => Promise<unknown>,
  ): Promise<unknown> {
    let index = 0;

    const next = async (): Promise<unknown> => {
      if (index < ActionSystem.middleware.length) {
        const mw = ActionSystem.middleware[index++];
        return await mw(context, next);
      }
      return await handler();
    };

    return await next();
  }

  /**
   * Get action history
   */
  public static getHistory(): ActionContext[] {
    return [...ActionSystem.history];
  }

  /**
   * Clear history and undo/redo stacks
   */
  public static clearHistory(): void {
    ActionSystem.history = [];
    ActionSystem.undoStack = [];
    ActionSystem.redoStack = [];
  }

  /**
   * Enable/disable history recording
   */
  public static setHistoryEnabled(enabled: boolean): void {
    ActionSystem.historyEnabled = enabled;
  }

  /**
   * Get all registered action types
   */
  public static getActionTypes(): string[] {
    return Array.from(ActionSystem.actions.keys());
  }

  /**
   * Check if an action type is registered
   */
  public static hasAction(type: string): boolean {
    return ActionSystem.actions.has(type);
  }

  /**
   * Clear all registered actions
   */
  public static clear(): void {
    ActionSystem.actions.clear();
    ActionSystem.middleware = [];
    ActionSystem.clearHistory();
  }
}

// ==================== Built-in Middleware ====================

/**
 * Logging middleware - logs all actions to console
 */
export const loggingMiddleware: ActionMiddleware = async (context, next) => {
  devLog(`[Action] ${context.type}`, context.payload);
  const start = performance.now();
  const result = await next();
  const duration = performance.now() - start;
  devLog(`[Action] ${context.type} completed in ${duration.toFixed(2)}ms`);
  return result;
};

/**
 * Analytics middleware - emits events for analytics tracking
 */
export const analyticsMiddleware: ActionMiddleware = async (context, next) => {
  EventBus.emit("analytics:action", {
    type: context.type,
    payload: context.payload,
    timestamp: context.timestamp,
  });
  return await next();
};
