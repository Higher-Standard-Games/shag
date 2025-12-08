# Sprite System

2D sprites in a 3D world - classic game style with modern features.

---

## Overview

The engine provides two sprite systems:

### 1. NPC Sprites (`npc_sprite`)
Animated billboard sprites for characters:
- **Billboard rendering** - Always face the camera
- **8-direction support** - Different sprites based on facing vs camera angle
- **Frame animation** - Sprite sheet based animation
- **Dynamic lighting** - React to point lights in the scene
- **Ground shadows** - Configurable shadow ellipses

### 2. Sprite Buildings (`sprite_building`)
Static sprites for buildings and decorations:
- **Billboard or fixed rotation** - Choose per-sprite
- **Day/night cycle support** - Darken at night, glow effects
- **Trigger boxes** - Clickable areas for interaction
- **Collision boxes** - For physics/pathfinding
- **Transparent PNG support** - Full alpha channel

---

## Sprite Buildings

Perfect for isometric-style 2D art in a 3D world.

### Quick Start

```
{
"classname" "sprite_building"
"targetname" "my_shop"
"origin" "100 0 200"
"texture" "textures/base/shop.png"
"width" "128"
"height" "128"
"billboard" "1"
"emissive" "0.3"
}
```

### Rendering Modes

| Mode | Property | Description |
|------|----------|-------------|
| **Billboard** | `"billboard" "1"` | Sprite always faces camera - ideal for 2D-style buildings |
| **Fixed** | `"billboard" "0"` | Sprite has fixed rotation - for signs, geometric elements |

### Day/Night Cycle

Sprite buildings respond to scene lighting. The `emissive` property controls self-illumination:

```
"emissive" "0"      // Fully affected by day/night - dark at night
"emissive" "0.2"    // Default - slight glow, visible at night
"emissive" "0.5"    // Moderate glow - lit windows
"emissive" "0.8"    // Bright glow - neon signs
"emissive" "1.0"    // Fully self-lit - ignores day/night
```

### Interaction

Add trigger properties to make sprites clickable:

```
{
"classname" "sprite_building"
"texture" "textures/base/shop.png"
"origin" "100 0 200"
"width" "128"
"height" "128"
"windowTarget" "shop_dialog"
"triggerWidth" "100"
"triggerHeight" "100"
"triggerDepth" "30"
}
```

### Workflow

1. Create/cut 2D building sprites as transparent PNGs
2. Save to `public/textures/` folder
3. Add `sprite_building` entities to your map file
4. Set `billboard` mode based on desired look
5. Adjust `emissive` for day/night behavior

### All Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `texture` | string | required | Path to PNG (e.g., `textures/base/shop.png`) |
| `width` | float | `100` | Width in world units |
| `height` | float | `100` | Height in world units |
| `billboard` | `"0"`/`"1"` | `"0"` | Always face camera |
| `angle` | float | `0` | Y rotation degrees (non-billboard only) |
| `emissive` | float | `0.2` | Self-illumination (0-1) |
| `windowTarget` | string | - | Dialog to open on click |
| `triggerWidth/Height/Depth` | float | - | Clickable area size |
| `collisionWidth/Height/Depth` | float | - | Collision box size |

---

## NPC Sprites

Animated character sprites with 8-direction support.

### Quick Start

### In Map File

```
{
"classname" "npc_sprite"
"targetname" "my_npc"
"origin" "100 0 0"
"sprite" "test"
"scale" "48"
}
```

### Programmatically

```typescript
import { SpriteManager } from "./sprites/SpriteManager";

// Get manager (must be initialized by GameScene)
const manager = SpriteManager.getInstance();

// Create sprite with test sheet
const sprite = manager.createSpriteWithSheet("my_sprite", {
  path: TestSpriteGenerator.generateCharacterSheet(32, 32, "#ff0000", "#ffff00"),
  frameWidth: 32,
  frameHeight: 32,
  framesPerDirection: 4,
  directions: 8,
  frameRate: 8,
  hasAlpha: true,
});

// Configure
sprite.position = new Vector3(100, 0, 50);
sprite.scale = 48;
sprite.facingAngle = Math.PI; // Face south
sprite.receiveLighting = true;
sprite.castShadow = true;

// Animation
sprite.addAnimation({ name: "walk", startFrame: 0, frameCount: 4, loop: true });
sprite.playAnimation("walk");
```

---

## Sprite Sheets

### Layout

Sprite sheets are organized as a grid:
- **Rows** = Directions (top to bottom: S, SW, W, NW, N, NE, E, SE)
- **Columns** = Animation frames

```
┌─────┬─────┬─────┬─────┐
│ S_0 │ S_1 │ S_2 │ S_3 │  ← South (facing camera)
├─────┼─────┼─────┼─────┤
│SW_0 │SW_1 │SW_2 │SW_3 │  ← Southwest
├─────┼─────┼─────┼─────┤
│ W_0 │ W_1 │ W_2 │ W_3 │  ← West
├─────┼─────┼─────┼─────┤
│NW_0 │NW_1 │NW_2 │NW_3 │  ← Northwest
├─────┼─────┼─────┼─────┤
│ N_0 │ N_1 │ N_2 │ N_3 │  ← North (facing away)
├─────┼─────┼─────┼─────┤
│NE_0 │NE_1 │NE_2 │NE_3 │  ← Northeast
├─────┼─────┼─────┼─────┤
│ E_0 │ E_1 │ E_2 │ E_3 │  ← East
├─────┼─────┼─────┼─────┤
│SE_0 │SE_1 │SE_2 │SE_3 │  ← Southeast
└─────┴─────┴─────┴─────┘
```

### Direction Calculation

The engine automatically selects the correct sprite row based on:
1. The sprite's `facingAngle` (where the NPC is looking)
2. The camera's position relative to the sprite

This creates the illusion of a 3D character that turns to face different directions.

### Configuration

```typescript
interface SpriteSheetConfig {
  path: string;              // Image path or data URL
  frameWidth: number;        // Pixel width of one frame
  frameHeight: number;       // Pixel height of one frame
  framesPerDirection: number; // Columns in sheet
  directions: number;        // Rows in sheet (1, 4, or 8)
  frameRate: number;         // Animation FPS
  hasAlpha?: boolean;        // Transparency (default: true)
  receiveLighting?: boolean; // React to lights (default: false)
  ambientLevel?: number;     // Base brightness (default: 0.3)
}
```

---

## Animation

### Defining Animations

```typescript
sprite.addAnimation({
  name: "idle",
  startFrame: 0,
  frameCount: 4,
  loop: true,
  frameRate: 6,  // Optional override
});

sprite.addAnimation({
  name: "attack",
  startFrame: 4,
  frameCount: 3,
  loop: false,
});
```

### Playing Animations

```typescript
sprite.playAnimation("idle");   // Start animation
sprite.stopAnimation();         // Freeze on current frame
sprite.setFrame(2);             // Set specific frame
```

---

## Lighting

Sprites can react to point lights in the scene, creating dynamic colored lighting effects.

### How It Works

1. Every 100ms, the sprite samples all `PointLight` instances
2. Calculates distance-based attenuation for each light
3. Combines light colors with ambient level
4. Applies result as emissive color tint

### Configuration

```typescript
sprite.receiveLighting = true;  // Enable lighting
sprite.ambientLevel = 0.15;     // Darkness in shadow (0-1)
```

### Entity Properties

```
"receiveLighting" "1"    // Enable (default)
"receiveLighting" "0"    // Disable
"ambientLevel" "0.2"     // Custom ambient
```

### Visual Effect

- Sprites near red lights get a red tint
- Sprites near blue lights get a blue tint
- Sprites between lights get mixed colors
- Sprites far from lights are darker (ambient only)

---

## Shadows

Each sprite can have a ground shadow - a dark ellipse at its feet.

### Configuration

```typescript
sprite.castShadow = true;       // Enable shadow
sprite.shadowOpacity = 0.4;     // Darkness (0-1)
sprite.shadowScale = 1.2;       // Size relative to sprite
```

### Entity Properties

```
"castShadow" "1"           // Enable (default)
"castShadow" "0"           // Disable
"shadowOpacity" "0.5"      // Custom opacity
"shadowScale" "1.5"        // Custom scale
```

### Shadow Behavior

- Positioned at sprite's feet (Y position + 0.5)
- Scales proportionally with sprite size
- Slightly elliptical (squashed for perspective)
- Does not receive lighting

---

## Test Sprite Generator

For development without art assets, use the built-in generator:

```typescript
import { TestSpriteGenerator } from "./sprites/TestSpriteGenerator";

// Generate character sprite sheet
const dataUrl = TestSpriteGenerator.generateCharacterSheet(
  32,           // Frame width
  32,           // Frame height
  "#4488ff",    // Body color
  "#ffcc00"     // Accent color
);

// Use as sprite path
const sprite = manager.createSpriteWithSheet("test", {
  path: dataUrl,
  // ...
});
```

### In Map Files

Use `"sprite" "test"` with color properties:

```
{
"classname" "npc_sprite"
"sprite" "test"
"color" "#ff4444"
"accentColor" "#ffffff"
}
```

---

## API Reference

### BillboardSprite

```typescript
class BillboardSprite {
  // Transform
  position: Vector3;
  scale: number;
  facingAngle: number;          // Radians
  setFacingDegrees(deg: number): void;
  lookAt(target: Vector3): void;

  // Animation
  addAnimation(state: SpriteAnimationState): void;
  playAnimation(name: string): void;
  stopAnimation(): void;
  setFrame(frame: number): void;

  // Lighting
  receiveLighting: boolean;
  ambientLevel: number;
  readonly currentLightColor: Color3;

  // Shadow
  castShadow: boolean;
  shadowOpacity: number;
  shadowScale: number;

  // Cleanup
  dispose(): void;
}
```

### SpriteManager

```typescript
class SpriteManager {
  static getInstance(): SpriteManager;
  
  init(scene: Scene, camera: Camera): void;
  isInitialized(): boolean;
  
  loadSpriteSheet(config: SpriteSheetConfig): SpriteSheet;
  getSpriteSheet(path: string): SpriteSheet | undefined;
  
  createSprite(name: string, sheet: SpriteSheet): BillboardSprite;
  createSpriteWithSheet(name: string, config: SpriteSheetConfig): BillboardSprite;
  
  removeSprite(sprite: BillboardSprite): void;
  getSprites(): BillboardSprite[];
  clear(): void;
}
```

---

## Best Practices

1. **Use power-of-2 sprite sizes** - 32x32, 64x64, etc. for best GPU performance

2. **Limit directions for distant sprites** - Use 4 directions for background NPCs

3. **Share sprite sheets** - Multiple sprites can use the same `SpriteSheet` instance

4. **Throttle lighting updates** - Already done internally (100ms), but consider disabling for many sprites

5. **Disable shadows for small sprites** - Shadows add draw calls

6. **Use test sprites for prototyping** - Replace with real art later
