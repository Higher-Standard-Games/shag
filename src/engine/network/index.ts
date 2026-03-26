/**
 * SHAG Engine Networking Module
 *
 * Q3-style authoritative multiplayer networking system.
 *
 * @example
 * ```typescript
 * import { MessageCodec, NetworkGameHost } from './engine/network';
 *
 * // Connect to server via NetworkGameHost (used by Game)
 * const host = new NetworkGameHost(simulation, transport);
 * ```
 */

export { LocalGameHost } from "./client/hosts/LocalGameHost";
export { NetworkGameHost } from "./client/hosts/NetworkGameHost";
// Client
export type { Transport } from "./client/transport/Transport";
export { TransportFactory } from "./client/transport/Transport";
export { WebSocketTransport } from "./client/transport/WebSocketTransport";
export type { Command, CommandHandler } from "./core/Command";
export { MoveCommand } from "./core/Command";
// Core types and interfaces
export type { EntityId, PlayerId } from "./core/Entity";
// Core classes
export { Entity } from "./core/Entity";
export type { GameEvent } from "./core/GameState";
export { GameState, PlayerState } from "./core/GameState";
export type { IGameHost } from "./core/IGameHost";
export type { SimulationConfig } from "./core/Simulation";
export { GameSystem, Simulation } from "./core/Simulation";
// Protocol
export { BinaryDecoder, BinaryEncoder, BinaryProtocol, MessageType } from "./protocol/BinaryProtocol";
export { MessageCodec } from "./protocol/MessageCodec";

// Types
export type {
  ClientId,
  PlayerInfo,
  RoomId,
  Rotation,
  ServerInfo,
  SpawnInfo,
  Tick,
  Vector3,
} from "./types";
export { PROTOCOL_VERSION } from "./types";
