# BSP Map System

How SHAG Engine loads and renders Quake 3/Warsow BSP maps.

## Overview

BSP (Binary Space Partitioning) is a data structure used by id Tech engines for storing level geometry. SHAG Engine supports:

- **IBSP** - Quake 3 Arena format
- **FBSP** - Warsow/Qfusion format (extended IBSP)

## Loading Pipeline

```
PK3 Archive
    ↓
BspLoader.load()        ← Parse binary format
    ↓
BspMeshBuilder.build()  ← Create Babylon.js meshes
    ↓
TextureLoader           ← Apply textures
    ↓
SkyboxLoader            ← Create skybox
    ↓
Scene ready
```

## BSP Structure

A BSP file contains multiple data "lumps":

| Lump | Content |
|------|---------|
| Entities | Spawn points, lights, triggers (text) |
| Textures | Texture/shader names |
| Planes | BSP node splitting planes |
| Nodes | BSP tree nodes |
| Leaves | BSP tree leaves (visibility) |
| Leaffaces | Faces in each leaf |
| Vertices | Vertex positions, UVs, colors |
| Meshverts | Triangle indices |
| Faces | Geometry surfaces |
| Lightmaps | Pre-baked lighting |
| Visibility | PVS data for occlusion |

## Face Types

BSP faces come in four types:

| Type | ID | Description |
|------|-----|-------------|
| Polygon | 1 | Simple convex polygon |
| Patch | 2 | Bezier curve surface |
| Mesh | 3 | Triangle mesh |
| Billboard | 4 | Camera-facing sprite |

## Using BspLoader

```typescript
import { BspLoader } from './engine/loader/bsp/BspLoader';

// Load BSP file
const bspData = await BspLoader.load(bspArrayBuffer);

// Access parsed data
console.log(bspData.header);       // Format info
console.log(bspData.vertices);     // Vertex array
console.log(bspData.faces);        // Face array
console.log(bspData.entities);     // Entity string
```

## Using BspMeshBuilder

```typescript
import { BspMeshBuilder } from './engine/loader/bsp/BspMeshBuilder';

const builder = new BspMeshBuilder(bspData, scene);
const result = await builder.build();

// result contains:
result.worldMesh;        // Main geometry mesh
result.lightmapTextures; // Lightmap atlas
result.skyShaders;       // Sky shader info
result.stats;            // Build statistics
```

## Entity Parsing

Entities are stored as a text lump in Q3 format:

```
{
"classname" "info_player_deathmatch"
"origin" "256 128 64"
"angle" "90"
}
{
"classname" "light"
"origin" "0 0 128"
"light" "300"
}
```

Parse with:

```typescript
import { parseEntities } from './engine/loader/bsp/EntityParser';

const entities = parseEntities(bspData.entities);
const spawns = entities.filter(e => e.classname === 'info_player_deathmatch');
```

## Lightmaps

BSP files contain pre-baked lighting as 128x128 RGB textures. SHAG Engine:

1. Extracts lightmap data from BSP
2. Creates Babylon.js textures
3. Applies as second UV channel on meshes

Control with render variables:

```
r_lightmap 0    # Disable lightmaps
r_lightmap 1    # Normal intensity
r_lightmap 2    # Brighter
```

## LightGrid (Light Volumes)

BSP files also contain a 3D grid of lighting samples called the "lightgrid" or "light volumes". This is used for lighting dynamic objects (players, models) that don't have lightmaps.

Each grid point stores:
- **Ambient RGB** - Base illumination (0-255 per channel)
- **Directional RGB** - Dominant light color (0-255 per channel)
- **Direction** - Spherical coords (theta, phi) pointing toward light source

### Query Lightgrid

```bash
bsp lightgrid    # Show values at camera position
```

Output:
```
Position: (128, 64, 256)
Ambient: [45.2, 42.1, 38.5]
Directional: [180.3, 175.2, 165.8]
Direction: [128, 64]
```

### Debug Visualization

```bash
bsp debug_grid        # Spawn colored spheres at grid points
bsp debug_grid clear  # Remove debug spheres
```

Debug spheres are colored by their ambient light value - brighter spheres indicate more light at that grid point.

### Programmatic Access

```typescript
import { BspManager } from './engine/loader/bsp/BspManager';

const manager = BspManager.getInstance();
const lighting = manager.getLightingAt(position);

if (lighting) {
  console.log('Ambient:', lighting.ambient);      // [r, g, b] 0-255
  console.log('Directional:', lighting.directional); // [r, g, b] 0-255
  console.log('Direction:', lighting.direction);  // [theta, phi] bytes
}
```

The `getLightingAt()` method performs trilinear interpolation for smooth lighting transitions between grid points.

## Collision

BSP geometry provides collision data through:

- **Brush models** - Solid volumes
- **Planes** - Surface normals
- **Trace functions** - Ray/box intersection

## PVS (Potentially Visible Set)

BSP files include precomputed visibility data:

```typescript
import { PVSCuller } from './engine/loader/bsp/PVSCuller';

const culler = new PVSCuller(bspData);
const visibleLeaves = culler.getVisibleLeaves(cameraPosition);
```

## Related

- [PK3 Filesystem](./pk3-filesystem.md) - How BSP files are loaded from archives
- [Shader System](./shader-system.md) - How textures/materials are applied
- [Skybox System](./skybox-system.md) - Sky shader handling
