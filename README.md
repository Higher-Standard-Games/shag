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
- **Bot AI System** - Standalone Bot Intelligence Server with state-machine AI, BSP vision, and human-feel timing
- **Demo Recording** - Server-side match recording (`.shagdemo`) for playback and future ML training

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (client)
npm run dev

# Build for production
npm run build

# Generate API documentation
npm run docs:api
```

## AI Agent Research Workflow

The repo now includes a small local multi-agent orchestrator for document analysis. The default path is optimized for low-cost usage:

- `gemini` goes first when available, with `opencode` and `claude` as fallback workers
- `codex` synthesizes the final result
- outputs are written under `.agent/runs/`
- provider/account failures are cached in `.agent/agent-health.json` so unhealthy agents are skipped automatically

Single-document workflow:

```powershell
npm run dev:research:agents-list
npm run dev:research:wizard
```

Direct command workflow:

```powershell
npm run dev:research:doc --doc=docs/research/DEMO_PLAYER.md --goal="Summarize implementation risks and next steps"
```

Dry run without calling models:

```powershell
npm run dev:research:doc --doc=docs/research/DEMO_PLAYER.md --goal="Summarize implementation risks and next steps" --dry-run=true
```

Use `--risk=high` if you want the default policy to favor a stronger synthesis/review path.

## Server Architecture

SHAG Engine includes a complete dedicated server stack for multiplayer FPS gameplay.

### Game Server

Headless authoritative game server with physics, weapons, combat, and gametype systems.

```bash
# Start a standalone game server (for development/testing)
npm --prefix src/games/fps run net:server
```

The lobby server spawns game servers automatically for production use.

### Lobby Server

Central matchmaking and server management. Spawns game server processes, manages match listings, and serves demo file metadata.

```bash
# Start the lobby server (default port: 9000)
npm --prefix src/games/fps run lobby:server

# Custom port
npm --prefix src/games/fps run lobby:server -- --port 9001
```

### Bot Intelligence Server (BIS)

Separate Node.js process that spawns AI bot clients. Bots connect to game servers as real WebSocket clients — indistinguishable from human players.

```bash
# Start BIS with control API (default port: 9100)
npm --prefix src/games/fps run bot:server

# Auto-connect 3 medium bots to a game server
npm --prefix src/games/fps run bot:server -- --auto ws://localhost:7777 --count 3

# 5 hard bots
npm --prefix src/games/fps run bot:server -- --auto ws://localhost:7777 --count 5 --difficulty hard
```

BIS provides an interactive CLI for managing bots at runtime:

| Command | Description |
|---------|-------------|
| `add [url] [difficulty]` | Add a bot to a game server |
| `remove <botId\|all>` | Remove bot(s) |
| `status` | Show all active bots and their AI state |
| `help` | List commands |

### Full Stack Launch Order

```bash
# Terminal 1: Lobby server (matchmaking + server spawner)
npm --prefix src/games/fps run lobby:server

# Terminal 2: Client (browser)
npm run dev

# Terminal 3 (optional): Bot server
npm --prefix src/games/fps run bot:server -- --auto ws://localhost:7777 --count 3
```

## Documentation

| Section | Description |
|---------|-------------|
| [Manual](docs/manual/) | Full documentation site (VitePress) |
| [Reference](docs/reference/) | Technical reference for engine systems |
| [Changelog](docs/changelog/) | Version history |
| [Research](docs/research/) | Design documents and planning notes |
| [Bot AI Research](docs/research/BOTS.md) | Bot Intelligence Server design and architecture |

## License

[MIT License](LICENSE) - Free for commercial and personal use.
