# Command reference

Press backquote/tilde to open the browser console. Run `help` for the commands registered in the current composition and `help <command>` for metadata.

This page is a workflow reference, not a generated exhaustive list. Engine commands are auto-discovered from `src/engine/console/commands/`; the active FPS module adds commands from `src/games/fps/console/commands/`.

## Setup and help

| Command | Purpose |
| --- | --- |
| `help [command]` | List commands or show command help |
| `developer 0|1` | Gate developer-only commands |
| `version` | Show build version |
| `clear` | Clear console output |
| `quit` | Exit supported CLI/app compositions |

## Maps and BSP inspection

| Command | Purpose |
| --- | --- |
| `map <name> [gametype]` | Browser gameplay launch through the registered launcher |
| `map list|current|reload|unload` | Gameplay-map operations |
| `bsp load <name>` | Parse an indexed BSP for inspection |
| `bsp render [all|poly|patch|mesh]` | Build inspection geometry |
| `bsp info|faces|entities|textures|worldspawn` | Inspect parsed data |
| `bsp clusters|lightmaps|required` | Inspect dependencies and visibility/lightmaps |
| `bsp loadrequired` | Load dependent PK3 archives |
| `bsp applytextures|applylightmaps` | Apply inspection materials |
| `bsp sky info|apply|toggle|remove|debug` | Inspect/manage BSP sky |
| `bsp fog info|apply|clear` | Inspect/manage BSP fog volumes |
| `bsp collision point` | Show contents at the active camera |
| `pvs on|off|status|cluster` | PVS diagnostics |

`map` is not registered with a gameplay launcher in `cli:game`; use `bsp load` there.

## Camera and position

| Command | Purpose |
| --- | --- |
| `camera mode <iso|fps|freefly|follow|sidescroll>` | Select a built-in controller |
| `camera fov <degrees>` | Get or set FOV |
| `camera pos` / `camera info` | Inspect camera |
| `pos [copy]` | Show/copy position |
| `teleport <x> <y> <z>` | Move the camera |
| `freefly_speed [value]` | Get/set freefly speed |
| `freefly_collision [0|1]` | Get/set collision |
| `freefly_collision mode <native|bsp>` | Select collision path |

The console does not expose the old `camera controller`, `camera height`, or `camera target` forms.

## PK3 and shaders

| Command | Purpose |
| --- | --- |
| `pk3 list` | List indexed packages |
| `pk3 index` | Rebuild the runtime index |
| `pk3 find <exact-path>` | Find the owning archive |
| `pk3 stats` | Show package/file/shader/map counts |
| `shader load|count` | Load or count parsed shaders |
| `shader list [filter]` | List parsed shader names |
| `shader info [name]` | Inspect a shader or aimed surface |
| `shader resolve <name>` | Show resolved material flags |
| `shader deps <name>` | Trace archive dependencies |
| `shader aim <0|1>` | Highlight aimed surfaces |

## Cvars and rendering

| Command | Purpose |
| --- | --- |
| `<cvar> [value]` | Get or set a registered cvar directly |
| `set <cvar> <value>` | Explicit setter |
| `toggle <cvar>` | Toggle a boolean/numeric cvar |
| `reset <cvar>` / `resetall` | Restore defaults |
| `cvarlist [filter]` | List cvars |
| `cvarexport` | Copy modified cvars |
| `render list|reset|export|apply` | Render-variable group operations |
| `pp ...` | Post-processing command |
| `show_fps [on|off]` | FPS counter |
| `perf ...` | Performance capture/summary |

Use `render list` rather than the obsolete `r_list`; render values apply through callbacks.

## Physics and diagnostics

| Command | Purpose |
| --- | --- |
| `physics init|on|off|gravity|debug|info` | Havok scene-physics control |
| `gravity [value]` | Movement gravity shortcut |
| `debug collision|wireframe|bounds|player|info` | Current debug toggles |
| `stats` / `mem` | Runtime statistics |
| `inspect` | Inspect aimed scene object |
| `dump_scene` | Dump the Babylon scene graph |

There is no `debug fps` subcommand; use `show_fps`.

## Networking and FPS game commands

The FPS composition provides `connect`, `disconnect`, `loadout`, demo commands, `pickup_audit`, and network simulation commands. Engine-level commands include `join`, `nettest`, and `binarytest`.

```text
connect localhost:7777
disconnect
cl_netgraph 2
demolist
demo <number-or-file>
demoplay
```

Consult `help` in the actual FPS build because game commands and gametype-specific options evolve independently from engine commands.

## Utility

Other current engine command classes cover audio, fog, day/night, lights, shadows, weather, wind, debris, UI, HUD, screenshots, settings export, config execution, model spawning, and weapon inspection. Their subcommands are intentionally obtained through `help <command>` rather than duplicated here.

The `bind` command is currently a placeholder; use the controls/settings UI for durable bindings.
