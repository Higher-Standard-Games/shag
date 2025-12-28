# Game Paths System

The engine supports configurable game directories via a `--game` flag pattern. This allows switching between different games (e.g., "game" vs "example") without code changes.

## Directory Structure

```
public/
├── engine.json              # Root config: which game to load
├── engine/                  # Shared engine assets (always available)
│   └── fonts/               # Default fonts (Nunito, etc.)
│
├── game/                    # Default game (your main game)
│   ├── config.json          # Game configuration
│   ├── engine-settings.json # Engine overrides for this game
│   ├── data/                # Game data files
│   │   ├── ui-config.json
│   │   ├── hud-config.json
│   │   └── strains.json
│   ├── maps/
│   ├── prefabs/
│   ├── textures/
│   ├── fonts/               # Game-specific fonts (optional)
│   ├── music/
│   └── sounds/
│
└── example/                 # Example/demo game (future)
    ├── config.json
    └── ...
```

## Configuration

### engine.json

Root configuration file that specifies the default game:

```json
{
  "defaultGame": "game",
  "engineAssetsPath": "/engine"
}
```

### Switching Games

Games can be switched via:

1. **URL Parameter** (highest priority):
   ```
   http://localhost:3000/?game=example
   ```

2. **engine.json** (default):
   ```json
   { "defaultGame": "game" }
   ```

3. **Console Command**:
   ```
   game switch example
   ```

## GamePaths API

The `GamePaths` singleton provides centralized path management:

```typescript
import { GamePaths } from './engine/core/GamePaths';

// Initialize (called in main.ts)
await GamePaths.getInstance().init();

// Get current game name
GamePaths.getInstance().getGameName();  // "game"

// Build paths
GamePaths.getInstance().game();           // "/game"
GamePaths.getInstance().maps();           // "/game/maps"
GamePaths.getInstance().maps('level.map'); // "/game/maps/level.map"
GamePaths.getInstance().textures();       // "/game/textures"
GamePaths.getInstance().prefabs();        // "/game/prefabs"
GamePaths.getInstance().data();           // "/game/data"
GamePaths.getInstance().music();          // "/game/music"

// Config file paths
GamePaths.getInstance().configPath();         // "/game/config.json"
GamePaths.getInstance().engineSettingsPath(); // "/game/engine-settings.json"
GamePaths.getInstance().uiConfigPath();       // "/game/data/ui-config.json"
GamePaths.getInstance().hudConfigPath();      // "/game/data/hud-config.json"

// Engine assets (shared)
GamePaths.getInstance().engine();             // "/engine"
GamePaths.getInstance().engine('fonts/Nunito'); // "/engine/fonts/Nunito"

// Asset resolution with fallback (game → engine)
await GamePaths.getInstance().resolve('fonts/Nunito/Nunito-Bold.ttf');
```

## Console Commands

```
game                    # Show current game name and help
game info               # Show all game paths
game load <name>        # Set game (requires reload)
game switch <name>      # Switch game and reload page
game reload             # Reload with current game
```

## Source Code Mapping

The game name matches the source directory:

| Game Name | Source Directory | Public Directory |
|-----------|------------------|------------------|
| `game`    | `src/game/`      | `public/game/`   |
| `example` | `src/example/`   | `public/example/`|

## Asset Resolution

When loading assets, the system tries the game directory first, then falls back to engine:

1. Try: `/{gameName}/fonts/Nunito/Nunito-Bold.ttf`
2. Fallback: `/engine/fonts/Nunito/Nunito-Bold.ttf`
3. Error if not found

This allows games to override engine defaults while sharing common assets.

## Adding a New Game

1. Create directory: `public/example/`
2. Add required files:
   - `config.json` (game title, start map, etc.)
   - `maps/` directory with at least one map
   - Other assets as needed
3. Optionally create `src/example/` for game-specific code
4. Switch to it: `?game=example` or `game switch example`

## Future Enhancements

- Build-time game selection: `npm run build --game=example`
- Game module interface for swappable game code
- Asset pack system for downloadable content
