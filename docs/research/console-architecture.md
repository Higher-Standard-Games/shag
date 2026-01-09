# Console Architecture Refactoring

**Status:** Planning  
**Target Version:** 0.9.0  
**Branch:** `feature/console-refactor` (not created yet)

## Overview

Refactor the console system from a monolithic debug tool into a proper engine subsystem with clean architecture, auto-discovery of commands, and clear separation between cvars and commands.

## Current Problems

1. **Monolithic EngineCommands.ts** - 4600+ lines, unmaintainable
2. **Separate autocomplete JSON** - Definitions disconnected from handlers
3. **Lives in `debug/`** - Console is core infrastructure, not just debug
4. **No auto-discovery** - Commands hardcoded in registration function
5. **Unclear Cvar vs Command relationship** - Both accessible from console but different concepts

---

## Proposed Structure

```
src/engine/console/
├── index.ts                    # Public exports
├── Console.ts                  # UI (the dropdown console)
├── console.css                 # Styles
├── CommandRegistry.ts          # Registration + autocomplete
├── Command.ts                  # Base command class
├── CommandParser.ts            # Argument parsing utilities
│
└── commands/                   # One file per command
    ├── index.ts                # Auto-discovery loader
    │
    ├── AudioCommand.ts         # audio play, stop, volume
    ├── BspCommand.ts           # bsp info, stats
    ├── CameraCommand.ts        # camera mode, fov
    ├── DebugCommand.ts         # debug overlays
    ├── DebrisCommand.ts        # debris effects
    ├── ExportCommand.ts        # export settings
    ├── FogCommand.ts           # fog settings
    ├── FreeflyCommand.ts       # freefly_speed, freefly_collision
    ├── GameCommand.ts          # game state commands
    ├── HudCommand.ts           # hud show, hide
    ├── MapCommand.ts           # map load, reload, info
    ├── MemCommand.ts           # mem info, gc
    ├── PK3Command.ts           # pk3 load, index, list
    ├── PvsCommand.ts           # pvs debug
    ├── RenderCommand.ts        # r_list, r_reset, r_export
    ├── SceneCommand.ts         # scene info, entities
    ├── ShaderCommand.ts        # shader info, aim
    ├── ShowFpsCommand.ts       # show_fps
    ├── TimeCommand.ts          # time set, speed
    ├── UICommand.ts            # ui scale, theme
    ├── WeatherCommand.ts       # weather rain, snow
    └── WindCommand.ts          # wind settings
```

---

## Cvars vs Commands

### Conceptual Difference

| Aspect | Cvar | Command |
|--------|------|---------|
| **Purpose** | Store a value/setting | Perform an action |
| **State** | Has persistent state | Stateless (usually) |
| **Examples** | `r_bloom 0.5`, `s_volume 0.8` | `map load dm1`, `mem gc` |
| **Persistence** | Saved to localStorage | Not saved |
| **Type** | Typed value (bool, int, float, string) | Arguments vary |

### Quake Behavior (our reference)

In Quake/idTech engines:
- **Cvars** are typed variables: `r_fullscreen 1`, `sensitivity 3.5`
- **Commands** are actions: `map dm1`, `disconnect`, `screenshot`
- Both are typed in console the same way
- Typing cvar name alone prints value: `r_bloom` → `r_bloom is 0.5`
- Typing cvar with value sets it: `r_bloom 1.2` → sets value

### Current Implementation

We already have this with the Cvar system:
```typescript
Cvar.register('r_bloom', 1.0, { min: 0, max: 3, onChange: (v) => setBloom(v) });
// Console: "r_bloom" prints value, "r_bloom 0.5" sets it
```

### Proposed Relationship

```
┌─────────────────────────────────────────────────────────┐
│                    Console Input                         │
│                   "r_bloom 0.5"                          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  CommandRegistry                         │
│  1. Check if input matches a registered Command          │
│  2. If not, check if it matches a registered Cvar        │
│  3. If Cvar, get/set value                              │
│  4. If neither, show "unknown command"                   │
└─────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌──────────┐            ┌──────────┐
       │ Command  │            │   Cvar   │
       │ .execute │            │ get/set  │
       └──────────┘            └──────────┘
```

### Decision: Keep Separate

- **Cvars** remain in `src/engine/core/Cvar.ts`
- **Commands** live in `src/engine/console/commands/`
- **CommandRegistry** handles both, but they're conceptually different
- Cvars auto-register to console (current behavior, keep it)

---

## Auto-Discovery System

### Requirements

1. Engine commands auto-discovered from `src/engine/console/commands/`
2. Game commands auto-discovered from `src/games/{game}/console/commands/`
3. No hardcoded imports - just drop a file and it registers
4. Works with Vite's build system

### Option A: Vite Glob Import (Recommended)

```typescript
// src/engine/console/commands/index.ts

import { CommandRegistry } from '../CommandRegistry';
import { Command } from '../Command';

export async function registerEngineCommands(): Promise<void> {
  const registry = CommandRegistry.getInstance();
  
  // Vite glob import - discovers all *Command.ts files
  const modules = import.meta.glob<{ default: new () => Command }>(
    './*Command.ts',
    { eager: true }
  );
  
  for (const [path, module] of Object.entries(modules)) {
    if (module.default) {
      const command = new module.default();
      registry.register(command);
      console.log(`[Console] Registered: ${command.definition.name}`);
    }
  }
}
```

```typescript
// src/games/default/console/commands/index.ts

export async function registerGameCommands(): Promise<void> {
  const registry = CommandRegistry.getInstance();
  
  const modules = import.meta.glob<{ default: new () => Command }>(
    './*Command.ts',
    { eager: true }
  );
  
  for (const [path, module] of Object.entries(modules)) {
    if (module.default) {
      const command = new module.default();
      registry.register(command);
    }
  }
}
```

### Pros
- Zero configuration per command
- Just export default class and it's registered
- Build-time discovery (tree-shaking works)
- Clean pattern

### Cons
- Vite-specific (but we're committed to Vite)
- Requires default export convention

---

## Command Base Class

```typescript
// src/engine/console/Command.ts

export interface SubcommandDef {
  name: string;
  description: string;
  args?: ArgumentDef[];
}

export interface ArgumentDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  options?: string[];  // For enum type
}

export interface CommandDef {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  subcommands?: SubcommandDef[];
}

export abstract class Command {
  /** Command definition - used for help and autocomplete */
  abstract readonly definition: CommandDef;
  
  /** Execute the command with parsed arguments */
  abstract execute(args: string[]): Promise<string | void>;
  
  /** Optional: Custom autocomplete logic */
  getCompletions?(input: string, args: string[]): string[];
}
```

---

## Example Command

```typescript
// src/engine/console/commands/AudioCommand.ts

import { Command, CommandDef } from '../Command';

export default class AudioCommand extends Command {
  readonly definition: CommandDef = {
    name: 'audio',
    description: 'Control audio playback and settings',
    usage: 'audio <subcommand> [args]',
    subcommands: [
      { name: 'play', description: 'Play a sound', args: [
        { name: 'file', type: 'string', required: true }
      ]},
      { name: 'stop', description: 'Stop all audio' },
      { name: 'volume', description: 'Get/set volume', args: [
        { name: 'level', type: 'number', required: false }
      ]},
    ]
  };

  async execute(args: string[]): Promise<string | void> {
    const [sub, ...rest] = args;
    
    if (!sub) {
      return this.showHelp();
    }
    
    switch (sub) {
      case 'play':
        return this.play(rest[0]);
      case 'stop':
        return this.stop();
      case 'volume':
        return this.volume(rest[0]);
      default:
        return `Unknown subcommand: ${sub}`;
    }
  }
  
  private showHelp(): string {
    return `Usage: ${this.definition.usage}\n` +
      this.definition.subcommands!.map(s => `  ${s.name} - ${s.description}`).join('\n');
  }
  
  private async play(file: string) {
    if (!file) return 'Usage: audio play <file>';
    const audio = await getAudioManager();
    audio.playSound(file);
    return `Playing: ${file}`;
  }
  
  private async stop() {
    const audio = await getAudioManager();
    audio.stopAll();
    return 'Audio stopped';
  }
  
  private async volume(level?: string) {
    const audio = await getAudioManager();
    if (level === undefined) {
      return `Volume: ${audio.getVolume()}`;
    }
    const vol = parseFloat(level);
    if (isNaN(vol)) return 'Invalid volume';
    audio.setVolume(vol);
    return `Volume set to: ${vol}`;
  }
}
```

---

## Game Commands

Games follow the same pattern:

```
src/games/default/
└── console/
    └── commands/
        ├── index.ts           # registerGameCommands()
        ├── PlantCommand.ts    # plant water, harvest
        ├── ShopCommand.ts     # shop open, buy
        └── QuestCommand.ts    # quest list, complete
```

Game's main entry calls:
```typescript
import { registerGameCommands } from '@game/console/commands';
registerGameCommands();
```

---

## Migration Plan

### Phase 1: Foundation
1. Create `src/engine/console/` directory
2. Create `Command.ts` base class
3. Create new `CommandRegistry.ts` with Cvar integration
4. Move `Console.ts` (rename from DebugConsole)

### Phase 2: Migrate Commands (one at a time)
1. Start with simple commands (audio, time, show_fps)
2. Move to medium complexity (camera, map, pk3)
3. Finish with complex (bsp, shader, render)
4. Each migration: create file, test, remove from old

### Phase 3: Game Commands
1. Create `src/games/default/console/commands/`
2. Migrate GameCommands.ts to new pattern
3. Update main.ts to use new registration

### Phase 4: Cleanup
1. Delete old `src/engine/debug/EngineCommands.ts`
2. Delete `engine-commands.json`
3. Update all imports
4. Update documentation

---

## Resolved Questions

### 1. Aliases

Commands define their own aliases as a property:

```typescript
export default class QuitCommand extends Command {
  readonly definition: CommandDef = {
    name: 'quit',
    aliases: ['exit', 'q'],  // ← Aliases defined here
    description: 'Exit the game',
  };
}
```

The registry automatically registers all aliases pointing to the same handler.

### 2. Developer Mode & Console Access

**Global console control:**
```typescript
// Cvar to control console access
Cvar.register('con_enabled', true, {
  type: 'bool',
  description: 'Enable console (set false for production)',
  persist: false,  // Don't save - controlled by build
});

// In production builds, set this in main.ts:
if (import.meta.env.PROD) {
  Cvar.set('con_enabled', false);
}
```

**Developer-only commands:**

Rename `cheat` flag to `developer` - clearer intent:

```typescript
export interface CommandDef {
  name: string;
  description: string;
  aliases?: string[];
  developer?: boolean;  // ← Only works when developer mode enabled
  subcommands?: SubcommandDef[];
}

// Example: wireframe is developer-only
export default class WireframeCommand extends Command {
  readonly definition: CommandDef = {
    name: 'r_wireframe',
    description: 'Toggle wireframe rendering',
    developer: true,  // ← Hidden/disabled in production
  };
}
```

**Developer mode cvar:**
```typescript
Cvar.register('developer', false, {
  type: 'bool',
  description: 'Enable developer features',
  persist: false,
});

// In dev builds:
if (import.meta.env.DEV) {
  Cvar.set('developer', true);
}
```

**Behavior:**
- `con_enabled = false` → Console completely disabled (production default)
- `developer = false` → Developer commands hidden/rejected
- `developer = true` → All commands available (dev builds)

### 3. Config Files (.cfg)

Game-specific config files in `public/games/{game}/`:

```
public/games/default/
├── autoexec.cfg      # Runs on startup
├── config.cfg        # Saved user settings
└── binds.cfg         # Key bindings (future)
```

**Format (Quake-style):**
```
// autoexec.cfg
r_bloom 0.8
s_volume 0.7
bind f1 "screenshot"
```

**exec command:**
```typescript
export default class ExecCommand extends Command {
  readonly definition: CommandDef = {
    name: 'exec',
    description: 'Execute a config file',
    usage: 'exec <filename>',
  };
  
  async execute(args: string[]): Promise<string | void> {
    const file = args[0];
    if (!file) return 'Usage: exec <filename>';
    
    const path = GamePaths.getInstance().game(`${file}.cfg`);
    const response = await fetch(path);
    if (!response.ok) return `Config not found: ${file}.cfg`;
    
    const content = await response.text();
    const console = Console.getInstance();
    
    // Execute each line
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('//')) {
        await console.execute(trimmed);
      }
    }
    
    return `Executed: ${file}.cfg`;
  }
}
```

**Engine doesn't need cfg files** - cvars have defaults in code, cfg is for user/game customization.

---

## Where Cvars Are Defined (Current)

Cvars are registered by the systems that own them:

| File | Cvars | Purpose |
|------|-------|---------|
| `RenderVars.ts` | `r_*` (bloom, fog, etc.) | Rendering settings |
| `AudioManager.ts` | `s_volume`, `s_musicenabled`, etc. | Audio settings |
| `EngineCommands.ts` | `m_sensitivity`, `m_invertY` | Mouse settings |
| `GameCommands.ts` | Game-specific cvars | Game settings |

**This is the correct pattern** - cvars belong to their systems, not centralized.

With the new architecture, cvars stay where they are. Only commands move to `console/commands/`.

---

## Additional Notes

### Cvar 0/1 for true/false

Already works! The Cvar system handles Quake-style 0/1:
```typescript
r_bloom 0    // = false
r_bloom 1    // = true
r_bloom off  // also works
```

### writeconsole Command

Copy console output to clipboard. Simple debugging tool, no file support needed.

```typescript
export default class WriteConsoleCommand extends Command {
  readonly definition: CommandDef = {
    name: 'writeconsole',
    aliases: ['condump'],
    description: 'Copy console output to clipboard',
  };
  
  async execute(): Promise<string | void> {
    const console = Console.getInstance();
    const content = console.getOutputHistory().join('\n');
    
    await navigator.clipboard.writeText(content);
    return `Console output copied to clipboard (${content.length} chars)`;
  }
}
```

### Key Bindings

**Planned separately** - not part of console refactor. Will need its own architecture doc when we get there.

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Create feature branch `feature/console-refactor`
3. [ ] Implement Phase 1 (foundation)
4. [ ] Migrate commands incrementally
5. [ ] Update documentation
