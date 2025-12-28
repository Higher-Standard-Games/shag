# BuildableSystem

Engine-level generic buildable object system for objects that progress through stages, produce/consume resources, and respond to triggers.

## Overview

`BuildableSystem` provides a data-driven framework for:
- **Stage progression** - Visual changes as objects build/grow
- **Resource production** - Objects that generate items over time
- **Resource consumption** - Objects that need water, fuel, power, etc.
- **Decay/lifecycle** - Objects with phases (growing → ready → spoiled)
- **Map triggers** - Integration with .map file triggers

Games configure behavior via **templates**. Mappers reference templates by ID.

## Quick Start

```typescript
import { BuildableSystem, createStages3 } from './engine/BuildableSystem';

// Get singleton
const buildable = BuildableSystem.getInstance();

// Configure time provider (use your game timer)
buildable.setTimeProvider(() => GameTimer.getInstance().getGameTime());

// Register a template
buildable.registerTemplate({
  id: 'wheat_farm',
  name: 'Wheat Farm',
  buildTime: 60000, // 1 minute to build
  stages: createStages3('prefabs/wheat'), // 0%, 50%, 100%
  behaviors: {
    consumer: { resource: 'water', ratePerMinute: 10, onEmpty: 'pause' },
    producer: { outputItem: 'wheat', amount: 5, interval: 30000 },
  },
});

// Create an instance
const farm = buildable.create('wheat_farm', { x: 10, y: 0, z: 20 }, 'farm_map');

// Listen to events
buildable.on((event) => {
  if (event.type === 'complete') {
    console.log(`${event.instanceId} finished building!`);
  }
});

// Call update() from your game loop
buildable.update();
```

## Templates

Templates define the blueprint for buildable objects.

```typescript
interface BuildableTemplate {
  id: string;              // Unique ID (referenced in .map files)
  name: string;            // Display name
  icon?: string;           // UI icon path
  category?: string;       // For grouping (e.g., "farms", "buildings")
  buildTime: number;       // Time to build in ms (0 = instant)
  cost?: number;           // Build cost (game interprets)
  requiredLevel?: number;  // Player level requirement
  stages: BuildableStage[];// Visual stages
  behaviors?: BuildableBehaviors;
  customData?: Record<string, unknown>; // Game-specific data
}
```

## Stages

Stages define visual progression. Use helper functions:

```typescript
// 3 stages: 0%, 50%, 100%
createStages3('prefabs/building')

// 5 stages: 0%, 25%, 50%, 75%, 100%
createStages5('prefabs/crop')

// Single stage (instant build)
createInstantStage('prefabs/item.map')

// Custom thresholds
createCustomStages('prefabs/tree', [0, 20, 40, 60, 80, 100])
```

Each stage specifies:
```typescript
interface BuildableStage {
  minProgress: number;  // 0-100
  maxProgress: number;  // 0-100
  prefab?: string;      // Prefab path
  sprite?: string;      // Or sprite path
  scale?: number;       // Scale multiplier
}
```

## Behaviors

### Producer

Objects that generate items over time.

```typescript
behaviors: {
  producer: {
    outputItem: 'gold_ore',    // Item ID to produce
    amount: 10,                // Amount per cycle
    interval: 60000,           // Production interval (ms)
    maxStored: 100,            // Max before collection required
    requirePhase: 'ready',     // Only produce in this phase (for decayable)
  }
}
```

Collect production:
```typescript
const result = buildable.collect(instanceId);
// { item: 'gold_ore', amount: 50 }
```

### Consumer

Objects that consume resources.

```typescript
behaviors: {
  consumer: {
    resource: 'water',         // Resource type
    ratePerMinute: 10,         // Drain rate
    level: 100,                // Initial level (0-100)
    onEmpty: 'pause',          // 'pause' | 'damage' | 'destroy'
    damageRate: 5,             // Damage/min when empty (if onEmpty='damage')
  }
}
```

Add resources:
```typescript
buildable.addResource(instanceId, 'water', 50);
```

### Decay

Objects with lifecycle phases.

```typescript
behaviors: {
  decay: {
    phases: ['growing', 'ready', 'overripe', 'spoiled'],
    phaseDurations: [60000, 30000, 20000, Infinity],
    qualityPerPhase: [100, 100, 75, 25],
  }
}
```

### Trigger

Integration with map triggers.

```typescript
behaviors: {
  trigger: {
    onCreated: 'farm_placed',
    onComplete: 'farm_ready',
    onHarvest: 'farm_harvested',
    onDestroy: 'farm_destroyed',
    onPhaseChange: 'farm_phase_changed',
  }
}
```

Set trigger callback:
```typescript
buildable.setTriggerCallback((triggerName, instanceId) => {
  ActionSystem.getInstance().executeTrigger(triggerName);
});
```

### Upgrade

Objects that can be upgraded.

```typescript
behaviors: {
  upgrade: {
    upgradeTo: 'wheat_farm_v2',
    cost: 500,
    upgradeTime: 30000,
    requiredLevel: 5,
  }
}
```

Start upgrade:
```typescript
buildable.startUpgrade(instanceId);
```

## Events

Subscribe to events:

```typescript
buildable.on((event) => {
  switch (event.type) {
    case 'created':
    case 'progress':
    case 'stage_change':
    case 'complete':
    case 'phase_change':
    case 'resource_low':
    case 'resource_empty':
    case 'production_ready':
    case 'collected':
    case 'damaged':
    case 'destroyed':
    case 'upgrade_start':
    case 'upgrade_complete':
      // Handle event
      break;
  }
});
```

Events are also emitted to global `EventBus` as `buildable:<type>`.

## Visual Updates

Set callback for rendering:

```typescript
buildable.setVisualUpdateCallback((instance, stage) => {
  // Load prefab or sprite based on stage
  if (stage.prefab) {
    PrefabInstance.create(stage.prefab, instance.position, scene);
  }
});
```

## Serialization

Save/load state:

```typescript
// Save
const data = buildable.serialize();
localStorage.setItem('buildables', JSON.stringify(data));

// Load
const saved = JSON.parse(localStorage.getItem('buildables'));
buildable.deserialize(saved);

// Clear
buildable.clear();
buildable.clearMap('specific_map');
```

## Map Integration

In .map files, use `trigger_buildzone` entities:

```
{
  "classname": "trigger_buildzone"
  "targetname": "farm_plot_1"
  "template": "wheat_farm"
}
```

The game's trigger handler creates the buildable:

```typescript
ActionSystem.getInstance().registerAction('place_buildable', (params) => {
  const { template, position, mapId } = params;
  BuildableSystem.getInstance().create(template, position, mapId);
});
```

## Migration Status

The engine `BuildableSystem` is being incrementally migrated from the game-level `BuildableObjectManager`.

### Current State (Parallel Operation)

Both systems run simultaneously:
- **Old**: `BuildableObjectManager` - handles all current game logic (pots, plants, grow lights)
- **New**: `BuildableSystem` + `BuildableRenderer` - initialized with templates, ready for use

### Testing the New System

```javascript
// In browser console:
const bs = BuildableSystem.getInstance();

// Create a test pot
bs.create('pot_basic', { x: 100, y: 0, z: 100 }, 'test.map', { zoneId: 'test' });

// Check instances
bs.getAllInstances();

// Update (progress build)
bs.update();
```

### Remaining Migration Steps

1. **Migrate BuildingSystem** - Use engine for new builds
2. **Migrate PlantSystem** - Use container/child for pot-plant relationship  
3. **Update SaveManager** - Serialize engine state
4. **Remove old BuildableObjectManager**

## Example: Strategy Game

```typescript
// Register building templates
buildable.registerTemplates([
  {
    id: 'barracks',
    name: 'Barracks',
    category: 'military',
    buildTime: 120000,
    cost: 500,
    stages: createStages3('prefabs/barracks'),
    behaviors: {
      producer: { outputItem: 'soldier', amount: 1, interval: 30000, maxStored: 5 },
      consumer: { resource: 'gold', ratePerMinute: 5, onEmpty: 'pause' },
    },
  },
  {
    id: 'farm',
    name: 'Farm',
    category: 'economy',
    buildTime: 60000,
    cost: 200,
    stages: createStages5('prefabs/farm'),
    behaviors: {
      producer: { outputItem: 'food', amount: 10, interval: 60000 },
      consumer: { resource: 'water', ratePerMinute: 2, onEmpty: 'damage', damageRate: 1 },
    },
  },
]);
```

## Example: Farming Game

```typescript
buildable.registerTemplate({
  id: 'tomato_plant',
  name: 'Tomato Plant',
  category: 'crops',
  buildTime: 0, // Instant plant
  stages: createStages5('prefabs/tomato'),
  behaviors: {
    consumer: { resource: 'water', ratePerMinute: 5, onEmpty: 'damage', damageRate: 2 },
    decay: {
      phases: ['seedling', 'growing', 'flowering', 'ready', 'overripe'],
      phaseDurations: [30000, 60000, 60000, 120000, 60000],
      qualityPerPhase: [100, 100, 100, 100, 50],
    },
    producer: {
      outputItem: 'tomato',
      amount: 5,
      interval: 0, // Produce once when ready
      requirePhase: 'ready',
    },
  },
});
```
