# Feature Overview

Everything SHAG Engine can do, and what you can build with it.

---

## Core Engine

| Feature | What It Means |
|---------|---------------|
| **Babylon.js 8.x** | Modern WebGL2 with full GPU features |
| **TypeScript Native** | 100% typed, IDE-friendly, fewer bugs at runtime |
| **Tree-Shaken** | 8MB → 3.4MB bundle (-58%) through ES6 imports |
| **Singleton Services** | Clean architecture, easy to extend |

---

## BSP Map System

Load Quake 3 and Warsow maps directly—geometry, lightmaps, entities, and all.

| Feature | Details |
|---------|---------|
| **IBSP/FBSP** | Quake 3 (.bsp) and Warsow (FBSP) formats |
| **Lightmaps** | Pre-baked lighting with configurable intensity |
| **Face Types** | Polygons, Bezier patches, triangle meshes, billboards |
| **Entity Parsing** | Spawn points, lights, triggers, item locations |
| **PVS Culling** | Potentially Visible Set for occlusion (only render what's visible) |
| **Collision** | Full BSP brush collision with swept AABB |

---

## Shader System

Q3 shaders work here—animated textures, scrolling, waving, all the tricks that made Q3 maps look alive.

| Feature | Details |
|---------|---------|
| **Q3/QFusion Syntax** | Parses standard shader files from PK3 |
| **blendFunc** | Add, blend, filter, modulate |
| **tcMod** | Scroll, scale, rotate, turb (turbulence) |
| **deformVertexes** | Wave, autosprite (partial), bulge |
| **surfaceparm** | Sky, trans, nonsolid, nodraw, etc. |
| **animMap** | Animated texture sequences |
| **skyparms** | Skybox from shader definitions |

*Note: Some advanced Q3 shader features aren't fully implemented. Focus is on the 90% of shaders that work, not the 10% edge cases.*

---

## Movement System

The physics that made arena shooters feel good. Both Q3 and Warsow movement styles supported.

### Quake 3 Style
| Feature | Details |
|---------|---------|
| **Air Strafing** | Gain speed by strafing mid-air |
| **Bunny Hopping** | Chain jumps to maintain/gain speed |
| **Ground Friction** | Configurable via `sv_friction` |
| **Step Climbing** | Auto-climb small ledges (18 units default) |

### Warsow Style (Extended)
| Feature | Details |
|---------|---------|
| **Wall Jump** | Kick off walls for extra height/momentum |
| **Ledge Grab** | Grab ledges and pull yourself up |
| **Crouchslide** | Sprint → crouch = slide with camera tilt |
| **Air Control** | `sv_aircontrol` for tight mid-air turning |

### Movement CVars
All tweakable at runtime via console:
```
sv_gravity 1000          # Gravity (u/s²)
sv_jumpheight 320        # Jump velocity
sv_airaccelerate 1.0     # Air strafe acceleration
sv_aircontrol 150        # Warsow-style air turning
sv_walljump 1            # Enable wall jumps
sv_ledgegrab 1           # Enable ledge grabs
sv_slide 1               # Enable crouchslide
```

---

## Camera System

Multiple perspectives for different game types, switchable at runtime.

| Controller | Use Case |
|------------|----------|
| **FPS/Freefly** | First-person WASD + mouse look with collision |
| **Isometric** | Top-down for strategy/RPG games |
| **Sidescroll** | 2.5D platformer view |
| **Follow** | Third-person tracking |
| **Orthographic** | True orthographic projection (no perspective) |

Switch via console: `camera mode freefly`, `camera mode isometric`

---

## Console System

Press `~` and you're in familiar territory.

| Feature | Details |
|---------|---------|
| **Q3-Style Commands** | `command arg1 arg2` format |
| **Tab Completion** | Completes commands and arguments |
| **History** | Up/down arrows navigate history |
| **CVars** | Configuration variables with persistence |
| **Custom Commands** | Easy to register your own |

```
map wdm7              # Load a map
r_lightmap 2          # Increase lightmap intensity
mv sv_gravity 400     # Lower gravity
connect localhost:7777 # Join a server
```

---

## Networking System

Server-authoritative multiplayer, the way id Software intended.

### Architecture
| Component | Role |
|-----------|------|
| **Authoritative Server** | Runs the real simulation, clients obey |
| **Client Prediction** | Instant local feedback, no input lag |
| **Server Reconciliation** | Smooth correction when prediction was wrong |
| **Delta Compression** | Only send what changed (saves bandwidth) |
| **Interpolation** | Smooth remote player movement |

### Key Concepts
- **Tick-Based Simulation** — Fixed timestep (20Hz default), deterministic
- **Command Batching** — All player inputs processed together per tick
- **Grounded Flag** — Server tells client when you can jump (crucial!)
- **Smooth Correction** — Gradual drift to server position, not jarring snaps

### Commands
```bash
# Server
npm run net:server -- --map wdm7 --port 7777

# Client
connect ws://localhost:7777
network status
disconnect
```

*See [Networking Guide](../guides/networking.md) for the deep dive.*

---

## Viewport Effects

Post-processing and screen effects for that extra polish.

| Effect | Description |
|--------|-------------|
| **Bloom** | Glow on bright areas |
| **FXAA** | Fast anti-aliasing |
| **Color Grading** | Tint, saturation, contrast |
| **Vignette** | Darkened screen edges |
| **Screen Shake** | For impacts and explosions |
| **Damage Flash** | Red tint when hurt |

Controlled via render variables: `r_bloom 1.5`, `r_fxaa 1`

---

## Weapon System

Framework for implementing weapons with viewmodels and animation.

| Feature | Details |
|---------|---------|
| **Viewmodels** | First-person weapon display |
| **Animation States** | Idle, fire, reload, switch |
| **Projectile System** | For rockets, plasma, etc. |
| **Hitscan** | Instant trace for railguns, etc. |
| **Ammo System** | Tracking and pickup support |

*Game code implements the actual weapons—SHAG provides the framework.*

---

## Headless Mode

Run the full engine without a GPU. Essential for:

- **Dedicated Servers** — `npm run net:server`
- **CI/CD Testing** — Validate maps, shaders, collision
- **Memory Leak Detection** — `leaktest maprenderer 10`
- **Automated Workflows** — Load maps, run commands, exit

```bash
# Interactive CLI
npm run cli:game

# Single command
npm run cli:game -- --command "map wdm7; bsp info; quit"

# Dedicated server
npm run net:server -- --map wdm7
```

---

## Cross-Platform Deployment

| Platform | Technology | Notes |
|----------|------------|-------|
| **Web** | Vite + static hosting | Just deploy `dist/` |
| **Desktop** | Electron | Windows, Mac, Linux |
| **Mobile** | Capacitor | iOS and Android |

One codebase, all platforms. Write once, bunny hop everywhere.

---

## What SHAG Doesn't Do

Being honest about limitations helps you choose the right tool:

| Limitation | Why |
|------------|-----|
| **No trigger system** | BSP triggers are parsed but behavior is game code |
| **No built-in weapons** | Framework only, you implement the guns |
| **No AI/bots** | Pathfinding and bot logic is game code |
| **Partial shader support** | ~90% of Q3 shaders work, some edge cases don't |
| **No map editor** | Use NetRadiant-custom, import the BSP |

SHAG is an **engine**, not a complete game. It handles the hard parts (BSP loading, networking, physics) so you can focus on making your game unique.

---

## What's Next?

- [Getting Started](../getting-started/) — Install and run
- [Networking Guide](../guides/networking.md) — Deep dive on multiplayer
- [Movement System](../guides/movement-system.md) — All the physics details
- [Console System](../guides/console-system.md) — Commands and cvars
