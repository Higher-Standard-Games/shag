# Project Structure

Detailed breakdown of the SHAG Engine project structure.

## Root Directory

```text
shag-engine/
├── src/                  # Source code
├── public/               # Static assets
├── docs/                 # Documentation
├── scripts/              # Build & utility scripts
├── dist/                 # Build output
├── index.html            # Entry point
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite bundler configuration
├── vitest.config.ts      # Test configuration
└── biome.json            # Linter configuration
```

## Source Code (`src/`)

### Engine (`src/engine/`)

The core engine — reusable across games. 24 subdirectories organized by system.

#### Animation

```text
src/engine/animation/
├── PlayerModelManager.ts       # Warsow MD3 model loading (head/upper/lower)
├── PlayerAnimationController.ts # Animation state machine
├── AnimationBlender.ts         # Cross-fade blending
├── AnimationLoader.ts          # Animation clip loading
├── AnimationStateBridge.ts     # State ↔ animation mapping
├── HumanoidRig.ts              # Bone hierarchy
├── ProceduralLayers.ts         # Procedural animation overlays
└── PlayerAnimationState.ts     # Animation state definitions
```

#### Camera

```text
src/engine/camera/
├── CameraSystem.ts             # Camera manager singleton
├── CameraPresets.ts            # Preset configurations
└── controllers/
    ├── FPSController.ts        # First-person (prediction, reconciliation)
    ├── FreeflyController.ts    # Noclip / spectator
    ├── IsometricController.ts  # Top-down isometric
    ├── SideScrollController.ts # 2D side-scrolling
    ├── FollowController.ts     # Third-person follow
    └── ICameraController.ts    # Controller interface
```

#### Console

```text
src/engine/console/
├── CommandRegistry.ts          # Command registry singleton
├── Command.ts                  # Command base class
└── commands/                   # ~70 built-in commands
```

#### Core

```text
src/engine/core/
├── EngineVersion.ts            # Version management
├── EngineServices.ts           # Service container
├── EngineSettings.ts           # Configuration
├── ServiceLocator.ts           # Service locator pattern
├── EventBus.ts                 # Pub/sub event system
├── GameClock.ts                # Frame timing
├── GameTimer.ts                # Timer utilities
├── TimerManager.ts             # Timer lifecycle
├── Cvar.ts                     # Console variable system
├── ActionSystem.ts             # Input action binding
├── PersistenceManager.ts       # Save/load
├── ResourceSystem.ts           # Resource lifecycle
├── EntityHandlerRegistry.ts    # Entity handler dispatch
├── QualityDetector.ts          # Auto quality detection
├── Subsystem.ts                # Subsystem base class
├── GamePaths.ts                # Asset path resolution
├── PopupSystem.ts              # Popup notifications
├── WorldIndicatorSystem.ts     # 3D world indicators
├── CapacitorBridge.ts          # Mobile integration
└── LoadingEvents.ts            # Loading lifecycle events
```

#### Debug

```text
src/engine/debug/
├── DebugConsole.ts             # In-game console (~key)
├── DebugOverlay.ts             # FPS/stats overlay
└── DeveloperBar.ts             # Developer toolbar
```

#### Effects

```text
src/engine/effects/
├── PostProcessingManager.ts    # Post-processing pipeline
├── RainEffect.ts               # Particle rain
├── FogEffect.ts                # Volumetric fog
├── ThunderEffect.ts            # Lightning/thunder
├── WindSystem.ts               # Wind simulation
├── DebrisEffect.ts             # Debris particles
├── LocalDebrisEffect.ts        # Localized debris
└── ScreenTransition.ts         # Screen fade/wipe
```

#### Entities

```text
src/engine/entities/
└── EntityManager.ts            # Entity lifecycle management
```

#### World (in-world entities)

```text
src/engine/world/
└── Pickup.ts                   # Engine-generic in-world collectible base class
```

> Game-specific subclasses live in their game submodule. For the FPS game, the
> subclass + inventory + HUD prompt are at `src/games/fps/world/`:
>
> ```text
> src/games/fps/world/
> ├── FPSPickup.ts                # FPS subclass (weapon/ammo/health/armor)
> ├── InventoryManager.ts         # Q3-style ammo + weapon slots
> └── PickupPrompt.ts             # "PRESS [F] TO PICKUP" HUD
> ```

#### Input

```text
src/engine/input/
├── InputSystem.ts              # Keyboard/mouse/gamepad
└── InputTypes.ts               # Input type definitions
```

#### Lighting

```text
src/engine/lighting/
├── SkyLightSystem.ts           # Dynamic sky lighting
└── StreetLampSystem.ts         # Point light management
```

#### Loader

```text
src/engine/loader/
├── bsp/
│   ├── BspLoader.ts            # BSP file parser (Q3 + FBSP)
│   ├── BspMeshBuilder.ts       # Geometry/mesh construction
│   └── PVSCuller.ts            # Potentially Visible Set culling
├── pk3/
│   └── PK3Loader.ts            # Virtual filesystem (ZIP archives)
├── shader/
│   ├── Q3ShaderParser.ts       # Quake 3 shader parser
│   └── Q3ShaderRegistry.ts     # Shader lookup singleton
├── texture/
│   ├── TextureLoader.ts        # Texture loading pipeline
│   └── SkyboxLoader.ts         # Skybox texture loading
├── model/
│   ├── MD3Loader.ts            # Quake 3 MD3 model format
│   ├── ModelLoader.ts          # Generic model loading
│   ├── PrefabLoader.ts         # Prefab instantiation
│   └── PrefabInstance.ts       # Prefab instance management
├── map/
│   └── MapLoader.ts            # High-level map loading
├── AssetPreloader.ts           # Batch asset preloading
└── SkyboxLoader.ts             # Skybox construction
```

#### Math

```text
src/engine/math/
├── Noise.ts                    # Perlin/simplex noise
└── SeededRandom.ts             # Deterministic PRNG
```

#### Movement

```text
src/engine/movement/
├── CharacterController.ts      # Character physics controller
└── MovementVars.ts             # Movement CVars (speed, gravity, etc.)
```

#### Network (Client)

```text
src/engine/network/
├── NetworkManager.ts           # Client network manager
├── client/
│   ├── ClockSync.ts            # NTP-like time synchronization
│   ├── SnapshotBuffer.ts       # Time-based interpolation buffer
│   ├── NetGraph.ts             # Network diagnostics overlay
│   └── transport/
│       ├── WebTransportTransport.ts
│       └── ...
├── core/                       # Shared simulation types
├── components/                 # Network ECS components
├── protocol/                   # Binary protocol (delta encoding)
├── systems/                    # Network systems
└── types.ts                    # Network type definitions
```

#### Physics

```text
src/engine/physics/
├── PhysicsSystem.ts            # Physics pipeline
├── CollisionManager.ts         # Collision detection manager
├── BspCollision.ts             # BSP trace-based collision
├── SweepCollisionBackend.ts    # Sweep test backend
├── BabylonPhysicsBackend.ts    # Babylon.js physics wrapper
├── CollisionBackend.ts         # Backend interface
├── PatchTessellator.ts         # Bezier patch tessellation
├── PlayerPhysicsConstants.ts   # Player hull sizes, step height
└── ContentFlags.ts             # BSP content/surface flags
```

#### Procedural

```text
src/engine/procedural/
└── ProceduralTextureGenerator.ts  # Runtime texture generation
```

#### Rendering

```text
src/engine/rendering/
├── RenderVars.ts               # Runtime render config singleton
└── InstancedMeshManager.ts     # GPU instanced rendering
```

#### Server

```text
src/engine/server/
├── Server.ts                   # Server entry point
├── core/
│   ├── Simulation.ts           # Tick loop + subsystem orchestration
│   ├── Subsystem.ts            # Server subsystem base class
│   └── WorldState.ts           # Authoritative world state
├── ecs/
│   ├── Entity.ts               # Server entity base
│   └── types.ts                # ECS type definitions
├── network/
│   ├── ClientManager.ts        # Client connection management
│   ├── protocol/               # Binary encoder/decoder
│   └── transport/              # WebSocket + WebTransport
├── lagcomp/
│   ├── LagCompensation.ts      # Server-side rewind
│   ├── HistoryBuffer.ts        # Position history ring buffer
│   └── config.ts               # Lag comp configuration
├── replay/
│   └── Replay.ts               # Match replay recording
└── tick/                       # Tick timing utilities
```

#### Spawn

```text
src/engine/spawn/
└── SpawnPointManager.ts        # Spawn point selection
```

#### Sprites

```text
src/engine/sprites/
├── SpriteManager.ts            # Sprite lifecycle
├── BillboardSprite.ts          # Camera-facing sprites
├── SpriteSheet.ts              # Sprite sheet atlas
├── SpriteBuilding.ts           # Building sprites
└── SpriteTypes.ts              # Sprite type definitions
```

#### UI

```text
src/engine/ui/
├── UIManager.ts                # UI system manager
├── UITheme.ts                  # Theme system
├── UIStyles.ts                 # Global styles
├── UIScale.ts                  # Resolution-independent scaling
├── UIConfig.ts                 # UI configuration
├── LoadingScreen.ts            # Loading screen
├── MapLoadingOverlay.ts        # Map loading progress
├── BottomBar.ts                # Bottom action bar
├── ModalPanel.ts               # Modal dialogs
├── SidePanel.ts                # Side panel overlay
├── hud/
│   ├── HUDManager.ts           # HUD lifecycle
│   ├── HUDElement.ts           # HUD element base
│   ├── HUDTypes.ts             # HUD type definitions
│   └── components/             # HUD components
├── components/                 # Reusable UI components
└── styles/                     # CSS style modules
```

#### Viewport

```text
src/engine/viewport/
├── ViewportEffectsManager.ts   # Effect pipeline singleton
├── ViewportEffect.ts           # Effect base class
├── ViewportDelta.ts            # Position/rotation/FOV delta
├── PlayerState.ts              # Player state for effects
├── effects/
│   ├── WalkBobEffect.ts        # Walk/run head bob
│   ├── LandingImpactEffect.ts  # Landing camera dip
│   ├── SpeedFOVEffect.ts       # Speed-dependent FOV
│   ├── StrafeLeanEffect.ts     # Strafe camera lean
│   └── IdleBreathingEffect.ts  # Idle camera sway
└── applicators/                # Effect application strategies
```

#### Weapon

```text
src/engine/weapon/
├── WeaponViewManager.ts        # First-person weapon rendering
├── ProjectileManager.ts        # Client-side projectile interpolation
├── ExplosionEffect.ts          # Explosion VFX
└── HitscanEffects.ts           # Hitscan trail/impact VFX
```

#### Top-Level Engine Files

```text
src/engine/
├── EngineScene.ts              # Scene lifecycle manager
├── MapRenderer.ts              # Map rendering pipeline
├── AudioManager.ts             # Spatial audio system
├── BuildableSystem.ts          # Constructible entity system
├── AssetLoader.ts              # Generic asset loader
├── MenuSystem.ts               # Menu state machine
├── SpawnValidator.ts           # Spawn validation
└── index.ts                    # Engine barrel export
```

---

### Games (`src/games/`)

Game-specific code. Each game is a directory (can be a Git submodule).

```text
src/games/
├── fps/                        # FPS game (Git submodule)
│   ├── client/
│   │   ├── V2NetworkClient.ts      # Client prediction & reconciliation
│   │   ├── RemotePlayerRenderer.ts # Remote player interpolation
│   │   ├── HUDState.ts             # HUD data aggregator
│   │   ├── MatchHUD.ts             # Match HUD overlay
│   │   ├── MatchStateManager.ts    # Match state tracking
│   │   ├── Crosshair.ts            # Crosshair rendering
│   │   ├── DamageNumbers.ts        # Floating damage numbers
│   │   ├── GibSystem.ts            # Physics-based gib effects
│   │   ├── DroppedWeaponRenderer.ts # Dropped weapon display
│   │   └── InputHistory.ts         # Client input buffer
│   ├── server/
│   │   ├── GameServer.ts           # Dedicated game server
│   │   ├── MovementValidator.ts    # Anti-warp validation
│   │   ├── gametypes/
│   │   │   ├── GametypeController.ts   # Gametype orchestrator
│   │   │   ├── Deathmatch.ts           # DM rules
│   │   │   ├── BaseGametype.ts         # Gametype base class
│   │   │   ├── MatchState.ts           # Match state machine
│   │   │   └── SpawnPointStrategy.ts   # Spawn selection
│   │   ├── systems/
│   │   │   ├── FPSMovementSubsystem.ts # Server movement
│   │   │   ├── CombatSystem.ts         # Damage resolution
│   │   │   ├── WeaponSystem.ts         # Weapon logic
│   │   │   ├── ProjectileSystem.ts     # Projectile simulation
│   │   │   ├── DroppedWeaponSystem.ts  # Weapon drops
│   │   │   ├── PickupSystem.ts         # Item pickups
│   │   │   └── CharacterPhysicsSystem.ts
│   │   └── weapons/                # Weapon configuration
│   ├── simulation/
│   │   ├── FPSMovementProfile.ts   # Shared movement physics
│   │   ├── FPSSimulation.ts        # Shared simulation
│   │   └── collision/              # Shared collision
│   ├── FPSGameManager.ts          # Game loop orchestrator
│   ├── FPSPlayer.ts               # Player entity
│   └── FPSGame.ts                 # Game entry point
└── tower/                      # Tower defense game
```

---

### Shared (`src/shared/`)

Code shared between engine, client, and server — entity definitions, simulation types, protocol.

```text
src/shared/
├── entities/
│   ├── EntityRegistry.ts       # Entity type registry
│   ├── EntityDef.ts            # Base entity definition
│   ├── EntityType.ts           # Entity type enum
│   ├── WeaponDef.ts            # Weapon definition interface
│   ├── ProjectileDef.ts        # Projectile definition
│   ├── AmmoDef.ts              # Ammo type definition
│   ├── initEntityDefs.ts       # Entity registration
│   └── definitions/            # ~26 entity definitions
├── server/
│   ├── simulation/             # Server-shared simulation
│   └── gametype/               # Gametype interfaces
└── collision/                  # Shared collision types
```

---

### CLI (`src/cli/`)

Headless command-line tools — no GPU required.

```text
src/cli/
├── headless-game.ts            # Full engine in headless mode
├── headless-bsp.ts             # BSP-only loader
├── headless-netserver-v2.ts    # Standalone network server
├── headless-netclient.ts       # Headless network client
├── server-game.ts              # Game server entry
├── server-bench.ts             # Server benchmarking
├── server-fuzz.ts              # Protocol fuzzing
├── server-integration.ts       # Integration tests
├── server-protocol.ts          # Protocol tests
├── server-replay.ts            # Replay playback
├── server-tick.ts              # Tick timing tests
├── compare-local-vs-server.ts  # Client/server comparison
├── debug-collision-gravity.ts  # Collision debugging
├── test-fps-simulation.ts      # Simulation tests
├── test-server-physics.ts      # Physics tests
└── audit-textures.ts           # Texture audit tool
```

---

## Public Assets (`public/`)

```text
public/
├── engine.json                 # Engine configuration (required)
├── engine/                     # Shared engine assets
│   ├── fonts/                  # Fonts (Inter, Nunito, Share Tech Mono)
│   └── textures/               # Shared textures
└── games/                      # Per-game assets
    └── fps/
        ├── config.json         # Game configuration
        ├── maps/               # Map files
        ├── textures/           # Game textures
        └── *.pk3               # PK3 archives (Warsow assets)
```

---

## Key Singletons

| Class | Access | Purpose |
| ----- | ------ | ------- |
| `CameraSystem` | `CameraSystem.getInstance()` | Camera management |
| `PK3Loader` | `PK3Loader.getInstance()` | Virtual filesystem |
| `Q3ShaderRegistry` | `Q3ShaderRegistry.getInstance()` | Shader lookup |
| `RenderVars` | `RenderVars.getInstance()` | Render configuration |
| `ConsoleCommandRegistry` | `ConsoleCommandRegistry.getInstance()` | Console commands |
| `WeaponViewManager` | `WeaponViewManager.getInstance()` | Weapon rendering |
| `ViewportEffectsManager` | `ViewportEffectsManager.getInstance()` | Camera effects |
| `HUDState` | `HUDState.getInstance()` | HUD data aggregator |
| `InputSystem` | `InputSystem.getInstance()` | Input handling |
| `UIManager` | `UIManager.getInstance()` | UI system |
| `NetworkManager` | `NetworkManager.getInstance()` | Client networking |
| `AudioManager` | `AudioManager.getInstance()` | Spatial audio |
