# SHAG Engine Networking Design Document

**Version:** 1.0
**Date:** 2026-01-11
**Status:** Draft

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Requirements](#2-goals--requirements)
3. [Architecture Overview](#3-architecture-overview)
4. [Transport Layer](#4-transport-layer)
5. [Shared Simulation](#5-shared-simulation)
6. [State Management](#6-state-management)
7. [Command System](#7-command-system)
8. [Client Architecture](#8-client-architecture)
9. [Server Architecture](#9-server-architecture)
10. [Network Protocol](#10-network-protocol)
11. [Directory Structure](#11-directory-structure)
12. [API Reference](#12-api-reference)
13. [Implementation Roadmap](#13-implementation-roadmap)

---

## 1. Overview

### 1.1 Purpose

This document describes the networking architecture for SHAG Engine, enabling games to seamlessly support:

- **Single-player** - Local simulation, no network overhead
- **Multiplayer (Client)** - Connect to dedicated servers
- **Multiplayer (Host)** - Player hosts game, others connect
- **Dedicated Server** - Headless server for production deployment

### 1.2 Design Philosophy

> "The game code should never know or care whether it's running locally or over a network."

The architecture follows the **"Always Server"** pattern where game logic always runs through a server abstraction, whether that server is local (in-process) or remote (networked).

### 1.3 Reference Architecture

This design is heavily inspired by:

- **Quake 3** - Authoritative server, client prediction, snapshot interpolation
- **Source Engine** - Tick-based simulation, command system
- **Overwatch** - ECS architecture, deterministic simulation

---

## 2. Goals & Requirements

### 2.1 Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Single-player games run without network dependencies |
| FR-02 | Same game code runs on client and server |
| FR-03 | Multiplayer supports 2-32+ concurrent players |
| FR-04 | Client-side prediction for responsive local player |
| FR-05 | Server reconciliation corrects prediction errors |
| FR-06 | Interpolation smooths remote player movement |
| FR-07 | Support for reliable (chat, events) and unreliable (position) messages |
| FR-08 | Automatic reconnection handling |
| FR-09 | Host migration when host disconnects (stretch goal) |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | < 1ms overhead for single-player (local server) |
| NFR-02 | Support 20-60 tick server simulation |
| NFR-03 | < 100KB/s bandwidth per player at 20 tick |
| NFR-04 | Graceful degradation on packet loss |
| NFR-05 | Works on Browser, Electron, Capacitor (Android) |
| NFR-06 | WebSocket fallback for iOS/Safari |

### 2.3 Target Platforms

| Platform | Primary Transport | Fallback |
|----------|------------------|----------|
| Chrome/Edge | WebTransport | WebSocket |
| Firefox | WebTransport | WebSocket |
| Safari/iOS | WebSocket | - |
| Electron | WebTransport | WebSocket |
| Capacitor Android | WebTransport | WebSocket |
| Capacitor iOS | WebSocket | - |
| Node.js Server | Native | - |

---

## 3. Architecture Overview

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          GAME LAYER                                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    GameScene (Client)                          │  │
│  │  - Rendering (Babylon.js)                                      │  │
│  │  - Input handling                                              │  │
│  │  - Audio, UI, Effects                                          │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │                                   │
│                                  ▼                                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    IGameHost Interface                         │  │
│  │  - sendCommand(cmd)                                            │  │
│  │  - onStateUpdate(callback)                                     │  │
│  │  - getLocalState() // for prediction                           │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │                                   │
│              ┌───────────────────┼───────────────────┐              │
│              ▼                   ▼                   ▼              │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐       │
│  │  LocalGameHost  │ │ NetworkGameHost │ │  ListenServer   │       │
│  │  (Single-player)│ │   (MP Client)   │ │  (Host + Play)  │       │
│  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘       │
│           │                   │                   │                 │
└───────────┼───────────────────┼───────────────────┼─────────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
┌─────────────────┐    ┌───────────────┐    ┌───────────────┐
│  GameSimulation │    │   Transport   │    │  GameServer   │
│    (In-Process) │    │   (Network)   │    │  (In-Process) │
└─────────────────┘    └───────┬───────┘    └───────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Remote Server     │
                    │   (GameSimulation)  │
                    └─────────────────────┘
```

### 3.2 Mode Comparison

| Mode | GameHost | Simulation Location | Network |
|------|----------|---------------------|---------|
| Single-player | LocalGameHost | Client (in-process) | None |
| MP Client | NetworkGameHost | Remote Server | WebTransport/WS |
| MP Host | ListenServerHost | Client (in-process) + serves | WebTransport/WS |
| Dedicated | N/A (headless) | Server only | WebTransport/WS |

### 3.3 Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT FRAME                                 │
│                                                                      │
│  1. Sample Input ──► 2. Create Command ──► 3. Send to Host          │
│         │                                         │                  │
│         │            ┌────────────────────────────┘                  │
│         │            ▼                                               │
│         │    ┌───────────────┐                                       │
│         │    │ LocalGameHost │ ──► Execute immediately               │
│         │    └───────────────┘                                       │
│         │            OR                                              │
│         │    ┌───────────────┐                                       │
│         │    │NetworkGameHost│ ──► Predict locally + send to server │
│         │    └───────────────┘                                       │
│         │                                                            │
│  4. Receive State Update ◄─────────────────────────────────────────  │
│         │                                                            │
│  5. Reconcile (if prediction wrong)                                  │
│         │                                                            │
│  6. Interpolate remote entities                                      │
│         │                                                            │
│  7. Render ──► Babylon.js                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER TICK                                  │
│                                                                      │
│  1. Receive Commands from all clients                               │
│         │                                                            │
│  2. Validate commands (anti-cheat)                                  │
│         │                                                            │
│  3. Execute commands on simulation                                  │
│         │                                                            │
│  4. Update physics, AI, game systems                                │
│         │                                                            │
│  5. Generate snapshot                                               │
│         │                                                            │
│  6. Delta-compress against last ack'd snapshot per client           │
│         │                                                            │
│  7. Send snapshots to all clients                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Transport Layer

### 4.1 Transport Interface

```typescript
/**
 * Low-level transport abstraction.
 * Implementations: WebTransportTransport, WebSocketTransport, LocalTransport
 */
interface ITransport {
  /** Connection state */
  readonly state: TransportState;
  readonly latency: number;  // Round-trip time in ms

  /** Connect to server */
  connect(url: string): Promise<void>;

  /** Disconnect */
  disconnect(): void;

  /** Send data */
  send(data: Uint8Array, options?: SendOptions): void;

  /** Receive data */
  onMessage(callback: (data: Uint8Array) => void): void;

  /** Connection events */
  onConnect(callback: () => void): void;
  onDisconnect(callback: (reason: string) => void): void;
  onError(callback: (error: Error) => void): void;
}

interface SendOptions {
  /** Reliable delivery (TCP-like) or unreliable (UDP-like) */
  reliable?: boolean;

  /** Channel for multiplexing */
  channel?: number;
}

type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
```

### 4.2 Transport Implementations

#### 4.2.1 WebTransportTransport (Primary)

```typescript
class WebTransportTransport implements ITransport {
  private wt: WebTransport | null = null;
  private reliableStream: WritableStream | null = null;
  private datagramWriter: WritableStreamDefaultWriter | null = null;

  async connect(url: string): Promise<void> {
    this.wt = new WebTransport(url);
    await this.wt.ready;

    // Reliable channel (bidirectional stream)
    const stream = await this.wt.createBidirectionalStream();
    this.reliableStream = stream.writable;

    // Unreliable channel (datagrams)
    this.datagramWriter = this.wt.datagrams.writable.getWriter();

    // Read incoming datagrams
    this.readDatagrams();
    this.readStream(stream.readable);
  }

  send(data: Uint8Array, options?: SendOptions): void {
    if (options?.reliable) {
      // Use stream for reliable delivery
      const writer = this.reliableStream!.getWriter();
      writer.write(data);
      writer.releaseLock();
    } else {
      // Use datagrams for unreliable delivery
      this.datagramWriter!.write(data);
    }
  }

  private async readDatagrams(): Promise<void> {
    const reader = this.wt!.datagrams.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      this.messageCallback?.(value);
    }
  }
}
```

#### 4.2.2 WebSocketTransport (Fallback)

```typescript
class WebSocketTransport implements ITransport {
  private ws: WebSocket | null = null;

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => {
        this.messageCallback?.(new Uint8Array(e.data));
      };
    });
  }

  send(data: Uint8Array, options?: SendOptions): void {
    // WebSocket is always reliable, ignore options
    this.ws?.send(data);
  }
}
```

#### 4.2.3 LocalTransport (Single-player)

```typescript
class LocalTransport implements ITransport {
  private server: LocalServer;
  private clientId: string;

  readonly state: TransportState = 'connected';
  readonly latency = 0;

  constructor(server: LocalServer, clientId: string) {
    this.server = server;
    this.clientId = clientId;
  }

  async connect(): Promise<void> {
    // Already connected - local
  }

  send(data: Uint8Array): void {
    // Direct function call, no serialization needed for local
    // But we serialize anyway for consistency
    this.server.receiveFromClient(this.clientId, data);
  }
}
```

### 4.3 Transport Factory

```typescript
class TransportFactory {
  /**
   * Create best available transport for current platform
   */
  static async create(url: string): Promise<ITransport> {
    // Check for WebTransport support
    if (typeof WebTransport !== 'undefined') {
      try {
        const wt = new WebTransportTransport();
        await wt.connect(url.replace('wss://', 'https://'));
        console.log('[Transport] Using WebTransport');
        return wt;
      } catch (e) {
        console.warn('[Transport] WebTransport failed, falling back to WebSocket:', e);
      }
    }

    // Fallback to WebSocket
    const ws = new WebSocketTransport();
    await ws.connect(url);
    console.log('[Transport] Using WebSocket');
    return ws;
  }

  /**
   * Create local transport for single-player
   */
  static createLocal(server: LocalServer, clientId: string): ITransport {
    return new LocalTransport(server, clientId);
  }
}
```

---

## 5. Shared Simulation

The simulation is the core game logic that runs **identically** on both client and server.

### 5.1 Simulation Interface

```typescript
/**
 * Core game simulation - runs on client (prediction) and server (authority)
 */
class GameSimulation {
  // Current game state
  state: GameState;

  // Tick tracking
  currentTick: number = 0;

  // Configuration
  readonly config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
    this.state = new GameState();
  }

  /**
   * Advance simulation by one tick.
   * MUST be deterministic - same inputs = same outputs.
   */
  tick(commands: Command[]): void {
    // 1. Process all commands for this tick
    for (const cmd of commands) {
      this.executeCommand(cmd);
    }

    // 2. Update all game systems
    this.updateSystems();

    // 3. Advance tick counter
    this.currentTick++;
  }

  /**
   * Execute a single command
   */
  executeCommand(cmd: Command): void {
    const handler = this.commandHandlers.get(cmd.type);
    if (handler) {
      handler(this.state, cmd);
    }
  }

  /**
   * Update all game systems (physics, AI, etc.)
   */
  private updateSystems(): void {
    const dt = this.config.tickDuration;

    // Order matters for determinism!
    this.movementSystem.update(this.state, dt);
    this.physicsSystem.update(this.state, dt);
    this.combatSystem.update(this.state, dt);
    this.aiSystem.update(this.state, dt);
    this.effectsSystem.update(this.state, dt);
  }

  /**
   * Create a snapshot of current state
   */
  createSnapshot(): Snapshot {
    return {
      tick: this.currentTick,
      timestamp: Date.now(),
      state: this.state.serialize(),
    };
  }

  /**
   * Load state from snapshot
   */
  loadSnapshot(snapshot: Snapshot): void {
    this.currentTick = snapshot.tick;
    this.state = GameState.deserialize(snapshot.state);
  }
}

interface SimulationConfig {
  /** Ticks per second (e.g., 20, 30, 60) */
  tickRate: number;

  /** Milliseconds per tick */
  tickDuration: number;

  /** Maximum players */
  maxPlayers: number;

  /** Game-specific config */
  gameRules: GameRules;
}
```

### 5.2 Determinism Requirements

For client prediction to work, the simulation MUST be deterministic:

```typescript
/**
 * DETERMINISM RULES:
 *
 * 1. NO random() - use seeded RNG
 * 2. NO Date.now() in game logic - use tick count
 * 3. NO floating point accumulation - use fixed-point or reset regularly
 * 4. Process commands in consistent order (by playerId, then by type)
 * 5. Update systems in consistent order
 * 6. NO external state dependencies
 */

class DeterministicRNG {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Returns 0-1 deterministically */
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Returns integer in range [min, max] */
  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// Each tick has its own RNG seed derived from tick number
function getTickRNG(baseSeed: number, tick: number): DeterministicRNG {
  return new DeterministicRNG(baseSeed ^ tick);
}
```

### 5.3 Game Systems

```typescript
/**
 * Base class for game systems.
 * Systems process entities with specific components.
 */
abstract class GameSystem {
  abstract update(state: GameState, deltaTime: number): void;
}

/**
 * Movement system - processes player and entity movement
 */
class MovementSystem extends GameSystem {
  update(state: GameState, dt: number): void {
    for (const entity of state.entities.values()) {
      if (!entity.hasComponent('velocity')) continue;

      const pos = entity.getComponent<PositionComponent>('position');
      const vel = entity.getComponent<VelocityComponent>('velocity');

      // Simple euler integration
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;

      // Apply friction
      vel.x *= 0.9;
      vel.y *= 0.9;
      vel.z *= 0.9;
    }
  }
}

/**
 * Physics system - collision detection and response
 */
class PhysicsSystem extends GameSystem {
  private collisionWorld: CollisionWorld;

  update(state: GameState, dt: number): void {
    // Broad phase
    const pairs = this.collisionWorld.getPotentialPairs(state.entities);

    // Narrow phase
    for (const [a, b] of pairs) {
      if (this.checkCollision(a, b)) {
        this.resolveCollision(a, b);
        state.events.push({ type: 'collision', entities: [a.id, b.id] });
      }
    }
  }
}

/**
 * Combat system - damage, health, death
 */
class CombatSystem extends GameSystem {
  update(state: GameState, dt: number): void {
    // Process pending attacks
    for (const attack of state.pendingAttacks) {
      const target = state.entities.get(attack.targetId);
      if (!target) continue;

      const health = target.getComponent<HealthComponent>('health');
      health.current -= attack.damage;

      if (health.current <= 0) {
        state.events.push({
          type: 'death',
          entityId: target.id,
          killerId: attack.attackerId
        });
      }
    }

    state.pendingAttacks = [];
  }
}
```

---

## 6. State Management

### 6.1 Game State Structure

```typescript
/**
 * Complete game state - everything needed to render a frame
 */
class GameState {
  /** All entities in the world */
  entities: Map<EntityId, Entity> = new Map();

  /** Connected players */
  players: Map<PlayerId, PlayerState> = new Map();

  /** World state (time of day, weather, etc.) */
  world: WorldState = new WorldState();

  /** Events generated this tick (sounds, effects) */
  events: GameEvent[] = [];

  /**
   * Serialize entire state for snapshots
   */
  serialize(): Uint8Array {
    const encoder = new StateEncoder();

    // Entities
    encoder.writeUint16(this.entities.size);
    for (const [id, entity] of this.entities) {
      encoder.writeString(id);
      entity.serialize(encoder);
    }

    // Players
    encoder.writeUint8(this.players.size);
    for (const [id, player] of this.players) {
      encoder.writeString(id);
      player.serialize(encoder);
    }

    // World
    this.world.serialize(encoder);

    // Events
    encoder.writeUint16(this.events.length);
    for (const event of this.events) {
      this.serializeEvent(encoder, event);
    }

    return encoder.toBytes();
  }

  static deserialize(data: Uint8Array): GameState {
    const decoder = new StateDecoder(data);
    const state = new GameState();

    // Entities
    const entityCount = decoder.readUint16();
    for (let i = 0; i < entityCount; i++) {
      const id = decoder.readString();
      state.entities.set(id, Entity.deserialize(decoder));
    }

    // Players
    const playerCount = decoder.readUint8();
    for (let i = 0; i < playerCount; i++) {
      const id = decoder.readString();
      state.players.set(id, PlayerState.deserialize(decoder));
    }

    // World
    state.world = WorldState.deserialize(decoder);

    // Events
    const eventCount = decoder.readUint16();
    for (let i = 0; i < eventCount; i++) {
      state.events.push(GameState.deserializeEvent(decoder));
    }

    return state;
  }
}

/**
 * Per-player state
 */
class PlayerState {
  id: PlayerId;
  name: string;
  entityId: EntityId;  // The entity this player controls

  // Input state (last acknowledged)
  lastInputTick: number = 0;
  lastInputSeq: number = 0;

  // Stats
  score: number = 0;
  deaths: number = 0;
  ping: number = 0;
}

/**
 * World-level state
 */
class WorldState {
  timeOfDay: number = 0;      // 0-24 hours
  weather: WeatherType = 'clear';
  mapName: string = '';
}
```

### 6.2 Entity Component System (ECS)

```typescript
type EntityId = string;
type ComponentType = string;

/**
 * Entity - container for components
 */
class Entity {
  readonly id: EntityId;
  private components: Map<ComponentType, Component> = new Map();

  constructor(id: EntityId) {
    this.id = id;
  }

  addComponent<T extends Component>(type: ComponentType, component: T): void {
    this.components.set(type, component);
  }

  getComponent<T extends Component>(type: ComponentType): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  hasComponent(type: ComponentType): boolean {
    return this.components.has(type);
  }

  removeComponent(type: ComponentType): void {
    this.components.delete(type);
  }

  serialize(encoder: StateEncoder): void {
    encoder.writeUint8(this.components.size);
    for (const [type, component] of this.components) {
      encoder.writeString(type);
      component.serialize(encoder);
    }
  }
}

/**
 * Base component interface
 */
interface Component {
  serialize(encoder: StateEncoder): void;
}

/**
 * Common components
 */
class PositionComponent implements Component {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  serialize(encoder: StateEncoder): void {
    encoder.writeFloat32(this.x);
    encoder.writeFloat32(this.y);
    encoder.writeFloat32(this.z);
  }
}

class VelocityComponent implements Component {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  serialize(encoder: StateEncoder): void {
    encoder.writeFloat32(this.x);
    encoder.writeFloat32(this.y);
    encoder.writeFloat32(this.z);
  }
}

class HealthComponent implements Component {
  current: number = 100;
  max: number = 100;

  serialize(encoder: StateEncoder): void {
    encoder.writeUint16(this.current);
    encoder.writeUint16(this.max);
  }
}

class RotationComponent implements Component {
  pitch: number = 0;  // Up/down
  yaw: number = 0;    // Left/right
  roll: number = 0;   // Tilt

  serialize(encoder: StateEncoder): void {
    // Compress to 16-bit angles
    encoder.writeInt16(Math.round(this.pitch * 182.04));  // 32768 / 180
    encoder.writeInt16(Math.round(this.yaw * 182.04));
    encoder.writeInt16(Math.round(this.roll * 182.04));
  }
}
```

### 6.3 Snapshots and Delta Compression

```typescript
/**
 * Complete state snapshot at a specific tick
 */
interface Snapshot {
  tick: number;
  timestamp: number;
  state: Uint8Array;
}

/**
 * Delta-compressed snapshot (only changes since baseline)
 */
interface DeltaSnapshot {
  tick: number;
  baselineTick: number;  // The snapshot this delta is based on
  changes: EntityChange[];
  events: GameEvent[];
}

interface EntityChange {
  entityId: EntityId;
  changeType: 'create' | 'update' | 'delete';
  components?: Map<ComponentType, Uint8Array>;  // Only changed components
}

/**
 * Snapshot manager - handles delta compression
 */
class SnapshotManager {
  private history: Map<number, Snapshot> = new Map();
  private maxHistory = 64;  // Keep last 64 snapshots (~3 seconds at 20 tick)

  /**
   * Store a new snapshot
   */
  addSnapshot(snapshot: Snapshot): void {
    this.history.set(snapshot.tick, snapshot);

    // Prune old snapshots
    if (this.history.size > this.maxHistory) {
      const oldestAllowed = snapshot.tick - this.maxHistory;
      for (const tick of this.history.keys()) {
        if (tick < oldestAllowed) {
          this.history.delete(tick);
        }
      }
    }
  }

  /**
   * Create delta from baseline to current
   */
  createDelta(currentTick: number, baselineTick: number): DeltaSnapshot | null {
    const current = this.history.get(currentTick);
    const baseline = this.history.get(baselineTick);

    if (!current) return null;

    // If no baseline, send full snapshot
    if (!baseline) {
      return {
        tick: currentTick,
        baselineTick: -1,
        changes: this.fullStateToChanges(current),
        events: [],
      };
    }

    // Compute delta
    return this.computeDelta(baseline, current);
  }

  private computeDelta(baseline: Snapshot, current: Snapshot): DeltaSnapshot {
    const baseState = GameState.deserialize(baseline.state);
    const currState = GameState.deserialize(current.state);

    const changes: EntityChange[] = [];

    // Find new and changed entities
    for (const [id, entity] of currState.entities) {
      const baseEntity = baseState.entities.get(id);

      if (!baseEntity) {
        // New entity
        changes.push({
          entityId: id,
          changeType: 'create',
          components: this.serializeAllComponents(entity),
        });
      } else {
        // Check for component changes
        const changedComponents = this.getChangedComponents(baseEntity, entity);
        if (changedComponents.size > 0) {
          changes.push({
            entityId: id,
            changeType: 'update',
            components: changedComponents,
          });
        }
      }
    }

    // Find deleted entities
    for (const id of baseState.entities.keys()) {
      if (!currState.entities.has(id)) {
        changes.push({
          entityId: id,
          changeType: 'delete',
        });
      }
    }

    return {
      tick: current.tick,
      baselineTick: baseline.tick,
      changes,
      events: currState.events,
    };
  }
}
```

---

## 7. Command System

### 7.1 Command Interface

```typescript
type CommandType = string;

/**
 * Base command interface.
 * Commands are the ONLY way to modify game state.
 */
interface Command {
  /** Command type identifier */
  readonly type: CommandType;

  /** Player who issued the command */
  readonly playerId: PlayerId;

  /** Tick this command should execute on */
  readonly tick: number;

  /** Sequence number for acknowledgment */
  readonly seq: number;

  /** Serialize for network transmission */
  serialize(): Uint8Array;
}

/**
 * Command factory for deserialization
 */
class CommandFactory {
  private static handlers: Map<CommandType, (data: Uint8Array) => Command> = new Map();

  static register(type: CommandType, deserializer: (data: Uint8Array) => Command): void {
    this.handlers.set(type, deserializer);
  }

  static deserialize(data: Uint8Array): Command {
    const decoder = new StateDecoder(data);
    const type = decoder.readString();

    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`Unknown command type: ${type}`);
    }

    return handler(data);
  }
}
```

### 7.2 Common Commands

```typescript
/**
 * Movement input command - sent every tick while moving
 */
class MoveCommand implements Command {
  readonly type = 'move';
  readonly playerId: PlayerId;
  readonly tick: number;
  readonly seq: number;

  /** Movement direction (normalized) */
  readonly direction: { x: number; y: number; z: number };

  /** View angles */
  readonly viewPitch: number;
  readonly viewYaw: number;

  /** Button state (bitmask) */
  readonly buttons: number;

  constructor(
    playerId: PlayerId,
    tick: number,
    seq: number,
    direction: { x: number; y: number; z: number },
    viewPitch: number,
    viewYaw: number,
    buttons: number
  ) {
    this.playerId = playerId;
    this.tick = tick;
    this.seq = seq;
    this.direction = direction;
    this.viewPitch = viewPitch;
    this.viewYaw = viewYaw;
    this.buttons = buttons;
  }

  serialize(): Uint8Array {
    const encoder = new StateEncoder();
    encoder.writeString(this.type);
    encoder.writeString(this.playerId);
    encoder.writeUint32(this.tick);
    encoder.writeUint32(this.seq);
    encoder.writeInt8(Math.round(this.direction.x * 127));
    encoder.writeInt8(Math.round(this.direction.y * 127));
    encoder.writeInt8(Math.round(this.direction.z * 127));
    encoder.writeInt16(Math.round(this.viewPitch * 182.04));
    encoder.writeInt16(Math.round(this.viewYaw * 182.04));
    encoder.writeUint8(this.buttons);
    return encoder.toBytes();
  }

  static deserialize(data: Uint8Array): MoveCommand {
    const decoder = new StateDecoder(data);
    decoder.readString();  // Skip type
    return new MoveCommand(
      decoder.readString(),
      decoder.readUint32(),
      decoder.readUint32(),
      {
        x: decoder.readInt8() / 127,
        y: decoder.readInt8() / 127,
        z: decoder.readInt8() / 127,
      },
      decoder.readInt16() / 182.04,
      decoder.readInt16() / 182.04,
      decoder.readUint8()
    );
  }
}

// Button flags
const Buttons = {
  FIRE: 1 << 0,
  JUMP: 1 << 1,
  CROUCH: 1 << 2,
  USE: 1 << 3,
  RELOAD: 1 << 4,
  SPRINT: 1 << 5,
} as const;

/**
 * Use/interact command
 */
class UseCommand implements Command {
  readonly type = 'use';
  readonly playerId: PlayerId;
  readonly tick: number;
  readonly seq: number;
  readonly targetId: EntityId;

  // ... serialize/deserialize
}

/**
 * Chat message command (reliable)
 */
class ChatCommand implements Command {
  readonly type = 'chat';
  readonly playerId: PlayerId;
  readonly tick: number;
  readonly seq: number;
  readonly message: string;
  readonly channel: 'all' | 'team';

  // ... serialize/deserialize
}
```

### 7.3 Command Handlers

```typescript
/**
 * Command handlers registered with the simulation
 */
type CommandHandler = (state: GameState, cmd: Command) => void;

const commandHandlers: Map<CommandType, CommandHandler> = new Map([
  ['move', (state: GameState, cmd: Command) => {
    const moveCmd = cmd as MoveCommand;
    const player = state.players.get(moveCmd.playerId);
    if (!player) return;

    const entity = state.entities.get(player.entityId);
    if (!entity) return;

    const vel = entity.getComponent<VelocityComponent>('velocity');
    const rot = entity.getComponent<RotationComponent>('rotation');

    if (vel) {
      const speed = 300;  // Units per second
      vel.x = moveCmd.direction.x * speed;
      vel.y = moveCmd.direction.y * speed;
      vel.z = moveCmd.direction.z * speed;
    }

    if (rot) {
      rot.pitch = moveCmd.viewPitch;
      rot.yaw = moveCmd.viewYaw;
    }

    // Handle buttons
    if (moveCmd.buttons & Buttons.JUMP) {
      // Handle jump
    }
    if (moveCmd.buttons & Buttons.FIRE) {
      // Queue attack for combat system
    }
  }],

  ['use', (state: GameState, cmd: Command) => {
    const useCmd = cmd as UseCommand;
    // Handle interaction
  }],

  ['chat', (state: GameState, cmd: Command) => {
    const chatCmd = cmd as ChatCommand;
    state.events.push({
      type: 'chat',
      playerId: chatCmd.playerId,
      message: chatCmd.message,
      channel: chatCmd.channel,
    });
  }],
]);
```

---

## 8. Client Architecture

### 8.1 Game Host Interface

```typescript
/**
 * IGameHost - abstraction between game and network.
 * The game code ONLY interacts with this interface.
 */
interface IGameHost {
  /** Connection state */
  readonly isConnected: boolean;
  readonly latency: number;
  readonly localPlayerId: PlayerId;

  /** Send a command to be executed */
  sendCommand(cmd: Command): void;

  /** Get current predicted state (for rendering) */
  getState(): GameState;

  /** Get interpolated state for a specific entity */
  getInterpolatedEntity(entityId: EntityId): Entity | undefined;

  /** State update callback */
  onStateUpdate(callback: (state: GameState) => void): void;

  /** Event callback (sounds, effects) */
  onEvent(callback: (event: GameEvent) => void): void;

  /** Connection callbacks */
  onConnect(callback: () => void): void;
  onDisconnect(callback: (reason: string) => void): void;

  /** Cleanup */
  dispose(): void;
}
```

### 8.2 LocalGameHost (Single-player)

```typescript
/**
 * Local game host - runs simulation in-process.
 * No network, no latency, client is authoritative.
 */
class LocalGameHost implements IGameHost {
  private simulation: GameSimulation;
  private localPlayerId: PlayerId;
  private stateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: GameEvent) => void)[] = [];
  private tickInterval: number | null = null;
  private commandSeq = 0;

  readonly isConnected = true;
  readonly latency = 0;

  constructor(config: SimulationConfig) {
    this.simulation = new GameSimulation(config);
    this.localPlayerId = generatePlayerId();

    // Add local player
    this.simulation.state.players.set(this.localPlayerId, {
      id: this.localPlayerId,
      name: 'Player',
      entityId: this.createPlayerEntity(),
      lastInputTick: 0,
      lastInputSeq: 0,
      score: 0,
      deaths: 0,
      ping: 0,
    });

    // Start tick loop
    this.startTickLoop();
  }

  get localPlayerId(): PlayerId {
    return this._localPlayerId;
  }

  sendCommand(cmd: Command): void {
    // Execute immediately - we are the authority
    this.pendingCommands.push(cmd);
  }

  getState(): GameState {
    return this.simulation.state;
  }

  getInterpolatedEntity(entityId: EntityId): Entity | undefined {
    // No interpolation needed for local - return current state
    return this.simulation.state.entities.get(entityId);
  }

  private pendingCommands: Command[] = [];

  private startTickLoop(): void {
    const tickDuration = this.simulation.config.tickDuration;

    this.tickInterval = window.setInterval(() => {
      // Process all pending commands
      this.simulation.tick(this.pendingCommands);
      this.pendingCommands = [];

      // Notify state update
      for (const callback of this.stateCallbacks) {
        callback(this.simulation.state);
      }

      // Dispatch events
      for (const event of this.simulation.state.events) {
        for (const callback of this.eventCallbacks) {
          callback(event);
        }
      }
      this.simulation.state.events = [];

    }, tickDuration);
  }

  onStateUpdate(callback: (state: GameState) => void): void {
    this.stateCallbacks.push(callback);
  }

  onEvent(callback: (event: GameEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  dispose(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
  }
}
```

### 8.3 NetworkGameHost (Multiplayer Client)

```typescript
/**
 * Network game host - connects to remote server.
 * Implements client-side prediction and server reconciliation.
 */
class NetworkGameHost implements IGameHost {
  private transport: ITransport;
  private simulation: GameSimulation;  // For prediction
  private serverState: GameState;      // Last confirmed server state
  private pendingCommands: Command[] = [];
  private stateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: GameEvent) => void)[] = [];
  private interpolationBuffer: InterpolationBuffer;

  private _localPlayerId: PlayerId = '';
  private _isConnected = false;
  private _latency = 0;

  // Prediction
  private lastAckedSeq = 0;
  private commandHistory: Command[] = [];

  constructor(transport: ITransport, config: SimulationConfig) {
    this.transport = transport;
    this.simulation = new GameSimulation(config);
    this.serverState = new GameState();
    this.interpolationBuffer = new InterpolationBuffer();

    this.setupMessageHandlers();
  }

  get isConnected(): boolean { return this._isConnected; }
  get latency(): number { return this._latency; }
  get localPlayerId(): PlayerId { return this._localPlayerId; }

  sendCommand(cmd: Command): void {
    // 1. Store in history for reconciliation
    this.commandHistory.push(cmd);

    // 2. Predict locally
    this.simulation.executeCommand(cmd);

    // 3. Send to server
    this.transport.send(cmd.serialize(), { reliable: false });

    // 4. Notify state update (predicted)
    for (const callback of this.stateCallbacks) {
      callback(this.simulation.state);
    }
  }

  getState(): GameState {
    // Return predicted state for local player
    return this.simulation.state;
  }

  getInterpolatedEntity(entityId: EntityId): Entity | undefined {
    // For remote entities, return interpolated position
    return this.interpolationBuffer.getInterpolated(entityId);
  }

  private setupMessageHandlers(): void {
    this.transport.onMessage((data) => {
      const message = MessageProtocol.decode(data);

      switch (message.type) {
        case 'snapshot':
          this.handleSnapshot(message as SnapshotMessage);
          break;
        case 'welcome':
          this.handleWelcome(message as WelcomeMessage);
          break;
        case 'event':
          this.handleEvent(message as EventMessage);
          break;
      }
    });
  }

  private handleSnapshot(msg: SnapshotMessage): void {
    // 1. Update latency estimate
    this._latency = Date.now() - msg.clientTimestamp;

    // 2. Store server state
    this.serverState = GameState.deserialize(msg.state);

    // 3. Update interpolation buffer for remote entities
    for (const [id, entity] of this.serverState.entities) {
      if (id !== this.getLocalPlayerEntityId()) {
        this.interpolationBuffer.addSnapshot(id, msg.tick, entity);
      }
    }

    // 4. Server reconciliation for local player
    this.reconcile(msg.lastAckedSeq);
  }

  private reconcile(lastAckedSeq: number): void {
    // Remove acknowledged commands from history
    this.commandHistory = this.commandHistory.filter(
      cmd => cmd.seq > lastAckedSeq
    );

    // Reset to server state
    const localEntityId = this.getLocalPlayerEntityId();
    const serverEntity = this.serverState.entities.get(localEntityId);

    if (serverEntity) {
      // Copy server state for local entity
      this.simulation.state.entities.set(localEntityId, serverEntity.clone());

      // Re-apply unacknowledged commands
      for (const cmd of this.commandHistory) {
        this.simulation.executeCommand(cmd);
      }

      // Check for misprediction
      const predicted = this.simulation.state.entities.get(localEntityId);
      if (predicted && this.hasMisprediction(serverEntity, predicted)) {
        console.log('[Client] Misprediction detected, correcting...');
        // Could smooth the correction instead of snapping
      }
    }
  }

  private hasMisprediction(server: Entity, predicted: Entity): boolean {
    const serverPos = server.getComponent<PositionComponent>('position');
    const predictedPos = predicted.getComponent<PositionComponent>('position');

    if (!serverPos || !predictedPos) return false;

    const threshold = 0.1;  // Units
    const dx = Math.abs(serverPos.x - predictedPos.x);
    const dy = Math.abs(serverPos.y - predictedPos.y);
    const dz = Math.abs(serverPos.z - predictedPos.z);

    return dx > threshold || dy > threshold || dz > threshold;
  }
}
```

### 8.4 Interpolation Buffer

```typescript
/**
 * Interpolation buffer for smooth rendering of remote entities.
 * Stores multiple snapshots and interpolates between them.
 */
class InterpolationBuffer {
  private buffers: Map<EntityId, EntitySnapshot[]> = new Map();
  private interpolationDelay = 100;  // ms behind server time

  addSnapshot(entityId: EntityId, tick: number, entity: Entity): void {
    let buffer = this.buffers.get(entityId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(entityId, buffer);
    }

    buffer.push({
      tick,
      timestamp: Date.now(),
      entity: entity.clone(),
    });

    // Keep only last 1 second of snapshots
    const cutoff = Date.now() - 1000;
    this.buffers.set(
      entityId,
      buffer.filter(s => s.timestamp > cutoff)
    );
  }

  getInterpolated(entityId: EntityId): Entity | undefined {
    const buffer = this.buffers.get(entityId);
    if (!buffer || buffer.length < 2) {
      return buffer?.[0]?.entity;
    }

    // Find the render time (current time - interpolation delay)
    const renderTime = Date.now() - this.interpolationDelay;

    // Find two snapshots to interpolate between
    let before: EntitySnapshot | undefined;
    let after: EntitySnapshot | undefined;

    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].timestamp <= renderTime &&
          buffer[i + 1].timestamp >= renderTime) {
        before = buffer[i];
        after = buffer[i + 1];
        break;
      }
    }

    if (!before || !after) {
      // No suitable pair, return latest
      return buffer[buffer.length - 1].entity;
    }

    // Calculate interpolation factor
    const range = after.timestamp - before.timestamp;
    const t = range > 0 ? (renderTime - before.timestamp) / range : 0;

    // Interpolate
    return this.interpolateEntities(before.entity, after.entity, t);
  }

  private interpolateEntities(a: Entity, b: Entity, t: number): Entity {
    const result = a.clone();

    // Interpolate position
    const posA = a.getComponent<PositionComponent>('position');
    const posB = b.getComponent<PositionComponent>('position');
    if (posA && posB) {
      const posR = result.getComponent<PositionComponent>('position')!;
      posR.x = posA.x + (posB.x - posA.x) * t;
      posR.y = posA.y + (posB.y - posA.y) * t;
      posR.z = posA.z + (posB.z - posA.z) * t;
    }

    // Interpolate rotation (using shortest path)
    const rotA = a.getComponent<RotationComponent>('rotation');
    const rotB = b.getComponent<RotationComponent>('rotation');
    if (rotA && rotB) {
      const rotR = result.getComponent<RotationComponent>('rotation')!;
      rotR.pitch = this.lerpAngle(rotA.pitch, rotB.pitch, t);
      rotR.yaw = this.lerpAngle(rotA.yaw, rotB.yaw, t);
      rotR.roll = this.lerpAngle(rotA.roll, rotB.roll, t);
    }

    return result;
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return a + diff * t;
  }
}

interface EntitySnapshot {
  tick: number;
  timestamp: number;
  entity: Entity;
}
```

---

## 9. Server Architecture

### 9.1 Game Server

```typescript
/**
 * Authoritative game server.
 * Can run as dedicated server or listen server (host + play).
 */
class GameServer {
  private simulation: GameSimulation;
  private transport: ServerTransport;
  private clients: Map<ClientId, ClientConnection> = new Map();
  private snapshotManager: SnapshotManager;
  private tickInterval: number | null = null;

  // Tick timing
  private lastTickTime = 0;
  private tickAccumulator = 0;

  constructor(config: ServerConfig) {
    this.simulation = new GameSimulation(config.simulation);
    this.snapshotManager = new SnapshotManager();

    // Set up transport
    this.transport = new ServerTransport(config.transport);
    this.transport.onConnection(this.handleConnection.bind(this));
  }

  async start(): Promise<void> {
    await this.transport.listen();
    console.log(`[Server] Listening on port ${this.transport.port}`);

    // Start tick loop
    this.lastTickTime = performance.now();
    this.startTickLoop();
  }

  private startTickLoop(): void {
    const tickDuration = this.simulation.config.tickDuration;

    // Use setInterval for consistent timing
    this.tickInterval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - this.lastTickTime;
      this.lastTickTime = now;

      this.tickAccumulator += elapsed;

      // Process as many ticks as needed
      while (this.tickAccumulator >= tickDuration) {
        this.tick();
        this.tickAccumulator -= tickDuration;
      }
    }, 1);  // Check every 1ms for accurate timing
  }

  private tick(): void {
    // 1. Gather commands from all clients
    const commands: Command[] = [];
    for (const client of this.clients.values()) {
      commands.push(...client.pendingCommands);
      client.pendingCommands = [];
    }

    // 2. Sort commands for determinism (by player, then by seq)
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) {
        return a.playerId.localeCompare(b.playerId);
      }
      return a.seq - b.seq;
    });

    // 3. Execute simulation tick
    this.simulation.tick(commands);

    // 4. Store snapshot
    const snapshot = this.simulation.createSnapshot();
    this.snapshotManager.addSnapshot(snapshot);

    // 5. Send updates to all clients
    this.broadcastSnapshots();
  }

  private broadcastSnapshots(): void {
    for (const [clientId, client] of this.clients) {
      // Create delta from client's last acked snapshot
      const delta = this.snapshotManager.createDelta(
        this.simulation.currentTick,
        client.lastAckedTick
      );

      if (delta) {
        const message: SnapshotMessage = {
          type: 'snapshot',
          tick: delta.tick,
          baselineTick: delta.baselineTick,
          state: delta.changes,
          events: delta.events,
          lastAckedSeq: client.lastProcessedSeq,
          clientTimestamp: client.lastMessageTimestamp,
        };

        client.send(message, { reliable: false });
      }
    }
  }

  private handleConnection(clientId: ClientId, transport: ITransport): void {
    console.log(`[Server] Client connected: ${clientId}`);

    const client = new ClientConnection(clientId, transport);
    this.clients.set(clientId, client);

    // Create player
    const playerId = clientId;  // Or generate separate player ID
    const entityId = this.createPlayerEntity();

    this.simulation.state.players.set(playerId, {
      id: playerId,
      name: `Player_${clientId.substring(0, 4)}`,
      entityId,
      lastInputTick: 0,
      lastInputSeq: 0,
      score: 0,
      deaths: 0,
      ping: 0,
    });

    // Send welcome message
    client.send({
      type: 'welcome',
      playerId,
      entityId,
      tick: this.simulation.currentTick,
      state: this.simulation.state.serialize(),
      config: this.simulation.config,
    }, { reliable: true });

    // Handle messages
    client.onMessage((data) => {
      this.handleClientMessage(client, data);
    });

    client.onDisconnect(() => {
      this.handleDisconnection(clientId);
    });
  }

  private handleClientMessage(client: ClientConnection, data: Uint8Array): void {
    try {
      const cmd = CommandFactory.deserialize(data);

      // Validate command
      if (!this.validateCommand(client, cmd)) {
        console.warn(`[Server] Invalid command from ${client.id}`);
        return;
      }

      // Queue for next tick
      client.pendingCommands.push(cmd);
      client.lastProcessedSeq = Math.max(client.lastProcessedSeq, cmd.seq);
      client.lastMessageTimestamp = Date.now();

    } catch (e) {
      console.error(`[Server] Failed to process message:`, e);
    }
  }

  private validateCommand(client: ClientConnection, cmd: Command): boolean {
    // Check player owns this command
    const player = this.simulation.state.players.get(cmd.playerId);
    if (!player) return false;

    // Check command is for valid player
    // Add more validation as needed (rate limiting, cheat detection)

    return true;
  }

  private handleDisconnection(clientId: ClientId): void {
    console.log(`[Server] Client disconnected: ${clientId}`);

    const client = this.clients.get(clientId);
    if (client) {
      // Remove player and entity
      const player = this.simulation.state.players.get(clientId);
      if (player) {
        this.simulation.state.entities.delete(player.entityId);
        this.simulation.state.players.delete(clientId);
      }
    }

    this.clients.delete(clientId);
  }

  private createPlayerEntity(): EntityId {
    const entityId = generateEntityId();
    const entity = new Entity(entityId);

    // Add default components
    entity.addComponent('position', new PositionComponent());
    entity.addComponent('velocity', new VelocityComponent());
    entity.addComponent('rotation', new RotationComponent());
    entity.addComponent('health', new HealthComponent());

    // Find spawn point
    const spawnPos = this.findSpawnPoint();
    const pos = entity.getComponent<PositionComponent>('position')!;
    pos.x = spawnPos.x;
    pos.y = spawnPos.y;
    pos.z = spawnPos.z;

    this.simulation.state.entities.set(entityId, entity);
    return entityId;
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    this.transport.close();
  }
}

/**
 * Per-client connection state
 */
class ClientConnection {
  readonly id: ClientId;
  private transport: ITransport;

  pendingCommands: Command[] = [];
  lastAckedTick: number = -1;
  lastProcessedSeq: number = 0;
  lastMessageTimestamp: number = 0;

  constructor(id: ClientId, transport: ITransport) {
    this.id = id;
    this.transport = transport;
  }

  send(message: NetworkMessage, options?: SendOptions): void {
    const data = MessageProtocol.encode(message);
    this.transport.send(data, options);
  }

  onMessage(callback: (data: Uint8Array) => void): void {
    this.transport.onMessage(callback);
  }

  onDisconnect(callback: () => void): void {
    this.transport.onDisconnect(callback);
  }
}
```

### 9.2 Server Transport

```typescript
/**
 * Server-side transport handling.
 * Manages WebTransport + WebSocket fallback.
 */
class ServerTransport {
  private config: TransportConfig;
  private webTransportServer: Http3Server | null = null;
  private webSocketServer: WebSocketServer | null = null;
  private connectionCallback: ((clientId: ClientId, transport: ITransport) => void) | null = null;

  constructor(config: TransportConfig) {
    this.config = config;
  }

  get port(): number {
    return this.config.port;
  }

  async listen(): Promise<void> {
    // Start WebTransport server (HTTP/3)
    if (this.config.enableWebTransport) {
      const { Http3Server } = await import('@aspect-app/webtransport');

      this.webTransportServer = new Http3Server({
        port: this.config.port,
        host: '0.0.0.0',
        secret: this.config.secret,
        cert: this.config.cert,
        privKey: this.config.key,
      });

      this.webTransportServer.startServer();

      (async () => {
        const sessionStream = await this.webTransportServer!.sessionStream('/game');
        const sessionReader = sessionStream.getReader();

        while (true) {
          const { done, value: session } = await sessionReader.read();
          if (done) break;

          const clientId = generateClientId();
          const transport = new WebTransportServerTransport(session);
          this.connectionCallback?.(clientId, transport);
        }
      })();
    }

    // Start WebSocket server (fallback)
    if (this.config.enableWebSocket) {
      const { WebSocketServer } = await import('ws');

      this.webSocketServer = new WebSocketServer({
        port: this.config.wsPort || this.config.port + 1,
      });

      this.webSocketServer.on('connection', (ws) => {
        const clientId = generateClientId();
        const transport = new WebSocketServerTransport(ws);
        this.connectionCallback?.(clientId, transport);
      });
    }
  }

  onConnection(callback: (clientId: ClientId, transport: ITransport) => void): void {
    this.connectionCallback = callback;
  }

  close(): void {
    this.webTransportServer?.stopServer();
    this.webSocketServer?.close();
  }
}
```

---

## 10. Network Protocol

### 10.1 Message Types

```typescript
type MessageType =
  | 'welcome'      // Server → Client: Connection accepted
  | 'snapshot'     // Server → Client: Game state update
  | 'event'        // Server → Client: Game event (sound, effect)
  | 'command'      // Client → Server: Player input
  | 'ack'          // Client → Server: Snapshot acknowledgment
  | 'ping'         // Bidirectional: Latency measurement
  | 'chat'         // Bidirectional: Chat message
  | 'disconnect';  // Bidirectional: Clean disconnect

interface NetworkMessage {
  type: MessageType;
}

interface WelcomeMessage extends NetworkMessage {
  type: 'welcome';
  playerId: PlayerId;
  entityId: EntityId;
  tick: number;
  state: Uint8Array;  // Full initial state
  config: SimulationConfig;
}

interface SnapshotMessage extends NetworkMessage {
  type: 'snapshot';
  tick: number;
  baselineTick: number;
  state: EntityChange[];
  events: GameEvent[];
  lastAckedSeq: number;  // For client reconciliation
  clientTimestamp: number;  // For latency calculation
}

interface EventMessage extends NetworkMessage {
  type: 'event';
  events: GameEvent[];
}

interface AckMessage extends NetworkMessage {
  type: 'ack';
  tick: number;  // Last received snapshot tick
}

interface PingMessage extends NetworkMessage {
  type: 'ping';
  timestamp: number;
}
```

### 10.2 Binary Protocol

```typescript
/**
 * Efficient binary encoding for network messages.
 */
class MessageProtocol {
  private static readonly MESSAGE_TYPES: MessageType[] = [
    'welcome', 'snapshot', 'event', 'command', 'ack', 'ping', 'chat', 'disconnect'
  ];

  static encode(message: NetworkMessage): Uint8Array {
    const encoder = new StateEncoder();

    // Write message type (1 byte)
    const typeIndex = this.MESSAGE_TYPES.indexOf(message.type);
    encoder.writeUint8(typeIndex);

    // Write message-specific data
    switch (message.type) {
      case 'snapshot':
        this.encodeSnapshot(encoder, message as SnapshotMessage);
        break;
      case 'welcome':
        this.encodeWelcome(encoder, message as WelcomeMessage);
        break;
      // ... other message types
    }

    return encoder.toBytes();
  }

  static decode(data: Uint8Array): NetworkMessage {
    const decoder = new StateDecoder(data);

    const typeIndex = decoder.readUint8();
    const type = this.MESSAGE_TYPES[typeIndex];

    switch (type) {
      case 'snapshot':
        return this.decodeSnapshot(decoder);
      case 'welcome':
        return this.decodeWelcome(decoder);
      // ... other message types
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  }

  private static encodeSnapshot(encoder: StateEncoder, msg: SnapshotMessage): void {
    encoder.writeUint32(msg.tick);
    encoder.writeUint32(msg.baselineTick);
    encoder.writeUint32(msg.lastAckedSeq);
    encoder.writeUint32(msg.clientTimestamp);

    // Entity changes
    encoder.writeUint16(msg.state.length);
    for (const change of msg.state) {
      encoder.writeString(change.entityId);
      encoder.writeUint8(
        change.changeType === 'create' ? 0 :
        change.changeType === 'update' ? 1 : 2
      );
      if (change.components) {
        encoder.writeUint8(change.components.size);
        for (const [type, data] of change.components) {
          encoder.writeString(type);
          encoder.writeBytes(data);
        }
      }
    }

    // Events
    encoder.writeUint16(msg.events.length);
    for (const event of msg.events) {
      encoder.writeString(event.type);
      encoder.writeBytes(JSON.stringify(event));  // Simple for now
    }
  }
}

/**
 * Binary encoder helper
 */
class StateEncoder {
  private buffer: number[] = [];

  writeUint8(value: number): void {
    this.buffer.push(value & 0xFF);
  }

  writeUint16(value: number): void {
    this.buffer.push((value >> 8) & 0xFF);
    this.buffer.push(value & 0xFF);
  }

  writeUint32(value: number): void {
    this.buffer.push((value >> 24) & 0xFF);
    this.buffer.push((value >> 16) & 0xFF);
    this.buffer.push((value >> 8) & 0xFF);
    this.buffer.push(value & 0xFF);
  }

  writeInt8(value: number): void {
    this.writeUint8(value < 0 ? value + 256 : value);
  }

  writeInt16(value: number): void {
    this.writeUint16(value < 0 ? value + 65536 : value);
  }

  writeFloat32(value: number): void {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, false);
    for (let i = 0; i < 4; i++) {
      this.buffer.push(view.getUint8(i));
    }
  }

  writeString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.writeUint16(bytes.length);
    for (const byte of bytes) {
      this.buffer.push(byte);
    }
  }

  writeBytes(value: Uint8Array | string): void {
    const bytes = typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value;
    this.writeUint32(bytes.length);
    for (const byte of bytes) {
      this.buffer.push(byte);
    }
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}
```

---

## 11. Directory Structure

```
src/
├── engine/                           # SHAG Engine (client-only)
│   ├── core/
│   ├── rendering/
│   └── ...
│
├── network/                          # ⭐ NEW: Networking module
│   ├── shared/                       # Shared between client & server
│   │   ├── simulation/
│   │   │   ├── GameSimulation.ts     # Core game loop
│   │   │   ├── SimulationConfig.ts   # Tick rate, rules
│   │   │   └── systems/              # Game systems
│   │   │       ├── MovementSystem.ts
│   │   │       ├── PhysicsSystem.ts
│   │   │       ├── CombatSystem.ts
│   │   │       └── index.ts
│   │   │
│   │   ├── state/                    # Game state
│   │   │   ├── GameState.ts          # Complete state container
│   │   │   ├── Entity.ts             # ECS entity
│   │   │   ├── components/           # ECS components
│   │   │   │   ├── PositionComponent.ts
│   │   │   │   ├── VelocityComponent.ts
│   │   │   │   ├── HealthComponent.ts
│   │   │   │   └── index.ts
│   │   │   └── PlayerState.ts
│   │   │
│   │   ├── commands/                 # Input commands
│   │   │   ├── Command.ts            # Base interface
│   │   │   ├── CommandFactory.ts     # Deserialization
│   │   │   ├── MoveCommand.ts
│   │   │   ├── UseCommand.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── protocol/                 # Network protocol
│   │   │   ├── MessageProtocol.ts    # Encode/decode
│   │   │   ├── Messages.ts           # Message types
│   │   │   ├── StateEncoder.ts       # Binary encoding
│   │   │   └── StateDecoder.ts       # Binary decoding
│   │   │
│   │   └── types.ts                  # Shared type definitions
│   │
│   ├── client/                       # Client-only networking
│   │   ├── transport/
│   │   │   ├── ITransport.ts         # Transport interface
│   │   │   ├── WebTransportTransport.ts
│   │   │   ├── WebSocketTransport.ts
│   │   │   ├── LocalTransport.ts
│   │   │   └── TransportFactory.ts
│   │   │
│   │   ├── hosts/                    # Game host implementations
│   │   │   ├── IGameHost.ts          # Host interface
│   │   │   ├── LocalGameHost.ts      # Single-player
│   │   │   ├── NetworkGameHost.ts    # MP client
│   │   │   └── ListenServerHost.ts   # Host + play
│   │   │
│   │   ├── prediction/
│   │   │   ├── ClientPrediction.ts   # Predict local player
│   │   │   └── Reconciliation.ts     # Server correction
│   │   │
│   │   ├── interpolation/
│   │   │   ├── InterpolationBuffer.ts
│   │   │   └── EntityInterpolator.ts
│   │   │
│   │   └── NetworkClient.ts          # High-level client API
│   │
│   └── server/                       # Server-only networking
│       ├── transport/
│       │   ├── ServerTransport.ts
│       │   ├── WebTransportServer.ts
│       │   └── WebSocketServer.ts
│       │
│       ├── GameServer.ts             # Main server class
│       ├── ClientConnection.ts       # Per-client state
│       ├── SnapshotManager.ts        # Delta compression
│       └── index.ts                  # Server entry point
│
├── games/
│   └── default/
│       ├── shared/                   # Game-specific shared code
│       │   ├── GameRules.ts          # Game rules config
│       │   ├── WeaponStats.ts        # Weapon data
│       │   └── systems/              # Game-specific systems
│       │       └── WeaponSystem.ts
│       │
│       ├── client/
│       │   ├── GameScene.ts          # Uses IGameHost
│       │   ├── NetworkedGameScene.ts # MP-aware scene
│       │   └── ui/
│       │       ├── Scoreboard.ts
│       │       └── ChatUI.ts
│       │
│       └── server/
│           ├── GameRoom.ts           # Game-specific server logic
│           └── BotAI.ts              # Server-side AI
│
└── server/                           # Dedicated server entry
    ├── index.ts                      # Main entry point
    └── config.ts                     # Server configuration
```

---

## 12. API Reference

### 12.1 Starting a Game

```typescript
// === SINGLE-PLAYER ===
import { LocalGameHost } from '@/network/client/hosts/LocalGameHost';
import { GameScene } from '@game/client/GameScene';

const host = new LocalGameHost({
  tickRate: 20,
  tickDuration: 50,
  maxPlayers: 1,
  gameRules: defaultGameRules,
});

const scene = new GameScene(host);
engine.runScene(scene);


// === MULTIPLAYER (Join) ===
import { TransportFactory } from '@/network/client/transport/TransportFactory';
import { NetworkGameHost } from '@/network/client/hosts/NetworkGameHost';
import { GameScene } from '@game/client/GameScene';

const transport = await TransportFactory.create('https://game.server.com:443');
const host = new NetworkGameHost(transport, {
  tickRate: 20,
  tickDuration: 50,
  maxPlayers: 16,
  gameRules: defaultGameRules,
});

// Wait for connection
await host.connect();

const scene = new GameScene(host);
engine.runScene(scene);


// === MULTIPLAYER (Host) ===
import { ListenServerHost } from '@/network/client/hosts/ListenServerHost';
import { GameScene } from '@game/client/GameScene';

const host = new ListenServerHost({
  port: 7777,
  tickRate: 20,
  tickDuration: 50,
  maxPlayers: 8,
  gameRules: defaultGameRules,
});

// Start hosting
await host.start();
console.log(`Hosting on port ${host.port}`);

const scene = new GameScene(host);
engine.runScene(scene);
```

### 12.2 GameScene Integration

```typescript
import { EngineScene } from '@/engine/EngineScene';
import { IGameHost } from '@/network/client/hosts/IGameHost';

class GameScene extends EngineScene {
  private host: IGameHost;
  private localPlayerId: PlayerId;
  private commandSeq = 0;

  constructor(host: IGameHost) {
    super();
    this.host = host;
    this.localPlayerId = host.localPlayerId;

    // Subscribe to state updates
    this.host.onStateUpdate((state) => {
      this.updateWorld(state);
    });

    // Subscribe to events
    this.host.onEvent((event) => {
      this.handleEvent(event);
    });
  }

  protected update(deltaTime: number): void {
    // Sample input
    const input = this.inputSystem.getInput();

    // Create command
    const cmd = new MoveCommand(
      this.localPlayerId,
      this.host.currentTick,
      this.commandSeq++,
      {
        x: input.moveX,
        y: 0,
        z: input.moveY,
      },
      input.lookPitch,
      input.lookYaw,
      input.buttons
    );

    // Send to host (local or network)
    this.host.sendCommand(cmd);

    // Render
    this.render();
  }

  private updateWorld(state: GameState): void {
    // Update local player from predicted state
    const localEntity = state.entities.get(
      state.players.get(this.localPlayerId)?.entityId ?? ''
    );
    if (localEntity) {
      this.updateLocalPlayer(localEntity);
    }

    // Update remote players from interpolated state
    for (const [playerId, player] of state.players) {
      if (playerId === this.localPlayerId) continue;

      const entity = this.host.getInterpolatedEntity(player.entityId);
      if (entity) {
        this.updateRemotePlayer(playerId, entity);
      }
    }

    // Update other entities
    for (const [entityId, entity] of state.entities) {
      // Skip player entities (handled above)
      if (this.isPlayerEntity(entityId)) continue;

      this.updateEntity(entityId, entity);
    }
  }

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'sound':
        this.audioSystem.playSound(event.sound, event.position);
        break;
      case 'effect':
        this.effectsSystem.spawn(event.effect, event.position);
        break;
      case 'chat':
        this.chatUI.addMessage(event.playerId, event.message);
        break;
      case 'death':
        this.handleDeath(event.entityId, event.killerId);
        break;
    }
  }

  dispose(): void {
    this.host.dispose();
    super.dispose();
  }
}
```

---

## 13. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Create `src/network/` directory structure
- [ ] Implement `StateEncoder` / `StateDecoder`
- [ ] Implement basic `GameState`, `Entity`, components
- [ ] Implement `GameSimulation` with tick loop
- [ ] Implement basic `Command` system
- [ ] Create `LocalGameHost` for single-player
- [ ] Integration test: Single-player game loop

### Phase 2: Transport Layer (Week 3-4)
- [ ] Implement `ITransport` interface
- [ ] Implement `WebSocketTransport` (simpler, test first)
- [ ] Implement `WebTransportTransport`
- [ ] Implement `TransportFactory` with detection
- [ ] Implement `MessageProtocol` binary encoding
- [ ] Integration test: Client-server connection

### Phase 3: Server (Week 5-6)
- [ ] Implement `GameServer` tick loop
- [ ] Implement `ClientConnection` management
- [ ] Implement `SnapshotManager` with delta compression
- [ ] Implement `ServerTransport` (WebTransport + WebSocket)
- [ ] Implement server-side command validation
- [ ] Integration test: Multiple clients connected

### Phase 4: Client Prediction (Week 7-8)
- [ ] Implement `NetworkGameHost`
- [ ] Implement client-side prediction
- [ ] Implement server reconciliation
- [ ] Implement `InterpolationBuffer`
- [ ] Integration test: Smooth movement with latency

### Phase 5: Game Integration (Week 9-10)
- [ ] Integrate with existing `GameScene`
- [ ] Add network-aware entity rendering
- [ ] Implement game events (sounds, effects)
- [ ] Implement chat system
- [ ] Implement scoreboard / player list

### Phase 6: Polish & Testing (Week 11-12)
- [ ] Add reconnection handling
- [ ] Add bandwidth throttling
- [ ] Add server browser / lobby UI
- [ ] Performance profiling
- [ ] Stress testing (many clients)
- [ ] Documentation

---

## Appendix A: Configuration Examples

### Server Configuration
```typescript
const serverConfig: ServerConfig = {
  simulation: {
    tickRate: 20,
    tickDuration: 50,
    maxPlayers: 16,
    gameRules: {
      friendlyFire: false,
      respawnTime: 3000,
      scoreLimit: 50,
    },
  },
  transport: {
    port: 443,
    wsPort: 8080,
    enableWebTransport: true,
    enableWebSocket: true,
    cert: './certs/cert.pem',
    key: './certs/key.pem',
  },
};
```

### Client Configuration
```typescript
const clientConfig: ClientConfig = {
  serverUrl: 'https://game.server.com:443',
  interpolationDelay: 100,  // ms
  predictionEnabled: true,
  maxPredictionTicks: 10,
};
```

---

## Appendix B: Bandwidth Estimates

| Data | Size (bytes) | Frequency | Bandwidth |
|------|-------------|-----------|-----------|
| Player position | 12 | 20/s | 240 B/s |
| Player rotation | 6 | 20/s | 120 B/s |
| Player velocity | 12 | 20/s | 240 B/s |
| Input command | ~20 | 20/s | 400 B/s |
| **Per player (client)** | | | **~1 KB/s** |
| **Per player (server, 16 players)** | | | **~16 KB/s** |

With delta compression, typical bandwidth is 50-70% less.

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Tick** | Single discrete time step of the simulation |
| **Tick Rate** | Ticks per second (e.g., 20, 60) |
| **Snapshot** | Complete or partial game state at a tick |
| **Delta** | Difference between two snapshots |
| **Command** | Player input that modifies game state |
| **Prediction** | Client simulating ahead of server |
| **Reconciliation** | Correcting client state from server |
| **Interpolation** | Smoothing between snapshots |
| **Authority** | The source of truth for game state |
| **RTT** | Round-trip time (latency × 2) |
