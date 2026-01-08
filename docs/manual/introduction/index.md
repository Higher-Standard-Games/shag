# Introduction

## What is SHAG Engine?

SHAG Engine is a cross-platform WebGL game engine built on [Babylon.js](https://babylonjs.com). It integrates with NetRadiant-custom and idTech3 tooling, enabling streamlined level design workflows while targeting web, mobile, and desktop from a single TypeScript codebase.

With **headless mode** and an **AI-agent friendly** architecture, SHAG Engine supports automated testing, CI/CD pipelines, and AI-assisted development—making it fast to iterate and easy to integrate with modern development workflows.

### Key Features

- **Cross-Platform** - Web, mobile (Capacitor), desktop (Electron) from one codebase
- **Headless Mode** - Run without GPU for automated testing, CI/CD, and AI-agent workflows
- **BSP Map Loading** - Load IBSP (Quake 3) and FBSP (Warsow) maps with lightmaps and geometry
- **Q3 Shader Parsing** - Supports common shader directives: blendFunc, tcMod, animMap, skyparms
- **PK3 Virtual Filesystem** - Priority-based archive loading for mod support
- **Multiple Camera Modes** - Freefly, isometric, sidescroll, follow controllers
- **Console Command System** - Q3-style command syntax with extensible registry

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
