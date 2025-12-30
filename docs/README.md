# SHAG Engine Documentation

**Standards, High And Games**

A browser-based 3D game engine using Babylon.js with Q3map2/NetRadiant-compatible .map file support.

## Overview

This engine renders 3D environments from standard .map files (TrenchBroom/NetRadiant compatible) with support for:

- **Brush geometry** - Convex solid shapes
- **Patch surfaces** - Bezier curves for smooth geometry
- **Point lights** - Dynamic colored lighting
- **Triggers** - Interactive clickable volumes
- **Prefabs** - Reusable .map files as models
- **2D Sprites** - Animated billboard characters with lighting and shadows
- **Sprite Buildings** - Static 2D sprites for isometric-style buildings with day/night support

## Documentation Index

### Engine Core
| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Engine architecture patterns and conventions |
| [entities.md](./entities.md) | All supported entity types |
| [triggers.md](./triggers.md) | Trigger system and actions |
| [prefabs.md](./prefabs.md) | Prefab/model system (.map and .glb) |
| [MAP_FORMAT.md](./MAP_FORMAT.md) | .map file format specification |
| [config.md](./config.md) | Game configuration |

### Graphics & Rendering
| Document | Description |
|----------|-------------|
| [sprites.md](./sprites.md) | 2D sprite systems (NPCs and buildings) |
| [post-processing.md](./post-processing.md) | Graphics effects (bloom, vignette, SSAO) |
| [weather-effects.md](./weather-effects.md) | Weather system (rain, snow, thunder, fog) |
| [ktx2-textures.md](./ktx2-textures.md) | Compressed texture format |

### UI Systems
| Document | Description |
|----------|-------------|
| [dialogs.md](./dialogs.md) | UI dialog system |
| [HUD_SYSTEM_DESIGN.md](./HUD_SYSTEM_DESIGN.md) | Generic HUD system architecture |
| [ui-scaling.md](./ui-scaling.md) | Cross-platform UI scaling |

### Tools
| Document | Description |
|----------|-------------|
| [map-generator.md](./map-generator.md) | Procedural map generator |
| [DEBUG_CONSOLE.md](./DEBUG_CONSOLE.md) | In-game debug console commands |

### Performance & Optimization
| Document | Description |
|----------|-------------|
| [engine-optimization.md](./engine-optimization.md) | Mobile optimization guide (instancing, LOD, memory) |

### Platform & Build
| Document | Description |
|----------|-------------|
| [capacitor.md](./capacitor.md) | Mobile (Android/iOS) integration |
| [ANDROID_BUILD_GUIDE.md](./ANDROID_BUILD_GUIDE.md) | Android build instructions |

### Game-Specific
| Document | Description |
|----------|-------------|
| [game-systems.md](./game-systems.md) | Core game systems (GameState, Timer, Save) |
| [genetics-system.md](./genetics-system.md) | Plant genetics, breeding, progression |
| [buildable-system.md](./buildable-system.md) | Buildable object system |
| [data-files.md](./data-files.md) | JSON data files for game content |
| [GAME_PATHS.md](./GAME_PATHS.md) | Game progression paths |

## Quick Start

### 1. Project Structure

```
public/
├── game/
│   ├── config.json      # Game configuration
│   └── music/           # Audio files
├── maps/                # .map files
├── prefabs/             # Prefab .map files
└── textures/            # Texture images

src/
├── engine/              # Core engine classes
├── loader/              # Map parsing and asset loading
├── scene/               # Camera and scene management
├── sprites/             # 2D sprite system
└── ui/                  # UI and dialog system
```

### 2. Creating a Map

Use TrenchBroom or NetRadiant to create .map files. The engine supports:

- **Valve 220 format** (recommended)
- **Standard format**

### 3. Coordinate System

| Map File | Babylon.js |
|--------------|------------|
| X (right)    | X (right)  |
| Y (forward)  | Z (forward)|
| Z (up)       | Y (up)     |

The engine automatically converts coordinates when loading maps.

### 4. Textures

Place textures in `public/textures/`. Reference them in your map as:

```
textures/brick/wall01    →  /textures/textures/brick/wall01.jpg
mypath/mytexture         →  /textures/mypath/mytexture.jpg
```

**Special textures:**
- `color_R_G_B` - Solid color (e.g., `color_255_0_0` = red)
- `common/trigger` - Trigger volume (rendered as wireframe)
- `common/caulk` - Editor-only, not rendered

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      main.ts                            │
│  Entry point: Loading → Menu → Game                     │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  AssetLoader  │   │   MainMenu    │   │   GameScene   │
│  Config/Maps  │   │   UI/Audio    │   │  Scene/Camera │
└───────────────┘   └───────────────┘   └───────────────┘
        │                                       │
        ▼                                       ▼
┌───────────────┐                       ┌───────────────┐
│   MapParser   │                       │  MapRenderer  │
│  .map → JSON  │                       │ Entities→Mesh │
└───────────────┘                       └───────────────┘
                                                │
                ┌───────────────┬───────────────┼───────────────┐
                ▼               ▼               ▼               ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │BrushGenerator│ │PatchGenerator│ │PrefabInstance│ │SpriteManager│
        │  Brushes    │ │   Curves    │ │   Models    │ │  2D NPCs   │
        └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

## Key Classes

| Class | Purpose |
|-------|---------|
| `AssetLoader` | Loads config, maps, audio |
| `MapParser` | Parses .map file format |
| `MapRenderer` | Converts entities to meshes |
| `BrushGenerator` | Creates brush geometry |
| `PatchGenerator` | Creates curved surfaces |
| `TextureManager` | Loads and caches textures |
| `PrefabLoader` | Loads prefab .map files |
| `PrefabInstance` | Instantiates prefabs |
| `SpriteManager` | Manages 2D NPC sprites |
| `BillboardSprite` | Individual NPC sprite instance |
| `SpriteBuildingManager` | Manages static sprite buildings |
| `SpriteBuilding` | Individual sprite building instance |
| `RTSCameraController` | Isometric camera controls |
| `UIManager` | Dialog management |
| `SpawnValidator` | Validates dynamic spawning |
| `SaveManager` | Game-level save/load orchestration |
| `PersistenceManager` | Engine-level save infrastructure |
| `GameHUD` | In-game heads-up display |
| `UIScale` | Cross-platform UI scaling system |
| `HUDManager` | Declarative HUD component system |

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint
```
