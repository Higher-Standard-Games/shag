# SHAG Engine Documentation

Welcome to the SHAG Engine documentation. SHAG Engine is a cross-platform WebGL game engine built on Babylon.js, designed for streamlined development using NetRadiant-custom and idTech3 tooling. With headless mode and AI-agent friendly architecture, SHAG Engine enables rapid prototyping, automated testing, and AI-assisted development workflows.

**Open source under the [MIT License](https://github.com/user/shag-engine/blob/main/LICENSE)** — free for personal and commercial use.

---

## Full Documentation Tree

```
docs/manual/
│
├── Introduction
│   ├── index.md                    # What is SHAG Engine?
│   └── features.md                 # Complete feature list
│
├── Getting Started
│   ├── index.md                    # Installation & setup
│   ├── project-structure.md        # Directory layout explained
│   └── building.md                 # Production builds
│
├── Tutorials
│   ├── index.md                    # Tutorial overview
│   │
│   ├── beginner/
│   │   ├── first-map-load.md       # Load and explore a map
│   │   ├── camera-navigation.md    # Camera controls
│   │   ├── using-console.md        # Console basics
│   │   └── render-variables.md     # Tweaking r_* variables
│   │
│   ├── intermediate/
│   │   ├── map-viewer.md           # Build a map browser app
│   │   ├── fps-skeleton.md         # FPS game foundation
│   │   ├── isometric-game.md       # Isometric strategy setup
│   │   ├── sidescroller.md         # 2.5D platformer setup
│   │   ├── custom-commands.md      # Add console commands
│   │   └── pk3-mods.md             # Working with PK3 mods
│   │
│   ├── advanced/
│   │   ├── custom-camera.md        # Build custom camera controller
│   │   ├── custom-shaders.md       # Custom Babylon.js materials
│   │   ├── entity-system.md        # Entity parsing & spawning
│   │   ├── headless-testing.md     # CI/CD integration
│   │   └── performance.md          # Optimization techniques
│   │
│   └── recipes/
│       ├── change-skybox.md        # Swap skybox at runtime
│       ├── toggle-wireframe.md     # Debug visualization
│       ├── get-spawn-points.md     # Extract player spawns
│       ├── extract-entities.md     # Parse BSP entities
│       ├── debug-shader.md         # Inspect surface materials
│       └── export-settings.md      # Save render configuration
│
├── Guides
│   ├── index.md                    # Guide overview
│   ├── bsp-system.md               # BSP map loading & rendering
│   ├── shader-system.md            # Q3 shader parsing
│   ├── camera-system.md            # Camera controllers & modes
│   ├── console-system.md           # Command registration
│   ├── pk3-filesystem.md           # Virtual filesystem
│   ├── skybox-system.md            # Skybox loading
│   ├── render-variables.md         # Runtime r_* configuration
│   ├── headless-mode.md            # NullEngine CLI
│   ├── entity-system.md            # BSP entity handling
│   └── performance.md              # PVS, optimization
│
├── Tools
│   ├── index.md                    # Tools overview
│   ├── headless-game.md            # Full headless CLI
│   └── headless-bsp.md             # BSP-only CLI
│
├── Deployment
│   ├── index.md                    # Platform overview
│   ├── web.md                      # Static web hosting
│   ├── mobile.md                   # Capacitor (iOS/Android)
│   └── desktop.md                  # Electron apps
│
├── FAQ
│   └── index.md                    # Troubleshooting
│
└── Contributing
    └── index.md                    # How to contribute
```

---

## Quick Links

| Section | Description |
|---------|-------------|
| [Introduction](./introduction/) | What is SHAG Engine? |
| [Getting Started](./getting-started/) | Installation and setup |
| [Tutorials](./tutorials/) | Step-by-step learning |
| [Guides](./guides/) | In-depth system docs |
| [Tools](./tools/) | CLI and debugging |
| [Deployment](./deployment/) | Web, mobile, desktop |
| [API Reference](/api/) | TypeDoc generated docs |
| [FAQ](./faq/) | Troubleshooting |
| [Contributing](./contributing/) | How to contribute |
