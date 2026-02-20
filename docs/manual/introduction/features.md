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
| **LightGrid** | Per-vertex/model ambient lighting from BSP lightgrid data |
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
sv_movementSpeed 320     # Base movement speed
sv_movementRunSpeed 425  # Sprint speed
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
cl_netgraph 2         # Show network diagnostics
```

---

## Networking System

Server-authoritative multiplayer, the way id Software intended.

### Architecture

| Component | Role |
|-----------|------|
| **Authoritative Server** | Runs the real simulation at 125Hz |
| **Client Prediction** | Instant local feedback, no input lag |
| **Server Reconciliation** | Input replay + visual smoothing on correction |
| **Delta Compression** | Only send what changed (50-70% bandwidth savings) |
| **SnapshotBuffer** | Time-based interpolation for smooth remote players |
| **ClockSync** | NTP-like time synchronization for accurate interpolation |
| **Anti-Warp** | Server-side rate limiting protects against speed hacks |

### Key Specs

- **125Hz server tick rate** — 8ms per tick, deterministic physics
- **60Hz snapshot rate** — Every 2nd tick, delta-compressed per client
- **~50ms interpolation delay** — Auto-adjusting based on jitter
- **Visual reconciliation smoothing** — No camera jitter from corrections

### Network Diagnostics (NetGraph)

```
cl_netgraph 2         # Q3/Source-style overlay
```

Shows: ping, snapshot rate, packet loss %, interp delay, command rate, reconciliation rate, clock offset.

### Commands

```bash
# Server
npm run net:server -- --map wdm2 --port 7777

# Client
connect ws://localhost:7777
network status
disconnect
```

*See [Networking Guide](../guides/networking.md) for the deep dive.*

---

## Weapon System

Server-authoritative weapon pipeline with first-person rendering.

| Feature | Details |
|---------|---------|
| **Server-auth combat** | Server handles all damage, ammo, and hit detection |
| **Server-auth projectiles** | Projectile entities rendered via snapshot interpolation |
| **Viewmodels** | First-person weapon display with bob sync |
| **Weapon definitions** | Per-weapon fire rate, damage, splash, knockback config |
| **Crosshair system** | Per-weapon crosshair styles, hit markers |
| **Ammo system** | Server-tracked ammo with pickup support |
| **Weapon switching** | Slot-based (1-9) or quick-switch (Q) |
| **Weapon drops** | Havok physics on death, pickable by other players |

### Knockback & Splash Damage

| Feature | Details |
|---------|---------|
| **Server-side impulse queue** | Knockback applied as velocity impulse before movement |
| **Splash damage falloff** | Radius-based damage with distance falloff |
| **Client-predicted KB** | Instant self-damage knockback for responsive feel |
| **Configurable per weapon** | `splashRadius`, `splashDamage`, `knockbackScale` |

---

## HUD Data Layer

Real-time game data pipeline for UI rendering.

| Feature | Details |
|---------|---------|
| **Combat state** | Health/armor sent privately to owning player |
| **Damage events** | Attacker, weapon, damage amount |
| **Death events** | Victim, attacker, weapon for kill feed |
| **Scoreboard** | Kills, deaths, ping per player |
| **Damage numbers** | Floating positional damage indicators |

`HUDState` singleton aggregates all events into a queryable state.

---

## Gib System

Physics-based death effects for overkill damage.

| Feature | Details |
|---------|---------|
| **Bone-mapped gibs** | Gib pieces mapped to skeleton bones |
| **Physics simulation** | Gibs inherit death force vector velocity |
| **BSP collision** | Gibs collide with map geometry and settle |
| **Object pooling** | Prevents GC spikes from rapid creation/destruction |
| **Configurable** | `gib_threshold`, `gib_count`, `gib_lifetime` CVars |

---

## Death & Respawn

Warsow-inspired death and respawn flow.

| Feature | Details |
|---------|---------|
| **Camera freeze** | Camera locks at death position |
| **Weapon drops** | Dropped weapons use Havok physics for realistic tumbling |
| **Dropped weapon pickup** | Other players can pick up dropped weapons with ammo |
| **Respawn system** | Gametype-controlled spawn point selection |
| **Entity cleanup** | Proper dead player model disposal and state reset |

---

## Viewport Effects

Post-processing and first-person camera effects for polish.

| Effect | Description |
|--------|-------------|
| **Walk Bob** | View bobbing while moving (synced with weapon bob) |
| **Landing Impact** | Camera punch on landing |
| **Speed FOV** | FOV increase at high speed |
| **Strafe Lean** | Camera roll on strafe |
| **Idle Breathing** | Subtle idle movement |
| **Screen Shake** | For impacts and explosions |
| **Damage Flash** | Red tint when hurt |
| **Bloom** | Glow on bright areas |
| **FXAA** | Fast anti-aliasing |
| **Color Grading** | Tint, saturation, contrast |
| **Vignette** | Darkened screen edges |

Controlled via CVars: `cl_bobbing 1`, `r_bloom 1.5`, `r_fxaa 1`

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
npm run net:server -- --map wdm2
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
| **No built-in game modes** | Engine provides framework, you implement game logic |
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
- [Weapon System](../guides/weapon-system.md) — Server-authoritative weapons
