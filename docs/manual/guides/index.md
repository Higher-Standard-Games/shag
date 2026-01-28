# Guides

In-depth explanations of SHAG Engine systems. These guides explain concepts and architecture rather than step-by-step instructions.

## Core Systems

| Guide | Description |
|-------|-------------|
| [Configuration](./configuration.md) | Engine configuration (engine.json) |
| [BSP Map System](./bsp-system.md) | How BSP maps are loaded and rendered |
| [Q3 Shader System](./shader-system.md) | Shader parsing and material application |
| [PK3 Filesystem](./pk3-filesystem.md) | Virtual filesystem and archive loading |
| [Camera System](./camera-system.md) | Camera controllers and modes |
| [Physics System](./physics-system.md) | Collision detection and backends |
| [Raw .map System](./raw-map-system.md) | **Prototyping without compiling** (NetRadiant workflow) |
| [Movement System](./movement-system.md) | Player movement and physics cvars |
| [Viewport Effects](./viewport-effects.md) | View bob, screen shake, FOV effects |
| [Weapon System](./weapon-system.md) | First-person weapons and projectiles |

## Runtime Systems

| Guide | Description |
|-------|-------------|
| [Console System](./console-system.md) | Command registration and execution |
| [Command Reference](./command-reference.md) | Complete list of console commands |
| [Cvar System](./cvar-system.md) | Console variables for configuration |
| [Render Variables](./render-variables.md) | Runtime graphics configuration |
| [Skybox System](./skybox-system.md) | Cubemap and textured sky loading |

## Multiplayer

| Guide | Description |
|-------|-------------|
| [Networking System](./networking.md) | Multiplayer architecture and API |

## Advanced Topics

| Guide | Description |
|-------|-------------|
| [Headless Mode](./headless-mode.md) | NullEngine and CLI usage |
| [Performance](./performance.md) | PVS culling and optimization |
| [Entity System](./entity-system.md) | BSP entities and spawning |

## How Guides Differ from Tutorials

| Tutorials | Guides |
|-----------|--------|
| "Do this, then this" | "This is how it works" |
| Task-oriented | Concept-oriented |
| Build something | Understand something |
| Beginner-friendly | Reference material |
