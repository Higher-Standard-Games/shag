# Game Configuration

Central configuration file for game assets and settings.

---

## Location

```
public/game/config.json
```

---

## Structure

```json
{
  "game": {
    "title": "Game Title",
    "version": "1.0.0",
    "startMap": "level1.map"
  },
  "assets": {
    "maps": ["level1.map", "level2.map"],
    "menuMap": "menu_background.map",
    "prefabs": ["tree.map", "rock.map"],
    "music": {
      "menu": "music/menu.ogg",
      "maps": {
        "level1.map": "music/level1.ogg",
        "level2.map": "music/level2.ogg"
      }
    },
    "textures": []
  },
  "settings": {
    "defaultVolume": 0.5,
    "musicEnabled": true,
    "sfxEnabled": true
  }
}
```

---

## Sections

### game

General game information.

| Property | Type | Description |
|----------|------|-------------|
| `title` | string | Game title (shown in browser tab) |
| `version` | string | Version number |
| `startMap` | string | Map to load when starting game |

### assets

Assets to preload during loading screen.

| Property | Type | Description |
|----------|------|-------------|
| `maps` | string[] | Map files to preload |
| `menuMap` | string | Map to show in main menu background |
| `prefabs` | string[] | Prefab files to preload |
| `music.menu` | string | Menu music file path |
| `music.maps` | object | Map name → music file mapping |
| `textures` | string[] | Textures to preload (optional) |

### settings

Default game settings.

| Property | Type | Description |
|----------|------|-------------|
| `defaultVolume` | number | Audio volume 0-1 |
| `musicEnabled` | boolean | Music on/off |
| `sfxEnabled` | boolean | Sound effects on/off |

---

## Asset Paths

### Maps

```
"maps": ["level1.map"]
→ Loads from: /maps/level1.map
```

### Prefabs

```
"prefabs": ["tree.map"]
→ Loads from: /prefabs/tree.map
```

### Music

```
"music": { "menu": "music/menu.ogg" }
→ Loads from: /game/music/menu.ogg
```

### Textures

Textures are loaded on-demand from `/textures/` based on map references.

---

## Loading Process

1. **Config loaded** - `config.json` parsed
2. **Maps loaded** - All maps in `assets.maps` parsed and cached
3. **Prefabs loaded** - All prefabs in `assets.prefabs` parsed and cached
4. **Audio loaded** - Menu and map music files preloaded
5. **Complete** - Loading screen hidden, menu shown

---

## Accessing Config

```typescript
import { AssetLoader } from "./engine/AssetLoader";

const config = AssetLoader.getInstance().getConfig();

console.log(config.game.title);
console.log(config.settings.defaultVolume);
```

---

## Example Configurations

### Minimal

```json
{
  "game": {
    "title": "My Game",
    "version": "0.1.0",
    "startMap": "test.map"
  },
  "assets": {
    "maps": ["test.map"],
    "menuMap": "test.map",
    "prefabs": [],
    "music": {
      "menu": "",
      "maps": {}
    },
    "textures": []
  },
  "settings": {
    "defaultVolume": 0.5,
    "musicEnabled": true,
    "sfxEnabled": true
  }
}
```

### Full Game

```json
{
  "game": {
    "title": "Epic Adventure",
    "version": "1.0.0",
    "startMap": "intro.map"
  },
  "assets": {
    "maps": [
      "intro.map",
      "town.map",
      "forest.map",
      "dungeon.map",
      "boss.map"
    ],
    "menuMap": "menu_scene.map",
    "prefabs": [
      "props/tree.map",
      "props/rock.map",
      "props/chest.map",
      "buildings/house.map",
      "characters/npc_base.map"
    ],
    "music": {
      "menu": "music/title_theme.ogg",
      "maps": {
        "intro.map": "music/intro.ogg",
        "town.map": "music/peaceful_town.ogg",
        "forest.map": "music/forest_ambience.ogg",
        "dungeon.map": "music/dungeon_dark.ogg",
        "boss.map": "music/boss_battle.ogg"
      }
    },
    "textures": []
  },
  "settings": {
    "defaultVolume": 0.7,
    "musicEnabled": true,
    "sfxEnabled": true
  }
}
```

---

## Audio Manager

Access loaded audio:

```typescript
import { AudioManager } from "./engine/AudioManager";

const audio = AudioManager.getInstance();

// Play menu music
audio.playMusic("menu");

// Play map-specific music
audio.playMusic("level1.map");

// Control volume
audio.setVolume(0.5);

// Fade out
audio.fadeOut(2000); // 2 seconds
```

---

## Adding New Config Options

### 1. Update Interface

In `AssetLoader.ts`:

```typescript
export interface GameConfig {
  game: {
    title: string;
    version: string;
    startMap: string;
    myNewOption: string;  // Add here
  };
  // ...
}
```

### 2. Use in Code

```typescript
const config = AssetLoader.getInstance().getConfig();
const myValue = config.game.myNewOption;
```

### 3. Update config.json

```json
{
  "game": {
    "title": "My Game",
    "myNewOption": "my value"
  }
}
```
