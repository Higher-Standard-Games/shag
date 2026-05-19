# SHAG Engine

A Babylon.js game engine for Quake 3 / Warsow-style multiplayer games. Handles BSP map loading, PK3 asset management, server-authoritative networking, and Q3-style physics out of the box.

## Features

### Map & Asset Pipeline
- **BSP Map Loading** — Quake 3 `.bsp` and Warsow FBSP format support with full geometry, lightmaps, and entity parsing
- **PK3 Virtual Filesystem** — Loads and resolves assets from Quake 3 `.pk3` archives
- **Q3 Shader System** — Parses and renders Quake 3 shader scripts (animated textures, blending, deformations)
- **Skybox Loading** — Skybox rendering from BSP-referenced cubemap textures

### Networking
- **Binary Protocol** — Compact binary serialization for game state snapshots and input commands
- **WebSocket + WebTransport** — Dual transport support for client-server communication
- **Snapshot Interpolation** — Client-side entity interpolation between server snapshots
- **Delta Compression** — Bandwidth-efficient state sync via delta-encoded snapshots

### Server
- **Headless Game Server** — Dedicated CLI server with ECS architecture
- **Lag Compensation** — Server-side lag compensation for hit detection
- **PVS (Potentially Visible Set)** — BSP-based visibility culling for snapshot broadcasting
- **Tick System** — Fixed-rate server tick loop (125Hz default)
- **Replay System** — Server-side recording and playback

### Physics & Movement
- **BSP Collision** — Swept AABB traces against BSP geometry, patch tessellation
- **Character Controller** — Player physics with ground/air movement, gravity, friction
- **Movement Vars** — Data-driven movement parameters (speed, gravity, air control, jump height)

### Rendering & Animation
- **Skeletal Animation** — GLB model loading with animation blending and bone attachment
- **Camera System** — Modular camera controllers (FPS, Freefly, Isometric, SideScroll, Follow)
- **Lighting** — Dynamic and BSP-baked lighting
- **Weather Effects** — Rain, snow, wind, fog, and debris particle systems
- **Sprites** — 2D sprite rendering in 3D space

### UI
- **HUD Framework** — Scalable HUD system with components (health, armor, ammo, crosshair)
- **Debug Console** — Quake-style dropdown console with command system and cvars
- **Loading Screen** — Map loading overlay with progress indication
- **Menu System** — Modal panels, side panels, bottom bar
- **UI Scaling** — Resolution-independent UI with configurable scale

### Input
- **Keyboard & Mouse** — Input capture with key state tracking (down, pressed, released)
- **Mouse Delta** — Raw mouse movement for FPS camera control

### Other
- **Audio Manager** — Music and sound effects with browser audio policy handling
- **EventBus** — Pub/sub event system for decoupled communication
- **Spawn System** — Spawn point management with validation
- **Weapon System** — Weapon definitions, projectile/hitscan types, barrel sub-models
- **Buildable System** — Data-driven buildable objects with stages, production, and decay
- **Persistence** — Save/load system with localStorage backend

## Architecture

```
src/engine/
├── core/           # EventBus, GamePaths, GameTimer, settings
├── camera/         # Camera controllers (FPS, Freefly, Isometric, SideScroll, Follow)*
├── console/        # Console system, command registry, cvars
├── input/          # Keyboard/mouse input handling
├── loader/         # BSP, PK3, shader, texture, model loading
├── network/        # Client networking, protocol, snapshot interpolation
├── server/         # Headless game server, ECS, lag compensation, PVS
├── physics/        # BSP collision, swept AABB, player physics
├── movement/       # Character controller, movement variables
├── animation/      # Skeletal animation, GLB models
├── rendering/      # Render pipeline
├── lighting/       # Dynamic and baked lighting
├── effects/        # Weather, particles
├── sprites/        # 2D sprite system
├── ui/             # HUD, menus, loading screen, panels
├── weapon/         # Weapon definitions and systems*
├── spawn/          # Spawn point management
├── player/         # Player profiles
├── entities/       # Entity management
├── game/           # Pickup framework, inventory (currently FPS-flavoured)*
├── debug/          # Debug console and tools
├── viewport/       # Viewport effects (FPS-flavoured fields like wallJumpState)*
├── procedural/     # Procedural texture generation
├── math/           # Math utilities
├── MapRenderer.ts  # BSP map renderer
├── AudioManager.ts # Audio system
├── BuildableSystem.ts # Generic buildable framework (used by external SHAG games)
├── SpawnValidator.ts  # Generic spawn-validation hook (used by external SHAG games)
└── EngineScene.ts  # Main scene manager
```

> `*` marks subdirs that contain code currently coupled to the FPS game in
> `src/games/fps`. These are slated for cleanup — see
> `docs/research/0.9.13-QA-improvements.md` for the plan.

## Quick Start

```typescript
import { CameraSystem } from "@/engine/camera";
import { ConsoleSystem } from "@/engine/console";

// Set camera mode
CameraSystem.getInstance().setMode('fps');

// Load a BSP map
await ConsoleSystem.getInstance().execute('map wdm2');
```

## Version

Current version: **0.9.13** (see `src/engine/version.txt`)

See `docs/changelog/` for version history.
