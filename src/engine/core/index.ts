/**
 * Core Engine Systems
 * 
 * Unified systems for building game features:
 * - EventBus: Global event system for decoupled communication
 * - ActionSystem: Central command/action system with validation and undo
 * - ResourceSystem: Unified resource management (money, items, XP, etc.)
 * - TimerManager: Timer/cooldown system for growth, curing, etc.
 */

export { EventBus } from "./EventBus";
export type { 
  EventCallback,
  PlantEvents,
  ShopEvents,
  BuildingEvents,
  PlayerEvents,
  CuringEvents,
  GameEvents,
  AllEvents,
} from "./EventBus";

export { ActionSystem, loggingMiddleware, analyticsMiddleware } from "./ActionSystem";
export type {
  ActionContext,
  ActionHandler,
  ActionValidator,
  ActionUndoHandler,
  ActionMiddleware,
  ActionResult,
} from "./ActionSystem";

export { ResourceSystem, COMMON_RESOURCES } from "./ResourceSystem";
export type {
  ResourceDefinition,
  ResourceChange,
  ResourceCost,
} from "./ResourceSystem";

export { TimerManager } from "./TimerManager";
export type {
  TimerOptions,
  TimerState,
} from "./TimerManager";

export { PopupSystem } from "./PopupSystem";
export type {
  PopupButton,
  PopupConfig,
} from "./PopupSystem";
