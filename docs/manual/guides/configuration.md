# Engine Configuration

SHAG Engine uses a central configuration file to define game paths, browser title, and security settings.

## engine.json

Create `public/engine.json` in your project root. This file is **required** - the engine will throw an error if it's missing.

### Minimal Configuration

```json
{
  "defaultGame": "game"
}
```

### Full Configuration

```json
{
  "defaultGame": "game",
  "engineAssetsPath": "/engine",
  "title": "My Game Title",
  "allowGameOverride": false
}
```

## Options

### defaultGame (required)

The game directory name under `public/`. This determines where game assets are loaded from.

```json
{
  "defaultGame": "mygame"
}
```

Asset paths will resolve to:
- Maps: `/mygame/maps/`
- Audio: `/mygame/audio/`
- Data: `/mygame/data/`

### engineAssetsPath

Path to shared engine assets. Defaults to `/engine`.

```json
{
  "engineAssetsPath": "/engine"
}
```

### title

Browser tab title. If not set, defaults to "SHAG Engine v{version}".

```json
{
  "title": "My Awesome Game"
}
```

### allowGameOverride

**Security option.** When `true`, allows the `?game=` URL parameter to override the default game directory.

```json
{
  "allowGameOverride": true
}
```

| Value | Behavior |
|-------|----------|
| `true` | `?game=other` loads from `/other/` directory |
| `false` or missing | `?game=` parameter is ignored (warning logged) |

**Recommendation:** 
- Set `true` during development to test different game directories
- Set `false` or remove for production builds

## Usage Example

### Development (multiple games)

```json
{
  "defaultGame": "game",
  "allowGameOverride": true
}
```

Test different games:
- `http://localhost:5173/` → loads `/game/`
- `http://localhost:5173/?game=demo` → loads `/demo/`
- `http://localhost:5173/?game=test` → loads `/test/`

### Production (locked)

```json
{
  "defaultGame": "mygame",
  "title": "My Game",
  "allowGameOverride": false
}
```

The `?game=` parameter is ignored for security.

## Directory Structure

```
public/
├── engine.json          # Engine configuration
├── engine/              # Shared engine assets
│   ├── fonts/
│   └── textures/
├── game/                # Default game (or your game name)
│   ├── maps/
│   ├── audio/
│   └── data/
└── demo/                # Additional game (if allowGameOverride: true)
    ├── maps/
    └── ...
```

## GamePaths API

Access configuration in code via `GamePaths`:

```typescript
import { GamePaths } from './engine/core/GamePaths';

// After init()
const paths = GamePaths.getInstance();

paths.getGameName();    // "game"
paths.getGameTitle();   // "My Game Title" or null
paths.maps('level.map'); // "/game/maps/level.map"
paths.audio('music.mp3'); // "/game/audio/music.mp3"
paths.data('config.json'); // "/game/data/config.json"
paths.engine('font.ttf'); // "/engine/font.ttf"
```

## Error Handling

The engine throws clear errors for configuration issues:

```
[GamePaths] Missing engine.json - create public/engine.json with { "defaultGame": "game" }
```

```
[GamePaths] engine.json missing "defaultGame" field
```

If `?game=` is used but not allowed:
```
[GamePaths] ?game= ignored - set allowGameOverride: true in engine.json to enable
```
