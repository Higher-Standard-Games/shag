# Entity Reference

Complete reference for all supported entity types in the engine.

---

## World Entities

### worldspawn

The root entity containing all world geometry and map-wide settings.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `message` | string | - | Map title/description |
| `camera_mode` | string | `"perspective"` | Camera rendering mode (see below) |
| `camera_height` | float | varies | Camera distance/zoom level |

**Contains:** Brushes and patches that form the world geometry.

#### Camera Modes

| Mode | Description | Clustered Lighting |
|------|-------------|-------------------|
| `perspective` | Regular perspective camera | ✅ Full support |
| `orthographic` | True orthographic projection - perfect for 2D sprites | ⚠️ May have artifacts at screen edges |
| `fake_ortho` | Perspective with very low FOV - looks orthographic | ✅ Full support |

#### Camera Height

The meaning of `camera_height` varies by mode:

| Mode | camera_height controls | Default |
|------|----------------------|---------|
| `perspective` | Camera radius (distance from target) | 600 |
| `orthographic` | Orthographic size (zoom level) | 250 |
| `fake_ortho` | Camera radius (distance from target) | 4000 |

#### Examples

```
// Default perspective camera
{
"classname" "worldspawn"
"message" "My Level"
// brushes and patches here
}

// Fake orthographic with custom zoom
{
"classname" "worldspawn"
"message" "Isometric Level"
"camera_mode" "fake_ortho"
"camera_height" "5000"
// brushes and patches here
}

// True orthographic for 2D sprite games
{
"classname" "worldspawn"
"message" "2D Style Level"
"camera_mode" "orthographic"
"camera_height" "300"
// brushes and patches here
}
```

#### Runtime Commands

Camera settings can be changed at runtime via console:
```javascript
setCameraMode('perspective')    // Switch to perspective
setCameraMode('orthographic')   // Switch to orthographic
setCameraMode('fake_ortho')     // Switch to fake orthographic
setCameraHeight(5000)           // Adjust zoom/distance
getCameraMode()                 // Get current mode
getCameraHeight()               // Get current height
```

---

### info_player_start

Defines the player/camera starting position.

| Property | Type | Description |
|----------|------|-------------|
| `origin` | vector3 | `"x y z"` - Spawn position (map coords) |

```
{
"classname" "info_player_start"
"origin" "0 0 100"
}
```

---

## Lighting

The engine uses **BabylonJS 8 Clustered Lighting** for efficient rendering of many point lights. This allows dozens of lights without performance issues.

> **Note:** Clustered lighting works best with `perspective` or `fake_ortho` camera modes. True `orthographic` mode may show visual artifacts at screen edges when lights are near the viewport boundary.

### light

Point light source. Multiple lights are automatically grouped into a clustered light container.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | `"x y z"` - Light position |
| `light` | float | `300` | Intensity (divided by 200 for Babylon) |
| `range` | float | `200` | Light range in world units |
| `_color` | vector3 | `"1 1 1"` | RGB color (0-1 or 0-255 range) |

```
{
"classname" "light"
"origin" "0 0 200"
"light" "500"
"range" "400"
"_color" "1 0.5 0"
}
```

**Notes:**
- Color values > 1.0 are auto-detected as 0-255 range and converted
- For PBR materials (GLB models), lights use clustered rendering automatically
- Static lights don't cast shadows (use SkyLightSystem for shadows)

---

### street_lamp

Dynamic point light that automatically turns on/off based on time of day. Features smooth fade transitions and optional flicker effects. Creates a visible glowing bulb mesh.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | *required* | Position (map coords) |
| `targetname` | string | auto | Unique identifier |
| `light` | float | `200` | Intensity (divided by 200 for Babylon) |
| `_color` | vector3 | `"255 200 150"` | RGB color (0-255 or 0-1 range) |
| `range` | float | `100` | Light range in world units |
| `fadeTime` | float | `2` | Fade in/out duration (seconds) |
| `turnOnHour` | float | `18` | Hour to turn on (0-24, default: 6 PM) |
| `turnOffHour` | float | `6` | Hour to turn off (0-24, default: 6 AM) |
| `flicker` | `"0"` or `"1"` | `"0"` | Enable subtle flicker effect |
| `showBulb` | `"0"` or `"1"` | `"1"` | Show glowing bulb mesh |
| `bulbSize` | float | `3` | Bulb mesh diameter |

#### Examples

**Standard warm street lamp:**
```
{
"classname" "street_lamp"
"targetname" "lamp_1"
"origin" "100 200 50"
"light" "200"
"range" "150"
"_color" "255 200 150"
"fadeTime" "2"
"bulbSize" "4"
}
```

**Flickering neon (blue, faulty effect):**
```
{
"classname" "street_lamp"
"targetname" "lamp_neon"
"origin" "300 0 40"
"light" "150"
"range" "100"
"_color" "150 200 255"
"flicker" "1"
"bulbSize" "3"
}
```

**Custom hours (early on, late off):**
```
{
"classname" "street_lamp"
"targetname" "lamp_custom"
"origin" "0 0 50"
"light" "150"
"_color" "255 220 180"
"turnOnHour" "16"
"turnOffHour" "8"
}
```

**Hidden light (no bulb, ambient only):**
```
{
"classname" "street_lamp"
"targetname" "lamp_ambient"
"origin" "0 0 30"
"light" "100"
"range" "80"
"_color" "255 100 100"
"showBulb" "0"
}
```

#### Behavior

- Lamps automatically turn on during **dusk/evening/night** periods
- Smooth fade transition over `fadeTime` seconds
- Flicker effect adds ±5% intensity variation when enabled
- Bulb mesh emissive color matches light intensity
- Works with the `GameClock` day/night cycle system

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

## Models & Prefabs

### misc_model

Places a model in the world. Supports both `.map` prefabs (created in NetRadiant) and 3D model files (GLB/glTF/OBJ).

The engine auto-detects the format based on file extension.

---

#### Supported Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| **Map Prefab** | `.map` or no extension | NetRadiant brush/patch geometry |
| **glTF Binary** | `.glb` | Recommended for 3D models - single file, embedded textures |
| **glTF** | `.gltf` | Text-based glTF with separate files |
| **Wavefront** | `.obj` | Simple geometry, no animations |
| **Babylon** | `.babylon` | Native Babylon.js format |

---

#### Common Properties (All Formats)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | string | *required* | Model path (e.g., `"prefabs/barrel"` or `"models/crate.glb"`) |
| `origin` | vector3 | `"0 0 0"` | Position (map coords: X Y Z where Z is up) |
| `angle` | float | `0` | Y-axis rotation (degrees) |
| `scale` | float | `1` | Uniform scale |

---

#### 3D Model Properties (GLB/glTF/OBJ)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `collision` | `"0"` or `"1"` | `"1"` | Enable collision on meshes |
| `receiveShadows` | `"0"` or `"1"` | `"1"` | Model receives shadows from lights |
| `castShadows` | `"0"` or `"1"` | `"0"` | Model casts shadows (requires shadow system) |
| `visible` | `"0"` or `"1"` | `"1"` | Model visibility - `"0"` for invisible colliders/triggers |
| `renderingGroup` | int | `0` | Rendering layer for draw order control |

---

#### Map Prefab Properties (.map)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `dropToGround` | `"0"` or `"1"` | `"0"` | Raycast down to place on world geometry |
| `dropOffset` | float | `0` | Vertical offset after dropping (positive = higher) |

---

#### Examples

**Map Prefab (NetRadiant geometry):**
```
{
"classname" "misc_model"
"model" "prefabs/barrel"
"origin" "128 256 0"
"angle" "45"
"scale" "1.5"
"dropToGround" "1"
}
```

**GLB Model (from Blender, free resources, etc.):**
```
{
"classname" "misc_model"
"model" "models/props/crate.glb"
"origin" "200 100 0"
"angle" "90"
"scale" "2"
"collision" "1"
"receiveShadows" "1"
"castShadows" "1"
}
```

**Invisible Collider (collision without visuals):**
```
{
"classname" "misc_model"
"model" "models/collision/wall_blocker.glb"
"origin" "0 0 0"
"visible" "0"
"collision" "1"
"receiveShadows" "0"
"castShadows" "0"
}
```

---

#### Rendering Groups

Use `renderingGroup` to control draw order for layering effects:

| Value | Use Case |
|-------|----------|
| `0` | Default - normal world geometry |
| `1` | Foreground objects (rendered on top) |
| `2` | UI elements in 3D space |
| `3` | Always-on-top overlays |

---

#### Tips

- **GLB is recommended** for external 3D models - single file with embedded textures
- **Map prefabs** are best for geometry you want to edit in NetRadiant
- Place models in `public/models/` for GLB/glTF or `public/prefabs/` for .map files
- Use `visible "0"` with `collision "1"` for invisible barriers
- Enable `castShadows` sparingly - it has performance cost

---

## Sprites

### sprite_building

Static 2D sprite rendered in 3D world. Perfect for isometric-style buildings, signs, and decorations.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | Position (map coords) |
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
| `origin` | vector3 | required | Position (map coords) |
| `sprite` | string | required | Path to sprite sheet image |
| `targetname` | string | - | Unique identifier |
| `scale` | float | `48` | Size in world units |
| `angle` | float | `0` | Facing direction (degrees) |
| `directions` | int | `8` | Sprite directions (1, 4, or 8) |
| `frames` | int | `4` | Animation frames per direction |
| `frameRate` | int | `8` | Animation FPS |
| `frameWidth` | int | `32` | Sprite frame width (pixels) |
| `frameHeight` | int | `32` | Sprite frame height (pixels) |
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
"sprite" "sprites/characters/guard.png"
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
| `origin` | vector3 | required | Center position (map coords) |
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

## Effects

### info_debris_zone

Spawns local debris particles (leaves, trash, dust) in a fixed area. Responds to the global wind system and day/night lighting cycle.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | vector3 | required | Center position (map coords) |
| `targetname` | string | auto | Unique zone identifier |
| `type` | string | `"leaves"` | Debris type (see below) |
| `radius` | float | `128` | Horizontal spawn radius |
| `height` | float | `64` | Vertical spawn range |
| `density` | float | `0.5` | Particle density (0-1) |
| `windInfluence` | float | `0.8` | How much wind affects particles (0-1) |

**Debris Types:**

| Type | Description |
|------|-------------|
| `leaves` | Autumn leaves (orange, brown, yellow, red) |
| `trash` | Urban debris (paper, wrappers, plastic) |
| `dust` | Fine dust particles (semi-transparent) |
| `mixed` | Combination of leaves and trash |

**Examples:**

```
// Autumn leaves near trees
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

// Urban trash in alley
{
"classname" "info_debris_zone"
"targetname" "alley_trash"
"origin" "-100 300 16"
"type" "trash"
"radius" "64"
"height" "32"
"density" "0.3"
}

// Dusty desert area
{
"classname" "info_debris_zone"
"targetname" "desert_dust"
"origin" "500 0 8"
"type" "dust"
"radius" "256"
"height" "48"
"density" "0.6"
"windInfluence" "1.0"
}
```

**Behavior:**
- Particles spawn within the defined radius and height
- Responds to global `WindSystem` - particles drift with wind direction
- Colors modulate with scene ambient light for day/night cycle
- **Automatically disabled on indoor maps** (`indoor: true` in worldspawn)
- Cleaned up automatically on map transitions

**Tips:**
- Use lower `density` (0.2-0.4) for subtle ambient effects
- Higher `windInfluence` makes particles more responsive to gusts
- Place multiple zones with different types for varied environments
- Combine with `wind on` console command for testing

---

## Coordinate System

The engine converts from map coordinates to Babylon.js:

| Axis | Map File | Babylon |
|------|-------|---------|
| Right | +X | +X |
| Forward | +Y | +Z |
| Up | +Z | +Y |

When specifying `origin` in entities, use map coordinates. The engine handles conversion automatically.
