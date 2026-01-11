# Feature Overview

Complete list of SHAG Engine features and capabilities.

## Core Engine

| Feature | Description |
|---------|-------------|
| Babylon.js Foundation | Built on Babylon.js 8.x with ES6 modules |
| Tree-Shaken Bundle | 8MB → 3.4MB (-58%) through aggressive tree-shaking |
| TypeScript Native | 100% TypeScript codebase with strict typing |
| Singleton Architecture | Clean service-based architecture |

## BSP Map System

| Feature | Description |
|---------|-------------|
| IBSP/FBSP Support | Quake 3 and Warsow BSP geometry and lightmaps |
| Lightmap Rendering | Pre-baked lightmaps with configurable intensity |
| Entity Parsing | Entity lump parsing (spawn points, lights, doors) |
| Face Types | Polygons, patches (Bezier curves), meshes, billboards |
| Collision Detection | BSP-based collision for camera |
| PVS Culling | Potentially Visible Set for occlusion optimization |

## Shader System

| Feature | Description |
|---------|-------------|
| Shader Parsing | Parses Q3/QFusion shader syntax |
| Blend Functions | `blendFunc` support (add, blend, filter) |
| Texture Mods | `tcMod` scroll, scale, rotate, turb |
| Vertex Deformations | `deformVertexes` wave, autosprite (partial) |
| Surface Parameters | `surfaceparm` sky, trans, nonsolid |
| Animated Textures | `animMap` support |
| Skyparms | Skybox loading from shader definitions |

## Camera System

| Feature | Description |
|---------|-------------|
| Freefly Controller | FPS-style WASD + mouse look with collision |
| Isometric Controller | Top-down RTS/RPG perspective |
| Sidescroll Controller | 2.5D platformer camera |
| Follow Controller | Third-person character tracking |
| Runtime Switching | Change camera mode via console |
| Orthographic Mode | True orthographic projection |

## Console System

| Feature | Description |
|---------|-------------|
| Built-in Commands | Map loading, render variables, camera control |
| Q3-Style Syntax | Familiar `command arg1 arg2` format |
| Tab Completion | Auto-complete for commands |
| Command History | Up/down arrow navigation |
| Custom Commands | Easy to add your own commands |

## Render Variables

Runtime-configurable rendering:

- `r_normalmap` - Normal map intensity (0-4)
- `r_lightmap` - Lightmap intensity (0-4)
- `r_wireframe` - Wireframe toggle (0/1)
- `r_bloom` - Bloom intensity (0-3)
- And 8 more...

## Networking

| Feature | Description |
|---------|-------------|
| Authoritative Server | Q3-style server-authoritative architecture |
| Client Prediction | Local prediction with server reconciliation |
| Smooth Correction | Gradual position correction (not snap) |
| Binary Protocol | Efficient binary message encoding |
| Interpolation | Remote entity smoothing via snapshot buffer |
| WebSocket Transport | Browser-compatible networking |
| Dedicated Server | `npm run net:server` headless server |
| Connect Command | In-game `connect <server>` command |

## Headless Mode

| Feature | Description |
|---------|-------------|
| NullEngine Support | Run without GPU/WebGL |
| CLI Interface | `npm run cli:game` and `npm run cli:bsp` |
| Network Server | `npm run net:server` dedicated server |
| Network Client | `npm run net:client` test client |
| Full Command Access | All console commands available |
| CI/CD Ready | Automated testing in pipelines |

## Cross-Platform

| Platform | Technology |
|----------|------------|
| Web | Vite + static deployment |
| Mobile | Capacitor (iOS/Android) |
| Desktop | Electron (Windows/Mac/Linux) |

## Limitations

SHAG Engine focuses on **asset loading**, not full game logic replication:

- **No trigger system** - Triggers must be implemented in your game code
- **No weapon/item logic** - Entity data is parsed but behavior is yours to implement
- **Partial shader support** - Not all Q3 shader directives are implemented
- **Game logic required** - Networking provides infrastructure, game simulation is yours
