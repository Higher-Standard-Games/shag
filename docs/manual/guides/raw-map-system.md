# Raw .map File System

Skip the compile step. Design in NetRadiant, see it in-engine immediately.

---

## The Vision

Traditional Q3 workflow:
```
Edit in NetRadiant → Compile BSP (minutes) → Load in engine → Find problem → Repeat
```

SHAG workflow:
```
Edit in NetRadiant → Save .map → See it in-engine (instant)
```

No `q3map2`. No lightmap baking. No waiting. Just design and iterate.

---

## What Works Today

| Feature | Status | Notes |
|---------|--------|-------|
| **.map Parsing** | Complete | Full brush and patch support |
| **Entity System** | Complete | Extensible handler registry |
| **Light Entities** | Complete | Converted to Babylon lights |
| **Street Lamps** | Complete | Dynamic on/off with day/night |
| **Day/Night Cycle** | Complete | Sun/moon, color transitions |
| **Triggers** | Complete | Map switching, spawning, UI |
| **func_door** | Complete | Animated doors with grouping |
| **Hot Reload** | Planned | File watching not yet implemented |

---

## Entity System

The heart of the raw .map workflow. Every entity in your .map can do something.

### How It Works

```
NetRadiant entity          EntityHandlerRegistry           Babylon.js
┌─────────────────┐       ┌─────────────────────┐       ┌─────────────────┐
│ classname       │──────>│ Find handler for    │──────>│ Create light    │
│ "street_lamp"   │       │ "street_lamp"       │       │ Create mesh     │
│ origin "0 0 64" │       │                     │       │ Set position    │
│ _color "1 .8 0" │       │ Call handler with   │       │ Configure       │
└─────────────────┘       │ entity properties   │       └─────────────────┘
                          └─────────────────────┘
```

### Registering Custom Entities

```typescript
import { EntityHandlerRegistry } from '@/engine/core/EntityHandlerRegistry';

const registry = EntityHandlerRegistry.getInstance();

// Register a handler for your custom entity
registry.register('my_custom_entity', {
  preRender: (entity, scene) => {
    // Called before rendering - create meshes, lights, etc.
    const pos = parseOrigin(entity.origin);
    const mesh = MeshBuilder.CreateSphere('custom', { diameter: 10 }, scene);
    mesh.position = pos;

    // Store reference for cleanup
    entity._mesh = mesh;
  },

  postRender: (entity, scene) => {
    // Called when map unloads - cleanup
    entity._mesh?.dispose();
  }
});
```

### Built-in Entity Types

| Entity | Purpose | Key Properties |
|--------|---------|----------------|
| `worldspawn` | World settings | `message`, `camera_mode`, `daynight_*` |
| `info_player_start` | Spawn point | `origin`, `angle` |
| `light` | Point light | `origin`, `light` (intensity), `_color` |
| `street_lamp` | Dynamic lamp | `origin`, `turnOnHour`, `turnOffHour`, `flicker` |
| `trigger_multiple` | Repeatable trigger | `mins/maxs`, `targetMap`, `spawnModel` |
| `trigger_once` | One-shot trigger | Same as trigger_multiple |
| `func_door` | Animated door | `angle`, `speed`, `lip`, `targetname` |
| `info_npc` | NPC spawn | `origin`, `model`, `behavior` |

---

## Light Entities

Drop a `light` entity in NetRadiant, see a Babylon.js PointLight in-engine.

### Basic Light

In NetRadiant:
```
classname: light
origin: 100 200 64
light: 300
_color: 1 0.9 0.8
```

Result: Warm point light at that position with radius ~300 units.

### Street Lamps (Dynamic)

Street lamps are special—they respond to the day/night cycle.

```
classname: street_lamp
origin: 100 200 64
light: 200
range: 100
_color: 1 0.85 0.5
turnOnHour: 18
turnOffHour: 6
flicker: 1
showBulb: 1
fadeTime: 2
```

**Properties:**

| Property | Default | Description |
|----------|---------|-------------|
| `light` | 200 | Intensity |
| `range` | 100 | Light radius |
| `_color` | `1 0.85 0.5` | RGB (warm yellow) |
| `turnOnHour` | 18 | Turn on at 6 PM |
| `turnOffHour` | 6 | Turn off at 6 AM |
| `flicker` | 0 | Subtle flicker effect |
| `showBulb` | 1 | Show glowing bulb mesh |
| `fadeTime` | 2 | Fade duration (seconds) |

**Behavior:**
- At 6 PM: Smoothly fades on over 2 seconds
- At 6 AM: Smoothly fades off
- Optional flicker for atmosphere
- Glowing bulb mesh changes emissive color with intensity

---

## Day/Night Cycle

The sky changes. The lights respond. Time passes.

### Worldspawn Configuration

```
classname: worldspawn
daynight_enabled: 1
daynight_time: 0.25
daynight_cycle: 10
daynight_animate: 1
```

| Property | Description |
|----------|-------------|
| `daynight_enabled` | "1" to enable the system |
| `daynight_time` | Starting time (0=midnight, 0.5=noon, 1=midnight) |
| `daynight_cycle` | Minutes for a full 24-hour cycle |
| `daynight_animate` | "1" to start animating immediately |

### Console Control

```
daynight on              # Enable
daynight noon            # Jump to noon
daynight sunset          # Jump to sunset
daynight time 0.75       # Set to 6 PM
daynight cycle 5         # 5-minute full cycle
daynight start           # Start animation
daynight info            # Show current state
```

### What Changes

| Time | Sun | Ambient | Sky | Street Lamps |
|------|-----|---------|-----|--------------|
| Midnight | None | Dark blue | Night | ON |
| Dawn | Rising, orange | Warm | Pink/orange | Fading off |
| Noon | Overhead, white | Bright | Light blue | OFF |
| Sunset | Setting, red | Warm | Orange/red | Fading on |
| Night | None | Dark blue | Dark | ON |

---

## Triggers

Make things happen when the player enters an area.

### Map Switching

```
classname: trigger_multiple
targetMap: level2
mins: -64 -64 0
maxs: 64 64 128
```

Player enters the trigger volume → loads `level2.map`.

### Spawning Objects

```
classname: trigger_once
spawnModel: models/props/crate.md3
spawnOrigin: 100 200 0
spawnAngle: 45
```

Player enters → spawns a crate at the specified position (once).

### UI Dialogs

```
classname: trigger_multiple
windowTarget: shop_menu
```

Player enters → opens the "shop_menu" UI window.

### Custom Trigger Logic

```typescript
registry.register('trigger_custom', {
  preRender: (entity, scene) => {
    // Create trigger volume
    const trigger = createTriggerMesh(entity);

    // Set up intersection detection
    trigger.actionManager = new ActionManager(scene);
    trigger.actionManager.registerAction(
      new ExecuteCodeAction(
        ActionManager.OnIntersectionEnterTrigger,
        () => {
          console.log('Player entered custom trigger!');
          // Your logic here
        }
      )
    );
  }
});
```

---

## Animated Doors

Doors that open and close, grouped by targetname.

### NetRadiant Setup

```
classname: func_door
model: *5
angle: 90
speed: 100
lip: 8
targetname: main_door
```

| Property | Description |
|----------|-------------|
| `model` | BSP model index (*5, *10, etc.) |
| `angle` | Movement direction (90=+X, 180=+Y, -1=UP, -2=DOWN) |
| `speed` | Units per second |
| `lip` | How much to leave sticking out |
| `targetname` | Group name for multi-part doors |

### Code Control

```typescript
import { getDoorController, getDoorNames } from '@/engine/loader/bsp/BspEntityHandlers';

// List all door groups
console.log(getDoorNames()); // ['main_door', 'secret_door']

// Get a door controller
const door = getDoorController('main_door');
door.open();   // Smoothly opens
door.close();  // Smoothly closes
door.toggle(); // Toggles state
```

---

## .map File Format

For reference, here's what the parser understands:

### Entity Block
```
{
"classname" "light"
"origin" "100 200 64"
"light" "300"
"_color" "1 0.9 0.8"
}
```

### Brush (6-plane convex shape)
```
{
( -64 -64 0 ) ( -64 64 0 ) ( -64 64 64 ) common/caulk 0 0 0 0.5 0.5
( 64 -64 0 ) ( 64 -64 64 ) ( 64 64 64 ) common/caulk 0 0 0 0.5 0.5
( -64 -64 0 ) ( 64 -64 0 ) ( 64 -64 64 ) common/caulk 0 0 0 0.5 0.5
( -64 64 0 ) ( -64 64 64 ) ( 64 64 64 ) common/caulk 0 0 0 0.5 0.5
( -64 -64 0 ) ( -64 64 0 ) ( 64 64 0 ) common/caulk 0 0 0 0.5 0.5
( -64 -64 64 ) ( 64 -64 64 ) ( 64 64 64 ) common/caulk 0 0 0 0.5 0.5
}
```

### Bezier Patch
```
{
patchDef2
{
textures/common/caulk
( 3 3 0 0 0 )
(
( ( -64 -64 0 0 0 ) ( -64 0 0 0 0.5 ) ( -64 64 0 0 1 ) )
( ( 0 -64 32 0.5 0 ) ( 0 0 32 0.5 0.5 ) ( 0 64 32 0.5 1 ) )
( ( 64 -64 0 1 0 ) ( 64 0 0 1 0.5 ) ( 64 64 0 1 1 ) )
)
}
}
```

---

## Best Practices

### 1. Use Descriptive Entity Names
```
targetname: kitchen_light_1
```
Not:
```
targetname: l1
```

### 2. Group Related Lights
Put street lamps along a road with similar settings, they'll all respond to day/night together.

### 3. Test Day/Night Early
```
daynight cycle 0.5   # 30-second full cycle for testing
```

### 4. Use Triggers for Progression
Instead of hardcoding level transitions, use trigger entities. Easier to redesign levels.

### 5. Keep Entity Density Reasonable
Each light is a Babylon.js PointLight. 1000 lights will hurt performance. Use ClusteredLighting (automatic) but be mindful.

---

## Comparison: BSP vs Raw .map

| Aspect | BSP (Compiled) | Raw .map |
|--------|----------------|----------|
| **Load time** | Fast | Slightly slower |
| **Lightmaps** | Pre-baked, beautiful | Dynamic only |
| **PVS culling** | Yes | No |
| **Iteration** | Minutes per change | Instant |
| **File size** | Larger | Smaller |
| **Best for** | Final release | Development, prototyping |

**Recommendation:** Develop with raw .map, compile to BSP for release.

---

## Roadmap

Features we're working toward:

| Feature | Status |
|---------|--------|
| **Hot reload** | Planned - watch .map file, auto-reload |
| **NetRadiant live link** | Planned - WebSocket sync |
| **Incremental updates** | Planned - only reload changed entities |

---

## See Also

- [BSP System](./bsp-system.md) — Compiled map format
- [Lighting System](./lighting-system.md) — All lighting options
- [Console System](./console-system.md) — Day/night commands
- [Configuration](./configuration.md) — Engine setup
