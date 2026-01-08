<p align="center">
  <img src="docs/manual/public/logo.png" alt="SHAG Engine" width="128">
</p>

<h1 align="center">SHAG Engine</h1>

<p align="center">
  <strong>Scary Hacks And Glue</strong><br>
  Cross-platform WebGL game engine with idTech3 tooling integration
</p>

<p align="center">
  <a href="docs/manual/">Documentation</a> •
  <a href="docs/changelog/">Changelog</a> •
  <a href="LICENSE">MIT License</a>
</p>

---

## What is SHAG Engine?

SHAG Engine is a cross-platform WebGL game engine built on [Babylon.js](https://babylonjs.com). It integrates with NetRadiant-custom and idTech3 tooling, enabling streamlined level design workflows while targeting web, mobile, and desktop from a single TypeScript codebase.

With **headless mode** and an **AI-agent friendly** architecture, SHAG Engine supports automated testing, CI/CD pipelines, and AI-assisted development.

### Key Features

- **Cross-Platform** - Web, mobile (Capacitor), desktop (Electron) from one codebase
- **Headless Mode** - Run without GPU for automated testing, CI/CD, and AI-agent workflows
- **BSP Map Loading** - Load IBSP (Quake 3) and FBSP (Warsow) maps with lightmaps and geometry
- **Q3 Shader Parsing** - Supports common shader directives: blendFunc, tcMod, animMap, skyparms
- **PK3 Virtual Filesystem** - Priority-based archive loading for mod support
- **Multiple Camera Modes** - Freefly, isometric, sidescroll, follow controllers
- **Console Command System** - Q3-style command syntax with extensible registry

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Generate API documentation
npm run docs:api
```

## Documentation

| Section | Description |
|---------|-------------|
| [Manual](docs/manual/) | Full documentation site (VitePress) |
| [Reference](docs/reference/) | Technical reference for engine systems |
| [Changelog](docs/changelog/) | Version history |
| [Research](docs/research/) | Design documents and planning notes |

## License

[MIT License](LICENSE) - Free for commercial and personal use.
