# Project Structure

Detailed breakdown of the SHAG Engine project structure.

## Root Directory

```text
shag-engine/
├── src/                  # Source code
├── public/               # Static assets
├── docs/                 # Documentation
├── scripts/              # Build & utility scripts
├── config/               # Shared build/runtime config
├── android/              # Capacitor Android project
├── build-resources/      # Icons and installer assets
├── editor/               # Map-editor experiments
├── dist/                 # Build output
├── index.html            # Entry point
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite bundler configuration
├── vitest.config.ts      # Test configuration
├── capacitor.config.ts   # Mobile configuration
├── electron-builder.config.js  # Desktop packaging
└── biome.json            # Linter configuration
```

## Source Code (`src/`)

Nine top-level areas:

```text
src/
├── engine/    # Core engine — game-agnostic, reusable
├── shared/    # Code shared between client, server and bots
├── games/     # Game implementations (git submodules)
├── lobby/     # Lobby server, matchmaking, game-server spawning
├── bot/       # Bot Intelligence Server (separate process)
├── cli/       # Headless command-line tools
├── electron/  # Desktop shell (main + preload)
├── tools/     # Map generation and asset tooling
└── __tests__/ # Cross-cutting tests
```

### Engine (`src/engine/`)

The core engine — reusable across games. 25 subdirectories organized by system.

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

#### Audio

```text
src/engine/audio/
└── AudioV2Sfx.ts               # Babylon AudioEngineV2 SFX layer
```

#### Camera

```text
src/engine/camera/
├── CameraSystem.ts             # Camera manager singleton
├── CameraPresets.ts            # Preset configurations
├── CameraInputHandler.ts       # Pointer-lock and look input
├── GameFrameHook.ts            # Per-frame camera update hook
└── controllers/
    ├── FPSController.ts        # First-person (prediction, reconciliation, ADS)
    ├── FreeflyController.ts    # Noclip / inspection
    ├── IsometricController.ts  # Top-down isometric
    ├── SideScrollController.ts # 2D side-scrolling
    ├── FollowController.ts     # Third-person follow
    ├── SpectatorController.ts  # Follow/cycle live players + demo POV
    ├── SpectatorCycling.ts     # Spectator target selection
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
├── Log.ts                      # Structured + rate-limited logging
└── LoadingEvents.ts            # Loading lifecycle events
```

#### Player

```text
src/engine/player/
└── PlayerProfile.ts            # Persistent player identity/preferences
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
├── PostProcessingManager.ts    # Post-processing pipeline (bloom, grading, vignette, chromatic)
├── SSREffect.ts                # Screen-space reflections
├── GlowEffect.ts               # Glow layer
├── CelOutlinePostProcess.ts    # Cel-shaded outline pass
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
├── StreetLampSystem.ts         # Point light management
├── DynamicLightCluster.ts      # Light clustering / budget
├── DynamicLightSafety.ts       # Light-count guardrails
├── AreaLightManager.ts         # Babylon 9 textured area lights
├── AreaLightAssets.ts          # Area-light texture assets
├── AreaLightPanel.ts           # Area-light debug panel
├── MapAreaLightEntities.ts     # Area lights from BSP entities
├── MapEmissiveSurfaces.ts      # Emissive surfaces from shaders
├── MapGodRayEntities.ts        # God-ray emitters from BSP entities
├── GodRaysController.ts        # Volumetric god-ray control
└── SunGodRays.ts               # Sun-shaft god rays
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
├── RenderVars.ts                  # Runtime render config singleton
├── InstancedMeshManager.ts        # GPU instanced rendering
├── RenderingEngineFactory.ts      # WebGL2 / WebGPU engine selection
└── RendererPerformanceCapture.ts  # `perf capture` sampling
```

#### Server

```text
src/engine/server/
├── Server.ts                   # Server entry point
├── ServerPVS.ts                # Server-side PVS for snapshot scoping
├── core/
│   ├── Simulation.ts           # Tick loop + subsystem orchestration
│   ├── Subsystem.ts            # Server subsystem base class
│   └── WorldState.ts           # Authoritative world state
├── ecs/
│   ├── Entity.ts               # Server entity base
│   └── types.ts                # ECS type definitions
├── network/
│   └── transport/              # WebSocket + WebTransport
├── lagcomp/
│   ├── LagCompensation.ts      # Server-side rewind
│   ├── HistoryBuffer.ts        # Position history ring buffer
│   └── config.ts               # Lag comp configuration (125 Hz)
├── replay/
│   └── Replay.ts               # Match replay recording
└── tick/
    ├── TickConfig.ts           # Tick/snapshot rate configuration
    └── TickOrchestrator.ts     # Fixed-rate tick driver
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
├── HitscanEffects.ts           # Hitscan trail/impact VFX
├── WeaponBob.ts                # Viewmodel bob (synced with view bob)
├── WeaponRecoil.ts             # Recoil kick
├── WeaponCharge.ts             # Charged-fire windup
├── WeaponSlash.ts              # Melee slash arc
├── WeaponBarrels.ts            # Muzzle/barrel resolution
├── WeaponLighting.ts           # Viewmodel lighting
├── WeaponSwitchAnim.ts         # Switch animation
├── WeaponReloadAnim.ts         # Reload animation
├── AmmoCounterDisplay.ts       # On-model ammo readout
├── PointLightPool.ts           # Pooled muzzle/impact lights
├── EffectPreloader.ts          # Warm effect assets before first shot
└── muzzle/ rail/ voltaic/      # Per-weapon effect modules
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
├── fps/                        # Washiki Washoi (Git submodule)
│   ├── client/
│   │   ├── V2NetworkClient.ts      # Client prediction & reconciliation
│   │   ├── RemotePlayerRenderer.ts # Remote player interpolation
│   │   ├── HUDState.ts             # HUD data aggregator
│   │   ├── FPSHud.ts               # HUD root
│   │   ├── hud/widgets/            # Vitals, ammo, rack, scoreboard, bomb, …
│   │   ├── MatchStateManager.ts    # Match state tracking
│   │   ├── LobbyPanel.ts           # Lobby / ready-room UI
│   │   ├── FpsLobbyService.ts      # Lobby client wiring
│   │   ├── Crosshair.ts            # Crosshair rendering
│   │   ├── DamageNumbers.ts        # Floating damage numbers
│   │   ├── GibSystem.ts            # Physics-based gib effects
│   │   ├── RagdollSystem.ts        # Death ragdolls
│   │   ├── DroppedWeaponRenderer.ts # Dropped weapon display
│   │   ├── BombRenderer.ts         # S&D bomb + site markers
│   │   ├── Demo*.ts                # Demo playback, overlays, cinematic
│   │   ├── FPS*Audio.ts            # Combat/movement/pickup/bomb audio
│   │   ├── settings/               # In-game settings overlay
│   │   └── InputHistory.ts         # Client input buffer
│   ├── server/
│   │   ├── GameServer.ts           # Dedicated game server
│   │   ├── FPSServerGame.ts        # Server-side game wiring
│   │   ├── SnapshotBuilder.ts      # Per-client snapshot assembly
│   │   ├── SnapshotBroadcaster.ts  # Snapshot fan-out
│   │   ├── MovementValidator.ts    # Anti-warp validation
│   │   ├── AuthorityGuards.ts      # Server-authority checks
│   │   ├── DemoRecorder.ts         # Server-side demo recording
│   │   ├── ReSim.ts                # Deterministic re-simulation
│   │   ├── Telemetry.ts            # Anti-cheat telemetry (log-only)
│   │   ├── gametypes/
│   │   │   ├── GametypeController.ts   # Gametype orchestrator
│   │   │   ├── BaseGametype.ts         # Gametype base class
│   │   │   ├── Deathmatch.ts           # DM rules
│   │   │   ├── TeamDeathmatch.ts       # TDM rules
│   │   │   ├── Duel.ts                 # Duel rules (overtime on draw)
│   │   │   ├── SearchAndDestroy.ts     # S&D rounds, bomb, loadouts
│   │   │   ├── AwardTracker.ts         # Match awards
│   │   │   ├── MatchState.ts           # Match state machine
│   │   │   └── SpawnPointStrategy.ts   # Spawn selection
│   │   └── systems/
│   │       ├── FPSMovementSubsystem.ts # Server movement
│   │       ├── CombatSystem.ts         # Damage resolution
│   │       ├── WeaponSystem.ts         # Weapon logic
│   │       ├── ProjectileSystem.ts     # Projectile simulation
│   │       ├── DroppedWeaponSystem.ts  # Weapon drops
│   │       ├── PickupSystem.ts         # Item pickups
│   │       └── CharacterPhysicsSystem.ts
│   ├── simulation/
│   │   ├── MovementProfile.ts      # Shared movement physics
│   │   ├── MovementConfig.ts       # Deterministic movement config
│   │   ├── FPSSimulation.ts        # Shared simulation
│   │   ├── Slide.ts / WallJump.ts / LedgeGrab.ts / Acceleration.ts
│   │   └── collision/              # Shared collision
│   ├── world/
│   │   ├── FPSPickup.ts            # FPS pickup subclass
│   │   ├── InventoryManager.ts     # Q3-style ammo + weapon slots
│   │   └── PickupPrompt.ts         # "PRESS [F] TO PICKUP" HUD
│   ├── console/commands/           # Game console commands
│   ├── Game.ts                     # Game loop orchestrator
│   └── FPSPlayer.ts                # Player entity
└── tower/                      # Tower defense game (Git submodule)
```

> Weapon *stats* are not under `games/fps/` — they live in
> `src/shared/entities/definitions/weapons/` so client and server read one table.

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
│   └── definitions/
│       ├── weapons/            # Nine weapon defs + WeaponsTable
│       ├── projectiles/        # Projectile defs
│       ├── ammo/               # Ammo defs
│       └── items.ts            # Health, armor, powerups
├── server/
│   ├── simulation/             # Server-shared simulation (components, physics, types)
│   └── gametype/               # Gametype interfaces, BombModel, AgentDirective
├── net/
│   ├── BinaryProtocol.ts       # Wire format
│   ├── Entity.ts / Component.ts / GameState.ts
├── bsp/
│   ├── BspDataLoader.ts        # BSP-derived gameplay tables
│   ├── SpawnPointTable.ts      # Spawn points per team
│   ├── PickupTable.ts          # Item spawns
│   ├── TriggerTable.ts         # Teleporters and jumppads
│   └── BombSiteTable.ts        # S&D bomb sites
├── demo/
│   ├── DemoReader.ts           # `.shagdemo` decoder
│   ├── DemoAnalyzer.ts         # Highlight detection
│   ├── SequenceBuilder.ts      # Cinematic sequencing
│   └── CinematicCameraPaths.ts # Camera path generation
├── items/
│   ├── Powerups.ts             # Powerup definitions + durations
│   └── ItemGrants.ts           # What a pickup grants
├── bot/
│   └── WeightProfiles.ts       # Bot difficulty weight profiles
├── collision/                  # Shared collision world
├── DeterministicRng.ts         # Seeded RNG (demo re-sim safe)
└── SpreadUtils.ts              # Deterministic weapon spread
```

---

### CLI (`src/cli/`)

Headless command-line tools — no GPU required.

```text
src/cli/
├── headless-game.ts            # Full engine in headless mode (npm run cli:game)
├── headless-bsp.ts             # BSP-only loader (cli:bsp)
├── headless-netserver-v2.ts    # Standalone game server (net:server)
├── headless-netclient.ts       # Headless network client (net:client)
├── lobby-server.ts             # Lobby / matchmaker (lobby:server)
├── bot-server.ts               # Bot Intelligence Server (bot:server)
├── bot-train.ts                # Bot training run (bot:train)
├── bot-analyze.ts              # Bot behaviour analysis (bot:analyze)
├── record-demo.ts              # Scripted demo recording (demo:record)
├── demo-verify.ts              # Deterministic re-sim checksum (demo:verify)
├── anticheat-calibrate.ts      # Telemetry calibration (anticheat:calibrate)
├── server-game.ts              # Game server smoke run (server:game)
├── server-tick.ts              # Tick timing tests (server:tick)
├── server-fuzz.ts              # Protocol fuzzing (server:fuzz)
├── compare-local-vs-server.ts  # Client/server comparison (debug:compare)
├── debug-collision-gravity.ts  # Collision debugging (debug:collision)
├── debug-pickup-full.ts        # Pickup debugging (debug:pickup)
├── test-spawn.ts               # Spawn validation (debug:spawn)
├── test-fps-simulation.ts      # Simulation tests (test:simulation)
├── test-server-physics.ts      # Physics tests (test:physics)
├── convert-fbx.ts              # FBX → glTF conversion (tools:convert)
└── audit-textures.ts           # Texture audit tool (debug:textures)
```

---

### Lobby (`src/lobby/`)

The matchmaker. Runs as its own Node process (`npm run lobby:server`), queues
ready players, spawns dedicated game servers, and hands clients the address to
connect to. It also serves the developer `map` command's one-off dev-spawn and
the demo list.

```text
src/lobby/
├── LobbyServer.ts              # Queue, match formation, teams/sides, demo list
├── LobbyClient.ts              # Browser-side lobby client
├── GameServerSpawner.ts        # Spawns and reaps dedicated game servers
└── types.ts                    # Lobby protocol types
```

---

### Bot Intelligence Server (`src/bot/`)

Bots are **not** an engine subsystem — they are a separate process
(`npm run bot:server`) that joins matches as ordinary networked clients. That
keeps the server honest: a bot goes through the same input path, validation and
lag compensation a human does.

```text
src/bot/
├── BotServer.ts                # Process entry, match join/leave
├── BotClient.ts                # One bot's network client
├── BotBrain.ts                 # Decision root
├── StateMachineBrain.ts        # Deterministic behaviour tree
├── HybridBrain.ts              # State machine + neural policy
├── TFBackend.ts                # TensorFlow.js backend (optional)
├── BotVision.ts                # BSP line-of-sight + target selection
├── BotNavGraph.ts              # Navigation graph + A*
├── BotNavCache.ts              # Cached per-map nav data
├── BotMovementProfile.ts       # Movement/aim skill per difficulty
├── BotWeaponProfile.ts         # Weapon preference and accuracy
├── BotFireSafety.ts            # Self-splash avoidance
├── BotTrainer.ts               # Training loop (bot:train)
├── BotEpisodeRecorder.ts       # Episode capture for training
├── BotRewardComputer.ts        # Reward shaping
├── DemoTrainingExtractor.ts    # Training data from recorded demos
├── goals/                      # Goal definitions
└── sequences/                  # Scripted movement sequences
```

---

### Desktop & Tools (`src/electron/`, `src/tools/`)

```text
src/electron/
├── main.ts                     # Electron main process
└── preload.ts                  # Context-isolated preload bridge

src/tools/
├── MapGenerator.ts             # Procedural .map generation
├── HeightmapGenerator.ts       # Terrain heightmaps
├── generate-map.ts             # CLI entry (tools:map)
└── mapgen.config.json          # Generator configuration
```

---

## Public Assets (`public/`)

```text
public/
├── engine.json                 # Engine configuration (required)
├── engine/                     # Shared engine assets
│   └── fonts/                  # Fonts (Inter, Share Tech Mono)
├── games/                      # Per-game assets
│   └── default/
│       └── animations/         # Shared player animation clips
├── data/                       # PK3 archives (Warsow assets) — gitignored
├── assets/                     # Loose runtime assets
└── wasm/                       # Havok WASM binary
```

> `public/data/` holds the Warsow `.pk3` set and is **gitignored** — every
> developer supplies their own copy. If maps fail to load, that is the first
> thing to check.

---

## Key Singletons

| Class | Access | Purpose |
| ----- | ------ | ------- |
| `CameraSystem` | `CameraSystem.getInstance()` | Camera management |
| `PK3Loader` | `PK3Loader.getInstance()` | Virtual filesystem |
| `Q3ShaderRegistry` | `Q3ShaderRegistry.getInstance()` | Shader lookup |
| `RenderVars` | `RenderVars.getInstance()` | Render configuration |
| `CommandRegistry` | `CommandRegistry.getInstance()` | Console commands |
| `WeaponViewManager` | `WeaponViewManager.getInstance()` | Weapon rendering |
| `ViewportEffectsManager` | `ViewportEffectsManager.getInstance()` | Camera effects |
| `HUDState` | `HUDState.getInstance()` | HUD data aggregator |
| `InputSystem` | `InputSystem.getInstance()` | Input handling |
| `UIManager` | `UIManager.getInstance()` | UI system |
| `NetworkManager` | `NetworkManager.getInstance()` | Client networking |
| `AudioManager` | `AudioManager.getInstance()` | Spatial audio |
