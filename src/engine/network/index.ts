/**
 * SHAG Engine Networking Module
 *
 * Q3-style authoritative multiplayer networking system.
 *
 * @example
 * ```typescript
 * import { NetworkManager, MessageType } from './engine/network';
 *
 * // Connect to server
 * const nm = NetworkManager.getInstance();
 * await nm.connect('ws://localhost:7777');
 *
 * // Subscribe to state updates
 * nm.onStateUpdate((state) => {
 *   console.log(`Tick ${state.tick}: ${state.entities.size} entities`);
 * });
 * ```
 */

// Core types and interfaces
export type { PlayerId, EntityId } from './core/Entity';
export type { SimulationConfig } from './core/Simulation';
export type { IGameHost } from './core/IGameHost';

// Core classes
export { Entity } from './core/Entity';
export { GameState, PlayerState } from './core/GameState';
export type { GameEvent } from './core/GameState';
export { Simulation, GameSystem } from './core/Simulation';
export { MoveCommand } from './core/Command';
export type { Command, CommandHandler } from './core/Command';

// Protocol
export { BinaryProtocol, BinaryEncoder, BinaryDecoder, MessageType } from './protocol/BinaryProtocol';
export { MessageCodec } from './protocol/MessageCodec';

// Client
export type { Transport } from './client/transport/Transport';
export { TransportFactory } from './client/transport/Transport';
export { WebSocketTransport } from './client/transport/WebSocketTransport';
export { LocalGameHost } from './client/hosts/LocalGameHost';
export { NetworkGameHost } from './client/hosts/NetworkGameHost';

// Server-side code moved to src/engine/server/network
// Client-side code remains here

// Manager
export { NetworkManager } from './NetworkManager';

// Types
export type {
  ClientId,
  RoomId,
  Tick,
  Vector3,
  Rotation,
  ServerInfo,
  PlayerInfo,
  SpawnInfo,
} from './types';
export { PROTOCOL_VERSION } from './types';
