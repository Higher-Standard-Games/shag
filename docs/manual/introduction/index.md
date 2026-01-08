# Introduction

## What is SHAG Engine?

SHAG Engine is a modern TypeScript/WebGL game engine built on [Babylon.js](https://babylonjs.com) that loads idTech3-era assets. It parses BSP maps, PK3 archives, and Q3/QFusion shaders, making it easy to use existing level design tools and asset libraries.

### Key Features

- **BSP Map Loading** - Load IBSP (Quake 3) and FBSP (Warsow) maps with lightmaps and geometry
- **Q3 Shader Parsing** - Supports common shader directives: blendFunc, tcMod, animMap, skyparms
- **PK3 Virtual Filesystem** - Priority-based archive loading for mod support
- **Multiple Camera Modes** - Freefly, isometric, sidescroll, follow controllers
- **Console Command System** - Q3-style command syntax with extensible registry
- **Headless Mode** - NullEngine CLI for testing and CI/CD
- **Cross-Platform** - Web, mobile (Capacitor), desktop (Electron)

### Why SHAG Engine?

| Traditional Approach | SHAG Engine |
|---------------------|-------------|
| Port Q3 engine to WebGL | Native TypeScript, modern tooling |
| Desktop only | Web + Mobile + Desktop |
| C/C++ knowledge required | TypeScript, accessible to web devs |
| Full game logic port | Asset loading only - bring your own game logic |

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
