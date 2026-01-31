# Implementation Plan: Next-Gen Server Architecture

> **Date:** 2026-01-31  
> **Status:** Planning Phase  
> **Target:** v0.10.0 - Complete server replacement

---

## Directory Structure

### Overview

```
src/
├── engine/
│   └── server/              # NEW: Server engine (generic, reusable)
│       ├── core/            # Core simulation engine
│       ├── ecs/             # Entity-Component System with COW
│       ├── network/         # Network protocol & transport
│       ├── lagcomp/         # Lag compensation system
│       ├── tick/            # Multi-rate tick orchestrator
│       └── index.ts         # Public API exports
│
├── shared/
│   └── server/              # NEW: V2 server shared code
│       ├── simulation/      # Shared between client/server
│       │   ├── components/  # Component definitions
│       │   ├── types/       # Branded types, interfaces
│       │   ├── physics/     # Physics constants, formulas
│       │   └── index.ts
│       └── index.ts
│
├── games/
│   └── fps/
│       └── server/          # NEW: FPS-specific server code
│           ├── gametypes/   # Deathmatch, CTF, etc.
│           ├── systems/     # FPS-specific systems
│           ├── weapons/     # Weapon definitions
│           └── index.ts
│
└── (existing cli/)          # Server commands via npm run server:*
```

---

## Detailed Directory Breakdown

### `src/engine/server/` - Core Server Engine

This is the **game-agnostic simulation engine**. Games extend it, not modify it.

```
src/engine/server/
├── core/
│   ├── Simulation.ts        # Main simulation loop
│   ├── WorldState.ts        # COW world state container
│   ├── Subsystem.ts         # Base class for subsystems
│   └── index.ts
│
├── ecs/
│   ├── Entity.ts            # Entity container with direct props
│   ├── EntityId.ts          # Branded EntityId type
│   ├── ComponentRegistry.ts # Component type registry
│   └── index.ts
│
├── network/
│   ├── transport/
│   │   ├── WebSocketTransport.ts
│   │   └── WebRTCTransport.ts     # Future
│   ├── protocol/
│   │   ├── BinaryEncoder.ts
│   │   ├── BinaryDecoder.ts
│   │   ├── SnapshotProtocol.ts    # Full/delta snapshots
│   │   ├── InputProtocol.ts       # Client inputs
│   │   └── MessageTypes.ts        # Enum of message IDs
│   ├── ServerConnection.ts        # Per-client connection
│   ├── ClientManager.ts           # All connected clients
│   └── index.ts
│
├── lagcomp/
│   ├── LagCompensation.ts         # Main lag comp system
│   ├── HistoryBuffer.ts           # Circular buffer of snapshots
│   ├── HitDetection.ts            # Capsule trace, multipart
│   ├── config.ts                  # LagCompConfig defaults
│   └── index.ts
│
├── tick/
│   ├── TickOrchestrator.ts        # Multi-rate tick manager
│   ├── TickConfig.ts              # Per-subsystem tick rates
│   ├── AccumulatorLoop.ts         # Fixed timestep accumulator
│   └── index.ts
│
├── Server.ts                      # Main GameServer class
├── types.ts                       # All server-related types
└── index.ts                       # Public API:
                                   #   export { GameServer }
                                   #   export { WorldState }
                                   #   export { Subsystem }
                                   #   etc.
```

### `src/shared/server/simulation/` - Shared Types & Components

V2 server shared code - used by **both client and server** for prediction.

```
src/shared/server/
├── simulation/
│   ├── components/
│   │   ├── TransformComponent.ts  # Position, rotation
│   │   ├── PhysicsComponent.ts    # Velocity, grounded
│   │   ├── InputComponent.ts      # Player inputs
│   │   ├── HealthComponent.ts     # Health, armor
│   │   └── index.ts
│   │
│   ├── types/
│   │   ├── EntityId.ts            # type EntityId = number & { __brand }
│   │   ├── PlayerId.ts            # type PlayerId = number & { __brand }
│   │   ├── TickNumber.ts          # type TickNumber = number & { __brand }
│   │   ├── Vec3.ts                # PositionWorld, VelocityPerSec, etc.
│   │   └── index.ts
│   │
│   ├── physics/
│   │   ├── constants.ts           # GRAVITY, MAX_SPEED, etc.
│   │   ├── movement.ts            # Q3 movement functions
│   │   ├── collision.ts           # Trace types, bounds
│   │   └── index.ts
│   │
│   └── index.ts
│
└── index.ts                       # Re-export all
```

### `src/games/fps/server/` - FPS Game-Specific Server

This is where **FPS-specific logic** lives - gametypes, weapons, spawn logic.

```
src/games/fps/server/
├── gametypes/
│   ├── BaseGametype.ts            # Abstract base class
│   ├── Deathmatch.ts              # FFA deathmatch
│   ├── TeamDeathmatch.ts          # TDM
│   ├── CaptureTheFlag.ts          # CTF
│   ├── Duel.ts                    # 1v1
│   ├── Race.ts                    # Defrag-style
│   └── index.ts
│
├── systems/
│   ├── FPSPhysicsSystem.ts        # Q3/Warsow movement
│   ├── FPSCombatSystem.ts         # Damage, kills, respawn
│   ├── FPSWeaponSystem.ts         # Weapon switching, fire
│   ├── FPSProjectileSystem.ts     # Rockets, grenades, plasma
│   ├── FPSItemSystem.ts           # Pickups, health, armor
│   └── index.ts
│
├── weapons/
│   ├── WeaponDef.ts               # Weapon definition interface
│   ├── Machinegun.ts
│   ├── Shotgun.ts
│   ├── RocketLauncher.ts
│   ├── RailGun.ts
│   ├── PlasmaGun.ts
│   └── index.ts
│
├── entities/
│   ├── FPSPlayerEntity.ts         # Player entity factory
│   ├── FPSProjectile.ts           # Projectile entity factory
│   └── index.ts
│
├── FPSServerGame.ts               # Main FPS server game class
├── config.ts                      # FPS-specific config
└── index.ts
```

### Server CLI Commands - `npm run server:*`

Server commands added to `package.json`, reusing existing `src/cli/` directory.

```json
// package.json scripts
{
  "server:tick": "tsx src/cli/server-tick.ts",
  "server:replay": "tsx src/cli/server-replay.ts",
  "server:bench": "tsx src/cli/server-bench.ts",
  "server:fuzz": "tsx src/cli/server-fuzz.ts"
}
```

```
src/cli/
├── server-tick.ts                 # npm run server:tick -- single tick test
├── server-replay.ts               # npm run server:replay -- determinism
├── server-bench.ts                # npm run server:bench -- performance
├── server-fuzz.ts                 # npm run server:fuzz -- random inputs
├── ServerSimRunner.ts             # Headless simulation runner
├── ReplayRecorder.ts              # Record inputs for replay
├── ReplayPlayer.ts                # Play back recorded inputs
└── (existing files...)
```

---

## Migration Strategy

### Phase 0: Preparation (This Sprint)
```
[x] Complete architecture research
[x] Design directory structure
[ ] Create skeleton directories
[ ] Set up barrel files (index.ts)
[ ] Add to tsconfig paths
```

### Phase 1: Core Infrastructure (Week 1-2)
```
[ ] src/shared/server/simulation/types      - Branded types
[ ] src/shared/server/simulation/components - Components
[ ] src/engine/server/ecs                   - Entity, WorldState
[ ] src/engine/server/core                  - Simulation base
[ ] src/engine/server/tick                  - Tick orchestrator
[ ] npm run server:tick                     - Prove it works
```

### Phase 2: Networking (Week 2-3)
```
[ ] src/engine/server/network/protocol   - Binary encoder
[ ] src/engine/server/network/transport  - WebSocket
[ ] Snapshot encoding/decoding
[ ] Delta compression
[ ] npm run server:replay                - Determinism test
```

### Phase 3: FPS Game Integration (Week 3-4)
```
[ ] src/games/fps/server/systems         - Physics, combat
[ ] src/games/fps/server/gametypes       - Deathmatch
[ ] Port existing FPSMovementProfile
[ ] Weapon system
```

### Phase 4: Lag Compensation (Week 4)
```
[ ] src/engine/server/lagcomp
[ ] History buffer
[ ] Hit detection with rewind
[ ] Testing with simulated latency
```

### Phase 5: Production (Week 5)
```
[ ] Performance optimization
[ ] Stress testing (64 players)
[ ] Remove old src/engine/network
[ ] Documentation
```

---

## Key Classes Overview

### GameServer (Entry Point)

```typescript
// src/engine/server/Server.ts

export class GameServer<TGame extends BaseGame> {
  private simulation: Simulation;
  private network: ClientManager;
  private lagComp: LagCompensation;
  private tickOrchestrator: TickOrchestrator;
  
  constructor(config: ServerConfig, game: TGame) {
    this.simulation = new Simulation(game.getSubsystems());
    this.tickOrchestrator = new TickOrchestrator(game.getTickConfig());
    this.lagComp = new LagCompensation(game.getLagCompConfig());
    this.network = new ClientManager(config.transport);
  }
  
  /**
   * Start the server
   */
  async start(port: number): Promise<void> {
    await this.network.listen(port);
    this.tickOrchestrator.start(this.tick.bind(this));
  }
  
  /**
   * Main server tick
   */
  private tick(dt: number): void {
    // 1. Collect inputs from clients
    const inputs = this.network.collectInputs();
    
    // 2. Run simulation tick
    this.simulation.tick(inputs, dt);
    
    // 3. Record state for lag comp
    this.lagComp.recordSnapshot(this.simulation.getState());
    
    // 4. Send snapshots to clients
    this.network.broadcastSnapshot(this.simulation.getState());
  }
}
```

### BaseGame (Game Interface)

```typescript
// src/engine/server/core/BaseGame.ts

export abstract class BaseGame {
  abstract name: string;
  
  /** Get all subsystems for this game */
  abstract getSubsystems(): Subsystem[];
  
  /** Get tick rate configuration */
  abstract getTickConfig(): TickConfig;
  
  /** Get lag compensation config */
  abstract getLagCompConfig(): LagCompensationConfig;
  
  /** Called when a new player connects */
  abstract onPlayerJoin(playerId: PlayerId, state: WorldState): void;
  
  /** Called when player disconnects */
  abstract onPlayerLeave(playerId: PlayerId, state: WorldState): void;
}
```

### BaseGametype (Gametype Interface)

```typescript
// src/games/fps/server/gametypes/BaseGametype.ts

export abstract class BaseGametype {
  abstract name: string;
  abstract maxPlayers: number;
  abstract teamBased: boolean;
  
  /** Check win conditions */
  abstract checkWinCondition(state: WorldState): GameResult | null;
  
  /** Handle player spawn */
  abstract onSpawn(player: Entity, state: WorldState): void;
  
  /** Handle player death */
  abstract onDeath(
    victim: Entity,
    killer: Entity | null,
    state: WorldState
  ): void;
  
  /** Get score for player/team */
  abstract getScore(playerId: PlayerId): number;
  
  /** Get spawn point for player */
  abstract chooseSpawnPoint(
    player: Entity,
    state: WorldState
  ): PositionWorld;
}
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Class | PascalCase | `WorldState.ts` |
| Interface | PascalCase, I prefix optional | `Subsystem.ts` |
| Type alias | PascalCase | `EntityId.ts` |
| Constants | UPPER_SNAKE in file | `constants.ts` |
| Utilities | camelCase | `utils.ts` |
| Index/barrel | always lowercase | `index.ts` |
| Tests | `.test.ts` suffix | `WorldState.test.ts` |

---

## Import Strategy

### Path Aliases (tsconfig.json)

```json
{
  "compilerOptions": {
    "paths": {
      "@engine/server/*": ["src/engine/server/*"],
      "@shared/server/*": ["src/shared/server/*"],
      "@games/fps/server/*": ["src/games/fps/server/*"]
    }
  }
}
```

### Import Examples

```typescript
// In game code
import { GameServer, WorldState } from '@engine/server';
import { TransformComponent, PhysicsComponent } from '@shared/server/simulation';
import { FPSServerGame, Deathmatch } from '@games/fps/server';

// In engine code (use relative for internal)
import { Entity } from '../ecs/Entity';
import type { TickConfig } from '../tick/TickConfig';
```

---

## Dependency Rules

```
src/shared/server/        ← NO dependencies on engine or games
        ↑
        │ imports
        │
src/engine/server/        ← Can import from shared/server
        ↑
        │ imports
        │
src/games/fps/server/     ← Can import from engine & shared
```

**Rule:** Higher layers can import from lower layers. Never reverse.

---

## Testing Structure

```
src/engine/server/
├── core/
│   ├── WorldState.ts
│   └── __tests__/
│       └── WorldState.test.ts      # Unit tests next to code
│
tests/
├── integration/
│   └── simulation/
│       └── full-match.test.ts      # Integration tests separate
├── fixtures/
│   └── replays/
│       └── match-001.log           # Test data
└── golden/
    └── match-001-final.json        # Expected outputs
```

---

## Decisions Summary

| Question | Decision |
|----------|----------|
| Shared location | `src/shared/server/simulation/` |
| CLI commands | `npm run server:tick`, `server:replay`, etc. |
| Legacy network | Keep during migration, clean up later |
| Game registration | Both: config file (`game.json`) + programmatic API |
