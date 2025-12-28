# SHAG Engine

**Standards, High And Games**

A lightweight, modular game engine built on Babylon.js for creating isometric and 3D games.

## Features

- **Map System** - Q3map2/NetRadiant-compatible .map file loading
- **Prefab System** - Reusable object templates with entity support
- **BuildableSystem** - Data-driven buildable objects with stages, production, and decay
- **Camera System** - RTS-style camera with smooth movement and zoom
- **UI Framework** - Scalable HUD system with responsive design
- **Audio Manager** - Music and sound effects with browser audio policy handling
- **Weather Effects** - Rain, snow, wind, fog, and debris particles
- **Debug Console** - Quake-style dropdown console with command system
- **Persistence** - Save/load system with localStorage backend

## Architecture

```
src/engine/
├── core/           # Core systems (EventBus, GamePaths, Persistence)
├── camera/         # Camera controllers (RTS, Free)
├── ui/             # UI components (HUD, BottomBar, LoadingScreen)
├── loader/         # Asset loading (Maps, Prefabs, Textures)
├── debug/          # Debug console and commands
├── effects/        # Visual effects (Weather, Particles)
└── BuildableSystem.ts  # Buildable object framework
```

## Quick Start

```typescript
import { GameScene } from './engine/GameScene';

const game = GameScene.getInstance();
await game.start('maps/main.map');
```

## Version

See the changelog in the docs folder for version history.
