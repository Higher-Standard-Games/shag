# Console System

How the console command system works in SHAG Engine.

## Overview

SHAG Engine includes a Q3-style console for runtime control, debugging, and configuration. Commands can be executed via the in-game console or programmatically.

## Architecture

```
ConsoleCommandRegistry (Singleton)
    │
    ├── commands: Map<name, CommandHandler>
    │
    └── execute(commandLine) → result string
```

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

### Render Variables

```
r_list               // Show all r_* variables
r_<name> <value>     // Set variable
r_reset              // Reset all to defaults
r_apply              // Force apply to scene
r_export             // Export as config text
```

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

### Simple Command

```typescript
import { ConsoleCommandRegistry } from './engine/debug/ConsoleCommandRegistry';

const registry = ConsoleCommandRegistry.getInstance();

registry.registerCommand({
  name: 'hello',
  description: 'Say hello',
  execute: (args) => {
    const name = args[0] || 'World';
    return `Hello, ${name}!`;
  }
});

// Usage: hello Player → "Hello, Player!"
```

### Command with Subcommands

```typescript
registry.registerCommand({
  name: 'player',
  description: 'Player commands',
  execute: (args) => {
    const sub = args[0];
    
    switch (sub) {
      case 'health':
        return `Health: ${player.health}`;
      case 'position':
        return `Position: ${player.position}`;
      default:
        return 'Subcommands: health, position';
    }
  }
});

// Usage: player health → "Health: 100"
```

### Async Command

```typescript
registry.registerCommand({
  name: 'loadmap',
  description: 'Load map asynchronously',
  execute: async (args) => {
    const mapName = args[0];
    if (!mapName) return 'Usage: loadmap <name>';
    
    await mapLoader.load(mapName);
    return `Loaded: ${mapName}`;
  }
});
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

- [Tutorial: Using the Console](../tutorials/beginner/using-console.md)
- [Tutorial: Custom Commands](../tutorials/intermediate/custom-commands.md)
