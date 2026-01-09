# Command Reference

Complete list of console commands in SHAG Engine.

## Map & Scene

| Command | Description |
|---------|-------------|
| `map <name>` | Load a BSP map |
| `map list` | List available maps |
| `map reload` | Reload current map |
| `map unload` | Unload current map |
| `scene empty` | Create empty scene for testing |
| `scene clear` | Clear all scene objects |
| `scene dispose` | Dispose empty scene |

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

## BSP & PVS

| Command | Description |
|---------|-------------|
| `bsp load <name>` | Load BSP file |
| `bsp info` | Show BSP statistics |
| `bsp entities` | List BSP entities |
| `bsp textures` | List required textures |
| `bsp render` | Render loaded BSP |
| `bsp clear` | Clear rendered BSP |
| `bsp fog info` | Show fog settings |
| `bsp sky` | Toggle skybox |
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

## Rendering

| Command | Description |
|---------|-------------|
| `render list` | List render variables |
| `render reset` | Reset all render vars |
| `render export` | Export render config |
| `r_<varname> [value]` | Get/set render variable |

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

## UI

| Command | Description |
|---------|-------------|
| `ui scale [value\|auto]` | Get/set UI scale |
| `ui mode <fit\|fill\|width\|height>` | Set scale mode |
| `ui debug` | Toggle debug overlay |
| `ui info` | Show UI info |
| `hud info` | Show HUD status |
| `hud interval <ms>` | Set update interval |
| `hud show/hide/toggle <id>` | Control elements |
| `hud refresh` | Force refresh |
| `hud theme <name>` | Set theme |

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

## Audio

| Command | Description |
|---------|-------------|
| `audio volume <0-1>` | Set music volume |
| `audio mute/unmute` | Mute/unmute |
| `audio play <track>` | Play music |
| `audio stop` | Stop music |

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
