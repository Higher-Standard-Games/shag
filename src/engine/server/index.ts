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

export { Simulation } from './core/Simulation';
export { WorldState } from './core/WorldState';
export { Subsystem } from './core/Subsystem';
export type { SubsystemConfig } from './core/Subsystem';

// ═══════════════════════════════════════════════════════════════════
// ECS
// ═══════════════════════════════════════════════════════════════════

export { Entity, createPlayerEntity, createProjectileEntity, createDroppedWeaponEntity } from './ecs/Entity';
export { EntityType, entityId, playerId, tickNumber } from './ecs/types';
export type { EntityId, PlayerId, TickNumber } from './ecs/types';

// ═══════════════════════════════════════════════════════════════════
// TICK ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════

export { TickOrchestrator } from './tick/TickOrchestrator';
export { FPS_TICK_CONFIG, RTS_TICK_CONFIG } from './tick/TickConfig';
export type { TickConfig } from './tick/TickConfig';

// ═══════════════════════════════════════════════════════════════════
// NETWORK PROTOCOL
// ═══════════════════════════════════════════════════════════════════

export {
    // Binary encoding
    BinaryEncoder,
    BinaryDecoder,
    // Snapshots
    SnapshotEncoder,
    SnapshotDecoder,
    snapshotEncoder,
    snapshotDecoder,
    // Input
    InputEncoder,
    InputDecoder,
    inputEncoder,
    inputDecoder,
    applyInputCommand,
    // Message types
    MessageType,
    // Transport
    WebSocketServerTransport,
    // Client management
    ClientManager,
} from './network';

export type {
    InputCommand,
    DecodedInputBatch,
    DecodedSnapshot,
    DecodedEntity,
    Transport,
    TransportConfig,
    TransportEvents,
    ClientConnection,
    ClientInfo,
    ClientManagerEvents,
} from './network';

// ═══════════════════════════════════════════════════════════════════
// LAG COMPENSATION
// ═══════════════════════════════════════════════════════════════════

export { LagCompensation, HistoryBuffer } from './lagcomp';
export { CASUAL_CONFIG, COMPETITIVE_CONFIG, TOURNAMENT_CONFIG } from './lagcomp';
export type { LagCompensationConfig, Ray, Capsule, HitResult, HistoryEntry } from './lagcomp';

// ═══════════════════════════════════════════════════════════════════
// REPLAY SYSTEM
// ═══════════════════════════════════════════════════════════════════

export { ReplayRecorder, ReplayPlayer } from './replay/Replay';
export type { ReplayData, ReplayFrame, ReplayHeader, ReplayEvent } from './replay/Replay';

// ═══════════════════════════════════════════════════════════════════
// MAIN SERVER
// ═══════════════════════════════════════════════════════════════════

export { GameServer } from './Server';
export type { ServerConfig } from './Server';
