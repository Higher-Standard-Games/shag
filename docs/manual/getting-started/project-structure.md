# Project Structure

Detailed breakdown of the SHAG Engine project structure.

## Root Directory

```
shag-engine/
├── src/                  # Source code
├── public/               # Static assets
├── docs/                 # Documentation
├── dist/                 # Build output
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite bundler configuration
└── biome.json            # Linter configuration
```

## Source Code (`src/`)

### Engine (`src/engine/`)

The core engine, reusable across games.

```
src/engine/
├── camera/
│   ├── CameraSystem.ts         # Camera manager singleton
│   └── controllers/
│       ├── FreeflyController.ts
│       ├── IsometricController.ts
│       ├── SidescrollController.ts
│       └── FollowController.ts
├── console/
│   ├── ConsoleCommandRegistry.ts
│   └── commands/               # Built-in commands
├── core/
│   ├── EngineVersion.ts
│   └── PersistenceManager.ts
├── debug/
│   └── EngineCommands.ts       # Debug console commands
├── loader/
│   ├── bsp/
│   │   ├── BspLoader.ts        # BSP file parser
│   │   ├── BspMeshBuilder.ts   # Geometry builder
│   │   └── PVSCuller.ts        # Visibility culling
│   ├── pk3/
│   │   └── PK3Loader.ts        # Virtual filesystem
│   ├── shader/
│   │   ├── Q3ShaderParser.ts   # Shader file parser
│   │   └── Q3ShaderRegistry.ts # Shader lookup
│   ├── texture/
│   │   ├── SkyboxLoader.ts
│   │   └── TextureLoader.ts
│   └── map/
│       └── MapLoader.ts        # High-level map loading
├── network/
│   ├── core/
│   │   └── Simulation.ts         # tick() vs predict()
│   ├── client/
│   │   ├── SnapshotBuffer.ts     # Time-based interpolation
│   │   └── ClockSync.ts          # NTP-like time sync
│   ├── server/
│   │   └── Room.ts               # Command batching, tick loop
│   └── protocol/
│       └── BinaryProtocol.ts     # Delta compression, encoding
├── viewport/
│   ├── ViewportEffectsManager.ts  # Effect pipeline
│   └── effects/                   # WalkBob, IdleBreathing, etc.
├── weapon/
│   └── WeaponViewManager.ts      # First-person weapon rendering
└── rendering/
    └── RenderVars.ts           # Runtime render config
```

### Games (`src/games/`)

Game-specific code. Each game lives in its own directory (can be a Git submodule).

```
src/games/
└── fps/                       # FPS game mode (Git submodule)
    ├── client/
    │   ├── V2NetworkClient.ts     # Client prediction & reconciliation
    │   └── RemotePlayerRenderer.ts # Remote player interpolation
    ├── server/
    │   ├── GameServer.ts          # Dedicated server
    │   ├── GametypeController.ts  # Deathmatch rules
    │   └── systems/
    │       ├── FPSMovementSubsystem.ts
    │       ├── CombatSystem.ts
    │       ├── WeaponSystem.ts
    │       ├── ProjectileSystem.ts
    │       └── DroppedWeaponSystem.ts
    ├── simulation/
    │   └── FPSMovementProfile.ts   # Shared physics (client + server)
    ├── FPSGameManager.ts          # Game loop orchestrator
    └── WeaponDefs.ts              # Warsow weapon definitions
```

### Shared (`src/shared/`)

Code shared between client and server (simulation, types, protocol).

```
src/shared/
└── server/
    └── simulation/
        └── components/
            └── InputComponent.ts   # Input history for reconciliation
```

### CLI (`src/cli/`)

Headless command-line tools.

```
src/cli/
├── headless-game.ts           # Full engine in headless mode
└── headless-bsp.ts            # BSP-only loader
```

## Public Assets (`public/`)

```
public/
├── engine.json                # Engine configuration (required)
├── engine/                    # Shared engine assets
│   ├── fonts/                 # Engine fonts (Inter, Nunito, Share Tech Mono)
│   └── textures/              # Shared textures
└── games/                     # Game assets directory
    └── default/               # Assets for 'default' game
        ├── config.json        # Game configuration
        ├── maps/              # Map files
        ├── data/              # JSON data files
        ├── textures/          # Game textures
        ├── music/             # Music files
        └── *.pk3              # PK3 archives
```

## Key Singletons

| Class | Access | Purpose |
|-------|--------|---------|
| `CameraSystem` | `CameraSystem.getInstance()` | Camera management |
| `PK3Loader` | `PK3Loader.getInstance()` | Virtual filesystem |
| `Q3ShaderRegistry` | `Q3ShaderRegistry.getInstance()` | Shader lookup |
| `RenderVars` | `RenderVars.getInstance()` | Render configuration |
| `ConsoleCommandRegistry` | `ConsoleCommandRegistry.getInstance()` | Console commands |
| `WeaponViewManager` | `WeaponViewManager.getInstance()` | Weapon rendering |
| `ViewportEffectsManager` | `ViewportEffectsManager.getInstance()` | Camera effects |
| `HUDState` | `HUDState.getInstance()` | HUD data aggregator |
