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
| IBSP/FBSP Support | Full Quake 3 and Warsow BSP format support |
| Lightmap Rendering | Pre-baked lightmaps with configurable intensity |
| Entity Parsing | Full entity lump parsing (spawn points, lights, triggers) |
| Face Types | Polygons, patches (Bezier curves), meshes, billboards |
| Collision Detection | BSP-based collision for camera and entities |
| PVS Culling | Potentially Visible Set for occlusion optimization |

## Shader System

| Feature | Description |
|---------|-------------|
| 1,700+ Shaders | Parses complete Warsow shader library |
| Blend Functions | `blendFunc` support (add, blend, filter, etc.) |
| Texture Mods | `tcMod` scroll, scale, rotate, turb, stretch |
| Vertex Deformations | `deformVertexes` wave, move, autosprite |
| Surface Parameters | `surfaceparm` sky, trans, alphashadow, etc. |
| Animated Textures | `animMap` and `animClampMap` support |

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
| 45+ Commands | Comprehensive command library |
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

## Headless Mode

| Feature | Description |
|---------|-------------|
| NullEngine Support | Run without GPU/WebGL |
| CLI Interface | `npm run cli:game` and `npm run cli:bsp` |
| Full Command Access | All console commands available |
| CI/CD Ready | Automated testing in pipelines |

## Cross-Platform

| Platform | Technology |
|----------|------------|
| Web | Vite + static deployment |
| Mobile | Capacitor (iOS/Android) |
| Desktop | Electron (Windows/Mac/Linux) |

## Statistics

| Metric | Value |
|--------|-------|
| Lines of TypeScript | 80,000+ |
| TypeScript Files | 220+ |
| PK3 Archives Supported | 94 |
| Shaders Parsed | 1,741 |
| Console Commands | 45+ |
| Bundle Size (gzip) | ~755 KB |
