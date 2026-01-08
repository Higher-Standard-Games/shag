# Entity System Integration

**Time:** 45 minutes  
**Level:** Advanced

Parse BSP entities and spawn game objects.

## Prerequisites

- [Recipe: Extract Entities](../recipes/extract-entities.md)
- [Guide: BSP System](../../guides/bsp-system.md)

## BSP Entity Format

Entities are stored as text in the BSP file:

```
{
"classname" "info_player_deathmatch"
"origin" "256 128 64"
"angle" "90"
}
{
"classname" "item_health_large"
"origin" "512 256 32"
}
```

## Entity Parser

```typescript
interface Entity {
  classname: string;
  origin?: string;
  angle?: string;
  targetname?: string;
  target?: string;
  [key: string]: string | undefined;
}

function parseEntities(entityString: string): Entity[] {
  const entities: Entity[] = [];
  const regex = /\{([^}]+)\}/g;
  
  let match;
  while ((match = regex.exec(entityString)) !== null) {
    const entity: Entity = { classname: '' };
    const lines = match[1].trim().split('\n');
    
    for (const line of lines) {
      const keyValue = line.match(/"([^"]+)"\s+"([^"]*)"/);
      if (keyValue) {
        entity[keyValue[1]] = keyValue[2];
      }
    }
    
    if (entity.classname) {
      entities.push(entity);
    }
  }
  
  return entities;
}
```

## Entity Spawner System

```typescript
type EntitySpawner = (entity: Entity, scene: Scene) => void;

class EntitySystem {
  private spawners: Map<string, EntitySpawner> = new Map();
  private scene: Scene;
  
  constructor(scene: Scene) {
    this.scene = scene;
    this.registerDefaultSpawners();
  }
  
  registerSpawner(classname: string, spawner: EntitySpawner) {
    this.spawners.set(classname, spawner);
  }
  
  spawnAll(entities: Entity[]) {
    for (const entity of entities) {
      this.spawn(entity);
    }
  }
  
  spawn(entity: Entity) {
    const spawner = this.spawners.get(entity.classname);
    if (spawner) {
      spawner(entity, this.scene);
    } else {
      console.log(`No spawner for: ${entity.classname}`);
    }
  }
  
  private registerDefaultSpawners() {
    // Player spawns - just log, don't create mesh
    this.registerSpawner('info_player_deathmatch', (e) => {
      console.log('Player spawn at:', e.origin);
    });
    
    // Lights
    this.registerSpawner('light', (e, scene) => {
      const pos = this.parseOrigin(e.origin);
      const intensity = parseFloat(e.light || '300') / 300;
      
      const light = new PointLight(
        `light_${e.origin}`,
        new Vector3(pos.x, pos.y, pos.z),
        scene
      );
      light.intensity = intensity;
    });
  }
  
  private parseOrigin(origin?: string): { x: number; y: number; z: number } {
    if (!origin) return { x: 0, y: 0, z: 0 };
    const [x, y, z] = origin.split(' ').map(Number);
    return { x, y, z };
  }
}
```

## Spawning Items

```typescript
// Item spawner
entitySystem.registerSpawner('item_health_large', (entity, scene) => {
  const pos = parseOrigin(entity.origin);
  
  // Create visual
  const mesh = MeshBuilder.CreateBox('health', { size: 32 }, scene);
  mesh.position.set(pos.x, pos.y + 16, pos.z);
  
  // Add rotation animation
  scene.onBeforeRenderObservable.add(() => {
    mesh.rotation.y += 0.02;
  });
  
  // Store entity data
  mesh.metadata = { entity, type: 'pickup' };
});

// Weapon spawner
entitySystem.registerSpawner('weapon_rocketlauncher', (entity, scene) => {
  const pos = parseOrigin(entity.origin);
  
  // Load weapon model (if available)
  // Or create placeholder
  const mesh = MeshBuilder.CreateCylinder('weapon', { height: 48 }, scene);
  mesh.position.set(pos.x, pos.y + 24, pos.z);
  mesh.metadata = { entity, type: 'weapon', weapon: 'rocketlauncher' };
});
```

## Trigger Volumes

```typescript
entitySystem.registerSpawner('trigger_teleport', (entity, scene) => {
  // trigger_ entities use brush models
  const modelIndex = parseInt(entity.model?.replace('*', '') || '0');
  
  // Get brush geometry from BSP
  // Create invisible collision mesh
  const trigger = MeshBuilder.CreateBox('trigger', { size: 64 }, scene);
  trigger.visibility = 0;
  trigger.checkCollisions = true;
  
  trigger.metadata = {
    entity,
    type: 'trigger',
    target: entity.target // Where to teleport
  };
});
```

## Collision Detection

```typescript
function checkPickups(playerPos: Vector3, scene: Scene) {
  const pickupRadius = 32;
  
  for (const mesh of scene.meshes) {
    if (mesh.metadata?.type === 'pickup') {
      const dist = Vector3.Distance(playerPos, mesh.position);
      
      if (dist < pickupRadius) {
        handlePickup(mesh);
        mesh.dispose();
      }
    }
  }
}

function handlePickup(mesh: Mesh) {
  const entity = mesh.metadata.entity;
  
  switch (entity.classname) {
    case 'item_health_large':
      player.health = Math.min(100, player.health + 50);
      break;
    case 'item_armor_body':
      player.armor = Math.min(100, player.armor + 100);
      break;
  }
}
```

## Complete Example

```typescript
async function loadMapWithEntities(scene: Scene, mapName: string) {
  // Load map
  const mapLoader = new MapLoader(scene);
  const result = await mapLoader.load(mapName);
  
  // Parse entities
  const entities = parseEntities(result.bspData.entities);
  
  // Create entity system
  const entitySystem = new EntitySystem(scene);
  
  // Register custom spawners
  entitySystem.registerSpawner('item_health_large', createHealthPickup);
  entitySystem.registerSpawner('item_armor_body', createArmorPickup);
  
  // Spawn all entities
  entitySystem.spawnAll(entities);
  
  // Get player spawn
  const spawns = entities.filter(e => e.classname === 'info_player_deathmatch');
  
  return { result, entities, spawns };
}
```

## Next Steps

- [Performance Optimization](./performance.md)
- [Guide: BSP System](../../guides/bsp-system.md)
