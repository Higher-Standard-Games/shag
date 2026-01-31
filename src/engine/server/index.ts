/**
 * @module @engine/server
 * 
 * Next-Gen Server Engine
 * 
 * Game-agnostic simulation engine with:
 * - COW (Copy-on-Write) state management
 * - Multi-rate tick system
 * - Binary network protocol
 * - Lag compensation
 * - Replay system for determinism verification
 * 
 * @example
 * ```typescript
 * import { GameServer, WorldState } from '@engine/server';
 * 
 * const server = new GameServer(config, new FPSServerGame());
 * await server.start(3000);
 * ```
 */

// Core
export { Simulation } from './core/Simulation';
export { WorldState } from './core/WorldState';
export { Subsystem } from './core/Subsystem';
export type { SubsystemConfig } from './core/Subsystem';

// ECS
export { Entity, createPlayerEntity, createProjectileEntity } from './ecs/Entity';
export { EntityType, entityId, playerId, tickNumber } from './ecs/types';
export type { EntityId, PlayerId, TickNumber } from './ecs/types';

// Tick
export { TickOrchestrator } from './tick/TickOrchestrator';
export { FPS_TICK_CONFIG, RTS_TICK_CONFIG } from './tick/TickConfig';
export type { TickConfig } from './tick/TickConfig';

// Network Protocol
export {
    BinaryEncoder,
    BinaryDecoder,
    SnapshotEncoder,
    SnapshotDecoder,
    InputEncoder,
    InputDecoder,
    MessageType,
    applyInputCommand,
    snapshotEncoder,
    snapshotDecoder,
    inputEncoder,
    inputDecoder,
} from './network';
export type { InputCommand, DecodedInputBatch, DecodedSnapshot, DecodedEntity } from './network';

// Lag Compensation
export { LagCompensation } from './lagcomp/LagCompensation';
export { HistoryBuffer } from './lagcomp/HistoryBuffer';
export { CASUAL_CONFIG, COMPETITIVE_CONFIG, TOURNAMENT_CONFIG } from './lagcomp/config';
export type { LagCompensationConfig } from './lagcomp/config';

// Replay
export { ReplayRecorder, ReplayPlayer } from './replay/Replay';
export type { ReplayData, ReplayFrame, ReplayHeader, ReplayEvent } from './replay/Replay';

// Main server class
export { GameServer } from './Server';
export type { ServerConfig } from './Server';
