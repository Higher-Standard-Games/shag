# Getting Started

Let's get you bunny hopping in under 5 minutes.

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | Recommended: 22 LTS |
| **npm 9+** or **pnpm** | Comes with Node.js |
| **Git** | For cloning |
| **Modern browser** | Chrome, Firefox, Edge with WebGL2 |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Higher-Standard-Games/shag.git
cd shag
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — you should see a map loaded and ready to explore.

**First thing to try:** Press `~` to open the console, then type `map wdm7` to load a different map.

---

## Available Scripts

### Development

| Command | What It Does |
|---------|--------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |

### Headless/CLI

| Command | What It Does |
|---------|--------------|
| `npm run cli:game` | Full engine CLI (no GPU needed) |
| `npm run cli:bsp` | BSP-only loader for map testing |

### Multiplayer

| Command | What It Does |
|---------|--------------|
| `npm run net:server` | Start dedicated server |
| `npm run net:client` | Headless test client |

### Quality

| Command | What It Does |
|---------|--------------|
| `npm run lint` | Run Biome linter |
| `npm run docs` | Generate API documentation |

---

## Quick Test Commands

Once the dev server is running, open the console (`~`) and try:

```
map wdm7              # Load a map
camera mode freefly   # FPS-style camera
r_wireframe 1         # Wireframe mode
r_wireframe 0         # Normal mode
mv sv_gravity 100     # Moon gravity!
mv sv_gravity 1000    # Back to normal
```

---

## Headless Mode (No GPU)

SHAG runs without a browser for testing and servers:

```bash
# Interactive REPL
npm run cli:game

# Single command and exit
npm run cli:game -- --command "map wdm7; bsp info; quit"

# Memory leak test
npm run cli:game -- --command "leaktest maprenderer 5"
```

This is how you test changes without opening a browser. AI assistants: use this.

---

## Multiplayer Quick Start

**Terminal 1 — Server:**

```bash
npm run net:server -- --map wdm7
```

**Terminal 2 — Client (browser):**

```bash
npm run dev
```

Then open console and type: `connect localhost:7777`

**Or use the headless client:**

```bash
npm run net:client -- --name TestPlayer
```

---

## Project Structure

```
shag-engine/
├── src/
│   ├── engine/           # Core engine (game-agnostic)
│   │   ├── camera/       # Camera controllers
│   │   ├── console/      # Console system
│   │   ├── core/         # EventBus, services
│   │   ├── loader/       # BSP, PK3, textures
│   │   ├── movement/     # Character physics
│   │   ├── network/      # Multiplayer networking
│   │   ├── physics/      # Collision detection
│   │   └── rendering/    # Render variables
│   ├── games/            # Game implementations
│   │   └── fps/          # FPS game mode
│   └── cli/              # Headless tools
├── public/
│   ├── engine.json       # Engine configuration
│   ├── engine/           # Engine assets
│   └── games/            # Game assets (PK3 files, maps)
└── docs/                 # Documentation
```

---

## Configuration

The engine reads `public/engine.json` at startup:

```json
{
  "defaultMap": "wdm7",
  "defaultCamera": "freefly",
  "pk3Paths": ["games/default/basewsw"]
}
```

> **Note:** The server tick rate (125Hz) and snapshot rate (60Hz) are configured via server flags, not `engine.json`. See the [Networking Guide](../guides/networking.md).

See [Configuration Guide](../guides/configuration.md) for all options.

---

## What's Next?

Now that you're running, here's where to go:

| Goal | Guide |
|------|-------|
| Understand the systems | [Features Overview](../introduction/features.md) |
| Build multiplayer | [Networking Guide](../guides/networking.md) |
| Customize movement | [Movement System](../guides/movement-system.md) |
| Add console commands | [Console System](../guides/console-system.md) |
| Deploy your game | [Deployment Guide](../deployment/) |

---

## Troubleshooting

### "Map doesn't load"

- Check that PK3 files exist in `public/games/default/basewsw/`
- Verify the map name: `map list` shows available maps
- Check browser console for errors

### "Performance is bad"

- Try `r_pvs 1` to enable PVS culling
- Lower `r_bloom 0` to disable bloom
- Check that you're using a discrete GPU, not integrated

### "Console won't open"

- Press the backtick key: `~` (below Escape)
- Some keyboard layouts use different keys
- Check that the game canvas has focus

---

*Ready to dive deeper? Check the [Guides](../guides/) for system-specific documentation.*
