# SHAG Engine Networking System - Complete Technical Reference

> **Document Version**: 1.1
> **Date**: 2026-01-28
> **Purpose**: Complete documentation of the multiplayer networking architecture for debugging and development
> **Status**: All critical bugs FIXED - ready for testing

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Transport Layer](#2-transport-layer)
3. [Protocol Layer](#3-protocol-layer)
4. [Core Data Structures](#4-core-data-structures)
5. [Server Architecture](#5-server-architecture)
6. [Client Architecture](#6-client-architecture)
7. [FPS Game Integration](#7-fps-game-integration)
8. [Complete Data Flow](#8-complete-data-flow)
9. [File Reference](#9-file-reference)
10. [Known Issues & Bugs](#10-known-issues--bugs)

---

## 1. Architecture Overview

### Design Philosophy

The SHAG Engine uses a **server-authoritative** networking model inspired by Quake 3:

- **Server**: Runs the authoritative simulation, processes all player inputs, broadcasts state
- **Client**: Runs prediction simulation locally, reconciles with server state, interpolates for smooth rendering

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Tick** | Fixed timestep unit (default 60Hz = 16.67ms) |
| **Snapshot** | Complete game state at a specific tick |
| **Delta Compression** | Only send changed data vs baseline |
| **Client Prediction** | Client runs same simulation locally for instant feedback |
| **Reconciliation** | Client corrects prediction errors when server state arrives |
| **Interpolation** | Smooth rendering between discrete snapshots |

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        GAME LAYER                                │
│  FPSGameManager ←→ FPSController ←→ FPSSimulation               │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                        HOST LAYER                                │
│  LocalGameHost (single-player) | NetworkGameHost (multiplayer)  │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                      PROTOCOL LAYER                              │
│  MessageCodec → BinaryProtocol → BinaryEncoder/Decoder          │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                      TRANSPORT LAYER                             │
│  WebSocketTransport | WebTransportTransport (future)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Transport Layer

### Files

| File | Purpose |
|------|---------|
| `src/engine/network/client/transport/Transport.ts` | Interface definition |
| `src/engine/network/client/transport/WebSocketTransport.ts` | Browser WebSocket impl |
| `src/engine/network/client/transport/WebTransportTransport.ts` | WebTransport (placeholder) |

### Transport Interface

```typescript
interface Transport {
  connect(url: string): Promise<void>;
  disconnect(): Promise<void>;
  send(data: Uint8Array, reliable?: boolean): void;
  onMessage(callback: (data: Uint8Array) => void): void;
  onConnect(callback: () => void): void;
  onDisconnect(callback: (reason?: string) => void): void;
  onError(callback: (error: Error) => void): void;
  isConnected(): boolean;
}
```

### WebSocketTransport Implementation

**Key Details:**
- Uses `binaryType = 'arraybuffer'` for efficient binary transfer
- Stores multiple callback arrays (supports multiple listeners)
- `connect()` is idempotent - won't reconnect if already connected
- `send()` silently fails if socket not open (logs warning at 1% rate)

**Connection Flow:**
```
1. new WebSocket(url)
2. ws.onopen → call all connect callbacks
3. ws.onmessage → convert ArrayBuffer to Uint8Array → call message callbacks
4. ws.onclose → call disconnect callbacks
5. ws.onerror → call error callbacks
```

### TransportFactory

```typescript
static async create(url: string): Promise<Transport> {
  // Future: Try WebTransport first if available
  // Fallback to WebSocket
  const transport = new WebSocketTransport();
  return transport;
}
```

---

## 3. Protocol Layer

### Files

| File | Purpose |
|------|---------|
| `src/engine/network/protocol/MessageCodec.ts` | High-level message encoding |
| `src/engine/network/protocol/BinaryProtocol.ts` | State serialization & delta compression |

### Message Types

```typescript
enum MessageType {
  // Server → Client (0x01-0x0F)
  Welcome      = 0x01,  // Server info on connect
  JoinAccept   = 0x02,  // Assigned player/entity IDs
  JoinReject   = 0x03,  // Connection refused
  Snapshot     = 0x04,  // Game state update
  PlayerJoined = 0x05,  // Another player joined
  PlayerLeft   = 0x06,  // Another player left
  GameStart    = 0x07,  // Game starting
  Ack          = 0x08,  // Acknowledgment

  // Client → Server (0x81-0x8F)
  Join       = 0x81,  // Request to join
  Ready      = 0x82,  // Client ready
  Input      = 0x83,  // Player input command
  Disconnect = 0x84,  // Graceful disconnect
}
```

### Message Formats

#### Welcome (Server → Client)
```
[1 byte]  MessageType.Welcome (0x01)
[string]  serverId
[string]  serverName
[string]  mapName
[uint32]  tickRate
[uint16]  maxPlayers
[uint16]  currentPlayers
```

#### JoinAccept (Server → Client)
```
[1 byte]  MessageType.JoinAccept (0x02)
[string]  playerId (server-assigned)
[string]  entityId (player's entity)
```

#### Snapshot (Server → Client)
```
[1 byte]  MessageType.Snapshot (0x04)
[uint32]  tick number
[uint32]  timestamp (truncated)
[uint16]  entity count
  For each entity:
    [string]  entityId
    [uint8]   component flags
    [float32 x3]  position (if flag 0x01)
    [float32 x3]  velocity (if flag 0x02)
[uint16]  player count
  For each player:
    [string]  playerId
    [uint8]   field flags
    [string]  entityId (if flag 0x01)
    [string]  name (if flag 0x02)
    [uint32]  score (if flag 0x04)
[uint16]  event count
  For each event:
    [string]  eventType
    [string]  eventData (JSON)
```

#### Input (Client → Server)
```
[1 byte]  MessageType.Input (0x83)
[string]  playerId
[uint16]  sequence number
[string]  command (JSON serialized)
```

### Delta Compression

The snapshot encoder uses **component-level delta compression**:

1. Compare current state vs baseline (previous acknowledged snapshot)
2. For each entity, set flags for changed components:
   - `0x01` = position changed
   - `0x02` = velocity changed
3. Only encode components with set flags
4. Client reconstructs by merging delta with baseline

**Important**: If baseline is missing/null, FULL state is sent.

### BinaryEncoder/Decoder

Low-level binary serialization utilities:

```typescript
class BinaryEncoder {
  writeUint8(value: number): void;
  writeUint16(value: number): void;  // Little-endian
  writeUint32(value: number): void;  // Little-endian
  writeFloat32(value: number): void; // Little-endian
  writeString(str: string): void;    // UTF-8, length-prefixed (uint16)
  writeBytes(data: Uint8Array): void;
  getData(): Uint8Array;
}

class BinaryDecoder {
  readUint8(): number;
  readUint16(): number;
  readUint32(): number;
  readFloat32(): number;
  readString(): string;
  readBytes(length: number): Uint8Array;
  hasMore(): boolean;
}
```

---

## 4. Core Data Structures

### Files

| File | Purpose |
|------|---------|
| `src/engine/network/core/Entity.ts` | Entity container |
| `src/engine/network/core/Component.ts` | Component interface |
| `src/engine/network/core/GameState.ts` | State container |
| `src/engine/network/core/Command.ts` | Input command |
| `src/engine/network/core/Simulation.ts` | Abstract simulation |

### Entity

Container for components using composition pattern:

```typescript
class Entity {
  readonly id: EntityId;
  protected components: Map<string, IComponent>;

  addComponent<T>(type: string, component: T): void;
  getComponent<T>(type: string): T | undefined;
  hasComponent(type: string): boolean;
  removeComponent(type: string): boolean;
  getComponentNames(): string[];
  clone(): Entity;
}
```

### Components

#### TransformComponent
```typescript
{
  position: { x: number, y: number, z: number };
  rotation: { x: number, y: number, z: number, w: number }; // Quaternion
  scale: { x: number, y: number, z: number };
}
```

#### VelocityComponent
```typescript
{
  linear: { x: number, y: number, z: number };
  angular: { x: number, y: number, z: number };
  grounded: boolean;
}
```

#### InputComponent
```typescript
{
  buttons: number;        // Bitfield (InputButtons enum)
  moveDirection: Vec3;    // Normalized world-space direction
  viewAngles: { pitch: number, yaw: number };
  sequence: number;
  tick: number;
}
```

#### MovementStateComponent
```typescript
{
  isSliding: boolean;
  slideTime: number;
  isCrouching: boolean;
  crouchProgress: number;
  crouchViewOffset: number;
  wallJumpState: 'none' | 'available' | 'charging';
  wallJumpCooldown: number;
  ledgeGrabState: 'none' | 'grabbing' | 'pulling';
  actualHorizSpeed: number;
}
```

### GameState

```typescript
class GameState {
  tick: number = 0;
  entities: Map<EntityId, Entity> = new Map();
  players: Map<PlayerId, PlayerState> = new Map();
  events: GameEvent[] = [];

  clone(): GameState;
  serialize(encoder): void;
  deserialize(decoder): void;
}

interface PlayerState {
  entityId: EntityId;
  name: string;
  team: string;
  score: number;
  ping: number;
}
```

### Command

```typescript
interface Command {
  type: string;
  playerId: PlayerId;
  tick: number;
  seq: number;
  serialize(): Uint8Array;
}

// FPS-specific command
interface FPSInputCommand extends Command {
  type: 'fps_input';
  direction: { x: number, y: number, z: number };
  pitch: number;
  yaw: number;
  buttons: number;
}
```

### InputButtons Bitfield

```typescript
enum InputButtons {
  FORWARD   = 1 << 0,  // 0x01
  BACK      = 1 << 1,  // 0x02
  LEFT      = 1 << 2,  // 0x04
  RIGHT     = 1 << 3,  // 0x08
  JUMP      = 1 << 4,  // 0x10
  CROUCH    = 1 << 5,  // 0x20
  SPRINT    = 1 << 6,  // 0x40
  FIRE      = 1 << 7,  // 0x80
  ALT_FIRE  = 1 << 8,  // 0x100
}
```

### Simulation (Abstract)

```typescript
abstract class Simulation<TState extends GameState, TCommand extends Command> {
  state: TState;
  currentTick: number = 0;
  protected systems: GameSystem[] = [];
  protected commandHandlers: Map<string, CommandHandler>;

  tick(commands: TCommand[]): void {
    // 1. Sort commands deterministically
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
      return a.seq - b.seq;
    });

    // 2. Execute command handlers
    for (const cmd of commands) {
      const handler = this.commandHandlers.get(cmd.type);
      handler?.(cmd, this.state);
    }

    // 3. Update all systems
    const dt = this.config.tickDuration / 1000;
    for (const system of this.systems) {
      system.update(this.state, dt);
    }

    // 4. Increment tick
    this.currentTick++;
    this.state.tick = this.currentTick;
  }
}
```

---

## 5. Server Architecture

### Files

| File | Purpose |
|------|---------|
| `src/engine/network/server/GameServer.ts` | Server manager |
| `src/engine/network/server/Room.ts` | Game room (match) |
| `src/cli/headless-netserver.ts` | Production server entry |

### GameServer

Manages multiple rooms and routes client connections:

```typescript
class GameServer {
  private rooms: Map<string, Room> = new Map();
  private clientRooms: Map<string, Room> = new Map();

  createRoom(roomId: string, config: SimulationConfig, SimClass): Room;
  getRoom(roomId: string): Room | undefined;
  addClientToRoom(clientId: string, roomId: string, transport: Transport): void;
  removeClient(clientId: string): void;
}
```

### Room

Hosts a single game match:

```typescript
class Room {
  private simulation: Simulation;
  private clients: Map<string, ClientConnection> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private currentTick: number = 0;

  // Client management
  addClient(clientId: string, transport: Transport): void;
  removeClient(clientId: string): void;

  // Game loop
  start(tickRate: number = 20): void;
  stop(): void;
  private tick(): void;

  // Messaging
  private broadcastSnapshot(): void;
  private sendToClient(clientId: string, data: Uint8Array): void;
}
```

### Room.addClient() Flow

```
1. Store client connection
2. If simulation has spawnPlayer(), spawn entity for this player
3. Send WELCOME message with server info
4. Send JoinAccept with assigned player/entity IDs
5. Send initial snapshot
```

### Room.tick() - FIXED

```typescript
private pendingCommands: Command[] = [];

handleCommand(clientId: string, command: Command): void {
  this.pendingCommands.push(command);  // Queue for next tick
}

private tick(): void {
  this.currentTick++;
  this.simulation.tick(this.pendingCommands);  // Process ALL queued commands
  this.pendingCommands = [];
  this.broadcastSnapshot();
}
```

**Fixed**: Commands are now batched and processed together in each tick for deterministic simulation.

### Headless Server (headless-netserver.ts)

Production Node.js server:

```typescript
// Key features:
// - Uses 'ws' library for WebSocket
// - Loads BSP maps for collision
// - Extracts spawn points from map entities
// - Converts Q3 coords (Z-up) to Babylon (Y-up)

// Spawn point extraction (lines 195-201):
const spawnPoints = entities
  .filter(e => e.classname.includes('info_player'))
  .map(e => {
    const [x, y, z] = e.properties.origin.split(' ').map(Number);
    return { x, y: z, z: y };  // ⚠️ Y/Z swap for coordinate system
  });
```

---

## 6. Client Architecture

### Files

| File | Purpose |
|------|---------|
| `src/engine/network/core/IGameHost.ts` | Unified host interface |
| `src/engine/network/client/hosts/LocalGameHost.ts` | Single-player |
| `src/engine/network/client/hosts/NetworkGameHost.ts` | Multiplayer |

### IGameHost Interface

```typescript
interface IGameHost {
  localPlayerId: PlayerId;
  currentTick: number;

  sendCommand(cmd: Command): void;
  onStateUpdate(callback: (state: GameState) => void): () => void;
  onEvent(callback: (event: any) => void): () => void;
  getInterpolatedEntity(entityId: string): any;
  getLocalState(): GameState;

  // Optional lifecycle
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  isConnected?(): boolean;
  start?(): void;
  stop?(): void;
}
```

### LocalGameHost (Single-Player)

Runs simulation in-process with fixed timestep:

```typescript
class LocalGameHost implements IGameHost {
  private simulation: Simulation;
  private accumulator: number = 0;
  private previousPositions: Map<EntityId, Vec3> = new Map();

  sendCommand(cmd: Command): void {
    this.pendingCommands.push(cmd);
  }

  update(deltaTime: number): void {
    this.accumulator += deltaTime;
    while (this.accumulator >= this.tickDuration) {
      this.simulation.tick(this.pendingCommands);
      this.pendingCommands = [];
      this.accumulator -= this.tickDuration;
      this.notifyCallbacks();
    }
  }

  getInterpolatedPosition(entityId: string): Vec3 | null {
    // Lerp between previous and current for smooth rendering
  }
}
```

### NetworkGameHost (Multiplayer) - CRITICAL

Handles server connection, prediction, and reconciliation:

```typescript
class NetworkGameHost implements IGameHost {
  private transport: Transport;
  private simulation: Simulation;           // Client-side prediction
  private localState: GameState;            // Predicted state
  private interpolationBuffer: InterpolationBuffer;
  private smoothCorrection: SmoothCorrection;
  private pendingCommands: Command[] = [];
  private lastBaselineTick: number = 0;

  localPlayerId: PlayerId;
  localEntityId: string;
  currentTick: number = 0;
}
```

### NetworkGameHost.connect() Flow

```
1. Create Promise that resolves on JoinAccept
2. transport.connect(url)
3. Send JOIN message with initial playerId
4. Wait for JoinAccept (10s timeout)
5. Update localPlayerId/localEntityId from server
6. Spawn player in local prediction simulation
7. Resolve Promise
```

### NetworkGameHost.sendCommand() Flow

```
1. Add sequence number to command
2. Encode with MessageCodec
3. Send via transport (unreliable)
4. Store in pendingCommands for reconciliation
5. Apply locally: simulation.predict([cmd]) for instant prediction
   (Uses predict() instead of tick() - no tick counter increment!)
6. Update localState from simulation
```

### NetworkGameHost.handleSnapshot() Flow

```
1. Add snapshot to interpolation buffer
2. reconcilePrediction(snapshot)
   - Compare local predicted position vs server position
   - If distance > 100: SNAP immediately (teleport/respawn)
   - If distance > 0.5: Add smooth correction
3. Update currentTick
4. Send ACK to server
5. Apply smooth correction to localState
6. Get interpolated state from buffer
7. Notify all stateUpdateCallbacks
```

### InterpolationBuffer

Stores recent snapshots for smooth rendering:

```typescript
class InterpolationBuffer {
  private snapshots: Map<number, GameState> = new Map();
  private interpolationDelay: number = 100; // ms

  addSnapshot(snapshot: GameState): void {
    this.snapshots.set(snapshot.tick, snapshot);
    // Clean up old (keep last 10)
  }

  getInterpolatedState(renderTime: number): GameState {
    const targetTick = this.currentTick - 2;  // 2 ticks behind
    const s1 = this.snapshots.get(targetTick);
    const s2 = this.snapshots.get(targetTick + 1);

    if (!s1) return this.snapshots.get(this.currentTick) || new GameState();
    if (!s2) return s1;

    return this.interpolateStates(s1, s2, 0.5);
  }
}
```

### SmoothCorrection

Smoothly corrects prediction errors instead of snapping:

```typescript
class SmoothCorrection {
  private correctionX/Y/Z: number = 0;
  private correctionDecay: number = 0.1;  // Per frame

  addCorrection(dx, dy, dz): void {
    this.correctionX += dx;
    // ...
  }

  getCorrection(): Vec3 {
    const correction = {
      x: this.correctionX * this.correctionDecay,
      // ...
    };
    // Decay stored correction
    this.correctionX *= (1 - this.correctionDecay);
    // Zero out tiny corrections
    if (Math.abs(this.correctionX) < 0.01) this.correctionX = 0;
    return correction;
  }
}
```

---

## 7. FPS Game Integration

### Files

| File | Purpose |
|------|---------|
| `src/games/fps/FPSGameManager.ts` | Game manager singleton |
| `src/games/fps/simulation/FPSSimulation.ts` | FPS simulation |
| `src/games/fps/simulation/FPSMovementProfile.ts` | Q3-style movement |
| `src/engine/camera/controllers/FPSController.ts` | Input controller |
| `src/engine/network/systems/MovementSystem.ts` | Physics system |

### FPSGameManager (Singleton)

Bridges networking with game systems:

```typescript
class FPSGameManager {
  private gameHost: IGameHost | null = null;
  private simulation: FPSSimulation | null = null;
  private localPlayerId: string = '';
  private isNetworkMode: boolean = false;
  private onStateUpdateCallbacks: ((state: PlayerStateUpdate) => void)[] = [];

  // Initialize modes
  async initializeLocal(config): Promise<void>;
  async initializeNetwork(url: string, config): Promise<void>;

  // Input handling
  sendInput(input: PlayerInputState): void;

  // State access
  getLocalPlayerPosition(): Vec3 | null;
  onPlayerStateUpdate(callback): () => void;
}
```

### FPSGameManager.initializeNetwork() Flow

```
1. Create NetworkGameHost with FPSSimulation
2. Subscribe to onServerInfo BEFORE connect
   - On server info: load map via "map <name>" command
   - After map loads: set up FPSController, enable network mode
3. await networkHost.connect(url)
4. Update localPlayerId from server
5. Subscribe to onStateUpdate → onServerStateUpdate()
```

### FPSGameManager.sendInput() - Input Processing

```typescript
sendInput(input: PlayerInputState): void {
  // Convert WASD + yaw to world-space direction
  // Uses Babylon.js LEFT-HANDED coordinate system:
  const cosYaw = Math.cos(input.yaw);
  const sinYaw = Math.sin(input.yaw);

  // Forward: (sin(yaw), 0, cos(yaw))
  // Right: (cos(yaw), 0, -sin(yaw))

  let dirX = 0, dirZ = 0;
  if (input.forward)  { dirX += sinYaw; dirZ += cosYaw; }
  if (input.backward) { dirX -= sinYaw; dirZ -= cosYaw; }
  if (input.left)     { dirX -= cosYaw; dirZ += sinYaw; }
  if (input.right)    { dirX += cosYaw; dirZ -= sinYaw; }

  // Normalize
  const len = Math.sqrt(dirX*dirX + dirZ*dirZ);
  if (len > 0) { dirX /= len; dirZ /= len; }

  // Create command
  const cmd: FPSInputCommand = {
    type: 'fps_input',
    direction: { x: dirX, y: 0, z: dirZ },
    pitch: input.pitch,
    yaw: input.yaw,
    buttons: /* converted from booleans */,
  };

  this.gameHost.sendCommand(cmd);
}
```

### FPSGameManager.onServerStateUpdate()

Called when server snapshot arrives:

```typescript
private onServerStateUpdate(state: GameState): void {
  const player = state.players.get(this.localPlayerId);
  if (!player) return;  // Player not found

  const entity = state.entities.get(player.entityId);
  if (!entity) return;  // Entity not found

  const transform = entity.getComponent<TransformComponent>('transform');
  const velocity = entity.getComponent<VelocityComponent>('velocity');
  if (!transform || !velocity) return;  // Components not found

  // Build update for FPSController
  const update: PlayerStateUpdate = {
    position: { ...transform.position },
    velocity: { ...velocity.linear },
    grounded: velocity.grounded,
    tick: state.tick,
    // ... movement state fields
  };

  // Notify callbacks (FPSController)
  for (const callback of this.onStateUpdateCallbacks) {
    callback(update);
  }
}
```

### FPSSimulation

Server-side FPS game logic:

```typescript
class FPSSimulation extends Simulation<GameState, FPSInputCommand> {
  private spawnPoints: Vec3[] = [];
  private collisionWorld: CollisionWorld | null = null;

  constructor(config: SimulationConfig) {
    super(config);
    this.registerSystems();
  }

  private registerSystems(): void {
    // Movement system with Q3-style physics
    const movementSystem = new MovementSystem(new FPSMovementProfile());
    this.systems.push(movementSystem);

    // Input command handler
    this.commandHandlers.set('fps_input', this.handleInputCommand.bind(this));
  }

  spawnPlayer(playerId: string): Entity {
    const entity = new Entity(`player_${playerId.split('_').pop()}`);

    // Random spawn point
    const spawn = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
      || { x: 0, y: 100, z: 0 };

    // Add components
    entity.addComponent('transform', new TransformComponent(spawn));
    entity.addComponent('velocity', new VelocityComponent());
    entity.addComponent('input', new InputComponent());
    entity.addComponent('movementState', new MovementStateComponent());

    // Add to state
    this.state.entities.set(entity.id, entity);
    this.state.players.set(playerId, {
      entityId: entity.id,
      name: playerId,
      team: '',
      score: 0,
      ping: 0,
    });

    return entity;
  }

  private handleInputCommand(cmd: FPSInputCommand, state: GameState): void {
    const player = state.players.get(cmd.playerId);
    if (!player) return;

    const entity = state.entities.get(player.entityId);
    if (!entity) return;

    const input = entity.getComponent<InputComponent>('input');
    if (input) {
      input.buttons = cmd.buttons;
      input.moveDirection = cmd.direction;
      input.viewAngles = { pitch: cmd.pitch, yaw: cmd.yaw };
      input.sequence = cmd.seq;
      input.tick = cmd.tick;
    }

    const transform = entity.getComponent<TransformComponent>('transform');
    if (transform) {
      // Update rotation from view angles
      transform.rotation = /* quaternion from pitch/yaw */;
    }
  }
}
```

### MovementSystem

Applies physics to all entities:

```typescript
class MovementSystem implements GameSystem {
  private profile: MovementProfile;
  private collisionWorld: CollisionWorld | null = null;

  update(state: GameState, deltaTime: number): void {
    for (const [id, entity] of state.entities) {
      const transform = entity.getComponent<TransformComponent>('transform');
      const velocity = entity.getComponent<VelocityComponent>('velocity');
      if (!transform || !velocity) continue;

      const input = entity.getComponent<InputComponent>('input');

      // Run movement simulation
      const result = this.profile.simulate(
        transform.position,
        velocity.linear,
        input,
        deltaTime,
        this.collisionWorld
      );

      // Apply results
      transform.position = result.position;
      velocity.linear = result.velocity;
      velocity.grounded = result.grounded;

      // Update movement state component
      const movementState = entity.getComponent<MovementStateComponent>('movementState');
      if (movementState) {
        movementState.isSliding = result.isSliding;
        // ... etc
      }
    }
  }
}
```

### FPSController Network Mode

When connected to server, FPSController switches to network mode:

```typescript
class FPSController {
  private useNetworkMovement: boolean = false;
  private gameManager: FPSGameManager | null = null;
  private stateUnsubscribe: (() => void) | null = null;

  enableNetworkMode(): void {
    if (this.networkReady) return;  // Already enabled

    this.useNetworkMovement = true;
    this.gameManager = FPSGameManager.getInstance();

    // Subscribe to state updates
    this.stateUnsubscribe = this.gameManager.onPlayerStateUpdate((state) => {
      // Apply server position to camera
      this.applyServerState(state);
    });

    this.networkReady = true;
  }

  update(): void {
    if (this.useNetworkMovement) {
      // Get position from game manager
      const pos = this.gameManager?.getLocalPlayerPosition();
      if (pos) {
        this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      }

      // Still send input to server
      this.gameManager?.sendInput(this.collectInput());
    } else {
      // Local physics mode
      this.updateLocalMovement();
    }
  }
}
```

---

## 8. Complete Data Flow

### Client Input → Server → Back to Client

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
├─────────────────────────────────────────────────────────────────┤
│ 1. FPSController.update()                                       │
│    - Collect WASD, mouse input                                  │
│    - Call gameManager.sendInput(inputState)                     │
│                                                                 │
│ 2. FPSGameManager.sendInput()                                   │
│    - Convert to world-space direction                           │
│    - Create FPSInputCommand                                     │
│    - Call gameHost.sendCommand(cmd)                             │
│                                                                 │
│ 3. NetworkGameHost.sendCommand()                                │
│    - Add sequence number                                        │
│    - Encode: MessageCodec.encodeCommand()                       │
│    - Send via transport (unreliable)                            │
│    - LOCAL PREDICTION: simulation.predict([cmd])  ← NO TICK++   │
│    - Update localState                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                          │
├─────────────────────────────────────────────────────────────────┤
│ 4. Room.handleClientMessage()                                   │
│    - Decode: MessageCodec.decodeCommand()                       │
│    - Call handleCommand(clientId, command)                      │
│                                                                 │
│ 5. Room.handleCommand()                                         │
│    - pendingCommands.push(command)  ← QUEUED FOR NEXT TICK      │
│                                                                 │
│ 6. FPSSimulation.tick()                                         │
│    - handleInputCommand() updates entity.input component        │
│    - MovementSystem.update() applies physics                    │
│    - Updates entity.transform.position                          │
│                                                                 │
│ 7. Room.tick() (every 16.67ms at 60Hz)                          │
│    - simulation.tick(pendingCommands)  ← ALL QUEUED COMMANDS    │
│    - pendingCommands = []                                       │
│    - broadcastSnapshot()                                        │
│    - Encode: BinaryProtocol.encodeSnapshot()                    │
│    - Send to all clients                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
├─────────────────────────────────────────────────────────────────┤
│ 8. NetworkGameHost.handleMessage()                              │
│    - Decode: MessageCodec.decodeSnapshot()                      │
│    - Call handleSnapshot(snapshot)                              │
│                                                                 │
│ 9. NetworkGameHost.handleSnapshot()                             │
│    - interpolationBuffer.addSnapshot()                          │
│    - reconcilePrediction() - compare vs local prediction        │
│    - applySmothCorrection() - gradually correct errors          │
│    - getInterpolatedState() for rendering                       │
│    - Notify stateUpdateCallbacks                                │
│                                                                 │
│ 10. FPSGameManager.onServerStateUpdate()                        │
│     - Extract player's entity transform/velocity                │
│     - Notify onPlayerStateUpdate callbacks                      │
│                                                                 │
│ 11. FPSController (via callback)                                │
│     - Apply server position to camera                           │
│     - Render frame                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. File Reference

### Core Networking (14 files)

| Path | Lines | Purpose |
|------|-------|---------|
| `src/engine/network/core/Entity.ts` | 82 | Entity container |
| `src/engine/network/core/Component.ts` | ~50 | Component interface |
| `src/engine/network/core/GameState.ts` | ~80 | State container |
| `src/engine/network/core/Command.ts` | ~40 | Command interface |
| `src/engine/network/core/Simulation.ts` | ~100 | Abstract simulation |
| `src/engine/network/core/IGameHost.ts` | ~30 | Host interface |
| `src/engine/network/protocol/BinaryProtocol.ts` | 534 | Binary encoding |
| `src/engine/network/protocol/MessageCodec.ts` | ~200 | Message codec |
| `src/engine/network/client/transport/Transport.ts` | ~50 | Transport interface |
| `src/engine/network/client/transport/WebSocketTransport.ts` | ~100 | WebSocket impl |
| `src/engine/network/client/hosts/LocalGameHost.ts` | ~200 | Single-player host |
| `src/engine/network/client/hosts/NetworkGameHost.ts` | 534 | Multiplayer host |
| `src/engine/network/server/GameServer.ts` | ~100 | Server manager |
| `src/engine/network/server/Room.ts` | ~350 | Game room |

### Components (5 files)

| Path | Purpose |
|------|---------|
| `src/engine/network/components/TransformComponent.ts` | Position/rotation |
| `src/engine/network/components/VelocityComponent.ts` | Linear/angular velocity |
| `src/engine/network/components/InputComponent.ts` | Player input |
| `src/engine/network/components/MovementStateComponent.ts` | Movement state |
| `src/engine/network/components/index.ts` | Exports |

### Systems (4 files)

| Path | Purpose |
|------|---------|
| `src/engine/network/systems/MovementSystem.ts` | Physics update |
| `src/engine/network/systems/movement/MovementProfile.ts` | Profile interface |
| `src/engine/network/systems/movement/SimpleMovement.ts` | Basic movement |
| `src/engine/network/systems/collision/CollisionWorld.ts` | Collision interface |

### FPS Game (6 files)

| Path | Purpose |
|------|---------|
| `src/games/fps/FPSGameManager.ts` | Game manager singleton |
| `src/games/fps/FPSPlayer.ts` | Player controller |
| `src/games/fps/simulation/FPSSimulation.ts` | FPS simulation |
| `src/games/fps/simulation/FPSMovementProfile.ts` | Q3 movement |
| `src/games/fps/simulation/collision/BSPCollisionWorld.ts` | BSP collision |
| `src/engine/camera/controllers/FPSController.ts` | Camera controller |

### CLI & Commands (6 files)

| Path | Purpose |
|------|---------|
| `src/cli/headless-netserver.ts` | Production server |
| `src/cli/headless-netclient.ts` | Test client |
| `src/engine/console/commands/ConnectCommand.ts` | Connect command |
| `src/engine/console/commands/JoinCommand.ts` | Join command |
| `src/engine/console/commands/NetworkCommand.ts` | Network debug |
| `src/engine/console/commands/NetTestCommand.ts` | Network testing |

---

## 10. Known Issues & Bugs

### Summary of Fixes Applied (2026-01-28)

| Issue | Severity | Status | Files Changed |
|-------|----------|--------|---------------|
| Server tick-per-command | CRITICAL | **FIXED** | Room.ts |
| Client tick-per-command | CRITICAL | **FIXED** | Simulation.ts, NetworkGameHost.ts |
| InterpolationBuffer stripping | HIGH | **FIXED** | NetworkGameHost.ts |
| Component name mismatch | HIGH | **FIXED** | NetworkGameHost.ts |

---

### FIXED: Room.tick() Command Batching

**File**: `src/engine/network/server/Room.ts`

**Problem (WAS)**: Commands were processed immediately in `handleCommand()` via `simulation.tick([command])`, causing each command to trigger its own tick. Then `tick()` ran another tick with empty array. This caused:
- Non-deterministic simulation (timing-dependent)
- Multiple ticks per frame if multiple commands arrive
- Position desync between server and client
- Input processed then "forgotten" in empty tick

**Fix (APPLIED 2026-01-28)**: Commands are now queued and processed together in tick():
```typescript
private pendingCommands: Command[] = [];

handleCommand(clientId: string, command: Command): void {
  this.pendingCommands.push(command);  // Queue, don't process immediately
}

private tick(): void {
  this.currentTick++;
  this.simulation.tick(this.pendingCommands);  // Process all queued commands
  this.pendingCommands = [];
  this.broadcastSnapshot();
}
```

### Component Duplication (position + transform)

**File**: `src/engine/network/protocol/BinaryProtocol.ts:153-187`

Both 'position' and 'transform' components are created for compatibility. This is defensive but indicates incomplete migration. Code now uses 'transform' with fallback to 'position' for safety.

### FIXED: InterpolationBuffer Component Stripping

**File**: `src/engine/network/client/hosts/NetworkGameHost.ts:66-95`

**Problem (WAS)**: The `interpolateStates()` method only copied 'position' component, not 'transform' or 'velocity'. Also didn't copy players Map. This caused `FPSGameManager.onServerStateUpdate()` to fail silently.

**Fix (APPLIED 2026-01-28)**: Now copies:
- 'transform' component (interpolated)
- 'velocity' component (interpolated)
- players Map (required to find local player's entity)

### FIXED: Client Tick-Per-Command Divergence

**File**: `src/engine/network/client/hosts/NetworkGameHost.ts` and `src/engine/network/core/Simulation.ts`

**Problem (WAS)**: Client prediction ran `simulation.tick([cmd])` for each input command, incrementing the tick counter. This caused:
- Client at 60fps = 60 ticks/second
- Server at 20Hz = 20 ticks/second
- Tick counts wildly diverged, breaking reconciliation

**Fix (APPLIED 2026-01-28)**:
1. Added `Simulation.predict()` method that runs physics WITHOUT incrementing tick counter
2. Client now uses `predict()` instead of `tick()` for local prediction
3. Client tick synchronization is now driven by server snapshots only

```typescript
// Simulation.ts - new predict() method
predict(commands: TCommand[]): void {
  this.processCommands(commands);
  this.runSystems();
  // Note: tick NOT incremented - server snapshots drive tick sync
}

// NetworkGameHost.ts - use predict() instead of tick()
private predictLocally(cmd: Command): void {
  this.simulation.predict([cmd]);  // No tick increment!
  this.localState = this.simulation.state.clone();
}
```

### FIXED: Component Name Mismatch in Reconciliation

**File**: `src/engine/network/client/hosts/NetworkGameHost.ts`

**Problem (WAS)**: `reconcilePrediction()` and `applySmothCorrection()` used 'position' component, but FPSSimulation creates entities with 'transform' component. This caused reconciliation to silently fail because client entities had no 'position' component.

**Fix (APPLIED 2026-01-28)**: Both methods now use 'transform' component with fallback to 'position' for compatibility:

```typescript
const localTransform = localEntity.getComponent('transform') as any;
const localPos = localTransform?.position || localEntity.getComponent('position') as any;
```

### Coordinate System Mismatch Risk

- **Quake 3**: Z-up coordinate system
- **Babylon.js**: Y-up coordinate system

Conversion happens in multiple places:
- Server spawn points: `{ x, y: z, z: y }` swap
- BSP loading
- FPSController

If any path misses the conversion, positions will be wrong.

### State Subscription Timing

**File**: `src/games/fps/FPSGameManager.ts:231-234`

State update subscription happens AFTER `connect()` returns. Any snapshots arriving between JoinAccept and subscription setup could be missed (though buffering should handle this).

---

## Appendix: Debugging Checklist

When debugging network sync issues:

1. **Check server logs**: Is player spawning at correct position?
2. **Check snapshot encoding**: Are position flags being set?
3. **Check snapshot decoding**: Are transform/velocity components created?
4. **Check interpolation**: Is getInterpolatedState() returning valid data?
5. **Check callbacks**: Is onServerStateUpdate() being called?
6. **Check component names**: Use `entity.getComponentNames()` to verify
7. **Check coordinate system**: Is Y/Z swap applied consistently?

### Debug Commands

```bash
# Server-side
npm run cli:netserver -- --map wdm7

# Client-side (headless)
npm run cli:netclient -- ws://localhost:8080

# In-game console
connect ws://localhost:8080
join
network status
```
