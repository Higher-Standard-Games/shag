/**
 * Core Engine Systems
 *
 * Unified systems for building game features:
 * - EventBus: Global event system for decoupled communication
 * - ActionSystem: Central command/action system with validation and undo
 * - ResourceSystem: Unified resource management (money, items, XP, etc.)
 * - TimerManager: Timer/cooldown system for growth, curing, etc.
 */

export type {
  ActionContext,
  ActionHandler,
  ActionMiddleware,
  ActionResult,
  ActionUndoHandler,
  ActionValidator,
} from "./ActionSystem";
export { ActionSystem, analyticsMiddleware, loggingMiddleware } from "./ActionSystem";
export type { CvarFlags, CvarInstance, CvarOptions, CvarType, CvarValue } from "./Cvar";
export { Cvar } from "./Cvar";
export type { ServiceName } from "./EngineServices";
export { ENGINE_SERVICES, registerEngineServices, Services } from "./EngineServices";
export type {
  EntityData,
  EntityHandler,
  EntityHandlerOptions,
  EntityHandlerResult,
  PostRenderHook,
  PreRenderHook,
} from "./EntityHandlerRegistry";
export { EntityHandlerRegistry } from "./EntityHandlerRegistry";
export type {
  AppEvents,
  AssetEvents,
  AudioEvents,
  EngineEventData,
  EngineEvents,
  EventCallback,
  InputEvents,
  MapEvents,
} from "./EventBus";
export { EventBus } from "./EventBus";
export type { GameClockConfig, ScheduledEvent, TimeOfDay, TimePeriod } from "./GameClock";
export { GameClock } from "./GameClock";
export type { GameSpeedMode, ScheduledTask, TimerEvent } from "./GameTimer";
export { DEBUG_SPEED_ENABLED, GameTimer, SPEED_MULTIPLIERS } from "./GameTimer";
export type {
  LoadingCompleteEvent,
  LoadingProgressEvent,
  LoadingStartEvent,
  LoadingType,
} from "./LoadingEvents";
export { LOADING_EVENTS } from "./LoadingEvents";
export { PersistenceManager } from "./PersistenceManager";
export type {
  PopupButton,
  PopupConfig,
} from "./PopupSystem";
export { PopupSystem } from "./PopupSystem";
export type { DeviceInfo, QualityRecommendation } from "./QualityDetector";
export { QualityDetector } from "./QualityDetector";
export type {
  ResourceChange,
  ResourceCost,
  ResourceDefinition,
} from "./ResourceSystem";
export { COMMON_RESOURCES, ResourceSystem } from "./ResourceSystem";
export type { InitPhase, Service, ServiceRegistration } from "./ServiceLocator";
export { ServiceLocator } from "./ServiceLocator";
export type { InitializableSubsystem, Subsystem } from "./Subsystem";
export { SubsystemRegistry } from "./Subsystem";
export type {
  TimerOptions,
  TimerState,
} from "./TimerManager";
export { TimerManager } from "./TimerManager";
export type {
  AddIndicatorOptions,
  IndicatorAnimation,
  IndicatorConfig,
  WorldIndicator,
} from "./WorldIndicatorSystem";
export { WorldIndicatorSystem } from "./WorldIndicatorSystem";
