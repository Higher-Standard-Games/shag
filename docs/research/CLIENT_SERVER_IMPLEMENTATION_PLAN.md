# Client/Server Architecture Implementation Plan

**Branch:** `feature/client-server-architecture`
**Date:** 2026-01-27
**Status:** Milestone 2.1 Complete - Movement Debug Complete

> **Latest Update (2026-01-27):**
> - ✅ Fixed direction calculation (Babylon left-handed coordinates)
> - ✅ Fixed tick rate (LocalGameHost fixed timestep accumulator)
> - ✅ Ported 3-mode air acceleration (strafe jumping works!)
> - ⏸️ Remaining: wall jump grab, crouchslide effect, bobbing, jitter, ledge grab

---

## Debugging Learnings (2026-01-27)

### Bug 1: Direction Inverted (Forward = Backward)

**Symptom:** Moving forward caused backward movement, strafe was mirrored.

**Root Cause:** Direction calculation in `FPSGameManager.sendInput()` used right-handed rotation math, but Babylon.js uses left-handed coordinates.

**Fix:** Changed yaw rotation to match Babylon's conventions:
```typescript
// Babylon left-handed: forward = (sin(yaw), 0, cos(yaw))
const forwardX = Math.sin(input.yaw);
const forwardZ = Math.cos(input.yaw);
```

### Bug 2: Ultra-Fast Movement

**Symptom:** Movement speed was 2-4x faster than local mode.

**Root Cause:** `LocalGameHost.sendCommand()` ran `simulation.tick()` on every call. At 120fps render rate with 60Hz tick, this doubled movement speed.

**Fix:** Added fixed timestep accumulator - commands are queued and ticks only run when `timeAccumulator >= tickDuration`.

### Bug 3: Strafe Jumping Didn't Work

**Symptom:** No speed gain from strafe jumping, couldn't build momentum.

**Root Cause:** Network `airAccelerate` was simple Q3-style, missing the mode selection logic from local code.

**Fix:** Ported 3-mode air acceleration:
| Mode | Condition | Method |
|------|-----------|--------|
| 1 | W only + accelerating | `airAccelerateForward` (Warsow-style) |
| 2 | A/D only | `strafeBunnyAccelerate` (CPMA strafe jumping) |
| 3 | Default | `normalAirAccelerate` (Q3) |

### Remaining Issues
- Wall jumping bounces instantly (no grab state)
- Crouchslide client effect missing
- Walking/sprinting bobbing animation missing
- Movement jitter (needs client prediction)
- Ledge grabbing not working

---

## Executive Summary

This document plans the implementation of **generic, reusable simulation systems** for SHAG Engine, with the FPS game as the first integration. The networking infrastructure (transport, protocol, prediction) is already largely complete - what remains is creating:

1. **Generic Engine Systems** - MovementSystem, ProjectileSystem, DamageSystem, SpawnSystem (reusable for any game)
2. **Game-Specific Implementations** - FPSSimulation, Q3MovementProfile, BSPCollisionWorld
3. **Integration** - Wire FPSPlayer to use NetworkManager

### Architecture Philosophy

```
┌──────────────────────────────────────────────────────────┐
│  GAME LAYER: FPS, Hack'n'Slash, Racing, etc.             │
│    - Game-specific components and systems                │
│    - Implements engine interfaces (MovementProfile, etc.)│
├──────────────────────────────────────────────────────────┤
│  ENGINE LAYER: Generic, reusable systems                 │
│    - MovementSystem, ProjectileSystem, DamageSystem      │
│    - Defines interfaces: MovementProfile, CollisionWorld │
├──────────────────────────────────────────────────────────┤
│  NETWORK LAYER: Already complete                         │
│    - Transport, Protocol, Prediction, Interpolation      │
└──────────────────────────────────────────────────────────┘
```

This approach ensures the systems we build are **reusable for any game type** - not just FPS.

---

## Current State Analysis

### What Already Exists (Networking Framework)

The engine already has a comprehensive client/server networking system:

```
src/engine/network/
├── client/
│   ├── hosts/
│   │   ├── LocalGameHost.ts       ✅ In-process simulation (single player)
│   │   └── NetworkGameHost.ts     ✅ Remote server client with prediction
│   └── transport/
│       ├── Transport.ts           ✅ Abstract transport interface
│       ├── WebSocketTransport.ts  ✅ WebSocket implementation
│       └── WebTransportTransport.ts ✅ WebTransport (UDP-like) implementation
├── core/
│   ├── Command.ts                 ✅ MoveCommand with direction, angles, buttons
│   ├── Component.ts               ✅ Serializable component interface
│   ├── Entity.ts                  ✅ ECS entity with components
│   ├── GameState.ts               ✅ State with entities, players, events
│   ├── IGameHost.ts               ✅ Game host interface
│   └── Simulation.ts              ✅ Base simulation class with tick()
├── protocol/
│   ├── BinaryProtocol.ts          ✅ Binary encoder/decoder
│   ├── MessageCodec.ts            ✅ Message types (Snapshot, Input, Join, etc.)
│   ├── StateEncoder.ts            ✅ State serialization
│   └── StateDecoder.ts            ✅ State deserialization
├── server/
│   ├── GameServer.ts              ✅ Multi-room server
│   ├── Room.ts                    ✅ Game room with tick loop
│   ├── WebSocketServer.ts         ✅ WebSocket server
│   └── TestServer.ts              ✅ Test server implementation
├── NetworkManager.ts              ✅ Unified client interface
└── NetworkServices.ts             ✅ Service locator integration
```

#### Existing Features

| Feature | Status | Location |
|---------|--------|----------|
| **Transport Layer** | ✅ Done | WebTransport + WebSocket with auto-fallback |
| **Binary Protocol** | ✅ Done | MessageCodec, BinaryProtocol |
| **Game State** | ✅ Done | GameState with entities, players, events |
| **Entity/Component** | ✅ Done | Serializable ECS system |
| **Commands** | ✅ Done | MoveCommand with direction, angles, buttons |
| **Simulation Base** | ✅ Done | Abstract Simulation with tick(), systems |
| **LocalGameHost** | ✅ Done | Single-player in-process simulation |
| **NetworkGameHost** | ✅ Done | Client prediction, interpolation, smooth correction |
| **GameServer** | ✅ Done | Multi-room server management |
| **Room** | ✅ Done | Per-match simulation with tick loop |
| **Handshake Protocol** | ✅ Done | Welcome → Join → JoinAccept → Snapshot |

### What Needs to Be Done (FPS Integration)

The networking framework exists but isn't connected to the FPS game:

| Gap | Description |
|-----|-------------|
| **FPS Components** | Position, Velocity, Health, Weapon state components |
| **FPSSimulation** | Concrete `Simulation` subclass for FPS game |
| **Movement Physics** | Extract from FPSController to shared simulation code |
| **FPSPlayer Integration** | Connect to NetworkManager instead of local-only |
| **Weapon/Projectile Integration** | Network-aware weapon firing and projectiles |
| **Server-side BSP Collision** | Headless collision for server physics |

---

## Investigation Results

### Finding 1: Projectiles ARE Real 3D Objects

**User suspected:** Projectiles move with player's view (local effects only)

**Actual finding:** Projectiles ARE independent 3D world objects with:
- Real `TransformNode` positions in scene graph
- Independent movement through world space
- Real raycast collision against BSP geometry
- PointLights that affect world lighting
- Impact effects at world-space hit locations

**The issue is:** These projectiles are only local - not networked.

### Finding 2: Spawn Point Bug (Minor)

Projectiles spawn from **camera eye position** instead of **weapon muzzle**:

```typescript
// WeaponViewManager.ts line 781
const origin = this.mainCamera.position.clone();  // Eye position
origin.addInPlace(forward.scale(2));  // Just 2 units forward
```

**Should use:** The `tag_flash` position from the weapon model.

### Finding 3: FPS Game Bypasses Network Layer

Current FPSPlayer flow (all local):
```
Input → FPSPlayer.update() → FPSController → Local physics
     → WeaponViewManager.fire() → Local projectile
```

Should be:
```
Input → NetworkManager.sendCommand() → Server validates → State broadcast
     → Client predicts locally → Server confirms
```

---

## Architecture Plan

### Phase 1: FPS Components

Create serializable components for FPS game state:

```typescript
// src/shared/components/FPSComponents.ts

export class PositionComponent implements IComponent {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  serialize(encoder: StateEncoder): void {
    encoder.writeFloat32(this.x);
    encoder.writeFloat32(this.y);
    encoder.writeFloat32(this.z);
  }

  deserialize(decoder: StateDecoder): void {
    this.x = decoder.readFloat32();
    this.y = decoder.readFloat32();
    this.z = decoder.readFloat32();
  }

  clone(): PositionComponent {
    const c = new PositionComponent();
    c.x = this.x; c.y = this.y; c.z = this.z;
    return c;
  }
}

export class VelocityComponent implements IComponent { /* similar */ }

export class HealthComponent implements IComponent {
  current: number = 100;
  max: number = 100;
  armor: number = 0;
  // serialize/deserialize/clone
}

export class WeaponStateComponent implements IComponent {
  currentWeapon: string = 'plasmagun';
  ammo: Map<string, number> = new Map();
  cooldown: number = 0;
  state: 'idle' | 'firing' | 'reloading' = 'idle';
  // serialize/deserialize/clone
}

export class ProjectileComponent implements IComponent {
  ownerId: string = '';
  defId: string = '';
  direction: { x: number; y: number; z: number } = { x: 0, y: 0, z: 1 };
  speed: number = 2500;
  spawnTick: number = 0;
  lifetime: number = 5000;
  // serialize/deserialize/clone
}
```

### Phase 2: FPS Simulation

Create concrete simulation for FPS game:

```typescript
// src/shared/simulation/FPSSimulation.ts

import { Simulation, SimulationConfig, GameSystem } from '@engine/network/core/Simulation';
import { GameState } from '@engine/network/core/GameState';
import { Entity } from '@engine/network/core/Entity';
import { MoveCommand } from '@engine/network/core/Command';

// ===== SYSTEMS =====

class MovementSystem extends GameSystem {
  update(state: GameState, deltaTime: number): void {
    for (const [id, entity] of state.entities) {
      const pos = entity.getComponent<PositionComponent>('position');
      const vel = entity.getComponent<VelocityComponent>('velocity');
      if (!pos || !vel) continue;

      // Apply velocity
      pos.x += vel.x * deltaTime;
      pos.y += vel.y * deltaTime;
      pos.z += vel.z * deltaTime;

      // TODO: Collision with BSP
    }
  }
}

class ProjectileSystem extends GameSystem {
  update(state: GameState, deltaTime: number): void {
    const toRemove: string[] = [];

    for (const [id, entity] of state.entities) {
      const proj = entity.getComponent<ProjectileComponent>('projectile');
      const pos = entity.getComponent<PositionComponent>('position');
      if (!proj || !pos) continue;

      // Move projectile
      pos.x += proj.direction.x * proj.speed * deltaTime;
      pos.y += proj.direction.y * proj.speed * deltaTime;
      pos.z += proj.direction.z * proj.speed * deltaTime;

      // Check lifetime
      const age = state.tick - proj.spawnTick;
      if (age > proj.lifetime / 50) {  // Convert ms to ticks at 20Hz
        toRemove.push(id);
        continue;
      }

      // TODO: Collision detection, damage
    }

    // Remove expired projectiles
    for (const id of toRemove) {
      state.entities.delete(id);
    }
  }
}

class WeaponSystem extends GameSystem {
  update(state: GameState, deltaTime: number): void {
    for (const [id, entity] of state.entities) {
      const weapon = entity.getComponent<WeaponStateComponent>('weapon');
      if (!weapon) continue;

      // Decrease cooldown
      if (weapon.cooldown > 0) {
        weapon.cooldown -= deltaTime;
        if (weapon.cooldown < 0) weapon.cooldown = 0;
      }
    }
  }
}

// ===== SIMULATION =====

export class FPSSimulation extends Simulation {
  protected createInitialState(): GameState {
    return new GameState();
  }

  protected registerSystems(): void {
    this.addSystem(new MovementSystem());
    this.addSystem(new ProjectileSystem());
    this.addSystem(new WeaponSystem());
  }

  protected registerCommandHandlers(): void {
    this.onCommand('move', this.handleMoveCommand.bind(this));
    this.onCommand('fire', this.handleFireCommand.bind(this));
  }

  private handleMoveCommand(state: GameState, cmd: MoveCommand): void {
    const player = state.players.get(cmd.playerId);
    if (!player) return;

    const entity = state.entities.get(player.entityId);
    if (!entity) return;

    const vel = entity.getComponent<VelocityComponent>('velocity');
    if (!vel) return;

    // Apply input to velocity (simplified - real version uses Q3 physics)
    const speed = 280;
    vel.x = cmd.direction.x * speed;
    vel.z = cmd.direction.z * speed;

    // TODO: Proper Q3 movement physics
    // - Air acceleration
    // - Ground friction
    // - Jump
    // - Crouch
  }

  private handleFireCommand(state: GameState, cmd: any): void {
    const player = state.players.get(cmd.playerId);
    if (!player) return;

    const entity = state.entities.get(player.entityId);
    if (!entity) return;

    const weapon = entity.getComponent<WeaponStateComponent>('weapon');
    const pos = entity.getComponent<PositionComponent>('position');
    if (!weapon || !pos) return;

    // Check cooldown
    if (weapon.cooldown > 0) return;

    // Get weapon def
    const weaponDef = getWeaponDef(weapon.currentWeapon);
    if (!weaponDef) return;

    // Check ammo
    const ammo = weapon.ammo.get(weaponDef.ammoType) ?? 0;
    if (ammo <= 0) return;

    // Deduct ammo, set cooldown
    weapon.ammo.set(weaponDef.ammoType, ammo - 1);
    weapon.cooldown = 1 / weaponDef.fireRate;

    // Spawn projectile entity
    const projId = `proj_${state.tick}_${Math.random().toString(36).substr(2, 9)}`;
    const projEntity = new Entity(projId);

    const projPos = new PositionComponent();
    projPos.x = pos.x;
    projPos.y = pos.y;
    projPos.z = pos.z;
    projEntity.addComponent('position', projPos);

    const projComp = new ProjectileComponent();
    projComp.ownerId = cmd.playerId;
    projComp.defId = weaponDef.projectileId;
    projComp.direction = cmd.direction;
    projComp.speed = getProjectileDef(weaponDef.projectileId)?.speed ?? 2500;
    projComp.spawnTick = state.tick;
    projEntity.addComponent('projectile', projComp);

    state.entities.set(projId, projEntity);

    // Emit event for clients to play effects
    state.events.push({
      type: 'weapon_fired',
      playerId: cmd.playerId,
      weaponType: weapon.currentWeapon,
      projectileId: projId,
      origin: { x: pos.x, y: pos.y, z: pos.z },
      direction: cmd.direction,
    });
  }
}
```

### Phase 3: FPSPlayer Integration

Modify FPSPlayer to use NetworkManager:

```typescript
// src/games/fps/FPSPlayer.ts (modifications)

import { NetworkManager } from '@engine/network/NetworkManager';
import { MoveCommand } from '@engine/network/core/Command';

export class FPSPlayer {
  private networkManager: NetworkManager;
  private localPlayerId: string;
  private commandSeq: number = 0;

  async initialize(): Promise<void> {
    this.networkManager = NetworkManager.getInstance();

    // Initialize in local mode (runs server in-process)
    await this.networkManager.initialize({
      mode: 'local',
      SimulationClass: FPSSimulation,
      simulationConfig: {
        tickRate: 20,
        tickDuration: 50,
        maxPlayers: 16,
        gameRules: {}
      }
    });

    this.localPlayerId = this.networkManager.getGameHost()!.localPlayerId;

    // Subscribe to state updates
    this.networkManager.onStateUpdate(state => {
      this.onServerState(state);
    });

    // Subscribe to events (for effects)
    this.networkManager.onEvent(event => {
      this.onGameEvent(event);
    });
  }

  update(deltaTime: number): void {
    // Gather input
    const input = this.gatherInput();

    // Send command to network (handles prediction internally)
    const cmd = new MoveCommand(
      this.localPlayerId,
      this.networkManager.getGameHost()!.currentTick,
      this.commandSeq++,
      { x: input.moveX, y: 0, z: input.moveZ },
      this.camera.rotation.x,
      this.camera.rotation.y,
      input.buttons
    );

    this.networkManager.sendCommand(cmd);

    // Update network manager
    this.networkManager.update();
  }

  private onServerState(state: GameState): void {
    // Update other players' visuals (interpolated)
    for (const [playerId, player] of state.players) {
      if (playerId === this.localPlayerId) continue;

      const entity = this.networkManager.getInterpolatedEntity(player.entityId);
      if (!entity) continue;

      const pos = entity.getComponent('position');
      if (pos) {
        this.updateOtherPlayerVisual(playerId, pos);
      }
    }

    // Update projectile visuals
    for (const [entityId, entity] of state.entities) {
      const proj = entity.getComponent('projectile');
      if (!proj) continue;

      const pos = entity.getComponent('position');
      if (pos) {
        this.projectileManager.updateFromServer(entityId, pos, proj);
      }
    }
  }

  private onGameEvent(event: GameEvent): void {
    switch (event.type) {
      case 'weapon_fired':
        this.weaponViewManager.onWeaponFiredEvent(event);
        break;
      case 'projectile_hit':
        this.projectileManager.onImpactEvent(event);
        break;
      case 'player_damaged':
        this.onPlayerDamaged(event);
        break;
    }
  }
}
```

### Phase 4: Weapon/Projectile Integration

Modify weapon and projectile managers to be network-aware:

```typescript
// src/engine/weapon/ProjectileManager.ts (modifications)

export class ProjectileManager {
  // Predicted projectiles (local player, before server confirms)
  private predictedProjectiles: Map<string, PredictedProjectile> = new Map();

  // Server-confirmed projectiles
  private serverProjectiles: Map<string, ServerProjectile> = new Map();

  // Called by local player when firing (immediate visual)
  spawnPredicted(defId: string, origin: Vector3, direction: Vector3): string {
    const predId = `pred_${Date.now()}`;
    // Create visual immediately for responsiveness
    const visual = this.createProjectileVisual(defId, origin);
    this.predictedProjectiles.set(predId, {
      id: predId,
      defId,
      visual,
      direction,
      spawnTime: Date.now(),
      confirmed: false,
    });
    return predId;
  }

  // Called when server state arrives
  updateFromServer(entityId: string, pos: PositionComponent, proj: ProjectileComponent): void {
    let serverProj = this.serverProjectiles.get(entityId);

    if (!serverProj) {
      // New projectile from server - create visual
      // Try to match with a predicted projectile first
      const matched = this.matchPrediction(proj);
      if (matched) {
        // Reuse predicted visual
        matched.confirmed = true;
        serverProj = {
          id: entityId,
          visual: matched.visual,
          lastPos: new Vector3(pos.x, pos.y, pos.z),
        };
        this.serverProjectiles.set(entityId, serverProj);
      } else {
        // New projectile we didn't predict (other player)
        const visual = this.createProjectileVisual(proj.defId, new Vector3(pos.x, pos.y, pos.z));
        serverProj = { id: entityId, visual, lastPos: new Vector3(pos.x, pos.y, pos.z) };
        this.serverProjectiles.set(entityId, serverProj);
      }
    }

    // Update position (interpolate for smoothness)
    const targetPos = new Vector3(pos.x, pos.y, pos.z);
    serverProj.visual.position = Vector3.Lerp(serverProj.lastPos, targetPos, 0.5);
    serverProj.lastPos = targetPos;
  }

  // Clean up projectiles not in server state
  reconcileWithServer(serverEntityIds: Set<string>): void {
    for (const [id, proj] of this.serverProjectiles) {
      if (!serverEntityIds.has(id)) {
        // Projectile removed on server (hit something or expired)
        proj.visual.dispose();
        this.serverProjectiles.delete(id);
      }
    }

    // Timeout unconfirmed predictions
    const now = Date.now();
    for (const [id, pred] of this.predictedProjectiles) {
      if (!pred.confirmed && now - pred.spawnTime > 500) {
        pred.visual.dispose();
        this.predictedProjectiles.delete(id);
      }
    }
  }
}
```

---

## Network Flow Diagrams

### Single Player (Local Mode)
```
┌─────────────────────────────────────────────────────────────────┐
│                    SAME PROCESS                                  │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   FPSPlayer  │───▶│ LocalGameHost│───▶│FPSSimulation │      │
│  │              │    │              │    │              │      │
│  │ sendCommand()│    │ tick([cmd])  │    │ Systems run  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         │◀──────────────────┴───────────────────┘               │
│         │           onStateUpdate(state)                        │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │   Rendering  │  (Update visuals from state)                  │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Multiplayer (Network Mode)
```
CLIENT 1                                    SERVER
┌──────────────┐                     ┌──────────────────────┐
│  FPSPlayer   │                     │        Room          │
│              │                     │   ┌──────────────┐   │
│ sendCommand()│──── Input ────────▶│   │FPSSimulation │   │
│              │    (WebSocket/      │   │              │   │
│              │     WebTransport)   │   │ tick([cmds]) │   │
│              │                     │   └──────────────┘   │
│              │◀─── Snapshot ───────│          │          │
│              │    (20 Hz)          │          │          │
│ Prediction   │                     │  broadcastSnapshot() │
│ Interpolation│                     └──────────────────────┘
└──────────────┘                              │
                                              │
CLIENT 2                                      │
┌──────────────┐                              │
│  FPSPlayer   │◀─────────────────────────────┘
│              │
│ (Same as C1) │
└──────────────┘
```

### Fire Weapon Flow
```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (T=0ms)                                                   │
│                                                                 │
│ 1. Player presses fire button                                   │
│ 2. IMMEDIATELY (before server):                                 │
│    - Play muzzle flash                                          │
│    - Play fire sound                                            │
│    - Spawn predicted projectile visual                          │
│    - Decrement ammo locally                                     │
│ 3. Send FireCommand to server                                   │
│                                                                 │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼ (50-200ms network delay)
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                          │
│                                                                 │
│ 1. Receive FireCommand                                          │
│ 2. Validate:                                                    │
│    - Player has weapon?                                         │
│    - Has ammo?                                                  │
│    - Cooldown passed?                                           │
│ 3. If valid:                                                    │
│    - Spawn authoritative projectile entity                      │
│    - Deduct ammo                                                │
│    - Emit 'weapon_fired' event                                  │
│ 4. Include in next snapshot                                     │
│                                                                 │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (T=100-200ms)                                            │
│                                                                 │
│ 1. Receive snapshot with projectile entity                      │
│ 2. Match with predicted projectile → confirm                    │
│ 3. Projectile now tracks server position                        │
│ 4. If denied (no projectile in snapshot):                       │
│    - Remove predicted visual (fizzle)                           │
│    - Restore ammo                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Generic vs Game-Specific Architecture

### Key Insight: Reusable Engine Subsystems

The client/server architecture should be **generic engine features**, not FPS-specific. The same principles apply to:
- FPS (this game)
- Isometric hack'n'slash
- Top-down shooter
- Racing games
- Any multiplayer game

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     GAME LAYER (Game-Specific)                   │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ FPSGame     │  │ HackNSlash  │  │ RacingGame  │             │
│  │             │  │             │  │             │             │
│  │ - Q3 physics│  │ - Pathfind  │  │ - Vehicles  │             │
│  │ - Weapons   │  │ - Abilities │  │ - Tracks    │             │
│  │ - BSP maps  │  │ - Inventory │  │ - Laps      │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                      │
├─────────────────────────────────────────────────────────────────┤
│                   ENGINE LAYER (Reusable)                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Generic Simulation Systems                  │   │
│  │                                                          │   │
│  │  MovementSystem     - Any entity with pos/vel            │   │
│  │  ProjectileSystem   - Any projectile definition          │   │
│  │  DamageSystem       - Generic damage/health              │   │
│  │  SpawnSystem        - Spawn points, respawn logic        │   │
│  │  PickupSystem       - Item spawns, collection            │   │
│  │  TriggerSystem      - Area triggers, teleports           │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Generic Components                          │   │
│  │                                                          │   │
│  │  TransformComponent  - Position, rotation, scale         │   │
│  │  VelocityComponent   - Linear velocity                   │   │
│  │  HealthComponent     - Current/max health, armor         │   │
│  │  ProjectileComponent - Owner, speed, lifetime            │   │
│  │  TriggerComponent    - Area bounds, on enter/exit        │   │
│  │  PickupComponent     - Item type, respawn time           │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Movement Profiles (Configurable)            │   │
│  │                                                          │   │
│  │  Q3Movement     - Air accel, strafejump, friction        │   │
│  │  TopDownMovement - Direct WASD, no gravity               │   │
│  │  VehicleMovement - Acceleration, steering, drift         │   │
│  │  PlatformerMovement - Jump, gravity, wall slide          │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                   NETWORK LAYER (Already Done)                   │
│                                                                 │
│  NetworkManager, GameState, Entity, Transport, Protocol...      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What's Generic vs Game-Specific

| Component | Generic (Engine) | Game-Specific |
|-----------|-----------------|---------------|
| **Movement** | MovementSystem + MovementProfile interface | Q3Movement, TopDownMovement |
| **Projectiles** | ProjectileSystem, ProjectileComponent | Weapon definitions, projectile defs |
| **Damage** | DamageSystem, HealthComponent | Damage formulas, armor types |
| **Spawning** | SpawnSystem, SpawnPointComponent | Spawn rules (deathmatch vs CTF) |
| **Pickups** | PickupSystem, PickupComponent | Item types, effects |
| **Collision** | CollisionInterface | BSPCollision, TilemapCollision |
| **Input** | InputCommand base | FPSInput, HackNSlashInput |

### Movement Profile Interface

```typescript
// src/engine/network/systems/movement/MovementProfile.ts

export interface MovementProfile {
  /** Apply movement physics for one tick */
  simulate(
    position: Vec3,
    velocity: Vec3,
    input: MovementInput,
    deltaTime: number,
    collision: CollisionWorld
  ): { position: Vec3; velocity: Vec3; grounded: boolean };

  /** Get default values */
  getDefaults(): {
    maxSpeed: number;
    acceleration: number;
    friction: number;
    gravity: number;
  };
}

// Game provides implementation:
export class Q3MovementProfile implements MovementProfile {
  simulate(...) {
    // Air acceleration, strafejump, etc.
  }
}

export class TopDownMovementProfile implements MovementProfile {
  simulate(...) {
    // Direct movement, no gravity
  }
}
```

### Generic MovementSystem

```typescript
// src/engine/network/systems/MovementSystem.ts

export class MovementSystem extends GameSystem {
  constructor(private profile: MovementProfile, private collision: CollisionWorld) {}

  update(state: GameState, deltaTime: number): void {
    for (const [id, entity] of state.entities) {
      const transform = entity.getComponent<TransformComponent>('transform');
      const velocity = entity.getComponent<VelocityComponent>('velocity');
      const input = entity.getComponent<InputComponent>('input');

      if (!transform || !velocity) continue;

      // Use game-provided movement profile
      const result = this.profile.simulate(
        transform.position,
        velocity.value,
        input?.current ?? null,
        deltaTime,
        this.collision
      );

      transform.position = result.position;
      velocity.value = result.velocity;
    }
  }
}
```

### Collision World Interface

```typescript
// src/engine/network/systems/collision/CollisionWorld.ts

export interface CollisionWorld {
  /** Trace a ray through the world */
  trace(start: Vec3, end: Vec3, bounds?: AABB): TraceResult;

  /** Check if a point is solid */
  pointContents(point: Vec3): Contents;

  /** Get all entities in a radius */
  findEntitiesInRadius(center: Vec3, radius: number): Entity[];
}

// Game provides implementation:
export class BSPCollisionWorld implements CollisionWorld {
  // Uses BSP tree for collision
}

export class TilemapCollisionWorld implements CollisionWorld {
  // Uses 2D tilemap for collision (isometric game)
}
```

### Benefits of Generic Approach

1. **Reusability** - Same systems work for any game type
2. **Testing** - Test systems independently of game logic
3. **Composition** - Mix and match systems per game
4. **Documentation** - Document once, use everywhere
5. **Community** - Others can build games on the engine

---

## Complete Gap Analysis

### Core Gaps (Must Have for Basic Multiplayer)

| Gap | Description | Difficulty | Priority |
|-----|-------------|------------|----------|
| **FPSSimulation** | Concrete `Simulation` subclass for FPS game | Medium | P0 |
| **FPS Components** | Position, Velocity, Health, WeaponState, Projectile | Easy | P0 |
| **FPSPlayer ↔ NetworkManager** | Wire FPSPlayer to use network layer | Medium | P0 |
| **Movement Physics Extraction** | Move Q3 physics from FPSController to shared code | Hard | P1 |
| **Projectile Prediction** | Predicted visuals + server reconciliation | Medium | P1 |
| **Server-side BSP Collision** | Headless collision for NullEngine server | Hard | P1 |

### Secondary Gaps (Required for Playable Game)

| Gap | Description | Difficulty | Priority |
|-----|-------------|------------|----------|
| **Player Spawn System** | Spawn points, initial spawn, respawn after death | Medium | P1 |
| **Other Player Rendering** | Render remote players (models, positions) | Medium | P1 |
| **Player Model/Animation Sync** | Sync animation states (running, jumping, firing) | Medium | P2 |
| **Sound Events** | Network events for weapon/impact sounds | Easy | P2 |
| **Death/Respawn Flow** | Health → death → respawn cycle | Medium | P2 |
| **Pickup Sync** | Server-authoritative item pickups | Medium | P2 |

### Polish Gaps (Nice to Have)

| Gap | Description | Difficulty | Priority |
|-----|-------------|------------|----------|
| **Lag Compensation** | Backwards reconciliation for hit detection | Hard | P3 |
| **Delta Compression** | Only send changed state | Medium | P3 |
| **Spectator Mode** | Watch other players | Easy | P3 |
| **Kill Feed / Events** | UI for kills, deaths, events | Easy | P3 |
| **Scoreboard Sync** | Score, kills, deaths per player | Easy | P3 |

---

## Detailed Implementation Plan

### Milestone 1: "Hello Network" - Basic State Sync
**Goal:** See your player position update via server (even in local mode)

#### Phase 1.1: Generic Engine Components
```
Files to create:
  src/engine/network/components/TransformComponent.ts    (position, rotation)
  src/engine/network/components/VelocityComponent.ts     (linear velocity)
  src/engine/network/components/InputComponent.ts        (last input snapshot)
  src/engine/network/components/index.ts

Tasks:
  [ ] TransformComponent - position {x,y,z}, rotation {pitch,yaw,roll}
  [ ] VelocityComponent - velocity {x,y,z}, angular velocity
  [ ] InputComponent - stores current input for systems to read
  [ ] All implement IComponent (serialize/deserialize/clone)
  [ ] Export from index.ts
```

#### Phase 1.2: Generic Movement System + Interface
```
Files to create:
  src/engine/network/systems/MovementSystem.ts           (generic system)
  src/engine/network/systems/movement/MovementProfile.ts (interface)
  src/engine/network/systems/movement/SimpleMovement.ts  (basic implementation)

Tasks:
  [ ] MovementProfile interface (simulate function)
  [ ] SimpleMovement - basic velocity + position integration
  [ ] MovementSystem - uses profile, processes all entities with transform+velocity
  [ ] No game-specific code in engine layer
```

#### Phase 1.3: FPS Game Simulation
```
Files to create:
  src/games/fps/simulation/FPSSimulation.ts              (game simulation)
  src/games/fps/simulation/FPSMovementProfile.ts         (Q3-style movement placeholder)

Tasks:
  [ ] FPSSimulation extends Simulation
  [ ] Uses MovementSystem with FPSMovementProfile
  [ ] Creates player entity on join (with Transform, Velocity, Input)
  [ ] Handles 'move' command (updates InputComponent)
```

#### Phase 1.4: FPSPlayer Integration (Read Only)
```
Files to modify:
  src/games/fps/FPSPlayer.ts
  src/games/fps/FPSGame.ts (or entry point)

Tasks:
  [ ] Initialize NetworkManager with FPSSimulation in local mode
  [ ] Subscribe to onStateUpdate
  [ ] Log state changes to verify data flows
  [ ] Camera still moves locally (not from state yet)
  [ ] Test: npm run cli:game -- --command "net test"
```

**Milestone 1 Success Criteria:**
- Console shows state updates with tick numbers
- Player entity exists in GameState with Transform component
- Commands flow through LocalGameHost → FPSSimulation → back
- Engine systems are game-agnostic (could use for any game)

---

### Milestone 2: "Server Says Where You Are" - Authoritative Movement
**Goal:** Player position comes from server state, not local physics

#### Phase 2.1: Input Command Flow
```
Tasks:
  [ ] Gather input in FPSPlayer.update()
  [ ] Create MoveCommand with direction, angles, buttons
  [ ] Send via NetworkManager.sendCommand()
  [ ] FPSSimulation.handleMoveCommand() processes it
```

#### Phase 2.2: Simple Movement Physics (Server-Side)
```
Files to create:
  src/shared/physics/SimpleMovement.ts

Tasks:
  [ ] Create pure function: applyMovement(pos, vel, input, dt) → newPos
  [ ] No Babylon deps - just math
  [ ] Basic ground movement (no jump/crouch yet)
  [ ] MovementSystem calls this function
```

#### Phase 2.3: Apply Server State to Camera
```
Tasks:
  [ ] On state update, read local player's position
  [ ] Apply to camera position
  [ ] Client prediction: also predict locally between snapshots
  [ ] Smooth correction when prediction differs from server
```

**Milestone 2 Success Criteria:**
- Moving is driven by server (with 50ms tick visible jitter)
- Client prediction smooths it out
- Position reconciliation works (no rubber-banding on LAN)

---

### Milestone 3: "Pew Pew" - Networked Projectiles
**Goal:** Fire projectiles that exist on server and render on all clients

#### Phase 3.1: Generic Projectile System (Engine)
```
Files to create:
  src/engine/network/components/ProjectileComponent.ts   (generic)
  src/engine/network/systems/ProjectileSystem.ts         (generic)
  src/engine/network/systems/projectile/ProjectileDef.ts (interface)

Tasks:
  [ ] ProjectileComponent - ownerId, defId, direction, speed, spawnTick, lifetime
  [ ] ProjectileDef interface - speed, gravity, bounces, lifetime
  [ ] ProjectileSystem - moves all projectiles, checks lifetime, emits events
  [ ] No game-specific weapon logic in engine
```

#### Phase 3.2: Weapon Components (Game-Specific)
```
Files to create:
  src/games/fps/simulation/components/WeaponStateComponent.ts
  src/games/fps/simulation/systems/WeaponSystem.ts

Tasks:
  [ ] WeaponStateComponent - currentWeapon, ammo map, cooldown, state
  [ ] WeaponSystem - handles cooldowns per tick
  [ ] Links to existing weapon definitions in src/shared/entities/definitions/
```

#### Phase 3.3: Fire Command & Server Logic
```
Files to modify:
  src/games/fps/simulation/FPSSimulation.ts

Tasks:
  [ ] Add 'fire' command handler
  [ ] Validate: has weapon, has ammo, cooldown passed
  [ ] Use ProjectileSystem.spawn() helper
  [ ] Emit 'weapon_fired' event
  [ ] Projectile uses existing ProjectileDef from shared definitions
```

#### Phase 3.3: Projectile Prediction (Client)
```
Files to modify:
  src/engine/weapon/ProjectileManager.ts

Tasks:
  [ ] Add predictedProjectiles Map
  [ ] spawnPredicted() - immediate visual on fire
  [ ] updateFromServer() - match/confirm predictions
  [ ] reconcileWithServer() - cleanup unconfirmed
  [ ] Other players' projectiles spawn from server state
```

#### Phase 3.4: Weapon Effects from Events
```
Files to modify:
  src/engine/weapon/WeaponViewManager.ts

Tasks:
  [ ] onWeaponFiredEvent() - play muzzle flash, sound
  [ ] Decouple fire effects from local fire() call
  [ ] Effects play for both local and remote players
```

**Milestone 3 Success Criteria:**
- Fire button spawns predicted projectile instantly
- Server confirms and projectile tracks server position
- Other players see your projectiles
- Muzzle flash/sound plays for all players

---

### Milestone 4: "Ouch" - Damage & Health
**Goal:** Projectiles damage players, death and respawn work

#### Phase 4.1: Generic Health & Damage (Engine)
```
Files to create:
  src/engine/network/components/HealthComponent.ts       (generic)
  src/engine/network/systems/DamageSystem.ts             (generic)
  src/engine/network/systems/damage/DamageEvent.ts       (interface)

Tasks:
  [ ] HealthComponent - current, max, armor, isDead
  [ ] DamageEvent interface - target, amount, source, type
  [ ] DamageSystem - processes damage queue, applies to health
  [ ] Emits 'entity_damaged', 'entity_killed' events
  [ ] Generic - works for players, NPCs, destructibles
```

#### Phase 4.2: Generic Spawn System (Engine)
```
Files to create:
  src/engine/network/components/SpawnPointComponent.ts   (generic)
  src/engine/network/systems/SpawnSystem.ts              (generic)

Tasks:
  [ ] SpawnPointComponent - position, team filter, enabled
  [ ] SpawnSystem - manages spawn point selection
  [ ] Respawn queue with configurable delay
  [ ] Spawn point filtering (avoid occupied, team-based)
```

#### Phase 4.3: FPS Spawn Integration (Game-Specific)
```
Files to modify:
  src/games/fps/simulation/FPSSimulation.ts

Tasks:
  [ ] Load spawn points from BSP entities (info_player_deathmatch)
  [ ] Create SpawnPointComponent entities on map load
  [ ] Configure respawn delay (game rule)
  [ ] Handle 'entity_killed' → queue respawn
  [ ] Reset weapon/ammo on respawn (FPS-specific)
```

**Milestone 4 Success Criteria:**
- Projectile hits reduce health
- Player dies at 0 health
- Respawn after delay at spawn point
- Kill/death events visible in console
- Systems reusable for hack'n'slash mobs too

---

### Milestone 5: "See You" - Other Player Rendering
**Goal:** See other connected players moving and shooting

#### Phase 5.1: Remote Player Visuals
```
Files to create:
  src/engine/player/RemotePlayerRenderer.ts

Tasks:
  [ ] Create/update mesh for each remote player
  [ ] Position from interpolated state
  [ ] Basic capsule or placeholder model
  [ ] Cleanup when player disconnects
```

#### Phase 5.2: Animation State Sync
```
Files to create:
  src/shared/components/AnimationStateComponent.ts

Tasks:
  [ ] Track: idle, running, jumping, firing, dying
  [ ] Server sets based on velocity/actions
  [ ] Client plays appropriate animation
```

#### Phase 5.3: Network Sound Events
```
Tasks:
  [ ] 'weapon_fired' event includes position
  [ ] Client plays 3D sound at event position
  [ ] 'projectile_impact' event with position/surface
  [ ] Impact sounds for remote hits
```

**Milestone 5 Success Criteria:**
- See other players as meshes
- They move smoothly (interpolated)
- Hear their weapon sounds
- See their projectiles

---

### Milestone 6: "Real Physics" - Q3 Movement
**Goal:** Full Q3-style movement physics on server

#### Phase 6.1: Collision World Interface (Engine)
```
Files to create:
  src/engine/network/systems/collision/CollisionWorld.ts     (interface)
  src/engine/network/systems/collision/TraceResult.ts        (types)

Tasks:
  [ ] CollisionWorld interface - trace(), pointContents(), findEntitiesInRadius()
  [ ] TraceResult - hit, fraction, normal, contents
  [ ] Generic interface any game can implement
```

#### Phase 6.2: BSP Collision Implementation (Game)
```
Files to create:
  src/games/fps/simulation/collision/BSPCollisionWorld.ts

Tasks:
  [ ] Implement CollisionWorld for BSP
  [ ] Extract collision logic from BSPCollisionBackend
  [ ] Pure math trace function (no Babylon deps)
  [ ] Load BSP collision data on server (NullEngine)
```

#### Phase 6.3: Q3 Movement Profile (Game)
```
Files to create:
  src/games/fps/simulation/movement/Q3MovementProfile.ts

Tasks:
  [ ] Implement MovementProfile interface
  [ ] Port FPSController physics to pure functions
  [ ] Ground movement with friction
  [ ] Air acceleration (strafejumping)
  [ ] Jump, crouch, sprint
  [ ] No Babylon deps - uses CollisionWorld interface
```

#### Phase 6.4: Special Movement Components (Game)
```
Files to create:
  src/games/fps/simulation/components/WallJumpComponent.ts
  src/games/fps/simulation/components/LedgeGrabComponent.ts
  src/games/fps/simulation/systems/SpecialMovementSystem.ts

Tasks:
  [ ] WallJumpComponent - state, chargeTime, wallNormal
  [ ] LedgeGrabComponent - state, ledgePosition, grabTime
  [ ] SpecialMovementSystem - processes wall jump, ledge grab
  [ ] Integrates with Q3MovementProfile
```

**Milestone 6 Success Criteria:**
- Strafejumping works and is server-authoritative
- No clipping through walls
- Special movement syncs correctly
- Feels identical to current local movement
- CollisionWorld interface reusable (e.g., TilemapCollisionWorld)

---

### Milestone 7: "For Real" - Network Testing
**Goal:** Actually connect two clients and play

#### Phase 7.1: Dedicated Server Mode
```
Tasks:
  [ ] npm run server - starts headless server
  [ ] Loads map, creates room
  [ ] Accepts WebSocket/WebTransport connections
```

#### Phase 7.2: Connect Flow
```
Tasks:
  [ ] Client connect command: /connect localhost:7777
  [ ] Receive welcome, join room
  [ ] Spawn local player
  [ ] Start receiving snapshots
```

#### Phase 7.3: Latency Simulation
```
Tasks:
  [ ] Add artificial latency to LocalTransport
  [ ] Test prediction with 100ms, 200ms latency
  [ ] Verify smooth correction works
```

**Milestone 7 Success Criteria:**
- Two browser windows can connect to same server
- See each other move
- Shoot each other
- One dies when health depleted

---

## Implementation Order Summary

```
Phase 1: Hello Network (State flowing)
  └── 1.1 FPS Components
  └── 1.2 Minimal FPSSimulation
  └── 1.3 FPSPlayer Integration

Phase 2: Server Authority (Movement)
  └── 2.1 Input Command Flow
  └── 2.2 Simple Movement Physics
  └── 2.3 Apply Server State

Phase 3: Projectiles
  └── 3.1 Weapon/Projectile Components
  └── 3.2 Fire Command & Server Logic
  └── 3.3 Projectile Prediction
  └── 3.4 Weapon Effects Events

Phase 4: Combat
  └── 4.1 Health & Damage
  └── 4.2 Death & Respawn
  └── 4.3 Spawn Points

Phase 5: Multiplayer Visuals
  └── 5.1 Remote Player Rendering
  └── 5.2 Animation Sync
  └── 5.3 Sound Events

Phase 6: Full Physics
  └── 6.1 Q3 Movement Extraction
  └── 6.2 BSP Collision Headless
  └── 6.3 Special Movement

Phase 7: Network Testing
  └── 7.1 Dedicated Server
  └── 7.2 Connect Flow
  └── 7.3 Latency Testing
```

---

## Estimated Scope

| Milestone | Engine Files | Game Files | Modified | Complexity |
|-----------|--------------|------------|----------|------------|
| 1. Hello Network | 4 | 3 | 2 | Low |
| 2. Server Authority | 1 | 2 | 3 | Medium |
| 3. Projectiles | 3 | 2 | 3 | Medium |
| 4. Combat | 4 | 1 | 2 | Medium |
| 5. Multiplayer Visuals | 1 | 2 | 2 | Medium |
| 6. Full Physics | 2 | 5 | 3 | High |
| 7. Network Testing | 0 | 2 | 2 | Medium |

**Total: ~15 engine files (reusable), ~17 game files, ~17 modifications**

---

## New Directory Structure

```
src/
├── engine/
│   └── network/
│       ├── client/                          # (existing)
│       ├── core/                            # (existing)
│       ├── protocol/                        # (existing)
│       ├── server/                          # (existing)
│       │
│       ├── components/                      # NEW: Generic components
│       │   ├── TransformComponent.ts        # Position + rotation
│       │   ├── VelocityComponent.ts         # Linear + angular velocity
│       │   ├── InputComponent.ts            # Current input snapshot
│       │   ├── HealthComponent.ts           # Health, armor, isDead
│       │   ├── ProjectileComponent.ts       # Generic projectile data
│       │   ├── SpawnPointComponent.ts       # Spawn location
│       │   └── index.ts
│       │
│       └── systems/                         # NEW: Generic systems
│           ├── MovementSystem.ts            # Uses MovementProfile
│           ├── ProjectileSystem.ts          # Moves projectiles
│           ├── DamageSystem.ts              # Processes damage
│           ├── SpawnSystem.ts               # Handles respawning
│           │
│           ├── movement/
│           │   ├── MovementProfile.ts       # Interface
│           │   └── SimpleMovement.ts        # Basic implementation
│           │
│           ├── collision/
│           │   ├── CollisionWorld.ts        # Interface
│           │   └── TraceResult.ts           # Types
│           │
│           ├── projectile/
│           │   └── ProjectileDef.ts         # Interface
│           │
│           └── damage/
│               └── DamageEvent.ts           # Interface
│
├── games/
│   └── fps/
│       ├── FPSPlayer.ts                     # Modified: uses NetworkManager
│       ├── FPSGame.ts                       # Modified: initializes network
│       │
│       └── simulation/                      # NEW: FPS-specific simulation
│           ├── FPSSimulation.ts             # Main simulation class
│           │
│           ├── components/                  # FPS-specific components
│           │   ├── WeaponStateComponent.ts
│           │   ├── WallJumpComponent.ts
│           │   └── LedgeGrabComponent.ts
│           │
│           ├── systems/                     # FPS-specific systems
│           │   ├── WeaponSystem.ts
│           │   └── SpecialMovementSystem.ts
│           │
│           ├── movement/                    # FPS movement
│           │   └── Q3MovementProfile.ts     # Implements MovementProfile
│           │
│           └── collision/                   # FPS collision
│               └── BSPCollisionWorld.ts     # Implements CollisionWorld
│
└── shared/
    └── entities/
        └── definitions/                     # (existing, already shared)
            ├── weapons/
            │   └── plasmagun.ts
            └── projectiles/
                └── plasma_bolt.ts
```

---

## Reusability Examples

### Example: Isometric Hack'n'Slash

Using the same generic engine systems:

```typescript
// src/games/hackslash/simulation/HackSlashSimulation.ts

import { Simulation } from '@engine/network/core/Simulation';
import { MovementSystem } from '@engine/network/systems/MovementSystem';
import { DamageSystem } from '@engine/network/systems/DamageSystem';
import { TopDownMovementProfile } from './movement/TopDownMovementProfile';
import { TilemapCollisionWorld } from './collision/TilemapCollisionWorld';

export class HackSlashSimulation extends Simulation {
  protected registerSystems(): void {
    const collision = new TilemapCollisionWorld(this.tilemap);
    const movement = new TopDownMovementProfile();

    // Reuse engine systems with game-specific configs
    this.addSystem(new MovementSystem(movement, collision));
    this.addSystem(new DamageSystem());
    this.addSystem(new SpawnSystem({ respawnDelay: 0 })); // Instant respawn

    // Game-specific systems
    this.addSystem(new AbilitySystem());
    this.addSystem(new LootSystem());
  }
}
```

### Example: Racing Game

```typescript
// src/games/racing/simulation/RacingSimulation.ts

import { Simulation } from '@engine/network/core/Simulation';
import { MovementSystem } from '@engine/network/systems/MovementSystem';
import { VehicleMovementProfile } from './movement/VehicleMovementProfile';
import { TrackCollisionWorld } from './collision/TrackCollisionWorld';

export class RacingSimulation extends Simulation {
  protected registerSystems(): void {
    const collision = new TrackCollisionWorld(this.track);
    const movement = new VehicleMovementProfile();

    // Reuse engine movement system
    this.addSystem(new MovementSystem(movement, collision));

    // Game-specific systems
    this.addSystem(new LapSystem());
    this.addSystem(new PowerUpSystem());
    this.addSystem(new RacePositionSystem());
  }
}
```

---

## Configuration

### Server Tick Rate

Configurable via `SimulationConfig.tickRate`:

```typescript
const config: SimulationConfig = {
  tickRate: 20,      // 20 Hz server tick (50ms intervals)
  tickDuration: 50,  // 50ms per tick
  maxPlayers: 16,
  gameRules: {}
};
```

Common values:
- **20 Hz** - Standard for network games (Quake 3 default)
- **60 Hz** - Higher fidelity (more bandwidth)
- **128 Hz** - Competitive (CS:GO servers)

### Client Interpolation

Configured in `NetworkGameHost.InterpolationBuffer`:

```typescript
private interpolationDelay: number = 100;  // 100ms behind real-time
```

---

## Key Files Reference

### Existing Network Framework
| File | Purpose |
|------|---------|
| `src/engine/network/NetworkManager.ts` | Client entry point |
| `src/engine/network/core/Simulation.ts` | Base simulation class |
| `src/engine/network/core/GameState.ts` | State container |
| `src/engine/network/core/Command.ts` | MoveCommand definition |
| `src/engine/network/client/hosts/LocalGameHost.ts` | Single-player host |
| `src/engine/network/client/hosts/NetworkGameHost.ts` | Multiplayer client |
| `src/engine/network/server/Room.ts` | Server game room |
| `src/engine/network/protocol/MessageCodec.ts` | Binary protocol |

### FPS Game (To Integrate)
| File | Purpose |
|------|---------|
| `src/games/fps/FPSPlayer.ts` | Player controller (needs integration) |
| `src/engine/weapon/WeaponViewManager.ts` | Weapon visuals |
| `src/engine/weapon/ProjectileManager.ts` | Projectile visuals |
| `src/games/fps/FPSController.ts` | Movement physics (extract to shared) |

### To Create
| File | Purpose |
|------|---------|
| `src/shared/components/FPSComponents.ts` | Position, Velocity, Health, etc. |
| `src/shared/simulation/FPSSimulation.ts` | FPS game simulation |
| `src/shared/physics/MovementPhysics.ts` | Shared Q3-style movement |

---

## Open Questions

### Q1: BSP Collision on Server
The server needs to do collision detection without Babylon.js Scene.

**Options:**
1. Use NullEngine on server (current TestServer approach)
2. Extract BSP collision to pure math (no Babylon deps)
3. Use separate physics lib (cannon.js, rapier)

**Recommendation:** Start with NullEngine, extract later if needed.

### Q2: Weapon Definition Access
Both client and server need weapon/projectile definitions.

**Current:** Definitions are in `src/shared/entities/definitions/`
**Status:** Already shared! Just need to import on server.

### Q3: Hit Detection
How to handle projectile hits fairly with latency?

**Options:**
1. Server raycasts at projectile position (favors low ping)
2. Backwards reconciliation (rewind server state to client time)
3. Client-side hit detection with server validation

**Recommendation:** Start with #1, implement #2 for competitive play.

---

## Related Documents

- [NETWORKING_ARCHITECTURE.md](./NETWORKING_ARCHITECTURE.md) - Q3 network model research
- [NETWORKING_DESIGN.md](./NETWORKING_DESIGN.md) - Detailed protocol design
- [WEAPON_SYSTEM.md](./WEAPON_SYSTEM.md) - Weapon architecture (already client/server ready)
- [FPS_MOVEMENT_PHYSICS.md](./FPS_MOVEMENT_PHYSICS.md) - Q3 movement implementation
