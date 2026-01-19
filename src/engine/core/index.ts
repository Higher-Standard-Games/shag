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
  MapEvents,
  AppEvents,
  InputEvents,
  AssetEvents,
  AudioEvents,
  EngineEvents,
  EngineEventData,
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

export { PersistenceManager } from "./PersistenceManager";

export { WorldIndicatorSystem } from "./WorldIndicatorSystem";
export type {
  IndicatorAnimation,
  IndicatorConfig,
  WorldIndicator,
  AddIndicatorOptions,
} from "./WorldIndicatorSystem";

export { SubsystemRegistry } from "./Subsystem";
export type { Subsystem, InitializableSubsystem } from "./Subsystem";

export { ServiceLocator } from "./ServiceLocator";
export type { Service, ServiceRegistration, InitPhase } from "./ServiceLocator";

export { registerEngineServices, Services, ENGINE_SERVICES } from "./EngineServices";
export type { ServiceName } from "./EngineServices";

export { EntityHandlerRegistry } from "./EntityHandlerRegistry";
export type { 
  EntityData, 
  EntityHandler, 
  EntityHandlerOptions, 
  EntityHandlerResult,
  PreRenderHook,
  PostRenderHook,
} from "./EntityHandlerRegistry";

export { QualityDetector } from "./QualityDetector";
export type { DeviceInfo, QualityRecommendation } from "./QualityDetector";

export { Cvar } from "./Cvar";
export type { CvarType, CvarValue, CvarFlags, CvarOptions, CvarInstance } from "./Cvar";

export { GameClock } from "./GameClock";
export type { TimeOfDay, TimePeriod, GameClockConfig, ScheduledEvent } from "./GameClock";

export { GameTimer, SPEED_MULTIPLIERS, DEBUG_SPEED_ENABLED } from "./GameTimer";
export type { GameSpeedMode, TimerEvent, ScheduledTask } from "./GameTimer";

export { LOADING_EVENTS } from "./LoadingEvents";
export type {
  LoadingType,
  LoadingStartEvent,
  LoadingProgressEvent,
  LoadingCompleteEvent,
} from "./LoadingEvents";
