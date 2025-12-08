# Entity Reference

Complete reference for all supported entity types in the engine.

---

## World Entities

### worldspawn

The root entity containing all world geometry.

| Property | Type | Description |
|----------|------|-------------|
| `message` | string | Map title/description |

**Contains:** Brushes and patches that form the world geometry.

```
{
"classname" "worldspawn"
"message" "My Level"
// brushes and patches here
}
```

---

### info_player_start

Defines the player/camera starting position.

| Property | Type | Description |
|----------|------|-------------|
| `origin` | vector3 | `"x y z"` - Spawn position (Quake coords) |

```
{
"classname" "info_player_start"
"origin" "0 0 100"
}
```

---

## Lighting

### light

Point light source.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | `"x y z"` - Light position |
| `light` | float | `300` | Intensity (divided by 200 for Babylon) |
| `_color` | vector3 | `"1 1 1"` | RGB color (0-1 or 0-255 range) |

```
{
"classname" "light"
"origin" "0 0 200"
"light" "500"
"_color" "1 0.5 0"
}
```

**Note:** Color values > 1.0 are auto-detected as 0-255 range and converted.

---

## Triggers

### trigger_multiple

Interactive trigger volume. Rendered as red wireframe.

| Property | Type | Description |
|----------|------|-------------|
| `targetname` | string | Unique identifier |
| `message` | string | Console message when triggered |
| `windowTarget` | string | Opens dialog with this ID |
| `targetMap` | string | Loads this map file |
| `spawnModel` | string | Spawns this prefab |
| `spawnOrigin` | vector3 | Where to spawn (defaults to trigger origin) |
| `spawnAngle` | float | Spawn rotation (degrees, default: random) |
| `spawnScale` | float | Spawn scale (default: 1) |
| `spawnDropToGround` | `"0"` or `"1"` | Drop spawned prefab to ground |
| `spawnValidators` | string | Comma-separated validator IDs |
| `maxCount` | int | Max instances (for max_count validator) |

```
{
"classname" "trigger_multiple"
"targetname" "spawn_button"
"spawnModel" "tree.map"
"spawnOrigin" "100 200 0"
"spawnDropToGround" "1"
"maxCount" "5"
{
// trigger brush geometry with common/trigger texture
}
}
```

---

## Prefabs

### misc_model

Places a prefab (.map file) as a model in the world.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | string | required | Prefab filename (e.g., `"tree.map"`) |
| `origin` | vector3 | `"0 0 0"` | Position (Quake coords) |
| `angle` | float | `0` | Y-axis rotation (degrees) |
| `scale` | float | `1` | Uniform scale |
| `dropToGround` | `"0"` or `"1"` | `"0"` | Raycast down to place on geometry |
| `dropOffset` | float | `0` | Vertical offset after dropping |

```
{
"classname" "misc_model"
"model" "props/barrel.map"
"origin" "128 256 0"
"angle" "45"
"scale" "1.5"
"dropToGround" "1"
}
```

**Prefab Convention:** The prefab's origin (0,0,0) is the floor/anchor point.

---

## Sprites

### sprite_building

Static 2D sprite rendered in 3D world. Perfect for isometric-style buildings, signs, and decorations.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | Position (Quake coords) |
| `texture` | string | required | Path to PNG texture (e.g., `"textures/base/shop.png"`) |
| `targetname` | string | - | Unique identifier |
| `width` | float | `100` | Width in world units |
| `height` | float | `100` | Height in world units |
| `billboard` | `"0"` or `"1"` | `"0"` | If `"1"`, sprite always faces camera |
| `angle` | float | `0` | Y rotation in degrees (ignored if billboard) |
| `emissive` | float | `0.2` | Self-illumination (0-1). See day/night section |
| `windowTarget` | string | - | Dialog ID to open when clicked |
| `triggerWidth` | float | - | Clickable area width |
| `triggerHeight` | float | - | Clickable area height |
| `triggerDepth` | float | - | Clickable area depth |
| `collisionWidth` | float | - | Collision box width |
| `collisionHeight` | float | - | Collision box height |
| `collisionDepth` | float | - | Collision box depth |

**Day/Night Cycle:**

The `emissive` property controls how the sprite interacts with the day/night cycle:

| Value | Effect |
|-------|--------|
| `0` | Fully affected by lighting - dark at night |
| `0.2` | Default - slight glow, visible at night but still darkens |
| `0.3-0.5` | Moderate glow - buildings with some lights |
| `0.5+` | Bright glow - neon signs, lit windows |
| `1.0` | Fully self-lit - ignores day/night |

**Rendering Modes:**

| Mode | Property | Use Case |
|------|----------|----------|
| Billboard | `"billboard" "1"` | 2D-style buildings that always face camera |
| Fixed | `"billboard" "0"` (default) | Geometric elements, signs with perspective |

```
// Billboard building (always faces camera)
{
"classname" "sprite_building"
"targetname" "shop"
"origin" "100 0 200"
"texture" "textures/base/shop.png"
"width" "128"
"height" "128"
"billboard" "1"
"emissive" "0.3"
"windowTarget" "shop_dialog"
"triggerWidth" "100"
"triggerHeight" "100"
"triggerDepth" "30"
}

// Fixed rotation building (perspective distortion)
{
"classname" "sprite_building"
"targetname" "sign"
"origin" "200 0 100"
"texture" "textures/base/neon_sign.png"
"width" "64"
"height" "32"
"angle" "45"
"emissive" "0.8"
}
```

---

### npc_sprite

2D animated billboard sprite that always faces the camera.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | Position (Quake coords) |
| `sprite` | string | `"test"` | Sprite sheet path or `"test"` for generated |
| `targetname` | string | - | Unique identifier |
| `scale` | float | `48` | Size in world units |
| `angle` | float | `0` | Facing direction (degrees) |
| `directions` | int | `8` | Sprite directions (1, 4, or 8) |
| `frames` | int | `4` | Animation frames per direction |
| `frameRate` | int | `8` | Animation FPS |
| `frameWidth` | int | `32` | Sprite frame width (pixels) |
| `frameHeight` | int | `32` | Sprite frame height (pixels) |
| `color` | string | `"#4488ff"` | Body color (test sprites only) |
| `accentColor` | string | `"#ffcc00"` | Accent color (test sprites only) |
| `receiveLighting` | `"0"` or `"1"` | `"1"` | React to scene lights |
| `ambientLevel` | float | `0.15` | Base brightness in shadow (0-1) |
| `castShadow` | `"0"` or `"1"` | `"1"` | Show ground shadow |
| `shadowOpacity` | float | `0.4` | Shadow darkness (0-1) |
| `shadowScale` | float | `1.2` | Shadow size multiplier |

```
{
"classname" "npc_sprite"
"targetname" "guard1"
"origin" "150 0 0"
"sprite" "test"
"color" "#ff4444"
"scale" "64"
"angle" "180"
"receiveLighting" "1"
"castShadow" "1"
}
```

---

## Geometry Types

### Brushes

Convex solid shapes defined by plane intersections.

**Format:**
```
( x1 y1 z1 ) ( x2 y2 z2 ) ( x3 y3 z3 ) texture u_off v_off rot u_scale v_scale
```

**Special Textures:**

| Texture | Effect |
|---------|--------|
| `color_R_G_B` | Solid color (e.g., `color_255_128_0`) |
| `common/caulk` | Not rendered (editor only) |
| `common/trigger` | Trigger volume (red wireframe) |

### Patches (patchDef2)

Bezier curved surfaces.

**Format:**
```
patchDef2
{
texture_name
( width height 0 0 0 )
(
( ( x y z u v ) ( x y z u v ) ... )
( ( x y z u v ) ( x y z u v ) ... )
...
)
}
```

**Requirements:**
- Width and height must be `2n+1` (3, 5, 7, 9...)
- Minimum: 3x3 (single curved patch)
- Larger sizes create multiple connected sub-patches

---

## Building

### build_zone

Defines an area where items can be placed (pots, equipment, decorations).

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | Center position (Quake coords) |
| `targetname` | string | auto | Unique zone identifier |
| `zoneType` | string | `"plant"` | Zone type: `"plant"`, `"equipment"`, `"decoration"` |
| `size` | float | `64` | Zone size in world units |

```
{
"classname" "build_zone"
"targetname" "pot_1"
"origin" "64 64 0"
"zoneType" "plant"
"size" "64"
}
```

**Zone Types:**

| Type | Description |
|------|-------------|
| `plant` | For plant pots and growing |
| `equipment` | For grow lights, watering systems |
| `decoration` | For decorative items |

**Visual Behavior:**
- Zones appear as subtle squares on the floor
- In build mode: available zones glow green, occupied zones glow red
- Click a green zone to place the selected item

---

## Coordinate System

The engine converts from Quake coordinates to Babylon.js:

| Axis | Quake | Babylon |
|------|-------|---------|
| Right | +X | +X |
| Forward | +Y | +Z |
| Up | +Z | +Y |

When specifying `origin` in entities, use Quake coordinates. The engine handles conversion automatically.
