# Cvar System

Quake/Warsow-style console variables for engine and game configuration.

## Overview

Cvars (console variables) are typed, persistent configuration values that integrate seamlessly with the console. They provide:

- **Type-safe** get/set with validation
- **Automatic persistence** to localStorage
- **Change callbacks** for reactive updates
- **Console integration** with autocomplete
- **Min/max bounds** checking

## Naming Conventions

| Prefix | Category | Examples |
|--------|----------|----------|
| `r_` | Render/graphics | `r_bloom`, `r_wireframe` |
| `s_` | Sound/audio | `s_volume`, `s_musicenabled` |
| `g_` | Game settings | `g_autosave`, `g_cheats` |
| `ui_` | UI settings | `ui_scale`, `ui_opacity` |
| `cam_` | Camera | `cam_fov`, `cam_sensitivity` |
| `con_` | Console | `con_height`, `con_speed` |

## Using Cvars

### Console

```
r_bloom              # Print current value
r_bloom 0.5          # Set value
toggle s_musicenabled   # Toggle boolean
cvarlist             # List all cvars
cvarlist r_          # List r_* cvars only
reset r_bloom        # Reset to default
resetall             # Reset all cvars
cvarexport           # Export modified cvars
```

### Code

```typescript
import { Cvar } from './engine/core/Cvar';

// Get value (type-safe)
const bloom = Cvar.get<number>('r_bloom');
const musicOn = Cvar.get<boolean>('s_musicenabled');

// Set value
Cvar.set('r_bloom', 0.5);
Cvar.set('s_musicenabled', false);

// Toggle boolean
Cvar.toggle('s_musicenabled');

// Reset
Cvar.reset('r_bloom');
Cvar.resetAll();
```

## Registering Cvars

### Basic Registration

```typescript
Cvar.register('g_difficulty', 1, {
  type: 'int',
  min: 0,
  max: 3,
  description: 'Game difficulty (0=Easy, 3=Hard)',
});
```

### With Change Callback

```typescript
Cvar.register('s_volume', 0.5, {
  type: 'float',
  min: 0,
  max: 1,
  description: 'Music volume',
  onChange: (value) => {
    AudioManager.getInstance().setMusicVolume(value as number);
  },
});
```

### Boolean Cvar

```typescript
Cvar.register('g_cheats', false, {
  type: 'bool',
  description: 'Enable cheat commands',
  persist: false,  // Don't save to localStorage
});
```

### String Cvar

```typescript
Cvar.register('player_name', 'Player', {
  type: 'string',
  description: 'Player display name',
});
```

## Registration Options

```typescript
interface CvarOptions {
  type?: 'bool' | 'int' | 'float' | 'string';  // Default: auto-detect
  min?: number;           // Minimum value (numeric types)
  max?: number;           // Maximum value (numeric types)
  description?: string;   // Shown in cvarlist
  persist?: boolean;      // Save to localStorage (default: true)
  onChange?: (value) => void;  // Called on value change
}
```

## Built-in Cvar Commands

| Command | Description |
|---------|-------------|
| `cvarlist [filter]` | List cvars, optionally filtered |
| `toggle <cvar>` | Toggle boolean cvar |
| `reset <cvar>` | Reset cvar to default |
| `resetall` | Reset all cvars to defaults |
| `set <cvar> <value>` | Explicit set (alternative syntax) |
| `cvarexport` | Export all modified cvars |

## Registered Engine Cvars

### Render (r_*)

| Cvar | Type | Range | Default | Description |
|------|------|-------|---------|-------------|
| `r_normalmap` | float | 0-4 | 1 | Normal map intensity |
| `r_glossmap` | float | 0-4 | 1 | Specular/gloss intensity |
| `r_lightmap` | float | 0-4 | 1 | Lightmap intensity |
| `r_ambient` | float | 0-4 | 1 | Ambient light intensity |
| `r_emissive` | float | 0-4 | 1 | Emissive/glow intensity |
| `r_anisotropy` | int | 1-16 | 8 | Anisotropic filtering |
| `r_bloom` | float | 0-3 | 1 | Bloom intensity |
| `r_exposure` | float | 0-3 | 1 | Exposure multiplier |
| `r_contrast` | float | 0-3 | 1 | Contrast multiplier |
| `r_wireframe` | int | 0-1 | 0 | Per-mesh wireframe |
| `r_showtris` | int | 0-1 | 0 | Scene wireframe |
| `r_lightintensity` | float | 0-4 | 1 | Global light multiplier |

### Audio (s_*)

| Cvar | Type | Range | Default | Description |
|------|------|-------|---------|-------------|
| `s_volume` | float | 0-1 | 0.5 | Music volume |
| `s_musicenabled` | bool | - | true | Music enabled |
| `s_sfxvolume` | float | 0-1 | 0.5 | SFX volume |
| `s_sfxenabled` | bool | - | true | SFX enabled |

### Game (g_*)

| Cvar | Type | Range | Default | Description |
|------|------|-------|---------|-------------|
| `g_autosave` | bool | - | true | Enable autosave |
| `g_cheats` | bool | - | false | Enable cheats |

## Persistence

Cvars persist to localStorage by default:

```typescript
// Persisted (default)
Cvar.register('r_bloom', 1.0);

// Not persisted
Cvar.register('g_cheats', false, { persist: false });
```

Storage key: `engine_cvars`

### Export/Import

```typescript
// Export modified cvars as config string
const config = Cvar.exportConfig();
// Returns: "r_bloom 0.5\ns_volume 0.8"

// Import config string
const result = Cvar.importConfig(config);
console.log(`Applied ${result.applied} cvars`);
```

## Architecture

```
Cvar (Static Class)
    │
    ├── cvars: Map<name, CvarInstance>
    │
    ├── register(name, default, options)
    ├── get<T>(name) → T
    ├── set(name, value)
    ├── toggle(name)
    ├── reset(name)
    ├── resetAll()
    │
    ├── exportConfig() → string
    └── importConfig(config) → result

ConsoleCommandRegistry
    │
    └── Auto-registers cvars as commands
        └── "r_bloom" → get/set r_bloom
```

## Game Integration

Games register their own cvars in `GameCommands.ts`:

```typescript
export function registerGameCommands(): void {
  // Register game cvars
  Cvar.register('g_difficulty', 1, {
    type: 'int',
    min: 0,
    max: 3,
    description: 'Game difficulty',
    onChange: (v) => setDifficulty(v as number),
  });

  Cvar.register('g_timescale', 1.0, {
    type: 'float',
    min: 0.1,
    max: 10,
    description: 'Game speed multiplier',
  });
}
```

## Related

- [Console System](./console-system.md)
- [Render Variables](./render-variables.md)
