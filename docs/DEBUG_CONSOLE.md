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

### PK3 Archive Commands

```
pk3 load <file>           # Load a PK3 archive
pk3 list [filter]         # List files in loaded PK3s
pk3 path <path>           # Add search path for PK3s
pk3 index build           # Build file→package index
pk3 index find <file>     # Find which PK3 contains a file
pk3 index search <term>   # Search indexed files
pk3 index clear           # Clear the index
```

### BSP Map Commands

```
bsp load <mapname>        # Load BSP from map PK3
bsp info                  # Show BSP details
bsp render                # Render BSP to scene
bsp clear                 # Remove BSP from scene
bsp textures              # List textures used by map
bsp loadrequired          # Auto-load PK3s needed for textures
bsp applytextures         # Apply textures to rendered meshes
```

### Freefly Collision Debugging

``` 
freefly_collision 1                    # Enable collision in freefly
freefly_collision mode native          # Use Babylon mesh collision (recommended)
```

Clip brushes (typically `textures/common/fullclip` and `textures/common/playerclip`) can be debugged without generating Babylon collision meshes:

```
freefly_collision clipviz [mode]       # Draw clip brushes as wireframes
freefly_collision clipdump <mode>      # Dump brush plane data for a clip brush
freefly_collision cliptrace [args...]  # Trace against clip brushes only
```

**clipviz modes:**

```
freefly_collision clipviz clear
freefly_collision clipviz last
freefly_collision clipviz brush <index>
freefly_collision clipviz <max>
```

**clipdump modes:**

```
freefly_collision clipdump last
freefly_collision clipdump brush <index>
freefly_collision clipdump <index>
```

**cliptrace:**

```
freefly_collision cliptrace [dist] [radius] [height] [debug]
```

### Q3 Shader Commands

```
shader load               # Load shaders from all PK3s
shader list [filter]      # List loaded shader names
shader info [name]        # Show shader definition (or aimed surface when no name)
shader aim 1              # Highlight the surface under the crosshair (outline/edges)
shader aim 0              # Disable aim highlight
shader resolve <name>     # Show resolved material properties
shader clear              # Clear shader registry
```

### Render Variables (r_*)

Q3/Warsow-style runtime renderer configuration. See [RENDER_VARS.md](RENDER_VARS.md) for full docs.

```
r_normalmap [value]   # Normal/bump map intensity (0-4, default: 1)
r_glossmap [value]    # Specular/gloss intensity (0-4, default: 1)
r_lightmap [value]    # Lightmap intensity (0-4, default: 1)
r_ambient [value]     # Ambient light intensity (0-4, default: 1)
r_emissive [value]    # Emissive/glow intensity (0-4, default: 1)
r_anisotropy [value]  # Anisotropic filtering level (1-16, default: 8)
r_wireframe [0|1]     # Wireframe mode toggle (0/1, default: 0)
r_list                # List all render variables
r_reset               # Reset all to defaults
r_export              # Export as config text
r_apply               # Force apply to scene
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
help                 # Show available commands (categorized, color-coded)
help <command>       # Show detailed help for a specific command
clear                # Clear console output
version              # Show engine version
fps                  # Toggle FPS display
```

### Log Search Commands

```
find <pattern> [max]        # Search log history with wildcards
log_history [size]          # View/set log history size (100-50000)
con_size [0.1-1.0]          # View/set console height (% of screen)
```

**Examples:**
```
find BspMeshBuilder         # Find all BspMeshBuilder lines
find *Sprite*               # Wildcard search for anything with "Sprite"
find *error* 100            # Find up to 100 error lines
log_history                 # Show current history usage
log_history 10000           # Increase history to 10000 lines
```

The log history keeps all console output in memory (default 5000 lines) even after it scrolls out of the visible console. Settings are persisted to localStorage.

The `help` command displays commands organized by category:
- **System** - Core commands (help, clear, version)
- **Debug** - Development tools (camera, debug, map, weather, etc.)
- **Game** - Game-specific commands (plant, quest, save, etc.)
- **Other** - Uncategorized commands

Commands are color-coded: commands in blue, labels in yellow.

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

### Loading a Warsow Map
```
pk3 path game/basewsw/
pk3 index build
scene empty
bsp load wdm11
bsp loadrequired
shader load
bsp render
bsp applytextures
```

### Clip Brush Debug Workflow (Warsow/FBSP)

```
freefly_collision 1
freefly_collision mode native
freefly_collision clipviz 200
freefly_collision cliptrace 300 16 56
freefly_collision clipdump last
freefly_collision clipviz last
```

Or as a single command:
```
pk3 path game/basewsw/; pk3 index build; scene empty; bsp load wdm11; bsp loadrequired; shader load; bsp render; bsp applytextures
```

## Notes

- **Indoor maps**: Weather effects (wind, debris, precipitation) are automatically disabled on indoor maps
- **Day/night cycle**: Debris particles respond to scene ambient lighting
- **Settings persistence**: Use `debris settings` to see current values, then update defaults in code if desired
- **Map-based debris**: Use `info_debris_zone` entities in maps for localized debris effects (see `docs/entities.md`)
