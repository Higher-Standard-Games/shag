# Engine Configuration

SHAG Engine uses a central configuration file to define game paths and browser title. Game selection happens at **build time**, ensuring each build is self-contained.

## engine.json

Create `public/engine.json` in your project root. This file is **required** - the engine will throw an error if it's missing.

### Minimal Configuration

```json
{
  "defaultGame": "default"
}
```

### Full Configuration

```json
{
  "defaultGame": "default",
  "engineAssetsPath": "/engine",
  "title": "My Game Title"
}
```

## Options

### defaultGame (required)

The game directory name. This determines:
- **Source code**: `src/games/{defaultGame}/` - bundled at build time
- **Assets**: `public/games/{defaultGame}/` - loaded at runtime

```json
{
  "defaultGame": "mygame"
}
```

Asset paths will resolve to:
- Maps: `/games/mygame/maps/`
- Audio: `/games/mygame/audio/`
- Data: `/games/mygame/data/`

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

## Build-Time Game Selection

Games are selected at **build time**, not runtime. This ensures:
- Only the selected game's code is bundled
- Clean separation between engine and game code
- Self-contained builds for distribution

### Default Build

Uses the game specified in `engine.json`:

```bash
npm run build
```

### Override with Environment Variable

Build a different game by setting `GAME`:

```bash
# Windows PowerShell
$env:GAME="demo"; npm run build

# Linux/macOS
GAME=demo npm run build
```

### Development Server

```bash
# Use default game
npm run dev

# Use different game
$env:GAME="demo"; npm run dev
```

## Directory Structure

```
project/
├── src/
│   └── games/
│       ├── default/         # Default game source
│       │   ├── GameScene.ts
│       │   ├── ui/
│       │   └── ...
│       └── demo/            # Another game (build with GAME=demo)
│           └── ...
└── public/
    ├── engine.json          # Engine configuration
    ├── engine/              # Shared engine assets
    │   ├── fonts/
    │   └── textures/
    └── games/
        ├── default/         # Default game assets
        │   ├── maps/
        │   ├── data/
        │   └── music/
        └── demo/            # Demo game assets
            └── ...
```

## @game Import Alias

Use the `@game` alias to import from the selected game's source:

```typescript
// In main.ts or engine code
import { GameScene } from "@game/GameScene";
import { SaveManager } from "@game/SaveManager";
```

The alias resolves to `src/games/{selectedGame}/` at build time.

## GamePaths API

Access runtime asset paths via `GamePaths`:

```typescript
import { GamePaths } from './engine/core/GamePaths';

// After init()
const paths = GamePaths.getInstance();

paths.getGameName();     // "default"
paths.getGameTitle();    // "My Game Title" or null
paths.maps('level.map'); // "/games/default/maps/level.map"
paths.music('theme.mp3'); // "/games/default/music/theme.mp3"
paths.data('config.json'); // "/games/default/data/config.json"
paths.engine('font.ttf'); // "/engine/font.ttf"
```

## Customizing UI Styles

Games can customize the engine's UI colors before initialization.

### Console Colors

The debug console uses the SHAG logo palette by default. Customize via `UIStyles.setConsoleColors()`:

```typescript
import { UIStyles } from './engine/ui/UIStyles';

// Call BEFORE UIStyles.injectBase() or any UI initialization
UIStyles.setConsoleColors({
  primary: '#ff6600',      // Main accent color
  primaryDim: 'rgba(255, 102, 0, 0.4)',
  primaryGlow: 'rgba(255, 102, 0, 0.6)',
  error: '#ff4444',
  warn: '#ffaa00',
  success: '#44ff44',
});
```

Available color keys:
- `primary`, `primaryDim`, `primaryGlow` - Main accent
- `orange`, `yellow`, `teal`, `magenta`, `green` - SHAG palette
- `error`, `warn`, `info`, `success` - Semantic colors
- `text`, `textBright`, `textDim` - Text colors
- `bg`, `bgHeader`, `bgInput` - Background colors

### Loading Screen Colors

The loading screen uses the SHAG logo palette defined in `LoadingScreen.ts`:
- Orange: `#E85D04`
- Yellow: `#FAC748`
- Teal: `#2EC4B6`
- Magenta: `#E040FB`
- Green: `#4ADE80`

## Error Handling

The engine throws clear errors for configuration issues:

```
[GamePaths] Missing engine.json - create public/engine.json with { "defaultGame": "default" }
```

```
[GamePaths] engine.json missing "defaultGame" field
```
