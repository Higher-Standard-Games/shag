# SHAG Engine Networking Design Document

**Version:** 1.0
**Date:** 2026-01-11
**Status:** Draft

## Table of Contents

1. [Overview](#1-overview)
2. [Engine vs Game Separation](#2-engine-vs-game-separation)
3. [Goals & Requirements](#3-goals--requirements)
4. [Architecture Overview](#4-architecture-overview)
5. [Transport Layer](#5-transport-layer)
6. [Shared Simulation](#6-shared-simulation)
7. [State Management](#7-state-management)
8. [Command System](#8-command-system)
9. [Client Architecture](#9-client-architecture)
10. [Server Architecture](#10-server-architecture)
11. [Network Protocol](#11-network-protocol)
12. [Directory Structure](#12-directory-structure)
13. [Build & Deployment](#13-build--deployment)
14. [API Reference](#14-api-reference)
15. [MVP: Headless Connection Test](#15-mvp-headless-connection-test)
16. [Implementation Roadmap](#16-implementation-roadmap)

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

## 2. Engine vs Game Separation

A critical architectural decision: **what belongs in the engine vs what belongs in the game?**

The networking system is designed so that **~80% lives in the engine** (reusable across all games) and **~20% is game-specific**.

### 2.1 Separation Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENGINE (Reusable)                             │
│  "How networking works"                                              │
├─────────────────────────────────────────────────────────────────────┤
│  • Transport layer (WebTransport, WebSocket, Local)                 │
│  • IGameHost interface + base implementations                       │
│  • Binary serialization primitives                                  │
│  • Entity/Component base classes                                    │
│  • Snapshot manager + delta compression                             │
│  • Interpolation buffer                                             │
│  • Client prediction framework                                      │
│  • Server tick loop infrastructure                                  │
│  • Network protocol (message types, encoding)                       │
│  • Common components (Position, Velocity, Health)                   │
│  • Common systems (Movement, Physics)                               │
│  • Common commands (MoveCommand)                                    │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ extends / implements
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         GAME (Specific)                              │
│  "What the game does"                                                │
├─────────────────────────────────────────────────────────────────────┤
│  • Game-specific components (Weapon, Inventory, Vehicle...)         │
│  • Game-specific commands (Attack, UseItem, Mount...)               │
│  • Game-specific systems (Combat, Crafting, Trading...)             │
│  • GameState subclass with game data                                │
│  • GameRules configuration                                          │
│  • Game events (sounds, effects)                                    │
│  • UI (scoreboard, chat, lobby)                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Responsibility Matrix

| Layer | Engine | Game |
|-------|--------|------|
| **Transport** | ✅ WebTransport, WebSocket, Local | - |
| **Host Interface** | ✅ IGameHost, LocalGameHost, NetworkGameHost | - |
| **Serialization** | ✅ StateEncoder, StateDecoder | - |
| **Entity/Component Base** | ✅ Entity, IComponent interface | - |
| **Common Components** | ✅ Position, Velocity, Rotation, Health | ✅ Weapon, Inventory, Vehicle |
| **Simulation Base** | ✅ Simulation class, tick loop | ✅ MySimulation (extends) |
| **Common Systems** | ✅ Movement, Physics | ✅ Combat, Crafting, Trading |
| **Command Base** | ✅ Command interface, MoveCommand | ✅ AttackCommand, UseItemCommand |
| **Server Infrastructure** | ✅ GameServer, SnapshotManager | ✅ GameRoom (extends) |
| **Protocol** | ✅ Message types, encoding | ✅ Game-specific events |
| **GameState** | ✅ Base GameState class | ✅ MyGameState (extends) |
| **GameRules** | ✅ Interface definition | ✅ Configuration values |
| **Interpolation** | ✅ InterpolationBuffer | - |
| **Prediction** | ✅ Prediction framework | - |
| **Delta Compression** | ✅ SnapshotManager | - |

### 2.3 Engine Base Classes

The engine provides abstract base classes that games extend:

```typescript
// ═══════════════════════════════════════════════════════════════════
// ENGINE: src/engine/network/core/Component.ts
// ═══════════════════════════════════════════════════════════════════

/**
 * Base interface for all networked components.
 * Games implement this for their custom components.
 */
interface IComponent {
  /** Serialize component state to binary */
  serialize(encoder: StateEncoder): void;

  /** Deserialize component state from binary */
  deserialize(decoder: StateDecoder): void;

  /** Clone component for snapshots */
  clone(): IComponent;
}

// ═══════════════════════════════════════════════════════════════════
// ENGINE: src/engine/network/core/Entity.ts
// ═══════════════════════════════════════════════════════════════════

/**
 * Base entity class - container for components.
 * Games use this directly, adding their custom components.
 */
class Entity {
  readonly id: EntityId;
  protected components: Map<string, IComponent> = new Map();

  addComponent<T extends IComponent>(type: string, component: T): void {
    this.components.set(type, component);
  }

  getComponent<T extends IComponent>(type: string): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  hasComponent(type: string): boolean {
    return this.components.has(type);
  }

  serialize(encoder: StateEncoder): void {
    encoder.writeUint8(this.components.size);
    for (const [type, component] of this.components) {
      encoder.writeString(type);
      component.serialize(encoder);
    }
  }

  clone(): Entity {
    const cloned = new Entity(this.id);
    for (const [type, component] of this.components) {
      cloned.addComponent(type, component.clone());
    }
    return cloned;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ENGINE: src/engine/network/core/Simulation.ts
// ═══════════════════════════════════════════════════════════════════

/**
 * Abstract simulation base class.
 * Games extend this to create their game-specific simulation.
 */
abstract class Simulation<
  TState extends GameState = GameState,
  TCommand extends Command = Command
> {
  state: TState;
  currentTick: number = 0;

  protected systems: GameSystem[] = [];
  protected commandHandlers: Map<string, CommandHandler<TCommand>> = new Map();

  constructor(config: SimulationConfig) {
    this.config = config;
    this.state = this.createInitialState();
    this.registerSystems();
    this.registerCommandHandlers();
  }

  /** Override to create game-specific initial state */
  protected abstract createInitialState(): TState;

  /** Override to register game-specific systems */
  protected abstract registerSystems(): void;

  /** Override to register game-specific command handlers */
  protected abstract registerCommandHandlers(): void;

  /**
   * Advance simulation by one tick.
   * This method is final - don't override.
   */
  tick(commands: TCommand[]): void {
    // Sort commands for determinism
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
      return a.seq - b.seq;
    });

    // Execute all commands
    for (const cmd of commands) {
      const handler = this.commandHandlers.get(cmd.type);
      if (handler) {
        handler(this.state, cmd);
      }
    }

    // Update all systems
    const dt = this.config.tickDuration / 1000;
    for (const system of this.systems) {
      system.update(this.state, dt);
    }

    this.currentTick++;
  }

  /** Add a system (engine or game-specific) */
  protected addSystem(system: GameSystem): void {
    this.systems.push(system);
  }

  /** Register a command handler */
  protected onCommand(type: string, handler: CommandHandler<TCommand>): void {
    this.commandHandlers.set(type, handler);
  }
}

// ═══════════════════════════════════════════════════════════════════
// ENGINE: src/engine/network/core/GameSystem.ts
// ═══════════════════════════════════════════════════════════════════

/**
 * Base class for game systems.
 * Both engine and game can provide systems.
 */
abstract class GameSystem {
  abstract update(state: GameState, deltaTime: number): void;
}
```

### 2.4 Game Extensions

Games extend the engine base classes:

```typescript
// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/shared/state/MyGameState.ts
// ═══════════════════════════════════════════════════════════════════

import { GameState } from '@engine/network/core/GameState';

/**
 * Game-specific state extending engine base.
 */
class MyGameState extends GameState {
  // Game-specific additions
  teamScores: Map<TeamId, number> = new Map();
  roundNumber: number = 1;
  roundTimeRemaining: number = 0;
  weather: WeatherType = 'clear';

  serialize(encoder: StateEncoder): void {
    super.serialize(encoder);  // Serialize base state

    // Serialize game-specific state
    encoder.writeUint8(this.teamScores.size);
    for (const [team, score] of this.teamScores) {
      encoder.writeString(team);
      encoder.writeUint32(score);
    }
    encoder.writeUint16(this.roundNumber);
    encoder.writeFloat32(this.roundTimeRemaining);
    encoder.writeString(this.weather);
  }
}

// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/shared/components/WeaponComponent.ts
// ═══════════════════════════════════════════════════════════════════

import { IComponent, StateEncoder, StateDecoder } from '@engine/network';

/**
 * Game-specific component for weapons.
 */
class WeaponComponent implements IComponent {
  weaponId: string = '';
  ammo: number = 0;
  maxAmmo: number = 30;
  reloadTimeRemaining: number = 0;
  isReloading: boolean = false;

  serialize(encoder: StateEncoder): void {
    encoder.writeString(this.weaponId);
    encoder.writeUint16(this.ammo);
    encoder.writeUint16(this.maxAmmo);
    encoder.writeFloat32(this.reloadTimeRemaining);
    encoder.writeBool(this.isReloading);
  }

  deserialize(decoder: StateDecoder): void {
    this.weaponId = decoder.readString();
    this.ammo = decoder.readUint16();
    this.maxAmmo = decoder.readUint16();
    this.reloadTimeRemaining = decoder.readFloat32();
    this.isReloading = decoder.readBool();
  }

  clone(): WeaponComponent {
    const c = new WeaponComponent();
    c.weaponId = this.weaponId;
    c.ammo = this.ammo;
    c.maxAmmo = this.maxAmmo;
    c.reloadTimeRemaining = this.reloadTimeRemaining;
    c.isReloading = this.isReloading;
    return c;
  }
}

// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/shared/commands/AttackCommand.ts
// ═══════════════════════════════════════════════════════════════════

import { Command, StateEncoder, StateDecoder } from '@engine/network';

/**
 * Game-specific command for attacking.
 */
class AttackCommand implements Command {
  readonly type = 'attack';
  readonly playerId: PlayerId;
  readonly tick: number;
  readonly seq: number;

  // Attack-specific data
  readonly weaponId: string;
  readonly targetPosition: { x: number; y: number; z: number };

  constructor(
    playerId: PlayerId,
    tick: number,
    seq: number,
    weaponId: string,
    targetPosition: { x: number; y: number; z: number }
  ) {
    this.playerId = playerId;
    this.tick = tick;
    this.seq = seq;
    this.weaponId = weaponId;
    this.targetPosition = targetPosition;
  }

  serialize(): Uint8Array {
    const encoder = new StateEncoder();
    encoder.writeString(this.type);
    encoder.writeString(this.playerId);
    encoder.writeUint32(this.tick);
    encoder.writeUint32(this.seq);
    encoder.writeString(this.weaponId);
    encoder.writeFloat32(this.targetPosition.x);
    encoder.writeFloat32(this.targetPosition.y);
    encoder.writeFloat32(this.targetPosition.z);
    return encoder.toBytes();
  }

  static deserialize(data: Uint8Array): AttackCommand {
    const decoder = new StateDecoder(data);
    decoder.readString(); // Skip type
    return new AttackCommand(
      decoder.readString(),
      decoder.readUint32(),
      decoder.readUint32(),
      decoder.readString(),
      {
        x: decoder.readFloat32(),
        y: decoder.readFloat32(),
        z: decoder.readFloat32(),
      }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/shared/systems/CombatSystem.ts
// ═══════════════════════════════════════════════════════════════════

import { GameSystem } from '@engine/network/core/GameSystem';
import { MyGameState } from '../state/MyGameState';

/**
 * Game-specific system for combat logic.
 */
class CombatSystem extends GameSystem {
  update(state: MyGameState, dt: number): void {
    // Process pending attacks
    for (const attack of state.pendingAttacks) {
      this.processAttack(state, attack);
    }
    state.pendingAttacks = [];

    // Update reload timers
    for (const entity of state.entities.values()) {
      const weapon = entity.getComponent<WeaponComponent>('weapon');
      if (weapon?.isReloading) {
        weapon.reloadTimeRemaining -= dt;
        if (weapon.reloadTimeRemaining <= 0) {
          weapon.ammo = weapon.maxAmmo;
          weapon.isReloading = false;
        }
      }
    }
  }

  private processAttack(state: MyGameState, attack: PendingAttack): void {
    const attacker = state.entities.get(attack.attackerEntityId);
    if (!attacker) return;

    const weapon = attacker.getComponent<WeaponComponent>('weapon');
    if (!weapon || weapon.ammo <= 0 || weapon.isReloading) return;

    // Consume ammo
    weapon.ammo--;

    // Raycast / hit detection
    const hits = this.performHitScan(state, attacker, attack.targetPosition);

    for (const hit of hits) {
      const health = hit.entity.getComponent<HealthComponent>('health');
      if (health) {
        const damage = this.calculateDamage(weapon.weaponId, hit.distance);
        health.current -= damage;

        // Emit damage event for effects/sounds
        state.events.push({
          type: 'damage',
          entityId: hit.entity.id,
          damage,
          attackerId: attack.attackerEntityId,
        });

        if (health.current <= 0) {
          state.events.push({
            type: 'death',
            entityId: hit.entity.id,
            killerId: attack.attackerEntityId,
          });
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/shared/MySimulation.ts
// ═══════════════════════════════════════════════════════════════════

import { Simulation } from '@engine/network/core/Simulation';
import { MovementSystem, PhysicsSystem } from '@engine/network/systems';
import { MoveCommand } from '@engine/network/commands/MoveCommand';
import { MyGameState } from './state/MyGameState';
import { CombatSystem } from './systems/CombatSystem';
import { InventorySystem } from './systems/InventorySystem';
import { AttackCommand } from './commands/AttackCommand';

type MyCommand = MoveCommand | AttackCommand | UseItemCommand;

/**
 * Game-specific simulation extending engine base.
 */
class MySimulation extends Simulation<MyGameState, MyCommand> {

  protected createInitialState(): MyGameState {
    const state = new MyGameState();
    state.teamScores.set('red', 0);
    state.teamScores.set('blue', 0);
    return state;
  }

  protected registerSystems(): void {
    // Engine-provided systems (reusable)
    this.addSystem(new MovementSystem());
    this.addSystem(new PhysicsSystem());

    // Game-specific systems
    this.addSystem(new CombatSystem());
    this.addSystem(new InventorySystem());
  }

  protected registerCommandHandlers(): void {
    // Engine command (movement) - uses default handler
    this.onCommand('move', (state, cmd) => {
      const moveCmd = cmd as MoveCommand;
      const player = state.players.get(moveCmd.playerId);
      if (!player) return;

      const entity = state.entities.get(player.entityId);
      if (!entity) return;

      const vel = entity.getComponent<VelocityComponent>('velocity');
      if (vel) {
        const speed = 300;
        vel.x = moveCmd.direction.x * speed;
        vel.y = moveCmd.direction.y * speed;
        vel.z = moveCmd.direction.z * speed;
      }
    });

    // Game-specific command (attack)
    this.onCommand('attack', (state, cmd) => {
      const attackCmd = cmd as AttackCommand;
      const player = state.players.get(attackCmd.playerId);
      if (!player) return;

      // Queue attack for CombatSystem to process
      state.pendingAttacks.push({
        attackerEntityId: player.entityId,
        weaponId: attackCmd.weaponId,
        targetPosition: attackCmd.targetPosition,
      });
    });
  }
}
```

### 2.5 Game Scene Integration

The game scene uses the engine's `IGameHost` interface - it doesn't know about networking details:

```typescript
// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/client/GameScene.ts
// ═══════════════════════════════════════════════════════════════════

import { EngineScene } from '@engine/EngineScene';
import { IGameHost } from '@engine/network/client/IGameHost';  // Engine interface!
import { MoveCommand } from '@engine/network/commands/MoveCommand';
import { AttackCommand } from '../shared/commands/AttackCommand';
import { MyGameState } from '../shared/state/MyGameState';

/**
 * Game scene - uses IGameHost for all networking.
 * Doesn't know if it's single-player or multiplayer!
 */
class GameScene extends EngineScene {
  private host: IGameHost;
  private commandSeq = 0;

  constructor(host: IGameHost) {
    super();
    this.host = host;

    // Subscribe to state updates (works for local AND networked)
    this.host.onStateUpdate((state: MyGameState) => {
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

    // Send movement command (engine command)
    if (input.isMoving) {
      const moveCmd = new MoveCommand(
        this.host.localPlayerId,
        this.host.currentTick,
        this.commandSeq++,
        { x: input.moveX, y: 0, z: input.moveY },
        input.lookPitch,
        input.lookYaw,
        input.buttons
      );
      this.host.sendCommand(moveCmd);
    }

    // Handle shooting (game-specific command)
    if (input.buttons & Buttons.FIRE) {
      this.shoot();
    }
  }

  private shoot(): void {
    const attackCmd = new AttackCommand(
      this.host.localPlayerId,
      this.host.currentTick,
      this.commandSeq++,
      this.currentWeaponId,
      this.getAimPosition()
    );

    // Send through host - works for SP and MP!
    this.host.sendCommand(attackCmd);
  }

  private updateWorld(state: MyGameState): void {
    // Update local player (predicted in MP, direct in SP)
    const localPlayer = state.players.get(this.host.localPlayerId);
    if (localPlayer) {
      const entity = state.entities.get(localPlayer.entityId);
      if (entity) {
        this.updateLocalPlayer(entity);
      }
    }

    // Update remote players (interpolated in MP)
    for (const [playerId, player] of state.players) {
      if (playerId === this.host.localPlayerId) continue;

      const entity = this.host.getInterpolatedEntity(player.entityId);
      if (entity) {
        this.updateRemotePlayer(playerId, entity);
      }
    }

    // Update UI with game-specific state
    this.updateScoreboard(state.teamScores);
    this.updateRoundTimer(state.roundTimeRemaining);
  }

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'damage':
        this.showDamageIndicator(event.entityId, event.damage);
        this.audioManager.playSound('hit');
        break;
      case 'death':
        this.playDeathEffect(event.entityId);
        this.showKillFeed(event.killerId, event.entityId);
        break;
      case 'chat':
        this.chatUI.addMessage(event.playerId, event.message);
        break;
    }
  }
}
```

### 2.6 Starting the Game

```typescript
// ═══════════════════════════════════════════════════════════════════
// GAME: src/games/default/client/main.ts
// ═══════════════════════════════════════════════════════════════════

import { LocalGameHost, NetworkGameHost, ListenServerHost } from '@engine/network/client/hosts';
import { TransportFactory } from '@engine/network/client/transport/TransportFactory';
import { MySimulation } from '../shared/MySimulation';
import { GameScene } from './GameScene';
import { gameRules } from '../shared/config/GameRules';

const simulationConfig = {
  tickRate: 20,
  tickDuration: 50,
  maxPlayers: 16,
  gameRules,
};

async function startSinglePlayer(): Promise<void> {
  // Create local host with game simulation
  const host = new LocalGameHost(simulationConfig, MySimulation);

  // Game scene doesn't know it's single-player!
  const scene = new GameScene(host);
  engine.runScene(scene);
}

async function joinMultiplayer(serverUrl: string): Promise<void> {
  // Connect using best available transport
  const transport = await TransportFactory.create(serverUrl);

  // Create network host
  const host = new NetworkGameHost(transport, simulationConfig, MySimulation);
  await host.connect();

  // Game scene doesn't know it's multiplayer!
  const scene = new GameScene(host);
  engine.runScene(scene);
}

async function hostMultiplayer(port: number): Promise<void> {
  // Create listen server (host + play)
  const host = new ListenServerHost(port, simulationConfig, MySimulation);
  await host.start();

  console.log(`Hosting on port ${port}`);

  // Game scene doesn't know it's hosting!
  const scene = new GameScene(host);
  engine.runScene(scene);
}
```

### 2.7 Summary

| What | Where | Why |
|------|-------|-----|
| Transport (WebTransport/WS) | Engine | Reusable, complex, game-agnostic |
| IGameHost interface | Engine | Abstraction for all game code |
| Serialization primitives | Engine | Reusable, performance-critical |
| Entity/Component base | Engine | Standard ECS foundation |
| Prediction/Interpolation | Engine | Complex algorithms, reusable |
| Snapshot/Delta compression | Engine | Complex algorithms, reusable |
| Position, Velocity, Health | Engine | Common to most games |
| Movement, Physics systems | Engine | Common to most games |
| MoveCommand | Engine | Universal input |
| **Game-specific components** | Game | Unique to each game |
| **Game-specific commands** | Game | Unique game actions |
| **Game-specific systems** | Game | Unique game rules |
| **GameState subclass** | Game | Unique game data |
| **GameRules config** | Game | Tuning values |

**The engine handles the "how", the game handles the "what".**

---

## 3. Goals & Requirements

### 3.1 Functional Requirements

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

### 3.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | < 1ms overhead for single-player (local server) |
| NFR-02 | Support 20-60 tick server simulation |
| NFR-03 | < 100KB/s bandwidth per player at 20 tick |
| NFR-04 | Graceful degradation on packet loss |
| NFR-05 | Works on Browser, Electron, Capacitor (Android) |
| NFR-06 | WebSocket fallback for iOS/Safari |

### 3.3 Target Platforms

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

## 4. Architecture Overview

### 4.1 High-Level Architecture

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

### 4.2 Mode Comparison

| Mode | GameHost | Simulation Location | Network |
|------|----------|---------------------|---------|
| Single-player | LocalGameHost | Client (in-process) | None |
| MP Client | NetworkGameHost | Remote Server | WebTransport/WS |
| MP Host | ListenServerHost | Client (in-process) + serves | WebTransport/WS |
| Dedicated | N/A (headless) | Server only | WebTransport/WS |

### 4.3 Data Flow

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

## 5. Transport Layer

### 5.1 Transport Interface

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

### 5.2 Transport Implementations

#### 5.2.1 WebTransportTransport (Primary)

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

#### 5.2.2 WebSocketTransport (Fallback)

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

#### 5.2.3 LocalTransport (Single-player)

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

### 5.3 Transport Factory

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

## 6. Shared Simulation

The simulation is the core game logic that runs **identically** on both client and server.

### 6.1 Simulation Interface

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

### 6.2 Determinism Requirements

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

### 6.3 Game Systems

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

## 7. State Management

### 7.1 Game State Structure

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

### 7.2 Entity Component System (ECS)

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

### 7.3 Snapshots and Delta Compression

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

## 8. Command System

### 8.1 Command Interface

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

### 8.2 Common Commands

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

### 8.3 Command Handlers

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

## 9. Client Architecture

### 9.1 Game Host Interface

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

### 9.2 LocalGameHost (Single-player)

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

### 9.3 NetworkGameHost (Multiplayer Client)

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

### 9.4 Interpolation Buffer

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

## 10. Server Architecture

### 10.1 Game Server

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

### 10.2 Server Transport

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

## 11. Network Protocol

### 11.1 Message Types

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

### 11.2 Binary Protocol

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

## 12. Directory Structure

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

## 13. Build & Deployment

The networking system uses a **hybrid build approach** that optimizes for both development convenience and production efficiency.

### 13.1 Build Approach Comparison

| Approach | Dev Experience | Prod Bundle | Complexity |
|----------|---------------|-------------|------------|
| **Separate builds** | ⚠️ Two builds to manage | ✅ Optimal (~200KB server) | Medium |
| **Headless mode** | ✅ Single build | ❌ Large (~3MB includes Babylon.js) | Low |
| **Hybrid (recommended)** | ✅ Single build + flags | ✅ Tree-shaken per target | Medium |

The hybrid approach uses:
1. **Single codebase** with shared simulation code
2. **Conditional dynamic imports** to load only what's needed
3. **Build-time environment flags** for tree-shaking
4. **Runtime mode detection** for flexibility

### 13.2 Entry Points

```
src/
├── main.ts                    # Client entry point (browser)
├── server/
│   └── main.ts                # Dedicated server entry point (Node.js)
└── cli/
    └── headless-game.ts       # Existing headless CLI (dev/testing)
```

#### 13.2.1 Client Entry Point

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/main.ts - Browser client entry point
// ═══════════════════════════════════════════════════════════════════

import { Engine } from '@/engine/Engine';
import { MainMenu } from '@/game/MainMenu';

async function startClient(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

  const engine = new Engine({
    canvas,
    headless: false,
  });

  await engine.initialize();

  // Show main menu - user chooses SP/MP from there
  const mainMenu = new MainMenu(engine);
  mainMenu.show();
}

startClient().catch(console.error);
```

#### 13.2.2 Server Entry Point

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/server/main.ts - Dedicated server entry point
// ═══════════════════════════════════════════════════════════════════

import { parseArgs } from 'node:util';
import { GameServer } from '@/network/server/GameServer';
import { ServerTransport } from '@/network/server/transport/ServerTransport';

// Server-specific imports - NO Babylon.js here!
// These are dynamically imported to enable tree-shaking

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '7777' },
    map: { type: 'string', short: 'm', default: 'wdm7' },
    tickrate: { type: 'string', short: 't', default: '20' },
    maxplayers: { type: 'string', short: 'n', default: '16' },
    gamemode: { type: 'string', short: 'g', default: 'deathmatch' },
    public: { type: 'boolean', default: false },
    password: { type: 'string' },
    servername: { type: 'string', default: 'SHAG Server' },
    rcon: { type: 'string' },  // Remote console password
    config: { type: 'string', short: 'c' },  // Config file path
  },
});

interface ServerConfig {
  port: number;
  map: string;
  tickRate: number;
  maxPlayers: number;
  gameMode: string;
  isPublic: boolean;
  password?: string;
  serverName: string;
  rconPassword?: string;
}

async function loadConfig(configPath?: string): Promise<Partial<ServerConfig>> {
  if (!configPath) return {};

  const fs = await import('node:fs/promises');
  const content = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

async function startServer(): Promise<void> {
  // Load config file if specified, then override with CLI args
  const fileConfig = await loadConfig(args.config);

  const config: ServerConfig = {
    port: parseInt(args.port!) || fileConfig.port || 7777,
    map: args.map! || fileConfig.map || 'wdm7',
    tickRate: parseInt(args.tickrate!) || fileConfig.tickRate || 20,
    maxPlayers: parseInt(args.maxplayers!) || fileConfig.maxPlayers || 16,
    gameMode: args.gamemode! || fileConfig.gameMode || 'deathmatch',
    isPublic: args.public ?? fileConfig.isPublic ?? false,
    password: args.password || fileConfig.password,
    serverName: args.servername! || fileConfig.serverName || 'SHAG Server',
    rconPassword: args.rcon || fileConfig.rconPassword,
  };

  // Dynamically import the game simulation (shared code)
  const { MySimulation } = await import('@/games/default/shared/MySimulation');
  const { gameRules } = await import('@/games/default/shared/config/GameRules');

  // Create transport layer (WebTransport + WebSocket fallback)
  const transport = new ServerTransport({
    port: config.port,

    // WebTransport for modern clients (Chrome, Edge, Firefox, Electron)
    webTransport: {
      enabled: true,
      // Requires TLS certificate for WebTransport
      certPath: process.env.TLS_CERT_PATH,
      keyPath: process.env.TLS_KEY_PATH,
    },

    // WebSocket fallback for iOS/Safari
    webSocket: {
      enabled: true,
      path: '/ws',
    },
  });

  // Create the game server
  const server = new GameServer({
    transport,
    simulationClass: MySimulation,
    config: {
      tickRate: config.tickRate,
      tickDuration: 1000 / config.tickRate,
      maxPlayers: config.maxPlayers,
      gameRules,
    },
  });

  // Load map data (BSP geometry for collision, entity spawns, etc.)
  // This uses shared map loading code - no rendering
  console.log(`Loading map: ${config.map}...`);
  await server.loadMap(config.map);

  // Register server event handlers
  server.on('playerJoin', (player) => {
    console.log(`Player joined: ${player.name} [${player.id}]`);
  });

  server.on('playerLeave', (player, reason) => {
    console.log(`Player left: ${player.name} (${reason})`);
  });

  server.on('error', (error) => {
    console.error('Server error:', error);
  });

  // Start the server
  await server.start();

  // Print server info
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    SHAG Engine Dedicated Server                 ║
╠════════════════════════════════════════════════════════════════╣
║  Server Name:  ${config.serverName.padEnd(46)} ║
║  Map:          ${config.map.padEnd(46)} ║
║  Game Mode:    ${config.gameMode.padEnd(46)} ║
║  Port:         ${String(config.port).padEnd(46)} ║
║  Tick Rate:    ${(config.tickRate + ' Hz').padEnd(46)} ║
║  Max Players:  ${String(config.maxPlayers).padEnd(46)} ║
║  Public:       ${(config.isPublic ? 'Yes' : 'No').padEnd(46)} ║
║  Password:     ${(config.password ? 'Yes' : 'No').padEnd(46)} ║
╠════════════════════════════════════════════════════════════════╣
║  WebTransport: ${(transport.webTransportEnabled ? 'Enabled' : 'Disabled').padEnd(46)} ║
║  WebSocket:    ${(transport.webSocketEnabled ? 'Enabled (fallback)' : 'Disabled').padEnd(46)} ║
╚════════════════════════════════════════════════════════════════╝
  `);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep process alive
  await new Promise(() => {});  // Never resolves
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
```

### 13.3 Vite Configuration

#### 13.3.1 Shared Base Configuration

```typescript
// ═══════════════════════════════════════════════════════════════════
// vite.config.base.ts - Shared configuration
// ═══════════════════════════════════════════════════════════════════

import { defineConfig } from 'vite';
import path from 'path';

export const baseConfig = defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@network': path.resolve(__dirname, 'src/network'),
      '@game': path.resolve(__dirname, 'src/games/default'),
    },
  },
});
```

#### 13.3.2 Client Build Configuration

```typescript
// ═══════════════════════════════════════════════════════════════════
// vite.config.ts - Client build (default)
// ═══════════════════════════════════════════════════════════════════

import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.config.base';

export default mergeConfig(baseConfig, defineConfig({
  define: {
    'import.meta.env.SHAG_TARGET': JSON.stringify('client'),
    'import.meta.env.SHAG_VERSION': JSON.stringify(process.env.npm_package_version),
  },

  build: {
    outDir: 'dist/client',
    target: 'esnext',

    rollupOptions: {
      input: {
        main: 'index.html',
      },
      output: {
        manualChunks: {
          // Split Babylon.js into separate chunk
          'babylon': ['@babylonjs/core'],
          // Split networking into separate chunk (lazy loaded for SP)
          'network': [
            './src/network/client/transport/WebTransportTransport.ts',
            './src/network/client/transport/WebSocketTransport.ts',
            './src/network/client/hosts/NetworkGameHost.ts',
          ],
        },
      },
    },
  },

  // Client-specific optimizations
  optimizeDeps: {
    include: ['@babylonjs/core'],
  },
}));
```

#### 13.3.3 Server Build Configuration

```typescript
// ═══════════════════════════════════════════════════════════════════
// vite.config.server.ts - Server build
// ═══════════════════════════════════════════════════════════════════

import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.config.base';

export default mergeConfig(baseConfig, defineConfig({
  define: {
    'import.meta.env.SHAG_TARGET': JSON.stringify('server'),
    'import.meta.env.SHAG_VERSION': JSON.stringify(process.env.npm_package_version),
  },

  build: {
    outDir: 'dist/server',
    target: 'node20',  // Node.js 20 LTS
    ssr: true,         // Server-side rendering mode (no browser APIs)

    rollupOptions: {
      input: 'src/server/main.ts',

      output: {
        format: 'esm',
        entryFileNames: '[name].js',
      },

      // Don't bundle Node.js built-ins
      external: [
        'node:util',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:http',
        'node:https',
        'node:crypto',
        'node:stream',
        'node:events',
        // External dependencies that should be installed on server
        '@aspect-dev/webtransport',
        'ws',
      ],
    },

    // Minify for production
    minify: process.env.NODE_ENV === 'production',
  },

  // Exclude client-only code from server bundle
  ssr: {
    noExternal: [
      // Include these in the bundle
      /^@\/network\/shared/,
      /^@\/network\/server/,
      /^@\/games\/.*\/shared/,
    ],
    external: [
      // Exclude these - they're client-only
      '@babylonjs/core',
      '@babylonjs/materials',
      '@babylonjs/loaders',
      '@babylonjs/gui',
      /^@\/engine\//,
      /^@\/network\/client\//,
      /^@\/games\/.*\/client/,
    ],
  },
}));
```

### 13.4 Dynamic Import Pattern

The hybrid approach uses dynamic imports to load code on-demand, enabling tree-shaking.

#### 13.4.1 Main Menu Game Mode Selection

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/game/MainMenu.ts - Dynamic import based on game mode
// ═══════════════════════════════════════════════════════════════════

import { Engine } from '@/engine/Engine';

export class MainMenu {
  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  /**
   * Start single-player game.
   * Only loads LocalGameHost - no network code.
   */
  async startSinglePlayer(mapName: string): Promise<void> {
    // Dynamic import - only loads local host code
    const { LocalGameHost } = await import('@/network/client/hosts/LocalGameHost');
    const { MySimulation } = await import('@/games/default/shared/MySimulation');
    const { GameScene } = await import('@/games/default/client/GameScene');
    const { gameRules } = await import('@/games/default/shared/config/GameRules');

    const host = new LocalGameHost({
      tickRate: 20,
      tickDuration: 50,
      maxPlayers: 1,
      gameRules,
      simulationClass: MySimulation,
    });

    // Load map
    await host.loadMap(mapName);

    // Start game
    const scene = new GameScene(this.engine, host);
    this.engine.runScene(scene);
  }

  /**
   * Join multiplayer server.
   * Loads network transport + NetworkGameHost.
   */
  async joinMultiplayer(serverUrl: string): Promise<void> {
    // Dynamic import - loads network code
    const { TransportFactory } = await import('@/network/client/transport/TransportFactory');
    const { NetworkGameHost } = await import('@/network/client/hosts/NetworkGameHost');
    const { MySimulation } = await import('@/games/default/shared/MySimulation');
    const { GameScene } = await import('@/games/default/client/GameScene');
    const { gameRules } = await import('@/games/default/shared/config/GameRules');

    // Show connecting UI
    this.showConnectingScreen(serverUrl);

    try {
      // Create transport (auto-detects best option)
      const transport = await TransportFactory.create(serverUrl);

      const host = new NetworkGameHost(transport, {
        tickRate: 20,
        tickDuration: 50,
        maxPlayers: 16,
        gameRules,
        simulationClass: MySimulation,
      });

      // Connect to server
      await host.connect();

      // Start game
      const scene = new GameScene(this.engine, host);
      this.engine.runScene(scene);
    } catch (error) {
      this.showError(`Failed to connect: ${error.message}`);
    }
  }

  /**
   * Host multiplayer game (listen server).
   * Loads server code + plays locally.
   */
  async hostMultiplayer(options: HostOptions): Promise<void> {
    // Dynamic import - loads both server and client network code
    const { ListenServerHost } = await import('@/network/client/hosts/ListenServerHost');
    const { MySimulation } = await import('@/games/default/shared/MySimulation');
    const { GameScene } = await import('@/games/default/client/GameScene');
    const { gameRules } = await import('@/games/default/shared/config/GameRules');

    const host = new ListenServerHost({
      port: options.port,
      tickRate: 20,
      tickDuration: 50,
      maxPlayers: options.maxPlayers,
      gameRules,
      simulationClass: MySimulation,
      password: options.password,
      serverName: options.serverName,
    });

    // Load map
    await host.loadMap(options.map);

    // Start hosting
    await host.start();

    this.showHostingInfo(host.port, host.serverName);

    // Start game
    const scene = new GameScene(this.engine, host);
    this.engine.runScene(scene);
  }
}

interface HostOptions {
  map: string;
  port: number;
  maxPlayers: number;
  password?: string;
  serverName: string;
}
```

#### 13.4.2 Environment Detection

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/Environment.ts - Runtime environment detection
// ═══════════════════════════════════════════════════════════════════

export type ShagTarget = 'client' | 'server' | 'headless';

/**
 * Detect current runtime environment.
 */
export function getTarget(): ShagTarget {
  // Build-time constant (set by Vite)
  if (import.meta.env.SHAG_TARGET) {
    return import.meta.env.SHAG_TARGET as ShagTarget;
  }

  // Runtime detection fallback
  if (typeof window === 'undefined') {
    return 'server';
  }

  if (typeof document === 'undefined' || !document.createElement) {
    return 'headless';
  }

  return 'client';
}

/**
 * Check if running on server (Node.js).
 */
export function isServer(): boolean {
  return getTarget() === 'server';
}

/**
 * Check if running in browser.
 */
export function isClient(): boolean {
  return getTarget() === 'client';
}

/**
 * Check if running in headless mode.
 */
export function isHeadless(): boolean {
  return getTarget() === 'headless';
}

/**
 * Check if WebTransport is available.
 */
export function hasWebTransport(): boolean {
  return typeof WebTransport !== 'undefined';
}

/**
 * Check if WebSocket is available.
 */
export function hasWebSocket(): boolean {
  return typeof WebSocket !== 'undefined';
}

/**
 * Get version string.
 */
export function getVersion(): string {
  return import.meta.env.SHAG_VERSION || 'dev';
}
```

### 13.5 Package Scripts

```json
// ═══════════════════════════════════════════════════════════════════
// package.json - Build and run scripts
// ═══════════════════════════════════════════════════════════════════

{
  "name": "shag-engine",
  "version": "0.8.17",
  "type": "module",
  "scripts": {
    // ─────────────────────────────────────────────────────────────
    // Development
    // ─────────────────────────────────────────────────────────────
    "dev": "vite",
    "dev:server": "tsx watch src/server/main.ts",

    // ─────────────────────────────────────────────────────────────
    // Building
    // ─────────────────────────────────────────────────────────────
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "vite build --config vite.config.server.ts",

    // ─────────────────────────────────────────────────────────────
    // Running (Production)
    // ─────────────────────────────────────────────────────────────
    "start": "npm run start:client",
    "start:client": "vite preview",
    "start:server": "node dist/server/main.js",

    // ─────────────────────────────────────────────────────────────
    // Server with options
    // ─────────────────────────────────────────────────────────────
    "server": "node dist/server/main.js",
    "server:dev": "tsx src/server/main.ts",

    // ─────────────────────────────────────────────────────────────
    // Headless CLI (existing)
    // ─────────────────────────────────────────────────────────────
    "cli:game": "tsx src/cli/headless-game.ts",
    "cli:bsp": "tsx src/cli/headless-bsp.ts",

    // ─────────────────────────────────────────────────────────────
    // Testing
    // ─────────────────────────────────────────────────────────────
    "test": "vitest",
    "test:network": "vitest --filter network"
  }
}
```

### 13.6 Server CLI Usage

```bash
# ═══════════════════════════════════════════════════════════════════
# Server CLI Examples
# ═══════════════════════════════════════════════════════════════════

# Basic server start
npm run server -- --map wdm7 --port 7777

# Full options
npm run server -- \
  --map wdm7 \
  --port 7777 \
  --tickrate 30 \
  --maxplayers 16 \
  --gamemode deathmatch \
  --servername "My SHAG Server" \
  --public \
  --password "secret123" \
  --rcon "adminpass"

# Using config file
npm run server -- --config server-config.json

# Development mode (with hot reload)
npm run server:dev -- --map wdm7

# Short form options
npm run server -- -m wdm7 -p 7777 -n 8 -t 20
```

#### 13.6.1 Server Configuration File

```json
// ═══════════════════════════════════════════════════════════════════
// server-config.json - Example server configuration
// ═══════════════════════════════════════════════════════════════════

{
  "serverName": "SHAG Deathmatch Server",
  "port": 7777,
  "map": "wdm7",
  "gameMode": "deathmatch",
  "tickRate": 20,
  "maxPlayers": 16,
  "isPublic": true,
  "password": null,
  "rconPassword": "admin123",

  "mapRotation": [
    "wdm7",
    "wdm1",
    "wdm5"
  ],

  "gameRules": {
    "fragLimit": 30,
    "timeLimit": 600,
    "respawnTime": 3,
    "friendlyFire": false
  },

  "network": {
    "webTransport": {
      "enabled": true,
      "certPath": "/etc/ssl/certs/server.crt",
      "keyPath": "/etc/ssl/private/server.key"
    },
    "webSocket": {
      "enabled": true,
      "path": "/ws"
    }
  },

  "rcon": {
    "enabled": true,
    "maxAttempts": 3,
    "banTime": 300
  }
}
```

### 13.7 Docker Deployment

#### 13.7.1 Dockerfile

```dockerfile
# ═══════════════════════════════════════════════════════════════════
# Dockerfile - Multi-stage build for server
# ═══════════════════════════════════════════════════════════════════

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build server only
RUN npm run build:server

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Copy built server
COPY --from=builder /app/dist/server ./dist/server
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy game assets (maps, configs)
COPY --from=builder /app/assets ./assets

# Create non-root user
RUN addgroup -g 1001 -S shag && \
    adduser -S shag -u 1001 -G shag

USER shag

# Expose ports
EXPOSE 7777/udp
EXPOSE 7777/tcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:7777/health').then(r => process.exit(r.ok ? 0 : 1))"

# Default command
ENTRYPOINT ["node", "dist/server/main.js"]
CMD ["--map", "wdm7", "--port", "7777"]
```

#### 13.7.2 Docker Compose

```yaml
# ═══════════════════════════════════════════════════════════════════
# docker-compose.yml - Full server stack
# ═══════════════════════════════════════════════════════════════════

version: '3.8'

services:
  game-server:
    build: .
    ports:
      - "7777:7777/udp"   # WebTransport datagrams
      - "7777:7777/tcp"   # WebSocket fallback
    environment:
      - NODE_ENV=production
      - TLS_CERT_PATH=/certs/server.crt
      - TLS_KEY_PATH=/certs/server.key
    volumes:
      - ./certs:/certs:ro
      - ./server-config.json:/app/server-config.json:ro
      - ./maps:/app/assets/maps:ro
    command: ["--config", "/app/server-config.json"]
    restart: unless-stopped

    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 256M

  # Optional: Reverse proxy for TLS termination
  caddy:
    image: caddy:2
    ports:
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - game-server

volumes:
  caddy_data:
  caddy_config:
```

### 13.8 Development Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Development Workflow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Local Development:                                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Terminal 1: npm run dev              (Client with HMR)      │   │
│  │  Terminal 2: npm run server:dev       (Server with watch)    │   │
│  │  Browser:    http://localhost:5173    (Client UI)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Testing Single-Player (no server needed):                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Terminal: npm run dev                                        │   │
│  │  Browser:  Click "Single Player" in menu                     │   │
│  │  → LocalGameHost runs simulation in-browser                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Testing Multiplayer:                                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Terminal 1: npm run server:dev -- --map wdm7                │   │
│  │  Terminal 2: npm run dev                                      │   │
│  │  Browser 1:  Connect to localhost:7777                       │   │
│  │  Browser 2:  Connect to localhost:7777                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Testing Headless (existing):                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  npm run cli:game -- --command "map wdm7; bsp info"          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Production Build:                                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  npm run build                        (Builds both)          │   │
│  │  → dist/client/   (~3.4MB)           Client bundle           │   │
│  │  → dist/server/   (~200KB)           Server bundle           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Production Deployment:                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Client: Deploy dist/client/ to CDN (Cloudflare, Vercel)     │   │
│  │  Server: docker-compose up -d                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.9 Bundle Analysis

Expected bundle sizes with the hybrid approach:

| Bundle | Contents | Size (gzipped) |
|--------|----------|----------------|
| **Client Main** | Engine, UI, game client | ~800KB |
| **Client Babylon** | @babylonjs/core (tree-shaken) | ~600KB |
| **Client Network** | Transports, hosts (lazy) | ~50KB |
| **Client Shared** | Simulation, state, commands | ~30KB |
| **Server Total** | Simulation + server code | ~80KB |

```typescript
// Lazy loading network code on first multiplayer action
// → Single-player users never download network chunk

async function onMultiplayerClick() {
  // This triggers the network chunk download
  const { NetworkGameHost } = await import('@/network/client/hosts/NetworkGameHost');
  // ...
}
```

---

## 14. API Reference

### 14.1 Starting a Game

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

### 14.2 GameScene Integration

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

## 15. MVP: Headless Connection Test

The MVP builds **real production code** with minimal scope - not throwaway prototypes. Every file created stays in the final system.

### 15.1 MVP Goal

> **Two headless clients connect to a headless server, receive game settings, and see each other in snapshots.**

### 15.2 MVP Principle: Real Code, Minimal Scope

| Component | Full System | MVP Scope |
|-----------|-------------|-----------|
| **Transport** | WebTransport + WebSocket + Local | WebSocket only |
| **Protocol** | Binary with delta compression | Binary, full snapshots |
| **Server** | GameServer + Simulation | GameServer (no physics) |
| **State** | Full ECS with components | Position + rotation only |
| **Client** | Prediction + interpolation | Receive & log only |
| **Rendering** | Babylon.js | Console output |

**Every line of MVP code stays in the final system. No rewrites.**

### 15.3 Files to Implement (MVP)

```
src/network/
├── shared/                          # ✅ MVP: Full implementation
│   ├── protocol/
│   │   ├── StateEncoder.ts          # Binary encoding
│   │   ├── StateDecoder.ts          # Binary decoding
│   │   ├── Messages.ts              # Message type definitions
│   │   └── MessageCodec.ts          # Encode/decode messages
│   ├── state/
│   │   ├── GameState.ts             # Minimal state (players only)
│   │   └── PlayerState.ts           # Position, rotation, health
│   └── types.ts                     # PlayerId, ClientId, etc.
│
├── client/
│   └── transport/
│       ├── ITransport.ts            # ✅ MVP: Interface
│       └── WebSocketTransport.ts    # ✅ MVP: WebSocket impl
│
└── server/
    ├── GameServer.ts                # ✅ MVP: Core server
    ├── ClientConnection.ts          # ✅ MVP: Per-client state
    └── transport/
        └── WebSocketServerTransport.ts  # ✅ MVP: WS server

src/server/
└── main.ts                          # ✅ MVP: Server entry point

src/cli/
└── network-client.ts                # ✅ MVP: Headless client for testing
```

### 15.4 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MVP TEST SCENARIO                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Terminal 1 (Server):                                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  $ npm run server:dev -- --map wdm7 --port 7777              │   │
│  │                                                               │   │
│  │  [Server] Starting on port 7777...                           │   │
│  │  [Server] Map loaded: wdm7                                    │   │
│  │  [Server] Waiting for connections...                          │   │
│  │  [Server] Client connected: client_abc123                     │   │
│  │  [Server] Client connected: client_def456                     │   │
│  │  [Server] 2 clients connected, starting game loop             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Terminal 2 (Client 1):                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  $ npm run cli:game -- --connect ws://localhost:7777         │   │
│  │                                                               │   │
│  │  [Client] Connecting to ws://localhost:7777...               │   │
│  │  [Client] Connected! Waiting for welcome...                   │   │
│  │  [Client] Received welcome: map=wdm7, tickRate=20            │   │
│  │  [Client] Loading map: wdm7                                   │   │
│  │  [Client] Map loaded, sending ready                           │   │
│  │  [Client] Game started! Receiving snapshots...               │   │
│  │  [Client] Tick 1: 2 players                                   │   │
│  │  [Client] Tick 2: 2 players                                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Terminal 3 (Client 2):                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  $ npm run cli:game -- --connect ws://localhost:7777         │   │
│  │                                                               │   │
│  │  [Client] Connecting to ws://localhost:7777...               │   │
│  │  [Client] Connected! Waiting for welcome...                   │   │
│  │  [Client] Received welcome: map=wdm7, tickRate=20            │   │
│  │  [Client] Loading map: wdm7                                   │   │
│  │  [Client] Map loaded, sending ready                           │   │
│  │  [Client] Game started! Receiving snapshots...               │   │
│  │  [Client] Tick 1: 2 players                                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 15.3 Handshake Protocol

```
Client                              Server
   │                                   │
   │ ──── TCP Connect ───────────────► │
   │                                   │
   │ ◄──── WELCOME ─────────────────── │  Server info + game settings
   │       {                           │
   │         serverId: "srv_...",      │
   │         serverName: "My Server",  │
   │         map: "wdm7",              │
   │         gameMode: "deathmatch",   │
   │         tickRate: 20,             │
   │         maxPlayers: 16,           │
   │         currentPlayers: 1,        │
   │         protocol: 1,              │
   │       }                           │
   │                                   │
   │ ──── JOIN ────────────────────► │  Client requests to join
   │       {                           │
   │         playerName: "Player1",    │
   │         protocol: 1,              │
   │       }                           │
   │                                   │
   │ ◄──── JOIN_ACCEPT ──────────────  │  Server accepts
   │       {                           │
   │         clientId: "client_...",   │
   │         playerId: "player_...",   │
   │         spawnPosition: {x,y,z},   │
   │       }                           │
   │                                   │
   │ ──── READY ───────────────────► │  Client loaded map
   │       {                           │
   │         clientId: "client_...",   │
   │       }                           │
   │                                   │
   │ ◄──── GAME_START ───────────────  │  Game begins (all ready)
   │       {                           │
   │         tick: 0,                  │
   │         players: [...],           │
   │       }                           │
   │                                   │
   │ ◄──── SNAPSHOT ─────────────────  │  Continuous state updates
   │       {                           │
   │         tick: 1,                  │
   │         players: [...],           │
   │         entities: [...],          │
   │       }                           │
   │                                   │
```

### 15.6 MVP Implementation

#### 15.6.1 Shared Types (Production)

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/types.ts - Production types (used from day 1)
// ═══════════════════════════════════════════════════════════════════

export type ClientId = string;
export type PlayerId = string;
export type EntityId = string;
export type Tick = number;

export const PROTOCOL_VERSION = 1;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  pitch: number;
  yaw: number;
}
```

#### 15.6.2 Message Definitions (Production)

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/protocol/Messages.ts - All message types
// ═══════════════════════════════════════════════════════════════════

import { ClientId, PlayerId, Vector3, Rotation, Tick } from '../types';

// Message type enum for binary encoding
export enum MessageType {
  // Server → Client
  Welcome = 0x01,
  JoinAccept = 0x02,
  JoinReject = 0x03,
  Snapshot = 0x04,
  PlayerJoined = 0x05,
  PlayerLeft = 0x06,
  GameStart = 0x07,

  // Client → Server
  Join = 0x81,
  Ready = 0x82,
  Input = 0x83,
  Disconnect = 0x84,
}

// ─────────────────────────────────────────────────────────────────
// Server → Client Messages
// ─────────────────────────────────────────────────────────────────

export interface WelcomeMessage {
  type: MessageType.Welcome;
  serverId: string;
  serverName: string;
  map: string;
  gameMode: string;
  tickRate: number;
  maxPlayers: number;
  currentPlayers: number;
  protocol: number;
}

export interface JoinAcceptMessage {
  type: MessageType.JoinAccept;
  clientId: ClientId;
  playerId: PlayerId;
  spawnPosition: Vector3;
  spawnRotation: Rotation;
}

export interface JoinRejectMessage {
  type: MessageType.JoinReject;
  reason: 'server_full' | 'banned' | 'password_required' | 'protocol_mismatch';
  message: string;
}

export interface SnapshotMessage {
  type: MessageType.Snapshot;
  tick: Tick;
  serverTime: number;
  players: PlayerSnapshot[];
  // entities: EntitySnapshot[];  // Post-MVP
}

export interface PlayerSnapshot {
  playerId: PlayerId;
  position: Vector3;
  rotation: Rotation;
  health: number;
  state: PlayerStateType;
}

export type PlayerStateType = 'alive' | 'dead' | 'spectating';

export interface PlayerJoinedMessage {
  type: MessageType.PlayerJoined;
  playerId: PlayerId;
  name: string;
}

export interface PlayerLeftMessage {
  type: MessageType.PlayerLeft;
  playerId: PlayerId;
  reason: 'disconnect' | 'kicked' | 'timeout';
}

export interface GameStartMessage {
  type: MessageType.GameStart;
  tick: Tick;
  players: Array<{ playerId: PlayerId; name: string }>;
}

// ─────────────────────────────────────────────────────────────────
// Client → Server Messages
// ─────────────────────────────────────────────────────────────────

export interface JoinMessage {
  type: MessageType.Join;
  playerName: string;
  password?: string;
  protocol: number;
}

export interface ReadyMessage {
  type: MessageType.Ready;
  clientId: ClientId;
}

export interface InputMessage {
  type: MessageType.Input;
  clientId: ClientId;
  tick: Tick;
  seq: number;
  keys: number;      // Bitmask
  pitch: number;
  yaw: number;
  buttons: number;   // Bitmask
}

export interface DisconnectMessage {
  type: MessageType.Disconnect;
  clientId: ClientId;
  reason: string;
}

// Union types for type safety
export type ServerMessage =
  | WelcomeMessage
  | JoinAcceptMessage
  | JoinRejectMessage
  | SnapshotMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | GameStartMessage;

export type ClientMessage =
  | JoinMessage
  | ReadyMessage
  | InputMessage
  | DisconnectMessage;

export type Message = ServerMessage | ClientMessage;
```

#### 15.6.3 Binary Protocol (Production)

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/protocol/StateEncoder.ts - Binary encoding
// ═══════════════════════════════════════════════════════════════════

export class StateEncoder {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset = 0;

  constructor(initialSize = 4096) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
  }

  writeUint8(value: number): this {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset++, value);
    return this;
  }

  writeUint16(value: number): this {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, true); // little-endian
    this.offset += 2;
    return this;
  }

  writeUint32(value: number): this {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
    return this;
  }

  writeFloat32(value: number): this {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
    return this;
  }

  writeString(value: string): this {
    const bytes = new TextEncoder().encode(value);
    this.writeUint16(bytes.length);
    this.ensureCapacity(bytes.length);
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
    return this;
  }

  writeVector3(v: { x: number; y: number; z: number }): this {
    return this.writeFloat32(v.x).writeFloat32(v.y).writeFloat32(v.z);
  }

  writeRotation(r: { pitch: number; yaw: number }): this {
    return this.writeFloat32(r.pitch).writeFloat32(r.yaw);
  }

  private ensureCapacity(bytes: number): void {
    if (this.offset + bytes > this.buffer.byteLength) {
      const newBuffer = new ArrayBuffer(this.buffer.byteLength * 2);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
    }
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.offset);
  }
}
```

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/protocol/StateDecoder.ts - Binary decoding
// ═══════════════════════════════════════════════════════════════════

export class StateDecoder {
  private view: DataView;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readUint8(): number {
    return this.view.getUint8(this.offset++);
  }

  readUint16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readString(): string {
    const length = this.readUint16();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readVector3(): { x: number; y: number; z: number } {
    return { x: this.readFloat32(), y: this.readFloat32(), z: this.readFloat32() };
  }

  readRotation(): { pitch: number; yaw: number } {
    return { pitch: this.readFloat32(), yaw: this.readFloat32() };
  }
}
```

#### 15.6.4 Transport Interface (Production)

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/client/transport/ITransport.ts - Transport abstraction
// ═══════════════════════════════════════════════════════════════════

export type TransportState = 'disconnected' | 'connecting' | 'connected';

export interface ITransport {
  readonly state: TransportState;
  readonly latency: number;

  connect(url: string): Promise<void>;
  disconnect(): void;
  send(data: Uint8Array): void;

  onMessage(callback: (data: Uint8Array) => void): void;
  onConnect(callback: () => void): void;
  onDisconnect(callback: (reason: string) => void): void;
  onError(callback: (error: Error) => void): void;
}
```

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/client/transport/WebSocketTransport.ts - WS implementation
// ═══════════════════════════════════════════════════════════════════

import { ITransport, TransportState } from './ITransport';

export class WebSocketTransport implements ITransport {
  private ws: WebSocket | null = null;
  private _state: TransportState = 'disconnected';
  private _latency = 0;
  private lastPingTime = 0;

  private messageCallback?: (data: Uint8Array) => void;
  private connectCallback?: () => void;
  private disconnectCallback?: (reason: string) => void;
  private errorCallback?: (error: Error) => void;

  get state(): TransportState { return this._state; }
  get latency(): number { return this._latency; }

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._state = 'connecting';
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this._state = 'connected';
        this.connectCallback?.();
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = new Uint8Array(event.data);
        this.messageCallback?.(data);
      };

      this.ws.onclose = (event) => {
        this._state = 'disconnected';
        this.disconnectCallback?.(event.reason || 'Connection closed');
      };

      this.ws.onerror = () => {
        const error = new Error('WebSocket error');
        this.errorCallback?.(error);
        reject(error);
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this._state = 'disconnected';
  }

  send(data: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  onMessage(callback: (data: Uint8Array) => void): void {
    this.messageCallback = callback;
  }

  onConnect(callback: () => void): void {
    this.connectCallback = callback;
  }

  onDisconnect(callback: (reason: string) => void): void {
    this.disconnectCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }
}
```

#### 15.6.5 Server Implementation (Production)

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/server/ClientConnection.ts - Per-client state
// ═══════════════════════════════════════════════════════════════════

import { ClientId, PlayerId, Vector3, Rotation } from '../shared/types';

export interface ClientConnection {
  clientId: ClientId;
  playerId: PlayerId;
  playerName: string;
  ready: boolean;
  lastInputSeq: number;
  position: Vector3;
  rotation: Rotation;
  health: number;
  state: 'alive' | 'dead' | 'spectating';
  send: (data: Uint8Array) => void;
}
```

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/server/GameServer.ts - Core server (production)
// ═══════════════════════════════════════════════════════════════════

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { ClientId, PlayerId, Vector3, PROTOCOL_VERSION } from '../shared/types';
import { MessageType, Message, SnapshotMessage } from '../shared/protocol/Messages';
import { StateEncoder } from '../shared/protocol/StateEncoder';
import { StateDecoder } from '../shared/protocol/StateDecoder';
import { ClientConnection } from './ClientConnection';
import { MessageCodec } from '../shared/protocol/MessageCodec';

export interface ServerConfig {
  port: number;
  map: string;
  serverName: string;
  gameMode: string;
  tickRate: number;
  maxPlayers: number;
  password?: string;
}

export class GameServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<ClientId, ClientConnection>();
  private wsToClient = new Map<WebSocket, ClientId>();
  private config: ServerConfig;
  private currentTick = 0;
  private tickInterval: NodeJS.Timeout | null = null;
  private gameStarted = false;
  private codec = new MessageCodec();

  constructor(config: ServerConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.config.port });

    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.wss.on('error', (error) => this.emit('error', error));

    console.log(`[GameServer] Started on port ${this.config.port}`);
    console.log(`[GameServer] Map: ${this.config.map}`);
    console.log(`[GameServer] Tick rate: ${this.config.tickRate} Hz`);
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = this.generateId('client');

    console.log(`[GameServer] Connection: ${clientId}`);

    // Send welcome immediately (binary)
    const welcome = this.codec.encode({
      type: MessageType.Welcome,
      serverId: `srv_${this.config.port}`,
      serverName: this.config.serverName,
      map: this.config.map,
      gameMode: this.config.gameMode,
      tickRate: this.config.tickRate,
      maxPlayers: this.config.maxPlayers,
      currentPlayers: this.clients.size,
      protocol: PROTOCOL_VERSION,
    });
    ws.send(welcome);

    // Store WS → ClientId mapping for later
    this.wsToClient.set(ws, clientId);

    ws.on('message', (data: Buffer) => {
      const message = this.codec.decode(new Uint8Array(data));
      this.handleMessage(clientId, ws, message);
    });

    ws.on('close', () => {
      this.handleDisconnect(clientId);
      this.wsToClient.delete(ws);
    });
  }

  private handleMessage(clientId: ClientId, ws: WebSocket, message: Message): void {
    switch (message.type) {
      case MessageType.Join:
        this.handleJoin(clientId, ws, message);
        break;
      case MessageType.Ready:
        this.handleReady(clientId);
        break;
      case MessageType.Input:
        this.handleInput(clientId, message);
        break;
      case MessageType.Disconnect:
        this.handleDisconnect(clientId);
        break;
    }
  }

  private handleJoin(clientId: ClientId, ws: WebSocket, message: any): void {
    if (this.clients.size >= this.config.maxPlayers) {
      ws.send(this.codec.encode({
        type: MessageType.JoinReject,
        reason: 'server_full',
        message: 'Server is full',
      }));
      ws.close();
      return;
    }

    const playerId = this.generateId('player');
    const spawn = this.getSpawnPosition();

    const client: ClientConnection = {
      clientId,
      playerId,
      playerName: message.playerName || 'Player',
      ready: false,
      lastInputSeq: 0,
      position: spawn,
      rotation: { pitch: 0, yaw: 0 },
      health: 100,
      state: 'alive',
      send: (data) => ws.send(data),
    };

    this.clients.set(clientId, client);

    console.log(`[GameServer] Player joined: ${client.playerName} (${playerId})`);

    // Send accept
    client.send(this.codec.encode({
      type: MessageType.JoinAccept,
      clientId,
      playerId,
      spawnPosition: spawn,
      spawnRotation: { pitch: 0, yaw: 0 },
    }));

    // Notify others
    this.broadcast({
      type: MessageType.PlayerJoined,
      playerId,
      name: client.playerName,
    }, clientId);

    this.emit('playerJoin', client);
  }

  private handleReady(clientId: ClientId): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.ready = true;
    console.log(`[GameServer] Player ready: ${client.playerName}`);

    if (!this.gameStarted && this.allPlayersReady()) {
      this.startGame();
    }
  }

  private handleInput(clientId: ClientId, message: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastInputSeq = message.seq;

    // MVP: Simple immediate position update (no physics)
    const speed = 5;
    const keys = message.keys;
    if (keys & 1) client.position.z -= speed;
    if (keys & 2) client.position.x -= speed;
    if (keys & 4) client.position.z += speed;
    if (keys & 8) client.position.x += speed;

    client.rotation.pitch = message.pitch;
    client.rotation.yaw = message.yaw;
  }

  private handleDisconnect(clientId: ClientId): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.log(`[GameServer] Player left: ${client.playerName}`);
    this.clients.delete(clientId);

    this.broadcast({
      type: MessageType.PlayerLeft,
      playerId: client.playerId,
      reason: 'disconnect',
    });

    this.emit('playerLeave', client);
  }

  private allPlayersReady(): boolean {
    if (this.clients.size === 0) return false;
    return Array.from(this.clients.values()).every(c => c.ready);
  }

  private startGame(): void {
    this.gameStarted = true;
    this.currentTick = 0;

    const players = Array.from(this.clients.values()).map(c => ({
      playerId: c.playerId,
      name: c.playerName,
    }));

    this.broadcast({ type: MessageType.GameStart, tick: 0, players });

    console.log(`[GameServer] Game started with ${players.length} players`);

    // Start tick loop
    const tickMs = 1000 / this.config.tickRate;
    this.tickInterval = setInterval(() => this.tick(), tickMs);
  }

  private tick(): void {
    this.currentTick++;

    // Build and send snapshot
    const snapshot: SnapshotMessage = {
      type: MessageType.Snapshot,
      tick: this.currentTick,
      serverTime: Date.now(),
      players: Array.from(this.clients.values()).map(c => ({
        playerId: c.playerId,
        position: { ...c.position },
        rotation: { ...c.rotation },
        health: c.health,
        state: c.state,
      })),
    };

    this.broadcast(snapshot);

    if (this.currentTick % this.config.tickRate === 0) {
      console.log(`[GameServer] Tick ${this.currentTick}: ${this.clients.size} players`);
    }
  }

  private broadcast(message: Message, excludeClient?: ClientId): void {
    const data = this.codec.encode(message);
    for (const [id, client] of this.clients) {
      if (id !== excludeClient) {
        client.send(data);
      }
    }
  }

  private getSpawnPosition(): Vector3 {
    const index = this.clients.size;
    return { x: (index % 4) * 100, y: 0, z: Math.floor(index / 4) * 100 };
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  async stop(): Promise<void> {
    if (this.tickInterval) clearInterval(this.tickInterval);
    for (const client of this.clients.values()) {
      // Close connections
    }
    this.wss?.close();
    console.log('[GameServer] Stopped');
  }
}
```

#### 15.5.2 Network Client

The client uses the same transport abstraction and message codec as the server:

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/client/NetworkClient.ts - Production network client
// ═══════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import type { ITransport } from '../shared/transport/ITransport';
import { WebSocketTransport } from '../shared/transport/WebSocketTransport';
import { MessageCodec } from '../shared/protocol/MessageCodec';
import { MessageType } from '../shared/protocol/Messages';
import type { ClientId, PlayerId, Tick, PROTOCOL_VERSION } from '../shared/types';

// ───────────────────────────────────────────────────────────────────
// Client State
// ───────────────────────────────────────────────────────────────────

export enum ClientState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Joining = 'joining',
  Joined = 'joined',
  Ready = 'ready',
  Playing = 'playing',
}

export interface PlayerSnapshot {
  playerId: PlayerId;
  position: { x: number; y: number; z: number };
  rotation: { pitch: number; yaw: number };
  health: number;
}

export interface GameSettings {
  map: string;
  gameMode: string;
  tickRate: number;
  serverName: string;
  maxPlayers: number;
  currentPlayers: number;
}

// ───────────────────────────────────────────────────────────────────
// Events
// ───────────────────────────────────────────────────────────────────

export interface NetworkClientEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  welcome: (settings: GameSettings) => void;
  joinAccepted: (clientId: ClientId, playerId: PlayerId, spawnPosition: { x: number; y: number; z: number }) => void;
  joinRejected: (reason: string, message: string) => void;
  gameStart: (tick: Tick, players: Array<{ playerId: PlayerId; name: string }>) => void;
  snapshot: (tick: Tick, players: PlayerSnapshot[]) => void;
  playerJoined: (playerId: PlayerId, name: string) => void;
  playerLeft: (playerId: PlayerId, reason: string) => void;
  error: (error: Error) => void;
}

// ───────────────────────────────────────────────────────────────────
// Network Client
// ───────────────────────────────────────────────────────────────────

export interface NetworkClientConfig {
  serverUrl: string;
  playerName: string;
  password?: string;
  transport?: ITransport;   // Inject custom transport (for testing)
}

export class NetworkClient extends EventEmitter {
  private transport: ITransport;
  private config: NetworkClientConfig;
  private state: ClientState = ClientState.Disconnected;

  // Connection state
  private clientId: ClientId | null = null;
  private playerId: PlayerId | null = null;
  private gameSettings: GameSettings | null = null;

  // Game state
  private currentTick: Tick = 0;
  private players: Map<PlayerId, PlayerSnapshot> = new Map();
  private inputSeq = 0;
  private inputInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: NetworkClientConfig) {
    super();
    this.config = config;
    this.transport = config.transport ?? new WebSocketTransport();
    this.setupTransportHandlers();
  }

  // ─────────────────────────────────────────────────────────────────
  // Transport Setup
  // ─────────────────────────────────────────────────────────────────

  private setupTransportHandlers(): void {
    this.transport.onConnect(() => {
      this.state = ClientState.Connected;
      console.log('[NetworkClient] Connected! Waiting for welcome...');
      this.emit('connected');
    });

    this.transport.onMessage((data: Uint8Array) => {
      this.handleMessage(data);
    });

    this.transport.onDisconnect((reason: string) => {
      console.log(`[NetworkClient] Disconnected: ${reason}`);
      this.cleanup();
      this.emit('disconnected', reason);
    });

    this.transport.onError((error: Error) => {
      console.error('[NetworkClient] Transport error:', error);
      this.emit('error', error);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.state !== ClientState.Disconnected) {
      throw new Error(`Cannot connect: already ${this.state}`);
    }

    this.state = ClientState.Connecting;
    console.log(`[NetworkClient] Connecting to ${this.config.serverUrl}...`);

    try {
      await this.transport.connect(this.config.serverUrl);
    } catch (error) {
      this.state = ClientState.Disconnected;
      throw error;
    }
  }

  disconnect(): void {
    if (this.state === ClientState.Disconnected) return;

    // Send disconnect message
    if (this.clientId && this.transport.state === 'connected') {
      this.send(MessageType.Disconnect, {
        clientId: this.clientId,
        reason: 'user_disconnect',
      });
    }

    this.transport.disconnect();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.inputInterval) {
      clearInterval(this.inputInterval);
      this.inputInterval = null;
    }
    this.state = ClientState.Disconnected;
    this.clientId = null;
    this.playerId = null;
    this.gameSettings = null;
    this.players.clear();
    this.inputSeq = 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // Message Handling
  // ─────────────────────────────────────────────────────────────────

  private handleMessage(data: Uint8Array): void {
    try {
      const { type, payload } = MessageCodec.decode(data);

      switch (type) {
        case MessageType.Welcome:
          this.handleWelcome(payload);
          break;
        case MessageType.JoinAccept:
          this.handleJoinAccept(payload);
          break;
        case MessageType.JoinReject:
          this.handleJoinReject(payload);
          break;
        case MessageType.GameStart:
          this.handleGameStart(payload);
          break;
        case MessageType.Snapshot:
          this.handleSnapshot(payload);
          break;
        case MessageType.PlayerJoined:
          this.handlePlayerJoined(payload);
          break;
        case MessageType.PlayerLeft:
          this.handlePlayerLeft(payload);
          break;
        default:
          console.warn(`[NetworkClient] Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error('[NetworkClient] Failed to decode message:', error);
    }
  }

  private handleWelcome(payload: any): void {
    this.gameSettings = {
      map: payload.map,
      gameMode: payload.gameMode,
      tickRate: payload.tickRate,
      serverName: payload.serverName,
      maxPlayers: payload.maxPlayers,
      currentPlayers: payload.currentPlayers,
    };

    console.log(`[NetworkClient] Received welcome: map=${payload.map}, tickRate=${payload.tickRate}`);
    console.log(`[NetworkClient] Server: ${payload.serverName} (${payload.currentPlayers}/${payload.maxPlayers} players)`);

    this.emit('welcome', this.gameSettings);

    // In headless mode, we "load" the map instantly
    // In visual client, this would wait for actual map loading
    console.log(`[NetworkClient] Loading map: ${payload.map}`);
    this.onMapLoaded();
  }

  /** Called when map is loaded (instant in headless, async in visual client) */
  protected onMapLoaded(): void {
    console.log('[NetworkClient] Map loaded!');
    this.state = ClientState.Joining;

    // Send join request
    this.send(MessageType.Join, {
      playerName: this.config.playerName,
      password: this.config.password ?? '',
      protocol: 1, // PROTOCOL_VERSION
    });
  }

  private handleJoinAccept(payload: any): void {
    this.state = ClientState.Joined;
    this.clientId = payload.clientId;
    this.playerId = payload.playerId;

    console.log(`[NetworkClient] Joined as ${this.playerId}`);
    console.log(`[NetworkClient] Spawn: (${payload.spawnPosition.x}, ${payload.spawnPosition.y}, ${payload.spawnPosition.z})`);

    this.emit('joinAccepted', this.clientId, this.playerId, payload.spawnPosition);

    // Send ready signal
    this.state = ClientState.Ready;
    this.send(MessageType.Ready, {
      clientId: this.clientId,
    });
    console.log('[NetworkClient] Sent ready signal');
  }

  private handleJoinReject(payload: any): void {
    console.error(`[NetworkClient] Join rejected: ${payload.reason} - ${payload.message}`);
    this.emit('joinRejected', payload.reason, payload.message);
    this.disconnect();
  }

  private handleGameStart(payload: any): void {
    this.state = ClientState.Playing;
    this.currentTick = payload.tick;

    console.log('[NetworkClient] Game started!');
    console.log(`[NetworkClient] Players: ${payload.players.map((p: any) => p.name).join(', ')}`);

    this.emit('gameStart', payload.tick, payload.players);

    // Start sending inputs
    this.startInputLoop();
  }

  private handleSnapshot(payload: any): void {
    this.currentTick = payload.tick;

    // Update player states
    for (const player of payload.players) {
      this.players.set(player.playerId, player);
    }

    // Log every 20 ticks
    if (payload.tick % 20 === 0) {
      console.log(`[NetworkClient] Tick ${payload.tick}: ${payload.players.length} players`);
    }

    this.emit('snapshot', payload.tick, payload.players);
  }

  private handlePlayerJoined(payload: any): void {
    console.log(`[NetworkClient] Player joined: ${payload.name}`);
    this.emit('playerJoined', payload.playerId, payload.name);
  }

  private handlePlayerLeft(payload: any): void {
    console.log(`[NetworkClient] Player left: ${payload.playerId}`);
    this.players.delete(payload.playerId);
    this.emit('playerLeft', payload.playerId, payload.reason);
  }

  // ─────────────────────────────────────────────────────────────────
  // Input Loop
  // ─────────────────────────────────────────────────────────────────

  private startInputLoop(): void {
    // Send input every 50ms (20 Hz) - simulated random movement for headless
    this.inputInterval = setInterval(() => {
      if (this.state !== ClientState.Playing) return;

      // Simulate random input (in real client, this comes from InputSystem)
      const keys = Math.random() > 0.5 ? 1 : 0; // Random forward movement

      this.sendInput({
        keys,
        pitch: 0,
        yaw: Math.random() * Math.PI * 2,
        buttons: 0,
      });
    }, 50);
  }

  /** Send input to server - called by InputSystem in visual client */
  sendInput(input: { keys: number; pitch: number; yaw: number; buttons: number }): void {
    if (this.state !== ClientState.Playing || !this.clientId) return;

    this.send(MessageType.Input, {
      clientId: this.clientId,
      tick: this.currentTick,
      seq: this.inputSeq++,
      ...input,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Send Helper
  // ─────────────────────────────────────────────────────────────────

  private send(type: MessageType, payload: any): void {
    if (this.transport.state !== 'connected') return;

    const data = MessageCodec.encode(type, payload);
    this.transport.send(data);
  }

  // ─────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────

  getState(): ClientState { return this.state; }
  getClientId(): ClientId | null { return this.clientId; }
  getPlayerId(): PlayerId | null { return this.playerId; }
  getGameSettings(): GameSettings | null { return this.gameSettings; }
  getCurrentTick(): Tick { return this.currentTick; }
  getPlayers(): Map<PlayerId, PlayerSnapshot> { return new Map(this.players); }
  getLatency(): number { return this.transport.latency; }
}
```

#### 15.5.3 CLI Entry Points

These are the **production** entry points for headless server and client testing:

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/server/main.ts - Game Server entry point
// ═══════════════════════════════════════════════════════════════════

import { parseArgs } from 'node:util';
import { GameServer } from '../network/server/GameServer';
import { WebSocketServerTransport } from '../network/server/transport/WebSocketServerTransport';

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '7777' },
    map: { type: 'string', short: 'm', default: 'wdm7' },
    name: { type: 'string', short: 'n', default: 'SHAG Game Server' },
    tickrate: { type: 'string', short: 't', default: '20' },
    maxplayers: { type: 'string', default: '16' },
    password: { type: 'string' },
  },
});

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║               SHAG Engine - Dedicated Server                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const transport = new WebSocketServerTransport({
    port: parseInt(args.port!),
  });

  const server = new GameServer({
    transport,
    map: args.map!,
    serverName: args.name!,
    gameMode: 'deathmatch',
    tickRate: parseInt(args.tickrate!),
    maxPlayers: parseInt(args.maxplayers!),
    password: args.password,
  });

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\n[Server] Shutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});
```

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/cli/headless-netclient.ts - Headless Network Client
// ═══════════════════════════════════════════════════════════════════

import { parseArgs } from 'node:util';
import { NetworkClient } from '../network/client/NetworkClient';
import { NodeWebSocketTransport } from '../network/shared/transport/NodeWebSocketTransport';

const { values: args } = parseArgs({
  options: {
    connect: { type: 'string', short: 'c' },
    name: { type: 'string', short: 'n', default: 'Player' },
    password: { type: 'string', short: 'p' },
    duration: { type: 'string', short: 'd', default: '0' }, // 0 = run forever
  },
});

async function main() {
  if (!args.connect) {
    console.error(`
Usage: npm run net:client -- --connect ws://localhost:7777 [options]

Options:
  -c, --connect <url>    Server URL (required)
  -n, --name <name>      Player name (default: Player)
  -p, --password <pass>  Server password
  -d, --duration <sec>   Run duration in seconds (0 = forever)
`);
    process.exit(1);
  }

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║               SHAG Engine - Headless Client                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Use Node.js WebSocket transport (browser client uses different transport)
  const transport = new NodeWebSocketTransport();

  const client = new NetworkClient({
    serverUrl: args.connect,
    playerName: args.name!,
    password: args.password,
    transport,
  });

  // Event handlers for logging
  client.on('gameStart', (tick, players) => {
    console.log(`[Test] Game started with ${players.length} players at tick ${tick}`);
  });

  client.on('playerJoined', (playerId, name) => {
    console.log(`[Test] Player joined: ${name} (${playerId})`);
  });

  client.on('playerLeft', (playerId, reason) => {
    console.log(`[Test] Player left: ${playerId} (${reason})`);
  });

  // Handle shutdown
  const shutdown = () => {
    console.log('\n[Client] Disconnecting...');
    client.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await client.connect();

    // If duration specified, disconnect after that time
    const duration = parseInt(args.duration!);
    if (duration > 0) {
      console.log(`[Test] Will disconnect after ${duration} seconds`);
      setTimeout(() => {
        console.log('[Test] Duration reached, disconnecting...');
        client.disconnect();
        process.exit(0);
      }, duration * 1000);
    }
  } catch (error) {
    console.error('[Client] Failed to connect:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[Client] Fatal error:', error);
  process.exit(1);
});
```

### 15.6 Package Scripts

```json
{
  "scripts": {
    "net:server": "tsx src/server/main.ts",
    "net:client": "tsx src/cli/headless-netclient.ts"
  }
}
```

### 15.7 Testing the MVP

```bash
# Terminal 1: Start server
npm run net:server -- --map wdm7 --port 7777

# Terminal 2: Connect client 1
npm run net:client -- --connect ws://localhost:7777 --name "Player1"

# Terminal 3: Connect client 2
npm run net:client -- --connect ws://localhost:7777 --name "Player2"
```

**Automated test script:**

```bash
#!/bin/bash
# scripts/test-network-mvp.sh - Automated network MVP test

echo "Starting network MVP test..."

# Start server in background
npm run net:server -- --map wdm7 --port 7777 &
SERVER_PID=$!
sleep 2

# Start two clients with 10 second duration
npm run net:client -- -c ws://localhost:7777 -n Player1 -d 10 &
CLIENT1_PID=$!

npm run net:client -- -c ws://localhost:7777 -n Player2 -d 10 &
CLIENT2_PID=$!

# Wait for clients to finish
wait $CLIENT1_PID
wait $CLIENT2_PID

# Stop server
kill $SERVER_PID 2>/dev/null

echo "Test complete!"
```

### 15.8 Acceptance Criteria

| # | Criterion | Validation |
|---|-----------|------------|
| 1 | Server starts and listens on specified port | Server logs "Waiting for connections" |
| 2 | Client connects and receives welcome message | Client logs "Received welcome: map=X" |
| 3 | Client sends join request after "loading map" | Client logs "Map loaded, sending join" |
| 4 | Server accepts client and assigns player ID | Client logs "Joined as player_X" |
| 5 | Client sends ready signal | Client logs "Sent ready signal" |
| 6 | Server starts game when all clients ready | Server logs "All players ready, starting game" |
| 7 | Server sends snapshots at tick rate | Server logs "Tick X: N players" periodically |
| 8 | Clients receive and log snapshots | Client logs "Tick X: N players" periodically |
| 9 | Second client sees first client in snapshot | Snapshot contains 2 players |
| 10 | Client disconnect is handled gracefully | Other client receives "player_left" message |

### 15.9 MVP Success Metrics

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MVP SUCCESS DEFINITION                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ✅ PASS if:                                                        │
│     1. Two clients can connect to server                            │
│     2. Both clients receive same map name                           │
│     3. Both clients appear in each other's snapshots                │
│     4. Tick rate is consistent (~20 Hz)                             │
│     5. Disconnect is handled without crashing                       │
│                                                                      │
│  ❌ FAIL if:                                                        │
│     - Connection fails or times out                                 │
│     - Clients receive different game settings                       │
│     - Snapshots don't include all players                          │
│     - Server crashes on client disconnect                           │
│     - Memory leaks over extended runtime                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 15.10 After MVP: Next Steps

The MVP validates the core networking stack with production code. Next phases add game functionality:

**Phase 1: Server-Side Game Loop**
1. **Map Loading** - Load BSP collision data on server for spawn points
2. **Entity System** - Server-side entity spawning and lifecycle
3. **Physics Simulation** - Apply player input to physics (Q3-style movement)
4. **Delta Compression** - Only send changes from last acknowledged snapshot

**Phase 2: Client-Side Integration**
1. **Visual Client** - Integrate NetworkClient with GameScene
2. **Map Synchronization** - Client loads map specified by server
3. **Entity Rendering** - Render networked entities from snapshots
4. **Prediction** - Client-side input prediction with server reconciliation

**Phase 3: Advanced Networking**
1. **WebTransport** - Add WebTransportTransport for lower latency
2. **Interpolation** - Smooth rendering between snapshots (100ms buffer)
3. **Lag Compensation** - Server-side backwards reconciliation for hit detection
4. **Bandwidth Management** - Priority-based entity updates, PVS culling

**Phase 4: Production Features**
1. **Reconnection** - Handle disconnects gracefully, rejoin in progress
2. **Matchmaking** - Room-based lobby system
3. **Server Browser** - Query and list available servers
4. **Anti-Cheat** - Server-authoritative validation

---

## 16. Implementation Roadmap

### Phase 0: MVP (Production Network Stack)

Core networking with production code, minimal game features:

- [ ] Create `src/network/` directory structure (shared, client, server)
- [ ] Implement `src/network/shared/types.ts` - Core type aliases
- [ ] Implement `src/network/shared/protocol/Messages.ts` - MessageType enum
- [ ] Implement `src/network/shared/protocol/StateEncoder.ts` - Binary encoding
- [ ] Implement `src/network/shared/protocol/StateDecoder.ts` - Binary decoding
- [ ] Implement `src/network/shared/protocol/MessageCodec.ts` - Encode/decode wrapper
- [ ] Implement `src/network/shared/transport/ITransport.ts` - Transport interface
- [ ] Implement `src/network/shared/transport/WebSocketTransport.ts` - Browser WebSocket
- [ ] Implement `src/network/shared/transport/NodeWebSocketTransport.ts` - Node.js WebSocket
- [ ] Implement `src/network/server/GameServer.ts` - Server with tick loop
- [ ] Implement `src/network/server/transport/WebSocketServerTransport.ts` - Server transport
- [ ] Implement `src/network/client/NetworkClient.ts` - Client state machine
- [ ] Implement `src/server/main.ts` - Server CLI entry point
- [ ] Implement `src/cli/headless-netclient.ts` - Headless client CLI
- [ ] Add npm scripts: `net:server`, `net:client`
- [ ] **Validation:** Two clients connect, receive same map, see each other in snapshots

### Phase 1: Server-Side Game Loop

Add server-authoritative game simulation:

- [ ] Implement `src/network/server/ServerEntity.ts` - Server-side entity
- [ ] Implement `src/network/server/ServerWorld.ts` - Entity container
- [ ] Load BSP collision data for spawn points
- [ ] Apply player input to physics (Q3-style movement on server)
- [ ] Implement delta compression (only send changes)
- [ ] Add `InputBuffer` for command buffering
- [ ] **Validation:** Player movement works, server is authoritative

### Phase 2: Client-Side Integration

Connect NetworkClient to Babylon.js renderer:

- [ ] Create `NetworkedGameScene` extending `GameScene`
- [ ] Integrate `NetworkClient` events with scene lifecycle
- [ ] Load map specified by server welcome message
- [ ] Render player entities from snapshots
- [ ] Implement `InterpolationBuffer` for smooth entity rendering
- [ ] **Validation:** Visual client connects and renders other players

### Phase 3: Client Prediction

Add client-side prediction for responsive controls:

- [ ] Implement `PredictionBuffer` - Store predicted states
- [ ] Apply input locally before sending to server
- [ ] Reconcile predictions with server snapshots
- [ ] Handle misprediction (rollback and replay)
- [ ] Tune prediction parameters for feel
- [ ] **Validation:** Movement feels instant, no visible corrections

### Phase 4: Advanced Networking

Optimize for production:

- [ ] Implement `WebTransportTransport` for lower latency
- [ ] Add transport fallback (WebTransport → WebSocket)
- [ ] Implement server-side lag compensation
- [ ] Add bandwidth management (priority updates, PVS culling)
- [ ] Implement NAT traversal for direct connection attempts
- [ ] **Validation:** Good experience at 100ms+ latency

### Phase 5: Game Features

Game-specific networking:

- [ ] Implement game events (sounds, effects, projectiles)
- [ ] Implement chat system with reliable delivery
- [ ] Implement scoreboard / player list synchronization
- [ ] Implement game mode logic (deathmatch scoring)
- [ ] Add kill feed / event notifications
- [ ] **Validation:** Full game loop works in multiplayer

### Phase 6: Production Polish

Ready for deployment:

- [ ] Add reconnection handling (rejoin in-progress game)
- [ ] Add server browser / lobby UI
- [ ] Implement matchmaking (room-based)
- [ ] Add spectator mode
- [ ] Performance profiling and optimization
- [ ] Stress testing (16+ clients)
- [ ] Security review (anti-cheat basics)
- [ ] Documentation for server operators

---

## 17. Security & Robustness

This section addresses security, stability, and gameplay feel. Items are prioritized by when they're needed.

### 17.1 Priority Levels

| Priority | When | Focus |
|----------|------|-------|
| **P0 - MVP** | Before first playtest | Game-breaking issues |
| **P1 - Demo** | Before public demo | Security basics, good feel |
| **P2 - Production** | Before release | Full security, anti-cheat |

---

### 17.2 Input Validation (P0 - MVP) ⚠️ CRITICAL

All client input must be validated server-side. Never trust client data.

#### 17.2.1 Numeric Bounds

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/server/InputValidator.ts
// ═══════════════════════════════════════════════════════════════════

export class InputValidator {
  // Movement input bounds
  static readonly MAX_MOVEMENT = 1.0;
  static readonly MIN_MOVEMENT = -1.0;

  // Rotation bounds (radians)
  static readonly MAX_PITCH = Math.PI / 2;   // 90 degrees
  static readonly MIN_PITCH = -Math.PI / 2;
  static readonly MAX_YAW = Math.PI * 2;     // Full rotation

  // Sequence bounds
  static readonly MAX_SEQ_JUMP = 100;  // Max commands ahead of last acked

  /**
   * Validate and sanitize input command
   * Returns null if input is invalid (should be dropped)
   */
  static validate(input: InputMessage, client: ClientConnection): InputMessage | null {
    // 1. Check sequence number is reasonable
    const seqDelta = input.seq - client.lastInputSeq;
    if (seqDelta < 0 || seqDelta > this.MAX_SEQ_JUMP) {
      console.warn(`[Validator] Invalid seq: ${input.seq} (last: ${client.lastInputSeq})`);
      return null;
    }

    // 2. Clamp movement to valid range
    const keys = input.keys;
    // Movement keys are bitmask, validate individual values when extracted

    // 3. Clamp rotation to valid range
    const pitch = Math.max(this.MIN_PITCH, Math.min(this.MAX_PITCH, input.pitch));
    const yaw = ((input.yaw % this.MAX_YAW) + this.MAX_YAW) % this.MAX_YAW;  // Wrap to [0, 2π]

    // 4. Validate buttons (bitmask, check for impossible combinations)
    const buttons = input.buttons & 0xFF;  // Only allow first 8 bits

    // 5. Return sanitized input
    return {
      ...input,
      pitch,
      yaw,
      buttons,
    };
  }

  /**
   * Validate position from client (for debugging/spectator)
   * Server NEVER trusts client position for gameplay
   */
  static validatePosition(pos: { x: number; y: number; z: number }): boolean {
    // Check for NaN/Infinity
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      return false;
    }

    // Check reasonable bounds (map-dependent, use conservative default)
    const MAX_COORD = 10000;
    if (Math.abs(pos.x) > MAX_COORD || Math.abs(pos.y) > MAX_COORD || Math.abs(pos.z) > MAX_COORD) {
      return false;
    }

    return true;
  }
}
```

#### 17.2.2 Server Integration

```typescript
// In GameServer.handleInput():
private handleInput(client: ClientConnection, message: InputMessage): void {
  // CRITICAL: Validate before processing
  const validated = InputValidator.validate(message, client);
  if (!validated) {
    console.warn(`[Server] Dropped invalid input from ${client.clientId}`);
    client.invalidInputCount++;

    // Kick after too many invalid inputs
    if (client.invalidInputCount > 100) {
      this.kickClient(client, 'Too many invalid inputs');
    }
    return;
  }

  // Update last seen sequence
  client.lastInputSeq = validated.seq;

  // Process validated input
  this.processInput(client, validated);
}
```

---

### 17.3 Rate Limiting (P0 - MVP) ⚠️ CRITICAL

Prevent clients from flooding the server with messages.

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/server/RateLimiter.ts
// ═══════════════════════════════════════════════════════════════════

export class RateLimiter {
  // Limits per client
  static readonly MAX_MESSAGES_PER_SECOND = 60;    // ~3x tick rate
  static readonly MAX_BYTES_PER_SECOND = 16384;    // 16 KB/s
  static readonly MAX_COMMANDS_PER_TICK = 2;       // Allow some buffering

  private messageCount = 0;
  private byteCount = 0;
  private commandsThisTick = 0;
  private lastReset = Date.now();

  /**
   * Check if message should be allowed
   * Returns false if rate limit exceeded
   */
  checkMessage(sizeBytes: number): boolean {
    const now = Date.now();

    // Reset counters every second
    if (now - this.lastReset >= 1000) {
      this.messageCount = 0;
      this.byteCount = 0;
      this.lastReset = now;
    }

    // Check limits
    if (this.messageCount >= RateLimiter.MAX_MESSAGES_PER_SECOND) {
      return false;
    }
    if (this.byteCount + sizeBytes > RateLimiter.MAX_BYTES_PER_SECOND) {
      return false;
    }

    // Update counters
    this.messageCount++;
    this.byteCount += sizeBytes;
    return true;
  }

  /**
   * Check command rate (called per tick)
   */
  checkCommand(): boolean {
    if (this.commandsThisTick >= RateLimiter.MAX_COMMANDS_PER_TICK) {
      return false;
    }
    this.commandsThisTick++;
    return true;
  }

  /**
   * Reset per-tick counters (called at start of each server tick)
   */
  resetTick(): void {
    this.commandsThisTick = 0;
  }
}

// Add to ClientConnection:
export interface ClientConnection {
  // ... existing fields ...
  rateLimiter: RateLimiter;
  invalidInputCount: number;
}
```

---

### 17.4 Message Size Limits (P0 - MVP) ⚠️ CRITICAL

Prevent memory exhaustion attacks via oversized messages.

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/protocol/StateDecoder.ts - Add size limits
// ═══════════════════════════════════════════════════════════════════

export class StateDecoder {
  private static readonly MAX_MESSAGE_SIZE = 65536;     // 64 KB max message
  private static readonly MAX_STRING_LENGTH = 1024;      // 1 KB max string
  private static readonly MAX_ARRAY_LENGTH = 1000;       // Max array elements
  private static readonly MAX_PLAYERS = 64;              // Max players in snapshot

  private buffer: Uint8Array;
  private offset = 0;

  constructor(data: Uint8Array) {
    // CRITICAL: Check total message size first
    if (data.length > StateDecoder.MAX_MESSAGE_SIZE) {
      throw new Error(`Message too large: ${data.length} > ${StateDecoder.MAX_MESSAGE_SIZE}`);
    }
    this.buffer = data;
  }

  readString(): string {
    const length = this.readUint16();  // Use uint16, not uint32

    // Validate length
    if (length > StateDecoder.MAX_STRING_LENGTH) {
      throw new Error(`String too long: ${length} > ${StateDecoder.MAX_STRING_LENGTH}`);
    }
    if (this.offset + length > this.buffer.length) {
      throw new Error('String extends beyond buffer');
    }

    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readBytes(): Uint8Array {
    const length = this.readUint32();

    // Validate length
    if (length > StateDecoder.MAX_MESSAGE_SIZE) {
      throw new Error(`Bytes too long: ${length}`);
    }
    if (this.offset + length > this.buffer.length) {
      throw new Error('Bytes extend beyond buffer');
    }

    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readPlayerArray(): PlayerSnapshot[] {
    const count = this.readUint8();

    // Validate count
    if (count > StateDecoder.MAX_PLAYERS) {
      throw new Error(`Too many players: ${count}`);
    }

    const players: PlayerSnapshot[] = [];
    for (let i = 0; i < count; i++) {
      players.push(this.readPlayer());
    }
    return players;
  }
}
```

---

### 17.5 Smooth Correction (P0 - MVP) ⚠️ CRITICAL

When client prediction doesn't match server state, corrections must be smooth to avoid jarring "teleportation" effects. This is critical for FPS gameplay feel.

#### 17.5.1 The Problem with Snap Correction

```
Without smoothing:

Client predicts: ████████████████████▶ (position 100)
Server says:     ████████████████▶      (position 80)
                                  ↑
                            SNAP! Player teleports back 20 units

This feels terrible in FPS games.
```

#### 17.5.2 Smooth Correction Implementation

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/client/SmoothCorrection.ts
// ═══════════════════════════════════════════════════════════════════

export interface CorrectionState {
  active: boolean;
  startTime: number;
  duration: number;           // How long to smooth over (ms)
  sourcePosition: Vector3;    // Where we were (wrong)
  targetPosition: Vector3;    // Where we should be (server)
  sourceRotation: Vector2;    // pitch, yaw
  targetRotation: Vector2;
}

export class SmoothCorrection {
  // Correction duration scales with error magnitude
  private static readonly MIN_DURATION = 50;   // 50ms minimum
  private static readonly MAX_DURATION = 200;  // 200ms maximum
  private static readonly UNITS_PER_MS = 0.5;  // 1 unit error = 2ms correction time

  // Threshold below which we don't bother correcting
  private static readonly POSITION_THRESHOLD = 0.01;  // 1 cm
  private static readonly ROTATION_THRESHOLD = 0.01;  // ~0.5 degrees

  private correction: CorrectionState = {
    active: false,
    startTime: 0,
    duration: 0,
    sourcePosition: { x: 0, y: 0, z: 0 },
    targetPosition: { x: 0, y: 0, z: 0 },
    sourceRotation: { x: 0, y: 0 },
    targetRotation: { x: 0, y: 0 },
  };

  /**
   * Start a smooth correction from predicted to server state
   */
  startCorrection(
    predicted: { position: Vector3; rotation: Vector2 },
    server: { position: Vector3; rotation: Vector2 }
  ): void {
    // Calculate position error
    const dx = server.position.x - predicted.position.x;
    const dy = server.position.y - predicted.position.y;
    const dz = server.position.z - predicted.position.z;
    const positionError = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Skip tiny corrections
    if (positionError < SmoothCorrection.POSITION_THRESHOLD) {
      return;
    }

    // Calculate duration based on error magnitude
    // Larger errors = longer smoothing to avoid jarring motion
    const duration = Math.min(
      SmoothCorrection.MAX_DURATION,
      Math.max(
        SmoothCorrection.MIN_DURATION,
        positionError / SmoothCorrection.UNITS_PER_MS
      )
    );

    this.correction = {
      active: true,
      startTime: performance.now(),
      duration,
      sourcePosition: { ...predicted.position },
      targetPosition: { ...server.position },
      sourceRotation: { ...predicted.rotation },
      targetRotation: { ...server.rotation },
    };

    console.log(`[Correction] Error: ${positionError.toFixed(2)} units, duration: ${duration.toFixed(0)}ms`);
  }

  /**
   * Apply correction offset to rendered position
   * Call this every frame during rendering
   */
  apply(currentPosition: Vector3, currentRotation: Vector2): { position: Vector3; rotation: Vector2 } {
    if (!this.correction.active) {
      return { position: currentPosition, rotation: currentRotation };
    }

    const elapsed = performance.now() - this.correction.startTime;
    const t = Math.min(1, elapsed / this.correction.duration);

    // Use smoothstep for natural feel (slow at start and end)
    const smoothT = t * t * (3 - 2 * t);

    // Calculate remaining offset (decreases over time)
    const remainingFactor = 1 - smoothT;

    // The offset is the difference between where we were and where we should be
    // We subtract this offset (scaled by remaining factor) from current position
    const offsetX = (this.correction.sourcePosition.x - this.correction.targetPosition.x) * remainingFactor;
    const offsetY = (this.correction.sourcePosition.y - this.correction.targetPosition.y) * remainingFactor;
    const offsetZ = (this.correction.sourcePosition.z - this.correction.targetPosition.z) * remainingFactor;

    // Apply offset to current position
    const correctedPosition = {
      x: currentPosition.x - offsetX,
      y: currentPosition.y - offsetY,
      z: currentPosition.z - offsetZ,
    };

    // Smoothly correct rotation using shortest path
    const correctedRotation = {
      x: this.lerpAngle(
        this.correction.sourceRotation.x,
        currentRotation.x,
        smoothT
      ),
      y: this.lerpAngle(
        this.correction.sourceRotation.y,
        currentRotation.y,
        smoothT
      ),
    };

    // End correction when complete
    if (t >= 1) {
      this.correction.active = false;
    }

    return { position: correctedPosition, rotation: correctedRotation };
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  isActive(): boolean {
    return this.correction.active;
  }
}
```

#### 17.5.3 Integration with NetworkClient

```typescript
// In NetworkClient, update reconciliation to use smooth correction:

class NetworkClient {
  private smoothCorrection = new SmoothCorrection();

  private reconcile(serverSnapshot: Snapshot): void {
    const localPlayerId = this.playerId;
    if (!localPlayerId) return;

    const serverPlayer = serverSnapshot.players.find(p => p.playerId === localPlayerId);
    if (!serverPlayer) return;

    // Get our predicted position BEFORE reconciliation
    const predictedPosition = { ...this.localPlayerPosition };
    const predictedRotation = { ...this.localPlayerRotation };

    // Remove acknowledged commands
    const ack = serverSnapshot.lastAckedSeq;
    this.commandHistory = this.commandHistory.filter(cmd => cmd.seq > ack);

    // Reset to server state
    this.localPlayerPosition = { ...serverPlayer.position };
    this.localPlayerRotation = { ...serverPlayer.rotation };

    // Re-apply unacknowledged commands
    for (const cmd of this.commandHistory) {
      this.applyInputLocally(cmd);
    }

    // Start smooth correction if there's a misprediction
    this.smoothCorrection.startCorrection(
      { position: predictedPosition, rotation: predictedRotation },
      { position: this.localPlayerPosition, rotation: this.localPlayerRotation }
    );
  }

  /**
   * Get position for rendering (includes correction smoothing)
   */
  getRenderedPosition(): { position: Vector3; rotation: Vector2 } {
    return this.smoothCorrection.apply(
      this.localPlayerPosition,
      this.localPlayerRotation
    );
  }
}
```

#### 17.5.4 Visual Result

```
With smooth correction:

Client predicts:  ████████████████████▶ (position 100)
Server says:      ████████████████▶      (position 80)

Frame 1: Render at 98    (smoothing...)
Frame 2: Render at 94    (smoothing...)
Frame 3: Render at 88    (smoothing...)
Frame 4: Render at 82    (smoothing...)
Frame 5: Render at 80    ✓ Correction complete, no visible pop

Player experiences smooth motion instead of teleportation.
```

---

### 17.6 Reliable vs Unreliable Channels (P1 - Demo)

Specify which messages need guaranteed delivery vs can be dropped.

```typescript
// ═══════════════════════════════════════════════════════════════════
// Message Reliability Specification
// ═══════════════════════════════════════════════════════════════════

export enum Reliability {
  /** Must arrive, in order. Use for state-changing messages. */
  Reliable = 'reliable',

  /** Can be dropped if newer data available. Use for frequent updates. */
  Unreliable = 'unreliable',
}

export const MESSAGE_RELIABILITY: Record<MessageType, Reliability> = {
  // ─────────────────────────────────────────────────────────────────
  // Server → Client
  // ─────────────────────────────────────────────────────────────────

  [MessageType.Welcome]: Reliability.Reliable,      // Must know game settings
  [MessageType.JoinAccept]: Reliability.Reliable,   // Must know we're in
  [MessageType.JoinReject]: Reliability.Reliable,   // Must know we're rejected
  [MessageType.GameStart]: Reliability.Reliable,    // Must know game started
  [MessageType.PlayerJoined]: Reliability.Reliable, // UI needs this
  [MessageType.PlayerLeft]: Reliability.Reliable,   // UI needs this
  [MessageType.Snapshot]: Reliability.Unreliable,   // Newer snapshots replace old
  [MessageType.Chat]: Reliability.Reliable,         // Players expect chat to arrive
  [MessageType.Error]: Reliability.Reliable,        // Must know about errors

  // ─────────────────────────────────────────────────────────────────
  // Client → Server
  // ─────────────────────────────────────────────────────────────────

  [MessageType.Join]: Reliability.Reliable,         // Must join successfully
  [MessageType.Ready]: Reliability.Reliable,        // Server needs to know
  [MessageType.Input]: Reliability.Unreliable,      // Newer inputs replace old
  [MessageType.Disconnect]: Reliability.Reliable,   // Clean disconnect
  [MessageType.Chat]: Reliability.Reliable,         // Player expects message sent
};

// Transport usage:
class NetworkClient {
  private send(type: MessageType, payload: any): void {
    const data = MessageCodec.encode(type, payload);
    const reliable = MESSAGE_RELIABILITY[type] === Reliability.Reliable;

    if (this.transport.supportsReliability) {
      // WebTransport: use streams (reliable) or datagrams (unreliable)
      this.transport.send(data, { reliable });
    } else {
      // WebSocket: always reliable (TCP)
      this.transport.send(data);
    }
  }
}
```

---

### 17.7 Error Message Types (P1 - Demo)

Define server error responses for client handling.

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/protocol/Messages.ts - Add error types
// ═══════════════════════════════════════════════════════════════════

export enum MessageType {
  // ... existing types ...

  // Server → Client: Errors
  Error = 0x0F,
}

export enum ErrorCode {
  // Connection errors
  VersionMismatch = 'version_mismatch',
  ServerFull = 'server_full',
  Banned = 'banned',
  InvalidPassword = 'invalid_password',

  // Runtime errors
  InvalidMessage = 'invalid_message',
  RateLimited = 'rate_limited',
  InvalidInput = 'invalid_input',
  Timeout = 'timeout',

  // Game errors
  NotInGame = 'not_in_game',
  InvalidAction = 'invalid_action',

  // Server errors
  InternalError = 'internal_error',
  ServerShuttingDown = 'server_shutting_down',
}

export interface ErrorMessage {
  type: MessageType.Error;
  code: ErrorCode;
  message: string;
  fatal: boolean;  // If true, client should disconnect
  details?: Record<string, unknown>;  // Additional context
}

// Server sends errors:
class GameServer {
  private sendError(
    client: ClientConnection,
    code: ErrorCode,
    message: string,
    fatal: boolean = false
  ): void {
    this.sendToClient(client, MessageType.Error, {
      code,
      message,
      fatal,
    });

    if (fatal) {
      // Give client time to receive error before disconnecting
      setTimeout(() => {
        this.disconnectClient(client, code);
      }, 100);
    }
  }
}

// Client handles errors:
class NetworkClient {
  private handleError(payload: ErrorMessage): void {
    console.error(`[NetworkClient] Error: ${payload.code} - ${payload.message}`);

    this.emit('error', {
      code: payload.code,
      message: payload.message,
      fatal: payload.fatal,
    });

    if (payload.fatal) {
      this.state = ClientState.Disconnected;
      // Don't try to reconnect for fatal errors
      this.cleanup();
    }
  }
}
```

---

### 17.8 Reconnection Protocol (P1 - Demo)

Handle disconnects gracefully with automatic reconnection.

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/client/ReconnectionManager.ts
// ═══════════════════════════════════════════════════════════════════

export interface ReconnectionConfig {
  maxAttempts: number;        // Max reconnection attempts
  initialDelay: number;       // First retry delay (ms)
  maxDelay: number;           // Maximum retry delay (ms)
  backoffMultiplier: number;  // Delay multiplier per attempt
}

const DEFAULT_CONFIG: ReconnectionConfig = {
  maxAttempts: 5,
  initialDelay: 1000,      // 1 second
  maxDelay: 30000,         // 30 seconds
  backoffMultiplier: 2,
};

export class ReconnectionManager {
  private config: ReconnectionConfig;
  private attempts = 0;
  private currentDelay: number;
  private reconnecting = false;
  private sessionToken: string | null = null;  // For session resumption

  constructor(config: Partial<ReconnectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentDelay = this.config.initialDelay;
  }

  /**
   * Store session info for reconnection
   */
  setSession(clientId: string, playerId: string): void {
    this.sessionToken = `${clientId}:${playerId}`;
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  async attemptReconnect(
    connect: () => Promise<void>,
    onSuccess: () => void,
    onFailure: (reason: string) => void
  ): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    while (this.attempts < this.config.maxAttempts) {
      this.attempts++;

      console.log(`[Reconnect] Attempt ${this.attempts}/${this.config.maxAttempts} in ${this.currentDelay}ms...`);

      await this.sleep(this.currentDelay);

      try {
        await connect();

        // Success!
        console.log('[Reconnect] Connected!');
        this.reset();
        onSuccess();
        return;

      } catch (error) {
        console.warn(`[Reconnect] Attempt ${this.attempts} failed:`, error);

        // Increase delay with exponential backoff
        this.currentDelay = Math.min(
          this.currentDelay * this.config.backoffMultiplier,
          this.config.maxDelay
        );
      }
    }

    // All attempts exhausted
    this.reconnecting = false;
    onFailure(`Failed after ${this.config.maxAttempts} attempts`);
  }

  /**
   * Reset for new connection
   */
  reset(): void {
    this.attempts = 0;
    this.currentDelay = this.config.initialDelay;
    this.reconnecting = false;
  }

  /**
   * Cancel ongoing reconnection
   */
  cancel(): void {
    this.reconnecting = false;
  }

  /**
   * Get session token for resumption
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Integration with NetworkClient:
class NetworkClient {
  private reconnectionManager = new ReconnectionManager();

  private onDisconnect(reason: string): void {
    console.log(`[NetworkClient] Disconnected: ${reason}`);

    // Don't reconnect for intentional disconnects or fatal errors
    if (reason === 'user_disconnect' || reason.startsWith('fatal:')) {
      this.cleanup();
      this.emit('disconnected', reason);
      return;
    }

    // Attempt reconnection
    this.emit('reconnecting');

    this.reconnectionManager.attemptReconnect(
      () => this.transport.connect(this.config.serverUrl),
      () => {
        // Reconnected - try to resume session
        this.resumeSession();
      },
      (failReason) => {
        this.cleanup();
        this.emit('disconnected', `Reconnection failed: ${failReason}`);
      }
    );
  }

  private resumeSession(): void {
    const token = this.reconnectionManager.getSessionToken();
    if (token) {
      // Send resume request instead of new join
      this.send(MessageType.ResumeSession, { token });
    } else {
      // No session to resume, full rejoin
      // Will get new Welcome and need to rejoin
    }
  }
}
```

---

### 17.9 Authentication (P2 - Production)

> **Note:** Authentication is not required for demos or playtests, but should be implemented before public release.

#### 17.9.1 Token-Based Authentication

```typescript
// ═══════════════════════════════════════════════════════════════════
// src/network/shared/protocol/Messages.ts - Add auth messages
// ═══════════════════════════════════════════════════════════════════

export enum MessageType {
  // ... existing types ...

  // Authentication (P2 - Production)
  Authenticate = 0x90,       // Client → Server
  AuthSuccess = 0x91,        // Server → Client
  AuthFailure = 0x92,        // Server → Client
}

// Flow:
// 1. Client connects
// 2. Server sends Welcome (with requiresAuth flag)
// 3. Client sends Authenticate with token
// 4. Server validates token, sends AuthSuccess or AuthFailure
// 5. Only after AuthSuccess can client send Join

export interface AuthenticateMessage {
  type: MessageType.Authenticate;
  token: string;              // JWT or session token
  clientVersion: string;      // For compatibility check
}

export interface AuthSuccessMessage {
  type: MessageType.AuthSuccess;
  accountId: string;          // Persistent account ID
  displayName: string;        // Player's chosen name
  permissions: string[];      // ['play', 'chat', 'admin']
}
```

#### 17.9.2 Future: OAuth Integration

```typescript
// Production implementation would integrate with:
// - Steam authentication
// - Discord OAuth
// - Custom account system
// - Guest tokens (time-limited, for demos)

// This is out of scope for MVP/demo phases.
```

---

### 17.10 Anti-Cheat Foundation (P2 - Production)

> **Note:** Full anti-cheat is complex. This section outlines the foundation for production.

#### 17.10.1 Server-Side Validation (Always)

The server is authoritative. It should validate:

```typescript
// Movement validation
class MovementValidator {
  // Maximum units per tick based on speed
  private readonly MAX_SPEED = 10;  // units per tick

  validateMovement(
    oldPos: Vector3,
    newPos: Vector3,
    deltaTime: number
  ): Vector3 {
    const distance = this.distance(oldPos, newPos);
    const maxDistance = this.MAX_SPEED * deltaTime;

    if (distance > maxDistance * 1.1) {  // 10% tolerance for float errors
      console.warn(`[AntiCheat] Speed violation: ${distance} > ${maxDistance}`);
      // Clamp to max distance
      const direction = this.normalize(this.subtract(newPos, oldPos));
      return this.add(oldPos, this.scale(direction, maxDistance));
    }

    return newPos;
  }
}

// Damage validation
class DamageValidator {
  validateDamage(
    attacker: Player,
    target: Player,
    damage: number,
    weapon: Weapon
  ): number {
    // Check weapon is equipped
    if (!attacker.hasWeapon(weapon.id)) {
      console.warn('[AntiCheat] Weapon not equipped');
      return 0;
    }

    // Check weapon damage range
    if (damage > weapon.maxDamage) {
      console.warn('[AntiCheat] Damage exceeds weapon max');
      return weapon.maxDamage;
    }

    // Check distance
    const distance = this.distance(attacker.position, target.position);
    if (distance > weapon.range) {
      console.warn('[AntiCheat] Target out of range');
      return 0;
    }

    // Check line of sight (requires collision system)
    if (!this.hasLineOfSight(attacker.position, target.position)) {
      console.warn('[AntiCheat] No line of sight');
      return 0;
    }

    return damage;
  }
}
```

#### 17.10.2 Anomaly Detection (Future)

```typescript
// Track suspicious patterns over time
interface PlayerMetrics {
  headshots: number;
  totalShots: number;
  averageReactionTime: number;
  impossibleAngles: number;      // Aim changes > physically possible
  positionAnomalies: number;     // Speed violations
}

// Flag for review when metrics are suspicious
// Actual implementation is complex and game-specific
```

---

### 17.11 Security Checklist

#### MVP (Before First Playtest)

- [ ] Input validation with numeric bounds
- [ ] Rate limiting (messages per second, commands per tick)
- [ ] Message size limits (64KB max)
- [ ] Smooth correction (no snap teleportation)
- [ ] Server authoritative movement

#### Demo (Before Public Demo)

- [ ] Reliable vs unreliable channel specification
- [ ] Error message types and handling
- [ ] Reconnection with exponential backoff
- [ ] Client version checking
- [ ] Basic kick/ban functionality

#### Production (Before Release)

- [ ] Token-based authentication
- [ ] Account system integration
- [ ] Movement speed validation
- [ ] Damage validation
- [ ] Line of sight checks
- [ ] Admin/RCON commands
- [ ] Logging and telemetry
- [ ] Anomaly detection foundation

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
