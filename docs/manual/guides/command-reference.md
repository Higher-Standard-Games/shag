# Command reference

Press backquote/tilde to open the browser console. Run `help` for the commands registered in the current composition and `help <command>` for its usage and subcommands.

This page is a workflow reference, not a generated exhaustive list. Engine commands are auto-discovered from `src/engine/console/commands/`; the active FPS module adds commands from `src/games/fps/console/commands/`. Commands marked **dev** are registered only while `developer 1` is set — the console answers `Command 'x' requires developer mode` otherwise, and they are hidden from completion.

## Setup and help

| Command | Purpose |
| --- | --- |
| `help [command]` | List commands or show one command's usage and subcommands |
| `developer [0\|1]` | Turn developer mode on or off (aliases: `dev`) |
| `version` | Show build version |
| `clear` | Clear console output |
| `echo <text>` | Print text |
| `exec <filename>` | Run a config file through the virtual filesystem |
| `quit` | Exit supported CLI/app compositions |
| `writeconsole` | Write the console log to a file |

## Maps and BSP inspection

| Command | Purpose |
| --- | --- |
| `map <name> [gametype]` **dev** | Browser gameplay launch through the registered launcher |
| `map list\|current\|reload\|unload` **dev** | Gameplay-map operations |
| `training_demo <map> [name] [gametype]` **dev** | Launch a map on a server that stays in warmup and records every tick of your play, for bots to learn a movement route from |
| `training_demo stop` **dev** | Leave the training server; it saves `public/data/demos/training/<map>_<name>.shagdemo` |
| `bsp load\|unload <name>` | Parse an indexed BSP for inspection, or drop it |
| `bsp render [all\|poly\|patch\|mesh]` | Build inspection geometry |
| `bsp info\|faces\|entities\|textures\|worldspawn` | Inspect parsed data |
| `bsp clusters\|lightmaps\|lightgrid\|required` | Inspect visibility, lightmaps and dependencies |
| `bsp loadrequired\|preload\|loadtextures` | Load dependent archives and textures |
| `bsp applytextures\|applylightmaps\|clear` | Apply or drop inspection materials |
| `bsp sky info\|apply\|toggle\|remove\|debug` | Inspect and manage BSP sky |
| `bsp fog info\|apply\|clear` | Inspect and manage BSP fog volumes |
| `bsp collision point` | Show contents at the active camera |
| `bsp trace` | Trace a ray through the collision world |
| `bsp door` | Inspect door and mover entities |
| `pvs on\|off\|status\|cluster` | PVS diagnostics |

`map` needs a gameplay launcher, which the browser composition registers and `cli:game` does not; use `bsp load` there.

`training_demo` records one trick per demo: do it, then `training_demo stop`. A
name that already exists gets `_2`, `_3` and so on rather than being overwritten.

## Camera and position

| Command | Purpose |
| --- | --- |
| `camera mode <iso\|fps\|freefly\|follow\|sidescroll>` | Select a built-in controller |
| `camera fov <degrees>` | Get or set FOV |
| `camera pos` / `camera info` | Inspect camera |
| `pos [copy]` | Show or copy position |
| `teleport <x> <y> <z>` **dev** | Move the camera |
| `freefly_speed [value]` **dev** | Get or set freefly speed |
| `freefly_collision [0\|1]` | Turn freefly collision on or off |
| `freefly_collision mode [native\|bsp]` | Select the collision path |
| `freefly_collision test\|draw\|clear` | Probe and visualise collision geometry |
| `freefly_collision clipviz\|clipdump\|cliptrace` | Inspect clip brushes |

The console does not expose the old `camera controller`, `camera height`, or `camera target` forms.

## PK3 and shaders

| Command | Purpose |
| --- | --- |
| `pk3 list` **dev** | List indexed packages |
| `pk3 index` **dev** | Rebuild the runtime index |
| `pk3 find <exact-path>` **dev** | Find the owning archive |
| `pk3 stats` **dev** | Show package/file/shader/map counts |
| `shader load\|count` | Load or count parsed shaders |
| `shader list [filter]` | List parsed shader names |
| `shader info [name]` | Inspect a shader or the aimed surface |
| `shader surface` | Snapshot aimed mesh layers, depth/alpha state and texture UV transforms |
| `shader resolve <name>` | Show resolved material flags |
| `shader deps <name>` | Trace archive dependencies |
| `shader aim <0\|1>` | Highlight aimed surfaces |
| `shader anim play\|pause\|resume\|speed\|status` | Drive shader animation |
| `shader glow\|blendmode\|lightmap\|toggle\|clear` | Inspect and override stage behaviour |

## Cvars and rendering

| Command | Purpose |
| --- | --- |
| `<cvar> [value]` | Get or set a registered cvar directly |
| `set <cvar> <value>` | Explicit setter |
| `toggle <cvar>` | Toggle a boolean cvar, or flip a numeric one between 0 and 1 |
| `reset <cvar>` / `resetall` | Restore defaults |
| `cvarlist [filter]` | List cvars |
| `cvarexport` | Copy modified cvars |
| `render list\|reset\|export\|apply` **dev** | Render-variable group operations |
| `pp <effect> [value]` **dev** | Post-processing control |
| `show_fps [0\|1\|on\|off]` | FPS counter |
| `perf capture [seconds]` | Performance capture and summary |
| `export <all\|cvars\|camera\|fx>` | Copy current state as config text |
| `settings export\|import\|list` | Settings file operations |
| `screenshot [filename]` | Save a screenshot |

A numeric cvar refuses text: `r_bloom abc` fails and leaves the value alone rather than reading the typo as zero. A number outside the cvar's range is clamped, not refused.

## World, lighting and weather

| Command | Purpose |
| --- | --- |
| `light <subcommand>` **dev** | Dynamic light control |
| `arealight [<image-url>\|off]` | Area light from an image |
| `shadow on\|off\|quality [value]` **dev** | Shadow control |
| `godrays [sun\|here\|off]` | Volumetric light shafts |
| `skybox load\|clear\|info [name]` **dev** | Skybox control |
| `fog on\|off\|color\|density` **dev** | Scene fog |
| `daynight on\|off\|noon\|midnight\|start\|stop\|info` **dev** | Day/night cycle |
| `weather rain\|snow\|clear\|fog\|thunder [intensity]` | Weather |
| `wind on\|off\|strength\|direction [value]` | Wind |
| `debris leaves\|trash\|dust\|mixed\|off\|density\|size\|speed` | Ambient debris |
| `time [subcommand]` | Time of day |
| `texture <subcommand>` **dev** | Texture inspection |

## Player state and cheats

| Command | Purpose |
| --- | --- |
| `god` **dev** | Toggle invulnerability |
| `noclip` **dev** | Toggle movement through geometry |
| `giveweapon <weapon_id\|all> [amount]` | Give a weapon and ammunition |
| `cl_wep_reset` | Reset client weapon state |
| `weapon <subcommand>` | Weapon inspection |
| `spectator [0\|1]` | Enter or leave spectator |
| `timescale [value]` **dev** | Scale simulation speed |
| `gravity [value]` **dev** | Movement gravity shortcut |
| `spawn [index]` **dev** | Move to a spawn point |
| `spawnmodel <model> [scale] [x y z] [angle]` **dev** | Spawn a model |
| `spawn_pickable_entity <entity_id>` **dev** | Spawn a pickup |
| `name [newname]` | Show or change the account name |

## Physics and diagnostics

| Command | Purpose |
| --- | --- |
| `physics init\|on\|off\|gravity\|debug\|info` **dev** | Havok scene-physics control |
| `debug collision\|wireframe\|bounds\|player\|info` **dev** | Debug toggles |
| `stats [detailed]` / `mem` **dev** | Runtime statistics |
| `inspect` **dev** | Inspect the aimed scene object |
| `entity list\|info\|count` **dev** | Inspect entities |
| `scene [subcommand]` | Scene queries |
| `dump_scene [filter]` **dev** | Dump the Babylon scene graph |
| `console_debug [0\|1]` **dev** | Console diagnostics |
| `editor [open\|close\|status\|return]` **dev** | Open the SHAGGED four-view brush editor from the lobby; `return` comes back from a playtest. See [SHAGGED Editor](./shagged-editor.md) |
| `animtest load\|play\|list\|stop\|dispose` **dev** | Animation harness |
| `game info\|load\|switch\|reload` | Game module control |
| `hud <subcommand>` / `ui <subcommand>` | HUD and UI control |
| `audio <subcommand>` | Audio control |

There is no `debug fps` subcommand; use `show_fps`.

## Networking and FPS game commands

Engine: `join`, `nettest <subcommand>`, `binarytest <subcommand>`.

The FPS composition adds `connect`, `disconnect`, `loadout`, `demo`, `demolist`, `demoplay`, `timedemo`, `netsim` (network condition simulation), `pickup_audit`, `camera_audit` and `water`.

```text
connect localhost:7777
disconnect
cl_netgraph 2
demolist
demo <number-or-file>
demoplay
```

For offline renderer benchmarking, see the [timedemo guide](./timedemo.md).

Consult `help` in the actual FPS build: game commands and gametype options evolve independently from engine commands.

## Key bindings

| Command | Purpose |
| --- | --- |
| `bind` | List every bound key |
| `bind <key>` | Show what one key runs |
| `bind <key> <command>` | Bind a key to a console command |
| `unbind <key>` | Remove one binding |
| `unbind all` | Remove every binding |

```text
bind f screenshot
bind 5 "give all"
bind ` clear
unbind f
```

A key is written the way you would say it — `f`, `5`, `f5`, `space`, `esc`,
`up`, `` ` `` — or as the browser's own key code, `KeyF`. Bindings persist per
browser.

This is separate from the action map in Settings → Controls. An action binding
says what a key *means* while it is held — Jump, Fire, Crouch — and a command
binding runs a console command once, on the press. A key can carry both:
binding `space` to a command does not stop it being Jump.

A bound key stays quiet while a text field has the keyboard, while the console
is open, and when Ctrl, Alt or Meta is held, so it never steals a browser or
operating-system shortcut.
