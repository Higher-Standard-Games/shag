# Raw .map Format

> Verified against <code>MapParser.ts</code> on 2026-08-06.

This page describes the text <code>.map</code> extension path, not compiled BSP gameplay maps. The active FPS normally loads <code>.bsp</code> files from PK3 packages.

<code>MapParser</code> supports:

- quoted entity key/value pairs;
- Valve-style three-point brush planes;
- NetRadiant <code>brushDef</code> wrappers;
- <code>patchDef2</code> control grids;
- full-line and inline <code>//</code> comments.

A parsed entity contains <code>classname</code>, <code>properties</code>, <code>brushes</code>, and <code>patches</code>. Brush planes retain three points, texture name, offsets, rotation, and scales. Patches retain texture, dimensions, and XYZ/UV control points.

The brushDef preprocessor currently discards its texture matrix and normalizes each plane to zero offset/rotation and unit scale. Do not rely on brushDef projection fidelity.

## Coordinates

Map source is Quake Z-up. Rendering converts it to Babylon Y-up:

    Quake X Y Z -> Babylon X Z Y

Keep prefab floor/anchor geometry around source origin. Plane winding matters to generated convex brushes; use known-good generated examples and inspect the mesh.

## Loading

<code>PrefabLoader</code> parses raw map fragments. <code>MapRenderer</code> renders full raw maps and their extension entities. <code>MapLoader</code> is the separate compiled BSP path.

For FPS maps, inspect the compiled result instead:

    npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"

See [Prefabs](./prefabs.md), [Entities](./entities.md), and [BSP System](../manual/guides/bsp-system.md).
