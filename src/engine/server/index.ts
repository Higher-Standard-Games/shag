/**
 * @module @engine/server
 *
 * Game-agnostic simulation engine with:
 * - COW (Copy-on-Write) state management
 * - Multi-rate tick system
 * - Binary network protocol
 * - Lag compensation with history rewind
 * - Replay system for determinism verification
 */

// ═══════════════════════════════════════════════════════════════════
// CORE
// ═══════════════════════════════════════════════════════════════════

export { Simulation } from "./core/Simulation";
export type { SubsystemConfig } from "./core/Subsystem";
export { Subsystem } from "./core/Subsystem";
export { WorldState } from "./core/WorldState";

// ═══════════════════════════════════════════════════════════════════
// ECS
// ═══════════════════════════════════════════════════════════════════

export { createDroppedWeaponEntity, createPlayerEntity, createProjectileEntity, Entity } from "./ecs/Entity";
export type { EntityId, PlayerId, TickNumber } from "./ecs/types";
export { EntityType, entityId, playerId, tickNumber } from "./ecs/types";

// ═══════════════════════════════════════════════════════════════════
// TICK ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════

export type { TickConfig } from "./tick/TickConfig";
export { FPS_TICK_CONFIG, RTS_TICK_CONFIG } from "./tick/TickConfig";
export { TickOrchestrator } from "./tick/TickOrchestrator";

// ═══════════════════════════════════════════════════════════════════
// NETWORK TRANSPORT
// ═══════════════════════════════════════════════════════════════════

export type {
  ClientConnection,
  Transport,
  TransportConfig,
  TransportEvents,
} from "./network";
export {
  // Transport
  WebSocketServerTransport,
} from "./network";

// ═══════════════════════════════════════════════════════════════════
// LAG COMPENSATION
// ═══════════════════════════════════════════════════════════════════

export type { Capsule, HistoryEntry, HitResult, LagCompensationConfig, Ray, RewindView } from "./lagcomp";
export { HistoryBuffer, LAG_COMPENSATION, LagCompensation } from "./lagcomp";

// ═══════════════════════════════════════════════════════════════════
// REPLAY SYSTEM
// ═══════════════════════════════════════════════════════════════════

export type { ReplayData, ReplayEvent, ReplayFrame, ReplayHeader } from "./replay/Replay";
export { ReplayPlayer, ReplayRecorder } from "./replay/Replay";
