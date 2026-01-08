# Building a Map Viewer App

**Time:** 30 minutes  
**Level:** Intermediate

Build a complete map browser application with UI.

## What We'll Build

A standalone app that:
- Lists available maps
- Loads selected map
- Provides camera controls
- Shows map information

## Prerequisites

- [Getting Started](../../getting-started/) completed
- Beginner tutorials completed

## Step 1: Project Setup

Start with the base SHAG Engine setup:

```typescript
// src/apps/map-viewer/main.ts
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { MapLoader } from '../../engine/loader/map/MapLoader';
import { CameraSystem } from '../../engine/camera/CameraSystem';
import { PK3Loader } from '../../engine/loader/pk3/PK3Loader';

async function init() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  
  // Initialize systems
  const pk3 = PK3Loader.getInstance();
  await pk3.indexDirectory('./game');
  
  const camera = CameraSystem.getInstance();
  camera.init(scene);
  
  // Start render loop
  engine.runRenderLoop(() => scene.render());
  
  return { engine, scene };
}
```

## Step 2: Get Available Maps

```typescript
async function getMapList(): Promise<string[]> {
  const pk3 = PK3Loader.getInstance();
  const files = pk3.listFiles('maps/');
  
  return files
    .filter(f => f.endsWith('.bsp'))
    .map(f => f.replace('maps/', '').replace('.bsp', ''));
}
```

## Step 3: Create Map Selector UI

```typescript
function createMapSelector(maps: string[], onSelect: (map: string) => void) {
  const container = document.createElement('div');
  container.className = 'map-selector';
  
  const select = document.createElement('select');
  maps.forEach(map => {
    const option = document.createElement('option');
    option.value = map;
    option.textContent = map;
    select.appendChild(option);
  });
  
  const button = document.createElement('button');
  button.textContent = 'Load Map';
  button.onclick = () => onSelect(select.value);
  
  container.appendChild(select);
  container.appendChild(button);
  document.body.appendChild(container);
}
```

## Step 4: Load Map Function

```typescript
async function loadMap(scene: Scene, mapName: string) {
  // Clear existing
  scene.meshes.forEach(m => m.dispose());
  
  // Load new map
  const loader = new MapLoader(scene);
  const result = await loader.load(mapName);
  
  if (result.success) {
    console.log(`Loaded: ${mapName}`);
    
    // Spawn camera at player start
    const spawns = result.entities?.filter(
      e => e.classname === 'info_player_deathmatch'
    );
    if (spawns?.length) {
      const pos = parseOrigin(spawns[0].origin);
      CameraSystem.getInstance().getCamera().position.set(pos.x, pos.y + 50, pos.z);
    }
  }
  
  return result;
}
```

## Step 5: Map Info Panel

```typescript
function showMapInfo(result: MapLoadResult) {
  const info = document.getElementById('map-info');
  if (!info) return;
  
  info.innerHTML = `
    <h3>${result.mapName}</h3>
    <p>Vertices: ${result.stats.vertices}</p>
    <p>Faces: ${result.stats.faces}</p>
    <p>Textures: ${result.stats.textures}</p>
    <p>Entities: ${result.entities?.length || 0}</p>
  `;
}
```

## Step 6: Put It Together

```typescript
async function main() {
  const { engine, scene } = await init();
  
  const maps = await getMapList();
  
  createMapSelector(maps, async (mapName) => {
    const result = await loadMap(scene, mapName);
    showMapInfo(result);
  });
  
  // Load first map by default
  if (maps.length > 0) {
    await loadMap(scene, maps[0]);
  }
}

main();
```

## Step 7: Add Styles

```css
.map-selector {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.8);
  padding: 10px;
  border-radius: 5px;
}

.map-selector select {
  margin-right: 10px;
  padding: 5px;
}

#map-info {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px;
  border-radius: 5px;
}
```

## Enhancements

- Add keyboard shortcuts (N = next map, P = previous)
- Add search/filter for map names
- Show map thumbnails
- Remember last loaded map
- Add loading spinner

## Next Steps

- [FPS Game Skeleton](./fps-skeleton.md)
- [Custom Console Commands](./custom-commands.md)
