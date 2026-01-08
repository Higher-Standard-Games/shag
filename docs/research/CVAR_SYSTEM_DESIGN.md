# Cvar System Design

Design document for the unified console variable (cvar) system.

## Background

### Problem

The engine had multiple, disconnected systems for managing configuration:

1. **RenderVars** - r_* variables with custom get/set
2. **AudioManager** - Separate volume/enabled settings
3. **Console commands** - Manual argument parsing for each command
4. **SettingsPanel** - UI that directly called engine methods

This led to:
- Duplicated persistence logic
- No unified console interface
- Complex autocomplete management
- Games had no easy way to add their own settings

### Solution

Implement a Quake/Warsow-style cvar system that:
- Provides a single API for all configuration values
- Auto-integrates with the console (commands + autocomplete)
- Handles persistence automatically
- Supports reactive updates via callbacks

## Design Goals

1. **Type-safe** - TypeScript-friendly get/set with proper types
2. **Unified** - One system for engine, renderer, audio, and game settings
3. **Persistent** - Automatic localStorage persistence
4. **Reactive** - onChange callbacks for immediate effect
5. **Console-first** - Cvars are console commands automatically
6. **Extensible** - Games can register their own cvars easily

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                         Cvar                                │
│  Static class managing all console variables                │
├─────────────────────────────────────────────────────────────┤
│  - cvars: Map<string, CvarInstance>                         │
│  - register(name, default, options)                         │
│  - get<T>(name): T                                          │
│  - set(name, value): boolean                                │
│  - toggle(name): boolean                                    │
│  - reset(name) / resetAll()                                 │
│  - exportConfig() / importConfig(config)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Auto-registers as commands
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                ConsoleCommandRegistry                       │
│  Manages console commands and autocomplete                  │
├─────────────────────────────────────────────────────────────┤
│  - registerCvar(name) - called by Cvar.register             │
│  - getAutocomplete() - includes all cvar names              │
│  - Built-in commands: cvarlist, toggle, reset, etc.         │
└─────────────────────────────────────────────────────────────┘
```

### CvarInstance Structure

```typescript
interface CvarInstance {
  name: string;
  type: 'bool' | 'int' | 'float' | 'string';
  value: CvarValue;
  defaultValue: CvarValue;
  min?: number;
  max?: number;
  description: string;
  persist: boolean;
  onChange?: (value: CvarValue) => void;
}
```

### Type Handling

| Type | Storage | Console Parsing | Validation |
|------|---------|-----------------|------------|
| bool | boolean | "0"/"1"/"true"/"false" | Coerce to boolean |
| int | number | parseInt | Round + clamp to min/max |
| float | number | parseFloat | Clamp to min/max |
| string | string | Raw value | None |

## Implementation Details

### Initialization Flow

```
1. registerEngineCommands() called at startup
2. Cvar.init() - loads persisted values from localStorage
3. RenderVars.registerCvars() - registers all r_* cvars
4. AudioManager.registerCvars() - registers all s_* cvars
5. registerGameCommands() - registers game g_* cvars
```

### Console Command Integration

When a cvar is registered, it becomes a console command:

```
"r_bloom"     → Print current value and info
"r_bloom 0.5" → Set to 0.5
```

The ConsoleCommandRegistry checks for cvars before unknown command error.

### Persistence Strategy

```typescript
// Storage key
const STORAGE_KEY = 'engine_cvars';

// Only persist non-default values
function save() {
  const data: Record<string, CvarValue> = {};
  for (const [name, cvar] of cvars) {
    if (cvar.persist && cvar.value !== cvar.defaultValue) {
      data[name] = cvar.value;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
```

### Reactive Updates

onChange callbacks fire immediately on set:

```typescript
Cvar.register('s_volume', 0.5, {
  onChange: (v) => AudioManager.setVolume(v)
});

Cvar.set('s_volume', 0.8);  // Immediately calls AudioManager.setVolume(0.8)
```

## Naming Convention Rationale

Following Quake/idTech convention:

| Prefix | Meaning | Rationale |
|--------|---------|-----------|
| `r_` | Render | Standard for graphics settings |
| `s_` | Sound | Standard for audio settings |
| `g_` | Game | Game-specific settings |
| `ui_` | UI | User interface settings |
| `cam_` | Camera | Camera control settings |
| `con_` | Console | Console settings |
| `sv_` | Server | Server/multiplayer settings |
| `cl_` | Client | Client/networking settings |

This makes it easy to:
- Filter cvars by category (`cvarlist r_`)
- Identify cvar purpose at a glance
- Maintain consistency with classic engines

## Migration Path

### Existing Systems

| System | Before | After |
|--------|--------|-------|
| RenderVars | Custom get/set, own persistence | Calls Cvar.register, keeps rendering logic |
| AudioManager | Direct properties | Cvar callbacks update properties |
| SettingsPanel | Calls engine methods | Can use Cvar.set (optional) |

### Incremental Migration

Systems don't need full rewrite. Pattern:

```typescript
// In system's registerCvars() method
Cvar.register('s_volume', this.musicVolume, {
  onChange: (v) => this.setMusicVolume(v as number)
});
```

The system keeps its internal state; cvar routes changes to it.

## Built-in Commands

| Command | Implementation |
|---------|----------------|
| `cvarlist [filter]` | List all cvars, filter by prefix |
| `toggle <name>` | Toggle boolean, error if not bool |
| `reset <name>` | Set to defaultValue |
| `resetall` | Reset all cvars |
| `set <name> <value>` | Alternative to `name value` |
| `cvarexport` | Export modified cvars as config |

## Future Considerations

### Potential Extensions

1. **Cvar flags** - CHEAT, READONLY, SERVERINFO, USERINFO
2. **Archive categories** - Separate config files per category
3. **Network sync** - Server can enforce certain cvars
4. **UI binding** - Auto-generate settings UI from cvars
5. **Cvar aliases** - Shorthand names

### Config File Support

```
// autoexec.cfg
r_bloom 0.5
s_volume 0.8
g_difficulty 2
```

Could be loaded on startup, executed line by line.

## References

- Quake 3 cvar system: https://github.com/id-Software/Quake-III-Arena
- Warsow engine: https://github.com/Warsow/qfusion
- idTech 4 cvar documentation
