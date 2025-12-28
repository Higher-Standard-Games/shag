# Prefab System

Use .map files as reusable models/prefabs that can be placed in your levels.

---

## Overview

Prefabs allow you to:

- **Reuse geometry** - Same tree, rock, or building in multiple maps
- **Maintain consistency** - Edit prefab once, updates everywhere
- **Dynamic spawning** - Spawn prefabs at runtime via triggers or code
- **Drop-to-ground** - Automatically place prefabs on terrain

---

## Creating Prefabs

### 1. Create in TrenchBroom/NetRadiant

Build your model as a normal .map file with these conventions:

- **Origin (0,0,0) = floor/anchor point** - Place the bottom center of your model at origin
- **Keep it simple** - Prefabs can contain brushes, patches, and lights
- **No player start needed** - Prefabs don't need `info_player_start`

```
        ___
       /   \      ← Tree crown
       |   |
       | | |      ← Trunk
       |_|_|
   ────+────      ← Origin (0,0,0) at ground level
```

### 2. Save to Prefabs Folder

Save your .map file to `public/prefabs/`:

```
public/
└── prefabs/
    ├── tree.map
    ├── rock.map
    └── building.map
```

### 3. Use in Maps

Reference with `misc_model` entity:

```
{
"classname" "misc_model"
"model" "tree.map"
"origin" "128 256 0"
"angle" "45"
"scale" "1.5"
}
```

---

## Entity Properties

### misc_model

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | string | required | Prefab filename (e.g., `"tree.map"`) |
| `origin` | vector3 | `"0 0 0"` | Position in map coordinates |
| `angle` | float | `0` | Y-axis rotation in degrees |
| `scale` | float | `1` | Uniform scale multiplier |
| `dropToGround` | `"0"` or `"1"` | `"0"` | Raycast down to place on geometry |
| `dropOffset` | float | `0` | Vertical offset after dropping |

### Examples

**Basic placement:**
```
{
"classname" "misc_model"
"model" "props/barrel.map"
"origin" "100 200 0"
}
```

**Rotated and scaled:**
```
{
"classname" "misc_model"
"model" "props/crate.map"
"origin" "100 200 0"
"angle" "90"
"scale" "2"
}
```

**Drop to ground:**
```
{
"classname" "misc_model"
"model" "nature/tree.map"
"origin" "100 200 500"
"dropToGround" "1"
"dropOffset" "-5"
}
```

---

## Drop-to-Ground

When `dropToGround` is `"1"`, the engine:

1. Starts at the specified origin
2. Raycasts downward (-Y in Babylon)
3. Finds the first collision with world geometry
4. Places the prefab at that point + `dropOffset`

**Use cases:**
- Placing trees on uneven terrain
- Dropping items onto floors
- Spawning objects without knowing exact Y position

**Note:** The raycast ignores other prefabs and trigger volumes.

---

## Dynamic Spawning

### Via Triggers

Create a trigger that spawns prefabs when clicked:

```
{
"classname" "trigger_multiple"
"targetname" "spawn_tree"
"spawnModel" "nature/tree.map"
"spawnOrigin" "200 300 0"
"spawnAngle" "0"
"spawnScale" "1"
"spawnDropToGround" "1"
{
// trigger brush
}
}
```

### Spawn Validation

The engine validates spawns to prevent overlapping:

| Property | Description |
|----------|-------------|
| `spawnValidators` | Comma-separated validator IDs |
| `maxCount` | Maximum instances (for `max_count` validator) |

**Built-in validators:**

- `collision` - Prevents spawning too close to existing prefabs (default: enabled)
- `max_count` - Limits total instances of a prefab type

```
{
"classname" "trigger_multiple"
"spawnModel" "tree.map"
"spawnValidators" "max_count"
"maxCount" "10"
}
```

### Via Code

```typescript
import { PrefabInstance } from "./loader/PrefabInstance";
import { PrefabLoader } from "./loader/PrefabLoader";

// Ensure prefab is loaded
await PrefabLoader.getInstance().loadPrefab("tree.map");

// Spawn instance
const result = await PrefabInstance.create("tree.map", scene, {
  position: new Vector3(100, 0, 200),
  angle: 45,
  scale: 1.5,
  dropToGround: true,
  dropOffset: 0,
});

if (result) {
  console.log(`Spawned at: ${result.finalPosition}`);
  // result.root = TransformNode containing all meshes
  // result.meshes = Array of individual meshes
}
```

---

## Preloading

Add prefabs to `config.json` for preloading during the loading screen:

```json
{
  "assets": {
    "prefabs": [
      "tree.map",
      "rock.map",
      "building.map"
    ]
  }
}
```

This ensures prefabs are ready before the game starts, avoiding load hitches during gameplay.

---

## Custom Validators

Create game-specific spawn rules:

```typescript
import { SpawnValidator, ISpawnValidator } from "./engine/SpawnValidator";

class ResourceCostValidator implements ISpawnValidator {
  id = "resource_cost";
  
  validate(context) {
    const cost = context.triggerProperties.cost_gold;
    if (cost && playerGold < parseInt(cost)) {
      return { allowed: false, reason: "Not enough gold!" };
    }
    return { allowed: true };
  }
}

// Register
SpawnValidator.getInstance().register(new ResourceCostValidator());
```

Use in map:
```
{
"classname" "trigger_multiple"
"spawnModel" "building.map"
"spawnValidators" "resource_cost"
"cost_gold" "100"
}
```

---

## API Reference

### PrefabLoader

```typescript
class PrefabLoader {
  static getInstance(): PrefabLoader;
  
  setBasePath(path: string): void;
  loadPrefab(name: string): Promise<PrefabDefinition | null>;
  getPrefab(name: string): PrefabDefinition | undefined;
  preloadPrefabs(names: string[]): Promise<void>;
  isPrefabLoaded(name: string): boolean;
  clearCache(): void;
}
```

### PrefabInstance

```typescript
class PrefabInstance {
  static create(
    prefabName: string,
    scene: Scene,
    options: PrefabInstanceOptions
  ): Promise<PrefabInstanceResult | null>;
  
  static createMultiple(
    prefabName: string,
    scene: Scene,
    instances: PrefabInstanceOptions[]
  ): Promise<PrefabInstanceResult[]>;
}

interface PrefabInstanceOptions {
  position: Vector3;
  angle?: number;        // Degrees
  scale?: number;
  dropToGround?: boolean;
  dropOffset?: number;
  hasCollision?: boolean;
}

interface PrefabInstanceResult {
  root: TransformNode;
  meshes: Mesh[];
  finalPosition: Vector3;
}
```

### SpawnValidator

```typescript
class SpawnValidator {
  static getInstance(): SpawnValidator;
  
  register(validator: ISpawnValidator): void;
  registerGlobal(validator: ISpawnValidator): void;
  unregister(id: string): void;
  
  validate(context: SpawnValidationContext, validatorIds?: string[]): SpawnValidationResult;
  
  disableCollisionCheck(): void;
  enableCollisionCheck(minDistance?: number): void;
}
```

---

## Best Practices

1. **Keep prefabs small** - Large prefabs with many brushes impact performance

2. **Use consistent scale** - Design prefabs at 1:1 scale, adjust with `scale` property

3. **Center at origin** - Makes rotation and placement predictable

4. **Test drop-to-ground** - Verify prefabs land correctly on your terrain

5. **Preload frequently used prefabs** - Add to config.json to avoid runtime loading

6. **Use collision validation** - Prevents ugly overlapping objects
