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
export { Entity } from './ecs/Entity';
export type { EntityId, PlayerId } from './ecs/types';

// Tick
export { TickOrchestrator } from './tick/TickOrchestrator';
export type { TickConfig } from './tick/TickConfig';

// Network (to be added)
// export { ClientManager } from './network/ClientManager';

// Lag Compensation (to be added)
// export { LagCompensation } from './lagcomp/LagCompensation';

// Main server class
export { GameServer } from './Server';
export type { ServerConfig } from './Server';
