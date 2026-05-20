# FPS Game Skeleton

**Time:** 45 minutes  
**Level:** Intermediate

Build the foundation for a first-person shooter.

## What We'll Build

A basic FPS foundation with:
- Player spawning
- First-person camera with collision
- Basic game loop
- HUD elements

## Prerequisites

- [First Map Load](../beginner/first-map-load.md)
- [Camera Navigation](../beginner/camera-navigation.md)

## Step 1: Game State

```typescript
// src/games/fps/GameState.ts
export interface PlayerState {
  health: number;
  armor: number;
  ammo: number;
  position: { x: number; y: number; z: number };
  rotation: { yaw: number; pitch: number };
}

export class FPSGameState {
  player: PlayerState = {
    health: 100,
    armor: 0,
    ammo: 50,
    position: { x: 0, y: 0, z: 0 },
    rotation: { yaw: 0, pitch: 0 }
  };
  
  isRunning = false;
  isPaused = false;
  
  reset() {
    this.player.health = 100;
    this.player.armor = 0;
    this.player.ammo = 50;
  }
}
```

## Step 2: Player Spawning

```typescript
// src/games/fps/PlayerSpawner.ts
import { parseEntities } from '../../engine/loader/bsp/EntityParser';

export function findSpawnPoints(entityString: string) {
  const entities = parseEntities(entityString);
  
  return entities
    .filter(e => 
      e.classname === 'info_player_deathmatch' ||
      e.classname === 'info_player_start'
    )
    .map(e => {
      const [x, y, z] = (e.origin || '0 0 0').split(' ').map(Number);
      const angle = parseFloat(e.angle || '0');
      return { x, y, z, angle };
    });
}

export function spawnPlayer(
  camera: Camera, 
  spawn: { x: number; y: number; z: number; angle: number }
) {
  camera.position.set(spawn.x, spawn.y + 56, spawn.z); // 56 = eye height
  camera.rotation.y = (spawn.angle * Math.PI) / 180;
}
```

## Step 3: FPS Camera Setup

```typescript
// src/games/fps/FPSController.ts
import { CameraSystem } from '../../engine/camera/CameraSystem';

export function setupFPSCamera(scene: Scene) {
  const cameraSystem = CameraSystem.getInstance();
  cameraSystem.init(scene);
  cameraSystem.setController('freefly');
  
  // Enable collision
  const registry = ConsoleCommandRegistry.getInstance();
  registry.execute('freefly_collision 1');
  
  return cameraSystem.getCamera();
}
```

## Step 4: Game Loop

```typescript
// src/games/fps/GameLoop.ts
export class FPSGameLoop {
  private state: FPSGameState;
  private lastTime = 0;
  
  constructor(state: FPSGameState) {
    this.state = state;
  }
  
  start() {
    this.state.isRunning = true;
    this.lastTime = performance.now();
    this.tick();
  }
  
  private tick = () => {
    if (!this.state.isRunning) return;
    
    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    
    if (!this.state.isPaused) {
      this.update(deltaTime);
    }
    
    requestAnimationFrame(this.tick);
  };
  
  private update(dt: number) {
    // Update player position from camera
    const cam = CameraSystem.getInstance().getCamera();
    this.state.player.position = {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z
    };
    
    // Game logic here
    this.checkPickups();
    this.updateEnemies(dt);
  }
  
  private checkPickups() {
    // Pickups in SHAG are server-authoritative. The engine generic base
    // class is `src/engine/world/Pickup` and the FPS-specific subclass is
    // `src/games/fps/world/FPSPickup`. The subclass owns a static
    // deactivation registry (`allPickups`, `pickupById`, `deactivateByPosition`)
    // that the server calls into via item_pickup events.
    //
    // Client-side `checkPickup` is display-only — it surfaces the HUD
    // prompt for weapon swap when the player approaches a pickup. The
    // actual pickup logic lives in `src/games/fps/server/systems/PickupSystem.ts`.
    // See the Pickup System Guide: ../../guides/pickup-system.md
  }
  
  private updateEnemies(dt: number) {
    // Update enemy AI
  }
}
```

## Step 5: HUD

```typescript
// src/games/fps/HUD.ts
export class FPSHUD {
  private container: HTMLDivElement;
  
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'fps-hud';
    this.container.innerHTML = `
      <div class="hud-health">
        <span class="label">HEALTH</span>
        <span class="value" id="hud-health">100</span>
      </div>
      <div class="hud-armor">
        <span class="label">ARMOR</span>
        <span class="value" id="hud-armor">0</span>
      </div>
      <div class="hud-ammo">
        <span class="label">AMMO</span>
        <span class="value" id="hud-ammo">50</span>
      </div>
      <div class="crosshair">+</div>
    `;
    document.body.appendChild(this.container);
  }
  
  update(state: PlayerState) {
    document.getElementById('hud-health')!.textContent = String(state.health);
    document.getElementById('hud-armor')!.textContent = String(state.armor);
    document.getElementById('hud-ammo')!.textContent = String(state.ammo);
  }
}
```

## Step 6: Main Entry Point

```typescript
// src/games/fps/main.ts
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';

async function main() {
  // Initialize engine
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  
  // Load assets
  const pk3 = PK3Loader.getInstance();
  await pk3.indexDirectory('./game');
  
  // Load shaders
  const shaders = Q3ShaderRegistry.getInstance();
  await shaders.loadFromPK3();
  
  // Load map
  const mapLoader = new MapLoader(scene);
  const result = await mapLoader.load('wdm7');
  
  // Setup camera
  const camera = setupFPSCamera(scene);
  
  // Spawn player
  const spawns = findSpawnPoints(result.bspData.entities);
  if (spawns.length > 0) {
    spawnPlayer(camera, spawns[0]);
  }
  
  // Initialize game
  const state = new FPSGameState();
  const hud = new FPSHUD();
  const gameLoop = new FPSGameLoop(state);
  
  // Start render loop
  engine.runRenderLoop(() => {
    scene.render();
    hud.update(state.player);
  });
  
  // Start game loop
  gameLoop.start();
}

main();
```

## HUD Styles

```css
.fps-hud {
  position: absolute;
  bottom: 20px;
  left: 20px;
  font-family: 'Courier New', monospace;
  color: white;
  text-shadow: 2px 2px black;
}

.fps-hud .value {
  font-size: 32px;
  font-weight: bold;
}

.crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  color: white;
}
```

## Next Steps

- Add weapons and shooting
- Add enemy spawning
- Add pickups (health, armor, ammo)
- Add damage system
- Add game over/respawn

## Related

- [Isometric Strategy Setup](./isometric-game.md)
- [Custom Console Commands](./custom-commands.md)
