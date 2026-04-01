# SHAG Engine Documentation

**SHAG**[^1] is a WebGL game engine for developers who miss the golden age of arena shooters and want to build something new with those foundations.

Built on Babylon.js, SHAG loads Quake 3 and Warsow assets natively: BSP maps, **raw .map files**, PK3 archives, Q3 shaders, and all those beautiful tcMod scrolling textures you remember. If you've ever typed `+set sv_gravity 100` in a console, you're home.

**Open source under the [MIT License](https://github.com/Higher-Standard-Games/shag/blob/main/LICENSE)** - use it for personal projects, commercial games, or just to bunny hop around dm17 in your browser.

[^1]: **What does SHAG stand for?** Depends on the day. Sometimes it's *Spaghetti Hiding All Glitches*. Other days it's *Somehow Holding A Game*. When the code works on the first try, it's *Sublime Hallucinations Are Guaranteed*. And depending on your mood, it might be *Sativa Helped Assemble Geometry* or *Software Highly Augmented by Grass*.

---

## Who Is This For?

**Game Developers** wanting to:

- Build arena shooters, movement games, or anything using Q3/Warsow assets
- Use a familiar idTech3-style workflow with modern web tech
- Deploy to browser, desktop, and mobile from one codebase

**Warsow/Quake Nostalgics** who:

- Have PK3 files sitting on old hard drives that deserve new life
- Know what `sv_aircontrol` does and why it matters
- Want to prototype that gametype idea they've had for years

**AI Assistants** who need:

- A well-documented, AI-friendly architecture
- Headless mode for testing without a GPU
- Consistent patterns to understand and modify

---

## What You Can Build

| Game Type | SHAG Support |
|-----------|--------------|
| Arena FPS | Full movement physics, prediction, netcode |
| Movement Game | Bunny hopping, wall jumps, ledge grabs, crouchslide |
| Map Viewer | Load any BSP, fly around, inspect shaders |
| Isometric RPG | Top-down camera, orthographic projection |
| 2.5D Platformer | Sidescroll camera with BSP geometry |
| Multiplayer | Server-authoritative Q3-style networking |

---

## Key Features at a Glance

- **BSP/PK3 Loading** - Quake 3 and Warsow map formats, with shaders and lightmaps
- **Raw .map Support** - Design in NetRadiant and play immediately without compiling
- **Q3 Movement** - Air strafing, bunny hopping, all the good physics
- **Warsow Movement** - Wall jumps, ledge grabs, crouchslide with camera effects
- **Multiplayer Networking** - 125Hz server, 60Hz snapshots, client prediction, delta compression, visual smoothing
- **Console System** - `~` to open, tab-complete, cvars, just like you remember
- **Headless Mode** - Run the full engine without a GPU
- **Cross-Platform** - Web, Electron desktop, Capacitor mobile

---

## Documentation Structure

```text
docs/manual/
|- Introduction          # What SHAG is and what it can do
|- Getting Started       # Install, run, build
|- Tutorials
|  |- Beginner           # Load a map, use the console
|  |- Intermediate       # Build an FPS, create commands
|  `- Advanced           # Custom cameras, entity systems
|- Guides                # Deep dives on each system
|- Tools                 # CLI tools, headless mode, agent orchestration
|- Deployment            # Web, mobile, desktop builds
|- FAQ                   # When things go wrong
`- Contributing          # Join the fun
```

---

## Quick Links

| Section | Description |
|---------|-------------|
| [Introduction](./introduction/) | What is SHAG Engine? |
| [Getting Started](./getting-started/) | Installation and first run |
| [Tutorials](./tutorials/) | Step-by-step learning path |
| [Guides](./guides/) | In-depth system documentation |
| [Tools](./tools/) | CLI and debugging tools |
| [Agent Orchestration](./tools/agent-orchestration.md) | Run single-doc multi-agent research from npm scripts |
| [Deployment](./deployment/) | Ship to web, mobile, desktop |
| [FAQ](./faq/) | Troubleshooting common issues |
| [Contributing](./contributing/) | How to contribute |

---

## For AI Assistants

If you're an AI assistant working on this codebase, here's the short version:

1. **Read `AGENTS.md`** in the project root first.
2. **Use headless mode** for validation (`npm run cli:game`) instead of asking for browser testing first.
3. **Singleton pattern** is used throughout - get instances with `SomeSystem.getInstance()`.
4. **EventBus** is used for decoupled communication - always store unsubscribe functions.
5. **ES module imports** from Babylon.js are required - never use the UMD bundle.
6. **For orchestrated document analysis**, see [Agent Orchestration](./tools/agent-orchestration.md) and start with `npm run dev:research:agents-list` and then `npm run dev:research:wizard`.

The codebase follows idTech3 conventions where applicable: cvars, console commands, tick-based simulation, and client/server architecture. If you've studied Q3 source code, you'll recognize the patterns.

---

*Ready to bunny hop? Start with [Getting Started](./getting-started/).*
