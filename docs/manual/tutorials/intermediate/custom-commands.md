# Adding Custom Console Commands

**Time:** 20 minutes  
**Level:** Intermediate

Learn to extend the console with your own commands.

## Prerequisites

- [Using the Console](../beginner/using-console.md) completed
- Basic TypeScript knowledge

## Understanding the Command System

Commands are registered with `ConsoleCommandRegistry`:

```typescript
import { ConsoleCommandRegistry } from '../../engine/debug/ConsoleCommandRegistry';

const registry = ConsoleCommandRegistry.getInstance();
```

## Basic Command

```typescript
registry.registerCommand({
  name: 'hello',
  description: 'Say hello',
  execute: (args) => {
    const name = args[0] || 'World';
    return `Hello, ${name}!`;
  }
});
```

**Usage:**
```
> hello
Hello, World!
> hello Player
Hello, Player!
```

## Command with Usage Help

```typescript
registry.registerCommand({
  name: 'teleport',
  description: 'Teleport to coordinates',
  usage: 'teleport <x> <y> <z>',
  execute: (args) => {
    if (args.length < 3) {
      return 'Usage: teleport <x> <y> <z>';
    }
    
    const x = parseFloat(args[0]);
    const y = parseFloat(args[1]);
    const z = parseFloat(args[2]);
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      return 'Error: Invalid coordinates';
    }
    
    const camera = CameraSystem.getInstance().getCamera();
    camera.position.set(x, y, z);
    
    return `Teleported to (${x}, ${y}, ${z})`;
  }
});
```

## Command with Subcommands

```typescript
registry.registerCommand({
  name: 'player',
  description: 'Player commands',
  usage: 'player <health|armor|ammo> [value]',
  execute: (args) => {
    const sub = args[0]?.toLowerCase();
    const value = args[1] ? parseInt(args[1]) : undefined;
    
    switch (sub) {
      case 'health':
        if (value !== undefined) {
          player.health = value;
          return `Health set to ${value}`;
        }
        return `Health: ${player.health}`;
        
      case 'armor':
        if (value !== undefined) {
          player.armor = value;
          return `Armor set to ${value}`;
        }
        return `Armor: ${player.armor}`;
        
      case 'ammo':
        return `Ammo: ${player.ammo}`;
        
      default:
        return 'Subcommands: health, armor, ammo';
    }
  }
});
```

## Async Commands

```typescript
registry.registerCommand({
  name: 'screenshot',
  description: 'Take a screenshot',
  execute: async (args) => {
    const engine = scene.getEngine();
    
    // Capture frame
    const data = await engine.createScreenshotAsync(
      scene.activeCamera!,
      { width: 1920, height: 1080 }
    );
    
    // Download
    const link = document.createElement('a');
    link.download = `screenshot-${Date.now()}.png`;
    link.href = data;
    link.click();
    
    return 'Screenshot saved';
  }
});
```

## Toggle Commands

```typescript
let godMode = false;

registry.registerCommand({
  name: 'god',
  description: 'Toggle god mode',
  execute: () => {
    godMode = !godMode;
    return `God mode: ${godMode ? 'ON' : 'OFF'}`;
  }
});
```

## Commands with Validation

```typescript
registry.registerCommand({
  name: 'spawn',
  description: 'Spawn an entity',
  usage: 'spawn <entity_type>',
  execute: (args) => {
    const type = args[0];
    
    const validTypes = ['enemy', 'pickup', 'projectile'];
    if (!validTypes.includes(type)) {
      return `Invalid type. Valid: ${validTypes.join(', ')}`;
    }
    
    spawnEntity(type);
    return `Spawned: ${type}`;
  }
});
```

## Organizing Commands

Create a commands file:

```typescript
// src/game/commands/GameCommands.ts
import { ConsoleCommandRegistry } from '../../engine/debug/ConsoleCommandRegistry';

export function registerGameCommands(registry: ConsoleCommandRegistry) {
  registry.registerCommand({
    name: 'give',
    description: 'Give item to player',
    execute: (args) => { /* ... */ }
  });
  
  registry.registerCommand({
    name: 'noclip',
    description: 'Toggle noclip mode',
    execute: () => { /* ... */ }
  });
}
```

Then call during init:

```typescript
import { registerGameCommands } from './commands/GameCommands';

registerGameCommands(ConsoleCommandRegistry.getInstance());
```

## Best Practices

1. **Return meaningful messages** - Users need feedback
2. **Validate input** - Check args before using
3. **Provide usage help** - Set the `usage` property
4. **Use lowercase names** - Consistent with Q3 style
5. **Keep it simple** - One command, one purpose

## Next Steps

- [Working with PK3 Mods](./pk3-mods.md)
- [Guide: Console System](../../guides/console-system.md)
