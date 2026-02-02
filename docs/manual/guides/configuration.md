# Engine Configuration

SHAG Engine uses environment variables and optional configuration files to control game builds and paths.

## Game Selection

Games are selected at **build time** via the `GAME` environment variable. This determines which game submodule's code is bundled.

### Development

```bash
# Use default game (fps)
npm run dev

# Use different game submodule
GAME=newgame npm run dev

# Windows PowerShell
$env:GAME="newgame"; npm run dev
```

### Production Build

```bash
# Build default game
npm run build

# Build specific game
GAME=demo npm run build
```

## Directory Structure

```
shag-engine/
├── src/
│   ├── engine/           # Engine code (always included)
│   └── games/            # Game submodules
│       ├── fps/          # → git submodule (wash-fps)
│       └── newgame/      # → git submodule (another game)
├── public/
│   ├── engine/           # Engine assets (fonts) - IN GIT
│   └── data/             # Game data - GITIGNORED
│       ├── maps/
│       ├── textures/
│       └── *.pk3
├── vite.config.ts
└── package.json
```

## @game Import Alias

Use the `@game` alias to import from the selected game's source:

```typescript
// In main.ts or engine code
import { GameScene } from "@game/GameScene";
import { PlayerController } from "@game/PlayerController";
```

The alias resolves to `src/games/${GAME}/` at build time.

## Game Submodules

Games are git submodules under `src/games/`. This allows:
- Separate git history for each game
- Independent versioning
- Easy switching between games

### Adding a Game Submodule

```bash
git submodule add git@github.com:you/my-game.git src/games/mygame
git commit -m "Add mygame submodule"
```

### Updating a Submodule

```bash
cd src/games/fps
git pull origin main
cd ../..
git add src/games/fps
git commit -m "chore: update fps submodule"
```

### Cloning with Submodules

```bash
git clone --recursive https://github.com/Higher-Standard-Games/shag.git
# Or if already cloned:
git submodule update --init --recursive
```

## Game Data

Game data (maps, pk3 files, textures) is **not stored in git**. Place assets in `public/data/`:

```
public/data/
├── maps/           # .bsp and .map files
├── textures/       # Texture images
├── music/          # Audio files
└── *.pk3           # PK3 packages
```

> [!NOTE]
> The `public/data/` directory is gitignored. Each developer downloads game data separately.

## GamePaths API

Access runtime asset paths via `GamePaths`:

```typescript
import { GamePaths } from './engine/core/GamePaths';

// After init()
const paths = GamePaths.getInstance();

paths.getGameName();     // "fps"
paths.data('maps/level.bsp');   // "/data/maps/level.bsp"
paths.engine('fonts/Nunito.ttf'); // "/engine/fonts/Nunito.ttf"
```

## Legacy: engine.json (Optional)

For backwards compatibility, you can still use `public/engine.json`:

```json
{
  "defaultGame": "fps",
  "engineAssetsPath": "/engine",
  "title": "My Game"
}
```

However, the `GAME` environment variable takes precedence.

## Customizing UI Styles

Games can customize the engine's UI colors before initialization.

### Console Colors

```typescript
import { UIStyles } from './engine/ui/UIStyles';

// Call BEFORE UIStyles.injectBase()
UIStyles.setConsoleColors({
  primary: '#ff6600',
  primaryDim: 'rgba(255, 102, 0, 0.4)',
  primaryGlow: 'rgba(255, 102, 0, 0.6)',
  error: '#ff4444',
  warn: '#ffaa00',
  success: '#44ff44',
});
```

Available color keys:
- `primary`, `primaryDim`, `primaryGlow` - Main accent
- `error`, `warn`, `info`, `success` - Semantic colors
- `text`, `textBright`, `textDim` - Text colors
- `bg`, `bgHeader`, `bgInput` - Background colors
