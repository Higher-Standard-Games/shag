# Guides

In-depth explanations of SHAG Engine systems. These guides explain concepts and architecture rather than step-by-step instructions.

## Core Systems

| Guide | Description |
|-------|-------------|
| [Configuration](./configuration.md) | Build-time `GAME` selection, `.env` runtime networking, game submodules |
| [BSP Map System](./bsp-system.md) | How BSP maps are loaded and rendered |
| [Q3 Shader System](./shader-system.md) | Shader parsing and material application |
| [PK3 Filesystem](./pk3-filesystem.md) | Virtual filesystem and archive loading |
| [Camera System](./camera-system.md) | Camera controllers and modes |
| [Physics System](./physics-system.md) | Collision detection and backends |
| [Raw .map System](./raw-map-system.md) | **Prototyping without compiling** (NetRadiant workflow) |
| [Movement System](./movement-system.md) | Player movement and physics cvars |
| [Pickup System](./pickup-system.md) | Engine-generic in-world collectibles + how to subclass for your game |
| [Viewport Effects](./viewport-effects.md) | View bob, screen shake, FOV effects |
| [Weapon System](./weapon-system.md) | First-person weapons and projectiles |
| [Model Loading](./model-loading.md) | MD3, GLB and prefab loading |
| [Lighting System](./lighting-system.md) | Lightmaps, LightGrid, dynamic and area lights |

## Runtime Systems

| Guide | Description |
|-------|-------------|
| [Console System](./console-system.md) | Command registration and execution |
| [Command Reference](./command-reference.md) | Complete list of console commands |
| [Cvar System](./cvar-system.md) | Console variables for configuration |
| [Render Variables](./render-variables.md) | Runtime graphics configuration |
| [Skybox System](./skybox-system.md) | Cubemap and textured sky loading |
| [Map Launching](./map-launching.md) | `bsp load` vs `map` — the two paths, lobby dev-spawn, env vars |
| [Service Registries](./service-registries.md) | `NetworkConnector` / `GameplayMapLauncher` — how games inject behaviour into engine code |

## Map Editing

| Guide | Description |
|-------|-------------|
| [SHAGGED Editor](./shagged-editor.md) | The built-in four-view brush editor: building, texturing, entities, compile and playtest |
| [SHAGGED Scripting API](./shagged-api.md) | Build maps from scripts or AI agents: operations, CLI, MCP server and mapping rules |

## Multiplayer

| Guide | Description |
|-------|-------------|
| [Networking System](./networking.md) | Multiplayer architecture and API |
| [Lobby Server](./lobby-server.md) | Accounts, rooms, match spawning, results and ranking |
| [Map Launching](./map-launching.md) | Lobby dev-spawn flow used by the developer `map` command |

## Advanced Topics

| Guide | Description |
|-------|-------------|
| [Headless Mode](./headless-mode.md) | NullEngine and CLI usage |
| [Performance](../tutorials/advanced/performance.md) | PVS culling and optimization *(tutorial)* |
| [Entity System](../tutorials/advanced/entity-system.md) | BSP entities and spawning *(tutorial)* |

## How Guides Differ from Tutorials

| Tutorials | Guides |
|-----------|--------|
| "Do this, then this" | "This is how it works" |
| Task-oriented | Concept-oriented |
| Build something | Understand something |
| Beginner-friendly | Reference material |
