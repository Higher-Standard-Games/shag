# Trigger System

Interactive trigger volumes for gameplay events.

---

## Overview

Triggers are brush volumes that respond to player clicks. They can:

- Open UI dialogs
- Switch maps/levels
- Spawn prefabs dynamically
- Execute custom game logic

---

## Creating Triggers

### 1. In Map Editor

Create a brush entity with:
- **Classname:** `trigger_multiple` (or `trigger_once`, etc.)
- **Texture:** `common/trigger` on all faces

### 2. Rendering

Triggers are automatically rendered as:
- Red color (RGB: 1, 0, 0)
- Semi-transparent (alpha: 0.3)
- Wireframe mode
- Double-sided

### 3. Detection

Any brush with a texture containing "trigger" is detected as a trigger volume.

---

## Trigger Actions

### Open Dialog

Opens a UI dialog window.

| Property | Value |
|----------|-------|
| `windowTarget` | Dialog ID to open |

```
{
"classname" "trigger_multiple"
"targetname" "npc_talk"
"windowTarget" "npc_dialog"
"message" "Talking to NPC..."
{
// trigger brush
}
}
```

The dialog must be registered with `UIManager`:

```typescript
UIManager.getInstance().registerDialog("npc_dialog", new MyDialog());
```

---

### Switch Map

Loads a different map file.

| Property | Value |
|----------|-------|
| `targetMap` | Map filename to load |

```
{
"classname" "trigger_multiple"
"targetname" "exit_door"
"targetMap" "level2.map"
"message" "Entering next area..."
{
// trigger brush
}
}
```

---

### Spawn Prefab

Dynamically spawns a prefab when clicked.

| Property | Type | Description |
|----------|------|-------------|
| `spawnModel` | string | Prefab filename |
| `spawnOrigin` | vector3 | Spawn position (defaults to trigger origin) |
| `spawnAngle` | float | Y rotation in degrees (default: random) |
| `spawnScale` | float | Scale multiplier (default: 1) |
| `spawnDropToGround` | `"0"` or `"1"` | Drop to ground geometry |
| `spawnDropOffset` | float | Vertical offset after drop |
| `spawnValidators` | string | Comma-separated validator IDs |
| `maxCount` | int | Max instances (for max_count validator) |

```
{
"classname" "trigger_multiple"
"targetname" "spawn_button"
"spawnModel" "props/crate.map"
"spawnOrigin" "200 300 0"
"spawnScale" "1"
"spawnDropToGround" "1"
"maxCount" "5"
{
// trigger brush
}
}
```

---

## Spawn Validation

Prevents invalid spawns (overlapping, resource limits, etc.)

### Built-in Validators

| Validator | Description |
|-----------|-------------|
| `collision` | Blocks spawn if too close to existing prefabs (enabled by default) |
| `max_count` | Limits total instances of a prefab type |

### Using Validators

```
"spawnValidators" "collision,max_count"
"maxCount" "10"
```

### Disabling Collision Check

For creative/sandbox modes:

```typescript
SpawnValidator.getInstance().disableCollisionCheck();
```

### Custom Validators

```typescript
import { SpawnValidator, ISpawnValidator } from "./engine/SpawnValidator";

class MyValidator implements ISpawnValidator {
  id = "my_validator";
  
  validate(context) {
    // context.prefabName - what's being spawned
    // context.position - where
    // context.scene - Babylon scene
    // context.triggerProperties - all trigger properties
    
    if (someCondition) {
      return { allowed: false, reason: "Cannot spawn here!" };
    }
    return { allowed: true };
  }
}

SpawnValidator.getInstance().register(new MyValidator());
```

---

## Multiple Actions

Triggers can have multiple actions. All matching actions execute:

```
{
"classname" "trigger_multiple"
"windowTarget" "shop_dialog"
"spawnModel" "effects/sparkle.map"
"spawnOrigin" "100 100 50"
{
// Opens dialog AND spawns effect
}
}
```

---

## Trigger Properties Reference

| Property | Type | Description |
|----------|------|-------------|
| `classname` | string | Entity type (e.g., `trigger_multiple`) |
| `targetname` | string | Unique identifier |
| `message` | string | Console log message |
| `windowTarget` | string | Dialog ID to open |
| `targetMap` | string | Map file to load |
| `spawnModel` | string | Prefab to spawn |
| `spawnOrigin` | vector3 | Spawn position |
| `spawnAngle` | float | Spawn rotation (degrees) |
| `spawnScale` | float | Spawn scale |
| `spawnDropToGround` | `"0"`/`"1"` | Drop spawned prefab |
| `spawnDropOffset` | float | Vertical offset |
| `spawnValidators` | string | Validator IDs |
| `maxCount` | int | Max spawn count |

---

## Adding Custom Actions

### 1. Define Property

Choose a property name for your action (e.g., `myAction`).

### 2. Add Handler

In `RTSCameraController.ts`, find the trigger handling code:

```typescript
// Check for spawnModel - dynamically spawn a prefab
if (mesh.metadata.properties?.spawnModel) {
  // ... existing spawn code
}

// Add your custom action
if (mesh.metadata.properties?.myAction) {
  const value = mesh.metadata.properties.myAction;
  // Handle your action
  console.log("My action triggered:", value);
}
```

### 3. Use in Map

```
{
"classname" "trigger_multiple"
"myAction" "some_value"
{
// trigger brush
}
}
```

---

## Metadata Structure

Trigger meshes have this metadata:

```typescript
mesh.metadata = {
  isTrigger: true,
  properties: {
    classname: "trigger_multiple",
    targetname: "...",
    windowTarget: "...",
    targetMap: "...",
    spawnModel: "...",
    // ... all entity properties
  }
}
```

Access in code:

```typescript
const props = mesh.metadata.properties;
if (props.windowTarget) {
  UIManager.getInstance().openDialog(props.windowTarget, props);
}
```

---

## Examples

### Dialog Trigger

```
{
"classname" "trigger_multiple"
"targetname" "npc_dialog"
"windowTarget" "merchant_shop"
"message" "Opening shop..."
{
( 0 0 0 ) ( 64 0 0 ) ( 0 64 0 ) common/trigger 0 0 0 1 1
( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) common/trigger 0 0 0 1 1
( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) common/trigger 0 0 0 1 1
( 0 64 0 ) ( 64 64 0 ) ( 0 64 64 ) common/trigger 0 0 0 1 1
( 64 0 0 ) ( 64 64 0 ) ( 64 0 64 ) common/trigger 0 0 0 1 1
( 0 64 0 ) ( 0 64 64 ) ( 0 0 0 ) common/trigger 0 0 0 1 1
}
}
```

### Level Exit

```
{
"classname" "trigger_multiple"
"targetname" "level_exit"
"targetMap" "level2.map"
{
// trigger brush at exit door
}
}
```

### Spawn Button

```
{
"classname" "trigger_multiple"
"targetname" "spawn_tree"
"spawnModel" "nature/tree.map"
"spawnOrigin" "200 200 0"
"spawnDropToGround" "1"
"spawnValidators" "max_count"
"maxCount" "5"
{
// trigger brush (button)
}
}
```

---

## Best Practices

1. **Use descriptive targetnames** - Makes debugging easier

2. **Keep triggers visible** - Place at clickable locations

3. **Validate spawns** - Use validators to prevent overlapping

4. **Combine with dialogs** - Show feedback when actions occur

5. **Test click detection** - Ensure triggers are large enough to click
