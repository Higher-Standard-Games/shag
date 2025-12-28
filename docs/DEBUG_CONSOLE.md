# Debug Console

The engine includes a powerful debug console for runtime testing and configuration.

## Opening the Console

Press **`~`** (tilde/backtick) to toggle the console.

## Features

- **Command history**: Use **Arrow Up/Down** to navigate through previous commands
- **Tab completion**: Press **Tab** to autocomplete commands
- **Multi-command execution**: Separate commands with **`;`** to run multiple at once
- **Persistent history**: Command history is saved to localStorage

## Commands

### Weather Commands

#### Wind
```
wind on              # Start wind system
wind off             # Stop wind
wind strength <0-1>  # Set wind strength
wind gust            # Trigger a gust
```

#### Debris (Leaves, Trash, Dust)
```
debris leaves        # Start leaves effect
debris trash         # Start trash effect
debris dust          # Start dust effect
debris mixed         # Start mixed debris
debris off           # Stop debris
```

**Debris Tuning Parameters:**
```
debris density <0-1>       # Particle count (0.15 = sparse, 1 = dense)
debris size <number>       # Particle size (default: 8)
debris speed <min> [max]   # Emit velocity (default: 2-5)
debris gravity <number>    # Downward pull (default: 3)
debris spin <number>       # Rotation speed (default: 2)
debris lifetime <seconds>  # How long particles live (default: 10)
debris windforce <number>  # Wind influence multiplier (default: 20)
debris turbulence <0-1>    # Random direction amount (default: 0.7)
debris spread <number>     # Horizontal spread area (default: 512)
debris height <number>     # Vertical spawn range (default: 80)
debris settings            # Show current settings as JSON
```

#### Precipitation
```
weather rain <0-1>   # Start rain with intensity
weather snow <0-1>   # Start snow with intensity
weather clear        # Stop precipitation
```

#### Thunder & Fog
```
thunder on           # Start thunder
thunder off          # Stop thunder
fog on               # Start fog
fog off              # Stop fog
```

### Camera Commands

```
camera mode <type>   # Set camera mode: perspective, orthographic, fake_ortho
camera height <n>    # Set camera height/distance
camera info          # Show current camera settings
```

### Time Commands

```
time <hour>          # Set game time (0-23)
time speed <mult>    # Set time speed multiplier
```

### Map Commands

```
loadMap <name>       # Load a map by name
```

### UI Scaling Commands

```
ui scale <value>     # Set UI scale (e.g., 1.5 for 150%)
ui scale auto        # Reset to automatic scaling
ui mode <type>       # Set scale mode: fit, fill, width, height
ui debug             # Toggle debug overlay
ui info              # Show current UI scale info
```

### HUD Commands

```
hud info             # Show HUD status and element count
hud interval <ms>    # Set update interval (default: 100ms)
hud show <id>        # Show element
hud hide <id>        # Hide element
hud toggle <id>      # Toggle element visibility
hud refresh          # Force refresh all elements
hud theme <name>     # Switch theme (default, dark)
hud collapse [id]    # Collapse accordion (or all if no id)
hud expand <id>      # Expand accordion
hud start            # Start update loop
hud stop             # Stop update loop
hud reset            # Reset to default layout/prefs
```

### System Commands

```
help                 # Show available commands
clear                # Clear console output
fps                  # Toggle FPS display
```

## Example Workflows

### Testing Wind & Debris
```
wind on; debris leaves
debris speed 2 4; debris gravity 2; debris turbulence 0.5
```

### Quick Weather Setup
```
wind on; weather rain 0.5; debris mixed
```

### Camera Testing
```
camera mode fake_ortho
camera height 300
```

### Time of Day Testing
```
time 6               # Morning
time 12              # Noon
time 18              # Evening
time 22              # Night
```

## Notes

- **Indoor maps**: Weather effects (wind, debris, precipitation) are automatically disabled on indoor maps
- **Day/night cycle**: Debris particles respond to scene ambient lighting
- **Settings persistence**: Use `debris settings` to see current values, then update defaults in code if desired
- **Map-based debris**: Use `info_debris_zone` entities in maps for localized debris effects (see `docs/entities.md`)
