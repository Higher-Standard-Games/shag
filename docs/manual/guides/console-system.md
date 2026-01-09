# Console System

How the console command system works in SHAG Engine.

## Overview

SHAG Engine includes a Q3-style console for runtime control, debugging, and configuration. Commands can be executed via the in-game console or programmatically.

## Architecture

The console system uses a modular command class architecture:

```
src/engine/console/
├── Command.ts              # Abstract base class
├── CommandRegistry.ts      # Registration and execution
└── commands/               # Auto-discovered command classes
    ├── BspCommand.ts
    ├── CameraCommand.ts
    ├── MapCommand.ts
    ├── ShaderCommand.ts
    └── ... (56+ commands)
```

Each command is a class extending `Command`:

```typescript
export class MyCommand extends Command {
  readonly definition: CommandDef = {
    name: 'mycommand',
    description: 'Does something',
    usage: 'mycommand <arg>',
  };

  async execute(args: string[]): Promise<string> {
    return 'Result';
  }
}
export default MyCommand;
```

Commands are **auto-discovered** via Vite glob import - just create a `*Command.ts` file in the commands folder.

## Using the Console

### Opening

Press **`~`** (tilde) or **`F1`** to toggle.

### Syntax

```
command arg1 arg2 arg3
```

Quoted strings for spaces:

```
echo "Hello World"
```

### Navigation

- **Tab** - Auto-complete
- **Up/Down** - Command history
- **Enter** - Execute

## Built-in Commands

### Map Commands

```
map <name>           // Load map
map list             // List available maps
scene clear          // Clear current scene
```

### Camera Commands

```
camera controller <name>  // Switch controller
camera mode <mode>        // perspective/orthographic
camera height <n>         // Set height
freefly_speed <n>         // Movement speed
freefly_collision <0/1>   // Toggle collision
```

### Cvars (Console Variables)

```
cvarlist             // List all cvars
cvarlist r_          // List r_* cvars only
r_bloom 0.5          // Set cvar value
toggle s_musicenabled // Toggle boolean cvar
reset r_bloom        // Reset to default
resetall             // Reset all cvars
cvarexport           // Export modified cvars
```

See [Cvar System](./cvar-system.md) for full documentation.

### Debug Commands

```
debug fps            // Toggle FPS display
debug wireframe      // Toggle wireframe
shader info          // Inspect aimed surface
bsp info             // Map statistics
bsp entities         // List entities
version              // Engine version
```

## Creating Custom Commands

### Command Class (Recommended)

Create a new file in `src/engine/console/commands/`:

```typescript
// src/engine/console/commands/HelloCommand.ts
import { Command, CommandDef } from '../Command';

export class HelloCommand extends Command {
  readonly definition: CommandDef = {
    name: 'hello',
    description: 'Say hello',
    usage: 'hello [name]',
  };

  async execute(args: string[]): Promise<string> {
    const name = args[0] || 'World';
    return `Hello, ${name}!`;
  }
}

export default HelloCommand;
// Auto-discovered! No registration needed.
```

### Command with Subcommands

```typescript
export class PlayerCommand extends Command {
  readonly definition: CommandDef = {
    name: 'player',
    description: 'Player commands',
    usage: 'player <health|position|teleport>',
    subcommands: [
      { name: 'health', description: 'Show health' },
      { name: 'position', description: 'Show position' },
    ],
  };

  async execute(args: string[]): Promise<string> {
    const sub = args[0]?.toLowerCase();
    
    switch (sub) {
      case 'health':
        return `Health: ${player.health}`;
      case 'position':
        return `Position: ${player.position}`;
      default:
        return 'Subcommands: health, position';
    }
  }
}
```

### Using Engine Systems

Commands can dynamically import engine systems:

```typescript
export class MapInfoCommand extends Command {
  readonly definition: CommandDef = {
    name: 'mapinfo',
    description: 'Show current map info',
  };

  async execute(): Promise<string> {
    const { MapLoader } = await import('../../loader/map/MapLoader');
    const loader = MapLoader.getInstance();
    const current = loader.getCurrentMap();
    return current ? `Current map: ${current}` : 'No map loaded';
  }
}
```

## Programmatic Execution

Execute commands from code:

```typescript
const result = await registry.execute('map wdm7');
console.log(result); // "Map loaded: wdm7"
```

## Command Definition Interface

```typescript
interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  execute: (args: string[]) => string | Promise<string>;
}
```

## Help System

```
help                 // List all commands
help map             // Show map command help
```

Commands with `usage` property show detailed help:

```typescript
registry.registerCommand({
  name: 'teleport',
  description: 'Teleport to position',
  usage: 'teleport <x> <y> <z>',
  execute: (args) => { /* ... */ }
});

// help teleport → "teleport <x> <y> <z>"
```

## Console UI

The console UI is a separate component that:

- Renders command prompt
- Handles keyboard input
- Displays output history
- Provides auto-complete

## Related

- [Cvar System](./cvar-system.md)
- [Render Variables](./render-variables.md)
- [Tutorial: Using the Console](../tutorials/beginner/using-console.md)
- [Tutorial: Custom Commands](../tutorials/intermediate/custom-commands.md)
