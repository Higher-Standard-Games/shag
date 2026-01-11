/**
 * SHAG Engine Network Types
 * Core type aliases used throughout the networking system
 */

// === Identifiers ===
export type ClientId = string;
export type PlayerId = string;
export type EntityId = string;
export type RoomId = string;
export type Tick = number;

// === Protocol ===
export const PROTOCOL_VERSION = 1;

// === Geometry ===
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  pitch: number;
  yaw: number;
}

// === Server Info ===
export interface ServerInfo {
  serverId: string;
  serverName: string;
  map: string;
  gameMode: string;
  tickRate: number;
  maxPlayers: number;
  currentPlayers: number;
  protocol: number;
}

// === Player Info ===
export interface PlayerInfo {
  playerId: PlayerId;
  entityId: EntityId;
  name: string;
  team: string;
  score: number;
  ping: number;
}

// === Spawn Info ===
export interface SpawnInfo {
  position: Vector3;
  rotation: Rotation;
}
