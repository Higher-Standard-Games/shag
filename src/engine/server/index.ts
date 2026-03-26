/**
 * @module @engine/server
 *
 * Next-Gen Server Engine v0.9.0
 *
 * Game-agnostic simulation engine with:
 * - COW (Copy-on-Write) state management
 * - Multi-rate tick system
 * - Binary network protocol
 * - Lag compensation with history rewind
 * - Replay system for determinism verification
 *
 * @example
 * ```typescript
 * import { GameServer, WorldState, LagCompensation } from '@engine/server';
 *
 * const server = new GameServer(config, new FPSServerGame());
 * await server.start(3000);
 * ```
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

export type { Capsule, HistoryEntry, HitResult, LagCompensationConfig, Ray } from "./lagcomp";
export { CASUAL_CONFIG, COMPETITIVE_CONFIG, HistoryBuffer, LagCompensation, TOURNAMENT_CONFIG } from "./lagcomp";

// ═══════════════════════════════════════════════════════════════════
// REPLAY SYSTEM
// ═══════════════════════════════════════════════════════════════════

export type { ReplayData, ReplayEvent, ReplayFrame, ReplayHeader } from "./replay/Replay";
export { ReplayPlayer, ReplayRecorder } from "./replay/Replay";

// ═══════════════════════════════════════════════════════════════════
// MAIN SERVER
// ═══════════════════════════════════════════════════════════════════

export type { ServerConfig } from "./Server";
export { GameServer } from "./Server";
