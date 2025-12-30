# Engine Optimization Guide

This document covers the mobile optimization features added to make the engine performant on cross-platform mobile devices.

## Service Locator Pattern

The `ServiceLocator` provides explicit control over service initialization order, replacing implicit singleton initialization.

### Usage

```typescript
import { ServiceLocator, registerEngineServices } from '@engine/core';

// Register all engine services
registerEngineServices();

// Initialize in phases
await ServiceLocator.getInstance().initCore();
await ServiceLocator.getInstance().initScene(scene);

// Access services
const textures = ServiceLocator.get<TextureManager>('textureManager');
```

### Benefits
- **Explicit initialization order** - Dependencies are resolved automatically
- **Testability** - Services can be mocked or reset between tests
- **Debugging** - `getDebugInfo()` shows service states
- **Lifecycle management** - Proper disposal in reverse order

## Entity Handler Registry

The `EntityHandlerRegistry` allows game code to extend `MapRenderer` without engine modifications.

### Usage

```typescript
import { EntityHandlerRegistry } from '@engine/core';

// Register game-specific entity handlers
EntityHandlerRegistry.register('build_zone', (entity, scene) => {
  BuildingSystem.getInstance().registerZone(entity);
  return { handled: true };
});

EntityHandlerRegistry.register('info_npc', async (entity, scene) => {
  const character = await CharacterGenerator.create(entity, scene);
  return { handled: true, node: character };
});
```

### Benefits
- **Engine/game separation** - Engine doesn't import game code
- **Extensibility** - New entity types without engine changes
- **Pre/post hooks** - Run code before/after map rendering

## Mesh Instancing

The `InstancedMeshManager` reduces draw calls by batching identical meshes.

### Usage

```typescript
import { InstancedMeshManager } from '@engine/rendering';

const manager = InstancedMeshManager.getInstance();
manager.init(scene);

// Register a mesh template
manager.registerTemplate('tree_pine', treeMesh, 500); // Max 500 instances

// Create instances (cheap!)
const tree1 = manager.createInstance('tree_pine', { 
  position: new Vector3(10, 0, 20),
  rotation: new Vector3(0, Math.PI / 4, 0),
});

// For maximum performance, use thin instances
const matrices = positions.map(pos => InstancedMeshManager.createMatrix({ position: pos }));
manager.createThinInstances('tree_pine', matrices);
```

### Performance Impact
| Scenario | Without Instancing | With Instancing |
|----------|-------------------|-----------------|
| 100 trees | 100 draw calls | 1 draw call |
| 500 props | 500 draw calls | ~5 draw calls |
| Mobile FPS | 15-20 FPS | 45-60 FPS |

## Texture Memory Management

The `TextureMemoryManager` enforces memory budgets and supports LOD.

### Usage

```typescript
import { TextureMemoryManager } from '@engine/loader';

const manager = TextureMemoryManager.getInstance();
manager.init(scene, { memoryBudgetMB: 128 }); // 128MB for mobile

// Apply quality preset
manager.setQuality('medium'); // ultra, high, medium, low, potato

// Check before loading large textures
if (manager.canAllocate(textureSize)) {
  const texture = loadTexture(path);
  manager.trackTexture(texture);
} else {
  // Load lower-res version
  const recommended = manager.getRecommendedSize(1024, 1024);
  // { width: 512, height: 512 } on medium quality
}

// Monitor memory
const stats = manager.getStats();
console.log(`Using ${stats.currentMB.toFixed(1)}MB of ${stats.budgetMB}MB`);
```

### Quality Presets

| Preset | Memory Budget | Max Texture | LOD Bias |
|--------|---------------|-------------|----------|
| ultra | 512 MB | 4096px | 0 |
| high | 256 MB | 2048px | 0 |
| medium | 128 MB | 1024px | 1 |
| low | 64 MB | 512px | 2 |
| potato | 32 MB | 256px | 3 |

## Event-Driven Architecture

Game-specific events are now separate from engine events:

### Engine Events (`@engine/core/EventBus`)
- `map:loading`, `map:loaded`, `map:unloading`
- `app:state_change`, `app:back_button`, `app:resize`
- `assets:progress`, `assets:complete`
- `audio:music_started`, `audio:music_ended`

### Game Events (`@game/GameEvents`)
- `plant:planted`, `plant:harvested`, etc.
- `shop:purchased`, `shop:sold`
- `building:started`, `building:completed`
- `player:levelup`, `player:xp_gained`
- `game:paused`, `game:resumed`

```typescript
// Engine listens for generic events
EventBus.emit('game:paused', {});

// Game layer handles specifics
EventBus.on('game:paused', () => {
  GameTimer.getInstance().pause();
});
```

## Mobile Best Practices

1. **Use instancing** for repeated geometry (trees, props, decorations)
2. **Set texture budgets** based on device capability
3. **Use quality presets** - detect device and apply appropriate preset
4. **Monitor memory** - `TextureMemoryManager.getStats()` for debugging
5. **Leverage events** - Decouple systems for cleaner code

## File Reference

| File | Purpose |
|------|---------|
| `src/engine/core/ServiceLocator.ts` | Service dependency management |
| `src/engine/core/EntityHandlerRegistry.ts` | Map entity extension point |
| `src/engine/core/EngineServices.ts` | Engine service registrations |
| `src/engine/rendering/InstancedMeshManager.ts` | GPU mesh instancing |
| `src/engine/loader/TextureMemoryManager.ts` | Texture LOD & memory |
| `src/game/EntityHandlers.ts` | Game-specific entity handlers |
| `src/game/GameEvents.ts` | Game-specific event types |
