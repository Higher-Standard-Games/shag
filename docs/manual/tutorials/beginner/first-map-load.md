# Your First Map Load

**Time:** 10 minutes
**Level:** Beginner

Learn how to load a Quake 3 / Warsow BSP map and inspect it from the console.

## Prerequisites

- SHAG Engine [installed and running](../../getting-started/)
- Development server started (`npm run dev`)

## Two Ways to Load a Map

SHAG has two distinct map-loading paths, and choosing the right one matters:

| Command | What It Does | When to Use |
|---------|--------------|-------------|
| `bsp load <name>` | Renders the BSP mesh into the scene. No gameplay, no server, no entities-as-pickups. You can fly around with the freefly camera. | Map inspection, shader debugging, screenshots, headless testing. |
| `map <name> [gametype]` | Developer-only. Asks the lobby to spawn a dedicated game server with the requested map + gametype, then connects this client to it. Full gameplay: physics, weapons, pickups, scoring. | Quick local play during development. Real players use the lobby UI's "Play" button. |

This tutorial uses **`bsp load`** — the inert mesh path — because it's the right tool for inspecting what a map looks like. See the [Map Launching Guide](../../guides/map-launching.md) for the gameplay path.

## Step 1: Open the Console

Press **`~`** (tilde) or **`F1`** to open the console.

You should see a command prompt:

```
> _
```

## Step 2: Load a Map for Inspection

Type the following command and press Enter:

```
bsp load wdm7
```

You'll see loading progress in the console and game log:

```
[BspCommand] Loading wdm7...
[PK3Loader] Found BSP: maps/wdm7.bsp
[BspLoader] Parsed 12,456 vertices, 8,234 faces
[BspMeshBuilder] Created Babylon mesh
[BspCommand] Render complete
```

## Step 3: Explore the Map

Switch to the freefly camera so you can move around:

```
camera mode freefly
```

Now use these controls:

| Key | Action |
|-----|--------|
| **W / A / S / D** | Move forward / left / back / right |
| **Mouse** | Look around (click the canvas first to capture pointer) |
| **Space** | Move up |
| **Shift** | Move down |
| **Scroll** | Adjust movement speed |

## Step 4: Try Other Maps

Several Warsow-style maps are typically bundled (depending on the PK3 set under `public/data/`):

```
bsp load wdm2
bsp load wdm11
bsp load wctf1
```

## Step 5: Get Map Info

While a BSP is loaded:

```
bsp info
```

You'll see map statistics:

```
Format: FBSP
Vertices: 12,456
Faces: 8,234
Textures: 89
Entities: 42
```

Other inspection commands:

```
bsp entities         # List all entities in the map (spawn points, lights, triggers)
bsp textures         # List textures the map references
bsp lightgrid        # LightGrid sample at the current camera position
```

## What's Happening Under the Hood?

When you type `bsp load wdm7`:

1. **PK3 index** locates `maps/wdm7.bsp` inside one of the discovered PK3 archives
2. **BspLoader** parses the binary BSP format (IBSP for Q3, FBSP for Warsow)
3. **BspMeshBuilder** assembles Babylon.js geometry from the BSP face data, lightmaps, and patches
4. **Q3ShaderRegistry** resolves shader scripts and applies the resulting materials
5. **SkyboxLoader** creates the sky from any `skyparms` references
6. **CameraSystem** moves the active camera to `info_player_deathmatch` (or `info_player_start`) for a sensible starting view

No server is involved — the entities (spawn points, triggers, item locations) are visible as data, but nothing is simulated. To actually play the map, see the [Map Launching Guide](../../guides/map-launching.md).

## Troubleshooting

**"Map not found" / empty index?**

```
pk3 index            # Rebuild the PK3 file index
pk3 list maps/       # List discovered maps
```

**Black screen after load?**

The lightmap intensity might be zero. Try:

```
r_lightmap 1
r_apply
```

**Want to see the shader for the surface under your crosshair?**

```
shader info          # No args = inspect aimed surface
```

## Next Steps

- [Navigating with the Camera](./camera-navigation.md)
- [Using the Console](./using-console.md)
- [Map Launching Guide](../../guides/map-launching.md) — server-backed gameplay launches
- [BSP System Guide](../../guides/bsp-system.md) — deep dive on the BSP pipeline
