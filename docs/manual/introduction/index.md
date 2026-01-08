# Introduction

## What is SHAG Engine?

SHAG Engine is a modern TypeScript/WebGL game engine built on [Babylon.js](https://babylonjs.com), designed for creating arena-style games with full compatibility for Quake 3 and Warsow assets.

### Key Features

- **Full BSP Support** - Load IBSP (Quake 3) and FBSP (Warsow) maps with lightmaps, entities, and collision
- **Q3 Shader System** - 1,700+ shaders with blendFunc, tcMod, deformVertexes support
- **PK3 Virtual Filesystem** - Priority-based archive loading for mod support
- **Multiple Camera Modes** - Freefly, isometric, sidescroll, follow controllers
- **Console Command System** - 45+ commands with Q3-style syntax
- **Headless Mode** - NullEngine CLI for testing and CI/CD
- **Cross-Platform** - Web, mobile (Capacitor), desktop (Electron)

### Why SHAG Engine?

| Traditional Approach | SHAG Engine |
|---------------------|-------------|
| Port Q3 engine to WebGL | Native TypeScript, modern tooling |
| Large monolithic bundle | Tree-shaken, 3.4 MB gzipped |
| Desktop only | Web + Mobile + Desktop |
| C/C++ knowledge required | TypeScript, accessible to web devs |

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Your Game                        │
├─────────────────────────────────────────────────────┤
│  Console Commands  │  Camera System  │  Game Logic  │
├─────────────────────────────────────────────────────┤
│     BSP Loader     │  Shader System  │  PK3 Loader  │
├─────────────────────────────────────────────────────┤
│                   Babylon.js                        │
├─────────────────────────────────────────────────────┤
│                   WebGL / GPU                       │
└─────────────────────────────────────────────────────┘
```

## Next Steps

- [Feature Overview](./features.md) - Complete feature list
- [Getting Started](../getting-started/) - Set up your development environment
