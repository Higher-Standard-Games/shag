# Using the Console

**Time:** 10 minutes  
**Level:** Beginner

Master the Q3-style console for runtime control and debugging.

## Opening the Console

Press **`~`** (tilde) or **`F1`** to toggle the console.

## Basic Commands

### Get Help

```
help
```

Lists all available commands.

```
help map
```

Shows detailed help for a specific command.

### Map Commands

```
map wdm7           # Load a map
map list           # List available maps
scene clear        # Clear current scene
```

### Camera Commands

```
camera mode perspective    # Switch camera mode
camera mode orthographic
camera height 500          # Set camera height
camera controller freefly  # Change controller
camera controller isometric
```

### Information Commands

```
version            # Engine version
bsp info           # Current map info
bsp entities       # List map entities
shader count       # Loaded shaders
pk3 list textures/ # Browse PK3 contents
```

## Tab Completion

Press **Tab** to auto-complete commands:

```
> cam<Tab>
> camera
```

## Command History

Use **Up/Down arrows** to navigate previous commands.

## Render Variables

All `r_*` commands control rendering:

```
r_list             # Show all render variables
r_wireframe 1      # Enable wireframe
r_wireframe 0      # Disable wireframe
r_lightmap 2       # Increase lightmap brightness
r_reset            # Reset all to defaults
```

## Subcommands

Some commands have subcommands:

```
bsp                # Shows: Subcommands: load, render, info...
bsp info           # Run subcommand
bsp entities       # Another subcommand
```

## Debug Commands

```
debug fps          # Toggle FPS display
debug wireframe    # Toggle wireframe
shader info        # Inspect surface under crosshair
shader aim 1       # Highlight aimed surface
```

## Developer Mode

Some commands require developer mode:

```
developer 1        # Enable developer mode
developer 0        # Disable developer mode
```

### Spawn Models (Developer)

```
spawnmodel <model>          # Spawn model at camera position
spawnmodel <model> 50       # Spawn with custom scale
spawnmodel list             # List spawned models
spawnmodel rotate 0 45      # Rotate model #0
spawnmodel anim 0 <anim>    # Play animation on model #0
spawnmodel clear            # Remove all models
```

### Spawn Points (Developer)

```
spawn              # Teleport to first spawn point
spawn 2            # Teleport to spawn point #2
```

## Command Syntax

Commands follow Q3/Warsow syntax:

```
command arg1 arg2 arg3
```

Arguments are space-separated. Quotes for spaces:

```
echo "Hello World"
```

## Creating Aliases (Future)

```
alias noclip "freefly_collision 0"
```

## Console Output

Commands return text output:

```
> version
SHAG Engine v0.8.13
Babylon.js: 8.44.1
```

Errors show in red, warnings in yellow.

## Next Steps

- [Tweaking Render Variables](./render-variables.md)
- [Camera Navigation](./camera-navigation.md)
