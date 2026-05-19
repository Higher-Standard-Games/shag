# Command Reference

Complete list of console commands in SHAG Engine. Press `~` to open the console.

## Map & Scene

| Command | Description |
|---------|-------------|
| `map <name> [gametype]` | Developer-only server-backed gameplay launch through the lobby |
| `map list` | List available maps |
| `map reload` | Relaunch last server-backed gameplay map |
| `map unload` | Disconnect and unload current client map |
| `scene empty` | Create empty scene for testing |
| `scene clear` | Clear all scene objects |
| `scene dispose` | Dispose empty scene |
| `dumpscene` | Dump scene graph for debugging |

## Player & Movement

| Command | Description |
|---------|-------------|
| `noclip` | Toggle noclip (fly through walls) |
| `god` | Toggle god mode (invincibility) |
| `teleport <x> <y> <z>` | Teleport to coordinates |
| `spawn [index]` | Respawn at spawn point |
| `spectator` | Toggle spectator mode |
| `position` | Show current position |
| `gravity [value]` | Get/set gravity |

## Entities & Models

| Command | Description |
|---------|-------------|
| `spawnmodel <path> [x y z]` | Spawn a GLB model |
| `spawnmodel lighting <id>` | Refresh model lighting |
| `spawn_pickable_entity <type>` | Spawn pickable item |
| `give <weapon>` | Give weapon to player |
| `inspect` | Inspect aimed object |
| `entity list` | List all entities |
| `entity info <id>` | Show entity info |

## Camera

| Command | Description |
|---------|-------------|
| `camera mode <type>` | Switch controller (iso, fps, freefly, follow, sidescroll) |
| `camera fov <degrees>` | Set field of view |
| `camera pos [x y z]` | Show/set camera position |
| `camera info` | Show camera info |
| `camera controller <type>` | Switch to controller |
| `camera controllers` | List registered controllers |
| `camera preset <name>` | Apply camera preset |
| `camera reset` | Reset to default view |
| `freefly_speed <n>` | Set freefly movement speed |
| `freefly_collision <0\|1>` | Toggle freefly collision |
| `freefly_collision mode <native\|bsp>` | Set collision mode |

## Weapons

| Command | Description |
|---------|-------------|
| `weapon load <name> [pk3path]` | Load weapon model |
| `weapon pos <x> <y> <z>` | Set position offset |
| `weapon scale <n>` | Set weapon scale |
| `weapon preset <hip\|ads\|lowered>` | Use position preset |
| `weapon clear` | Remove current weapon |
| `weapon info` | Show weapon info |
| `weapon hide` | Hide weapon model |
| `weapon show` | Show weapon model |
| `give <weapon>` | Give weapon to player |

## BSP & PVS

| Command | Description |
|---------|-------------|
| `bsp load <name>` | Load BSP file for inspection/rendering |
| `bsp info` | Show BSP statistics |
| `bsp entities` | List BSP entities |
| `bsp textures` | List required textures |
| `bsp render` | Render loaded BSP |
| `bsp clear` | Clear rendered BSP |
| `bsp fog info` | Show fog settings |
| `bsp sky` | Toggle skybox |
| `bsp lightgrid` | Show LightGrid info at pos |
| `bsp debug_grid [clear]` | Visualize LightGrid points |
| `bsp collision` | Show collision info |
| `pvs on` | Enable PVS culling |
| `pvs off` | Disable PVS culling |
| `pvs status` | Show PVS statistics |
| `pvs cluster` | Show current cluster info |

## Shaders

| Command | Description |
|---------|-------------|
| `shader load` | Load shaders from PK3 |
| `shader count` | Show loaded shader count |
| `shader list [filter]` | List shaders |
| `shader info [name]` | Show shader info (or aimed surface) |
| `shader aim <0\|1>` | Toggle aim highlight |
| `shader resolve <name>` | Resolve material properties |
| `shader pattern <name>` | Debug shader pattern |
| `shader deps <name>` | Show shader dependencies |
| `shader glow <n>` | Set glow intensity |
| `shader lightmap <n>` | Set lightmap intensity |
| `shader blendmode <add\|alpha>` | Set glow blend mode |
| `shader clear` | Clear shader registry |
| `shader anim status` | Show animation status |
| `shader anim pause/resume` | Control animations |
| `shader anim speed <n>` | Set animation speed |

## PK3 Filesystem

| Command | Description |
|---------|-------------|
| `pk3 load <file.pk3>` | Load PK3 package |
| `pk3 list [pattern]` | List files |
| `pk3 dir [path]` | List directory |
| `pk3 info` | Show loaded packages |
| `pk3 path [add]` | Show/add search paths |
| `pk3 test <file>` | Test loading a file |
| `pk3 texture <path>` | Load texture with companions |
| `pk3 cache` | Show texture cache |
| `pk3 unload` | Unload all packages |
| `pk3 index build` | Build file index |
| `pk3 index find <path>` | Find file in index |
| `pk3 index search <pattern>` | Search index |

## Textures

| Command | Description |
|---------|-------------|
| `texture list` | List loaded textures |
| `texture stats` | Show texture memory stats |
| `texture reload` | Reload all textures |

## Cvars (Console Variables)

| Command | Description |
|---------|-------------|
| `cvarlist [filter]` | List cvars |
| `toggle <cvar>` | Toggle boolean cvar |
| `reset <cvar>` | Reset cvar to default |
| `resetall` | Reset all cvars |
| `set <cvar> <value>` | Set cvar value |
| `cvarexport` | Export modified cvars |

### Common Cvars

| Cvar | Type | Description |
|------|------|-------------|
| `r_bloom` | float | Bloom intensity (0-3) |
| `r_exposure` | float | Exposure level |
| `r_contrast` | float | Contrast level |
| `r_normalmap` | float | Normal map intensity |
| `r_lightmap` | float | Lightmap intensity |
| `r_wireframe` | int | Wireframe mode |
| `s_volume` | float | Master volume |
| `s_musicenabled` | bool | Music enabled |

### Network Cvars

| Cvar | Type | Description |
|------|------|-------------|
| `cl_netgraph` | int | NetGraph overlay (0=off, 1=text, 2=text+graph) |
| `cl_interp` | int | Interpolation delay ms (0=auto) |
| `cl_timenudge` | int | Render time offset ms (negative=ahead) |

### Crosshair Cvars

| Cvar | Type | Description |
|------|------|-------------|
| `cg_crosshairSize` | int | Crosshair size in pixels |
| `cg_crosshairColor` | string | Crosshair color |
| `cg_crosshairAlpha` | float | Crosshair opacity |

### Viewport Effect Cvars

| Cvar | Type | Description |
|------|------|-------------|
| `cl_vieweffects` | int | Master toggle for viewport effects |
| `cl_bobbing` | int | Enable walk bob |
| `cg_idleamplitude` | float | Idle breathing intensity (default 0.02) |
| `cg_idlefrequency` | float | Idle breathing speed (default 0.6) |

### Gib Cvars

| Cvar | Type | Description |
|------|------|-------------|
| `gib_threshold` | int | Overkill damage to trigger gibs |
| `gib_count` | int | Number of gib pieces |
| `gib_lifetime` | float | Gib lifetime in seconds |

## Rendering & Post-Processing

| Command | Description |
|---------|-------------|
| `render list` | List render variables |
| `render reset` | Reset all render vars |
| `render export` | Export render config |
| `r_<varname> [value]` | Get/set render variable |
| `postprocess <effect> [value]` | Control post-processing |
| `skybox <on\|off>` | Toggle skybox |
| `skybox load <name>` | Load skybox |

## Lighting & Shadows

| Command | Description |
|---------|-------------|
| `light add <type>` | Add light to scene |
| `light list` | List scene lights |
| `light info <id>` | Show light info |
| `shadow on/off` | Toggle shadows |
| `shadow quality <low\|medium\|high>` | Set shadow quality |
| `shadow info` | Show shadow info |
| `daynight on/off` | Toggle day/night cycle |
| `daynight time <hour>` | Set time of day |
| `daynight speed <n>` | Set cycle speed |
| `time set <hour>` | Set time of day |
| `time pause/resume` | Pause/resume time |

## Weather & Environment

| Command | Description |
|---------|-------------|
| `weather rain [intensity]` | Start rain |
| `weather snow [intensity]` | Start snow |
| `weather clear` | Clear all weather |
| `weather fog <density>` | Set weather fog |
| `weather thunder` | Trigger thunder |
| `weather status` | Show weather status |
| `wind on/off` | Toggle wind |
| `wind strength <n>` | Set wind strength |
| `wind direction <x y z>` | Set wind direction |
| `debris on/off` | Toggle debris particles |
| `debris intensity <n>` | Set debris intensity |

## Fog

| Command | Description |
|---------|-------------|
| `fog on [r g b density]` | Enable EXP2 fog |
| `fog off` | Disable fog |
| `fog color <r g b>` | Set fog color |
| `fog density <value>` | Set fog density |
| `fog linear <start end>` | Enable linear fog |
| `fog status` | Show fog settings |
| `fog worldspawn` | Apply BSP fog |
| `fog cam on/off` | Toggle camera-based fog |

## Networking

| Command | Description |
|---------|-------------|
| `connect <url>` | Connect to game server |
| `disconnect` | Disconnect from server |
| `network connect <url>` | Connect to server |
| `network disconnect` | Disconnect from server |
| `network status` | Show connection status |
| `network init [mode]` | Initialize networking (local\|network\|listen) |
| `network mode` | Show current mode |
| `network shutdown` | Shutdown networking |
| `join <server>` | Join game server |
| `net ...` | Alias for network |
| `cl_netgraph 0\|1\|2` | NetGraph overlay (off/text/graph) |
| `cl_interp <ms>` | Interpolation delay (0=auto) |
| `cl_timenudge <ms>` | Render time offset |

## Physics

| Command | Description |
|---------|-------------|
| `physics init` | Initialize Havok physics |
| `physics enable/disable` | Toggle physics |
| `physics gravity <x y z>` | Set gravity vector |
| `physics debug` | Toggle physics debug |
| `physics info` | Show physics status |
| `gravity [value]` | Get/set gravity strength |

## Audio

| Command | Description |
|---------|-------------|
| `audio volume <0-1>` | Set music volume |
| `audio mute/unmute` | Mute/unmute |
| `audio play <track>` | Play music |
| `audio stop` | Stop music |

## Debug

| Command | Description |
|---------|-------------|
| `debug fps` | Toggle FPS display |
| `debug wireframe` | Toggle wireframe |
| `debug bounds` | Toggle bounding boxes |
| `debug lights` | Toggle light gizmos |
| `stats` | Show engine statistics |
| `mem` | Show memory usage |
| `mem textures` | Texture memory |
| `mem meshes` | Mesh memory |
| `showfps [on\|off]` | Toggle FPS counter |
| `timescale <n>` | Set time scale (slow-mo) |
| `developer <0\|1>` | Toggle developer mode |
| `animtest <anim>` | Test animation playback |

## UI

| Command | Description |
|---------|-------------|
| `ui scale [value\|auto]` | Get/set UI scale |
| `ui mode <fit\|fill\|width\|height>` | Set scale mode |
| `ui theme <light\|dark>` | Set UI theme |
| `ui debug` | Toggle debug overlay |
| `ui info` | Show UI info |
| `hud info` | Show HUD status |
| `hud interval <ms>` | Set update interval |
| `hud show/hide/toggle <id>` | Control elements |
| `hud refresh` | Force refresh |
| `hud theme <name>` | Set theme |

## Utility

| Command | Description |
|---------|-------------|
| `help [command]` | Show help |
| `echo <text>` | Print text |
| `clear` | Clear console |
| `quit` | Quit application |
| `version` | Show engine version |
| `screenshot` | Take screenshot |
| `exec <file.cfg>` | Execute config file |
| `bind <key> <command>` | Bind key |
| `unbind <key>` | Unbind key |
| `bindlist` | List bindings |
| `settings list` | List settings |
| `settings reset` | Reset all settings |
| `writeconsole` | Write console log to file |

## Game Commands

| Command | Description |
|---------|-------------|
| `game info` | Show game info |
| `game load` | Load game |
| `game reload` | Reload game |
| `export camera` | Export camera settings |
| `export fx` | Export post-processing |
| `export all` | Export all settings |

## See Also

- [Console System](./console-system.md) - How to use and extend the console
- [Cvar System](./cvar-system.md) - Console variables
- [Render Variables](./render-variables.md) - Rendering cvars
- [Networking System](./networking.md) - Multiplayer networking
