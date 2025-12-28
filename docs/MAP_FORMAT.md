# .map File Format Documentation

This document describes the Q3map2/NetRadiant-compatible `.map` file format used by this engine. Use this as a reference when generating or editing map files.

## Overview

The `.map` format is a text-based format that defines:
- **Entities** - Objects with key-value properties (player starts, lights, triggers, etc.)
- **Brushes** - 3D convex shapes defined by plane intersections (floors, walls, trigger volumes)

## File Structure

```
//@$& layerdef "0" -1 0 0 0
// entity 0
{
"classname" "worldspawn"
"key" "value"
// brush 0
{
brushDef
{
( plane1 ) ( ( uv_matrix ) ) texture flags
( plane2 ) ( ( uv_matrix ) ) texture flags
( plane3 ) ( ( uv_matrix ) ) texture flags
( plane4 ) ( ( uv_matrix ) ) texture flags
( plane5 ) ( ( uv_matrix ) ) texture flags
( plane6 ) ( ( uv_matrix ) ) texture flags
}
}
}
// entity 1
{
"classname" "info_player_start"
"origin" "0 0 100"
}
```

## Header

Always start with the layer definition:
```
//@$& layerdef "0" -1 0 0 0
```

## Entities

Entities are defined within curly braces `{}` with key-value pairs in quotes:

```
{
"classname" "entity_type"
"key1" "value1"
"key2" "value2"
}
```

### Entity Types

| Classname | Description | Required Properties |
|-----------|-------------|---------------------|
| `worldspawn` | The world entity, contains map brushes | `classname` |
| `info_player_start` | Player spawn point | `origin` |
| `light` | Point light source | `origin`, `light`, `range`, `_color` |
| `street_lamp` | Decorative lamp with light | `origin`, `light`, `range`, `_color`, `fadeTime`, `bulbSize` |
| `build_zone` | Buildable area marker | `origin`, `zoneType`, `size`, `color` |
| `trigger_multiple` | Clickable trigger volume | Contains a brush, plus properties |
| `info_npc` | NPC spawn point | `origin`, `npcId`, `name` |
| `info_debris_zone` | Local debris particle spawner | `origin`, `type`, `radius` |

### Common Properties

| Property | Format | Example | Description |
|----------|--------|---------|-------------|
| `origin` | `"x y z"` | `"100 200 50"` | Position in world space |
| `light` | `"intensity"` | `"200"` | Light brightness |
| `range` | `"distance"` | `"300"` | Light falloff range |
| `_color` | `"r g b"` (0-255 or 0-1) | `"255 200 100"` | RGB color |
| `targetMap` | `"path"` | `"maps/areas/suburbs.map"` | Map to load on trigger |
| `windowTarget` | `"dialog_id"` | `"seed_store"` | Dialog to open on trigger |
| `requiredLevel` | `"level"` | `"3"` | Level requirement for trigger |
| `requiredMoney` | `"amount"` | `"1000"` | Money requirement for trigger |
| `deniedMessage` | `"text"` | `"Need level 3!"` | Message when requirements not met |
| `zoneType` | `"type"` | `"plant"` | Build zone type: plant, growlight, equipment, decoration |

## Brushes (brushDef Format)

Brushes define 3D geometry using 6 planes (for a box). Each plane is defined by 3 points.

### Brush Structure

```
{
brushDef
{
( x1 y1 z1 ) ( x2 y2 z2 ) ( x3 y3 z3 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
... (6 planes total for a box)
}
}
```

### Plane Definition

Each line defines one plane:
```
( p1x p1y p1z ) ( p2x p2y p2z ) ( p3x p3y p3z ) ( ( uv_s ) ( uv_t ) ) texture flags
```

- **3 Points**: Define the plane orientation (winding order matters!)
- **UV Matrix**: `( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) )` - standard UV mapping
- **Texture**: Texture name (e.g., `color_100_100_100` for RGB color)
- **Flags**: `0 0 0` - surface flags (usually all zeros)

### CRITICAL: Plane Winding Order

The 3 points must be in the correct order for NetRadiant to render the brush.

For an axis-aligned box from `(minX, minY, minZ)` to `(maxX, maxY, maxZ)`:

```
// Top face (Z = maxZ)
( minX minY maxZ ) ( minX maxY maxZ ) ( maxX minY maxZ )

// Bottom face (Z = minZ)
( minX maxY minZ ) ( minX minY minZ ) ( maxX maxY minZ )

// Front face (Y = minY)
( minX minY maxZ ) ( maxX minY maxZ ) ( minX minY minZ )

// Back face (Y = maxY)
( maxX maxY maxZ ) ( minX maxY maxZ ) ( maxX maxY minZ )

// Left face (X = minX)
( minX maxY maxZ ) ( minX minY maxZ ) ( minX maxY minZ )

// Right face (X = maxX)
( maxX minY maxZ ) ( maxX maxY maxZ ) ( maxX minY minZ )
```

### Box Brush Template

For a box from `(x1, y1, z1)` to `(x2, y2, z2)`:

```
{
brushDef
{
( x1 y1 z2 ) ( x1 y2 z2 ) ( x2 y1 z2 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
( x1 y2 z1 ) ( x1 y1 z1 ) ( x2 y2 z1 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
( x1 y1 z2 ) ( x2 y1 z2 ) ( x1 y1 z1 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
( x2 y2 z2 ) ( x1 y2 z2 ) ( x2 y2 z1 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
( x1 y2 z2 ) ( x1 y1 z2 ) ( x1 y2 z1 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
( x2 y1 z2 ) ( x2 y2 z2 ) ( x2 y1 z1 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) texture 0 0 0
}
}
```

## Color Textures

Use `color_R_G_B` format for solid colors (0-255 range):

| Texture Name | Color |
|--------------|-------|
| `color_100_100_100` | Gray |
| `color_70_110_50` | Green (grass) |
| `color_50_50_55` | Dark gray (road) |
| `color_200_180_50` | Yellow (road lines) |
| `color_180_175_170` | Light gray (sidewalk) |
| `color_139_90_43` | Brown (curing station) |
| `color_100_200_100` | Green (seed shop) |
| `color_255_220_100` | Gold (portal) |

## Complete Examples

### Simple Floor Brush (800x800, 16 units thick)

```
// brush 0 - floor
{
brushDef
{
( -400 -400 -16 ) ( -400 400 -16 ) ( 400 -400 -16 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_100_100_100 0 0 0
( -400 400 -32 ) ( -400 -400 -32 ) ( 400 400 -32 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_80_80_80 0 0 0
( -400 -400 -16 ) ( 400 -400 -16 ) ( -400 -400 -32 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_90_90_90 0 0 0
( 400 400 -16 ) ( -400 400 -16 ) ( 400 400 -32 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_90_90_90 0 0 0
( -400 400 -16 ) ( -400 -400 -16 ) ( -400 400 -32 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_90_90_90 0 0 0
( 400 -400 -16 ) ( 400 400 -16 ) ( 400 -400 -32 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_90_90_90 0 0 0
}
}
```

### Trigger with Brush

```
{
"classname" "trigger_multiple"
"targetname" "portal_to_suburbs"
"targetMap" "maps/areas/suburbs_main.map"
"message" "To Suburbs"
"requiredLevel" "3"
"deniedMessage" "Reach level 3 first!"
// brush 0
{
brushDef
{
( 350 -50 0 ) ( 350 50 0 ) ( 400 -50 0 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_255_220_100 0 0 0
( 350 50 64 ) ( 350 -50 64 ) ( 400 50 64 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_255_220_100 0 0 0
( 350 -50 0 ) ( 400 -50 0 ) ( 350 -50 64 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_200_180_80 0 0 0
( 400 50 0 ) ( 350 50 0 ) ( 400 50 64 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_200_180_80 0 0 0
( 350 50 0 ) ( 350 -50 0 ) ( 350 50 64 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_220_200_90 0 0 0
( 400 -50 0 ) ( 400 50 0 ) ( 400 -50 64 ) ( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) ) color_220_200_90 0 0 0
}
}
}
```

### Point Light

```
{
"classname" "light"
"origin" "0 0 150"
"light" "200"
"range" "500"
"_color" "1 0.9 0.7"
}
```

### Street Lamp

```
{
"classname" "street_lamp"
"targetname" "lamp_1"
"origin" "-200 80 50"
"light" "150"
"range" "120"
"_color" "255 200 100"
"fadeTime" "3"
"bulbSize" "3"
}
```

### Build Zone

```
{
"classname" "build_zone"
"targetname" "pot_1"
"origin" "-150 -220 0"
"zoneType" "plant"
"size" "64"
"color" "100 200 100"
}
```

### Debris Zone

Spawns local debris particles in a fixed area. Responds to wind system.

```
{
"classname" "info_debris_zone"
"targetname" "autumn_leaves"
"origin" "200 100 32"
"type" "leaves"
"radius" "128"
"height" "64"
"density" "0.5"
"windInfluence" "0.8"
}
```

| Property | Default | Description |
|----------|---------|-------------|
| `type` | `"leaves"` | Debris type: `leaves`, `trash`, `dust`, `mixed` |
| `radius` | `128` | Horizontal spawn radius |
| `height` | `64` | Vertical spawn range |
| `density` | `0.5` | Particle density (0-1) |
| `windInfluence` | `0.8` | How much wind affects particles (0-1) |

**Note:** Debris zones are automatically disabled on indoor maps.

### NPC

```
{
"classname" "info_npc"
"targetname" "npc_old_pete"
"name" "Old Pete"
"npcId" "npc_mentor"
"origin" "-300 250 -16"
"angle" "0"
}
```

## Worldspawn Properties

The `worldspawn` entity can have special properties:

| Property | Description | Example |
|----------|-------------|---------|
| `message` | Map display name | `"Slum Street"` |
| `camera_mode` | Camera type | `"fake_ortho"` |
| `camera_height` | Camera distance | `"800"` |
| `area_id` | Area identifier | `"slums_street"` |
| `area_tier` | Area tier | `"slums"` |
| `playlist` | Music playlist file | `"defaultPlaylist.json"` |

## Coordinate System

- **X**: East (+) / West (-)
- **Y**: North (+) / South (-)
- **Z**: Up (+) / Down (-)

Ground level is typically at Z = -16 to Z = 0.
Player spawn height is typically Z = 100.

## Tips for Generation

1. **Always use the layerdef header**: `//@$& layerdef "0" -1 0 0 0`
2. **Use brushDef format**, not older legacy formats
3. **UV matrix is always**: `( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) )`
4. **Flags are always**: `0 0 0`
5. **Plane winding order is critical** - use the template above
6. **Entity numbering in comments is optional** but helps readability
7. **Brush numbering in comments is optional** but helps readability
8. **Ground brushes go inside worldspawn**, trigger brushes go inside their entity
