# Quick Recipes

Copy-paste examples for common game development tasks. Each recipe is self-contained and ready to use!

## 🗺️ Render a Map for Inspection

`bsp load` is the inert mesh-render path — no server, no gameplay. Use this for screenshots, debugging shaders, or any code that only needs the map geometry in the scene.

```typescript
import { ConsoleSystem } from '@/engine/console';
import { CameraSystem } from '@/engine/camera';

async function loadMapForInspection() {
  CameraSystem.getInstance().setMode('freefly');
  await ConsoleSystem.getInstance().execute('bsp load wdm2');
  console.log('Map rendered. Fly around with WASD/mouse.');
}
```

## 🎮 Launch a Gameplay Session

The `map` command is developer-only: it asks the lobby to spawn a dedicated game server and connects this client to it. Real player flows go through the lobby UI's "Play" button, not the console.

```typescript
import { ConsoleSystem } from '@/engine/console';

async function startDevGame() {
  // Requires: lobby server running (`npm run lobby:server`)
  await ConsoleSystem.getInstance().execute('map wdm2 duel');
  console.log('Connected to dev-spawned duel server on wdm2');
}
```

See the [Map Launching Guide](./../guides/map-launching.md) for the full architecture and the underlying `GameplayMapLauncher` registry pattern.

---

## 💬 Add a Custom Console Command

```typescript
import { CommandRegistry } from '@/engine/console/CommandRegistry';

// Simple command
CommandRegistry.getInstance().register('hello', async (args) => {
  const name = args[0] || 'World';
  return `Hello, ${name}!`;
}, {
  description: 'Say hello',
  usage: 'hello [name]'
});

// Command with subcommands
CommandRegistry.getInstance().register('score', async (args) => {
  const sub = args[0];
  
  switch (sub) {
    case 'add':
      const points = parseInt(args[1]) || 10;
      playerScore += points;
      return `Added ${points} points. Total: ${playerScore}`;
    
    case 'reset':
      playerScore = 0;
      return 'Score reset to 0';
    
    case 'show':
    default:
      return `Current score: ${playerScore}`;
  }
}, {
  description: 'Manage player score',
  usage: 'score <add|reset|show> [amount]'
});
```

---

## ⏱️ Create a Timer / Countdown

```typescript
import { GameTimer } from '@/engine/core/GameTimer';

class RaceTimer {
  private startTime: number = 0;
  private running: boolean = false;

  start(): void {
    this.startTime = GameTimer.getInstance().getTime();
    this.running = true;
  }

  getElapsed(): number {
    if (!this.running) return 0;
    return GameTimer.getInstance().getTime() - this.startTime;
  }

  getFormatted(): string {
    const ms = this.getElapsed();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
  }

  stop(): number {
    this.running = false;
    return this.getElapsed();
  }
}
```

---

## 🎯 Create Checkpoint / Trigger Zone

```typescript
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

interface Checkpoint {
  position: Vector3;
  radius: number;
  triggered: boolean;
}

class CheckpointSystem {
  private checkpoints: Checkpoint[] = [];
  private currentIndex: number = 0;

  addCheckpoint(x: number, y: number, z: number, radius: number = 50): void {
    this.checkpoints.push({
      position: new Vector3(x, y, z),
      radius,
      triggered: false
    });
  }

  update(playerPos: Vector3): boolean {
    const current = this.checkpoints[this.currentIndex];
    if (!current || current.triggered) return false;

    const distance = Vector3.Distance(playerPos, current.position);
    
    if (distance < current.radius) {
      current.triggered = true;
      this.currentIndex++;
      console.log(`Checkpoint ${this.currentIndex}/${this.checkpoints.length}!`);
      return true; // Checkpoint hit!
    }
    
    return false;
  }

  isComplete(): boolean {
    return this.currentIndex >= this.checkpoints.length;
  }

  reset(): void {
    this.checkpoints.forEach(cp => cp.triggered = false);
    this.currentIndex = 0;
  }
}
```

---

## 🎵 Play Sound on Event

```typescript
import { EventBus } from '@/engine/core/EventBus';
import { AudioManager } from '@/engine/AudioManager';

// Play sound when player jumps
const unsubJump = EventBus.on('player:jump', () => {
  AudioManager.getInstance().playSound('player/jump');
});

// Play sound when weapon fires
const unsubFire = EventBus.on('weapon:fire', (data) => {
  AudioManager.getInstance().playSound(`weapons/${data.weapon}/fire`);
});

// Remember to unsubscribe on cleanup!
function dispose() {
  unsubJump();
  unsubFire();
}
```

---

## 🏆 Simple Scoreboard

```typescript
interface PlayerScore {
  name: string;
  kills: number;
  deaths: number;
}

class Scoreboard {
  private scores: Map<string, PlayerScore> = new Map();

  addKill(playerId: string): void {
    const score = this.getOrCreate(playerId);
    score.kills++;
  }

  addDeath(playerId: string): void {
    const score = this.getOrCreate(playerId);
    score.deaths++;
  }

  private getOrCreate(playerId: string): PlayerScore {
    if (!this.scores.has(playerId)) {
      this.scores.set(playerId, { name: playerId, kills: 0, deaths: 0 });
    }
    return this.scores.get(playerId)!;
  }

  getSorted(): PlayerScore[] {
    return Array.from(this.scores.values())
      .sort((a, b) => b.kills - a.kills);
  }

  format(): string {
    return this.getSorted()
      .map((p, i) => `${i + 1}. ${p.name}: ${p.kills}/${p.deaths}`)
      .join('\n');
  }
}
```

---

## 🔄 Respawn Player at Random Spawn

```typescript
import { SpawnPointManager } from '@/engine/spawn/SpawnPointManager';
import { CameraSystem } from '@/engine/camera';

function respawnPlayer(): void {
  const spawns = SpawnPointManager.getInstance();
  const spawn = spawns.getRandomSpawnPoint();
  
  if (spawn) {
    const camera = CameraSystem.getInstance().getCamera();
    camera.position.copyFrom(spawn.position);
    
    // Reset velocity if using physics
    // playerController.setVelocity(Vector3.Zero());
    
    console.log('Respawned at', spawn.position.toString());
  }
}
```

---

## 🎲 Random Map Rotation

```typescript
import { ConsoleSystem } from '@/engine/console';

class MapRotation {
  private maps: string[] = ['wdm1', 'wdm2', 'wdm3', 'wdm7'];
  private currentIndex: number = 0;

  async nextMap(): Promise<void> {
    this.currentIndex = (this.currentIndex + 1) % this.maps.length;
    const map = this.maps[this.currentIndex];
    await ConsoleSystem.getInstance().execute(`map ${map}`);
  }

  async randomMap(): Promise<void> {
    const map = this.maps[Math.floor(Math.random() * this.maps.length)];
    await ConsoleSystem.getInstance().execute(`map ${map}`);
  }
}
```

---

## ⌨️ Key Binding Helper

```typescript
import { InputSystem } from '@/engine/input';

interface KeyAction {
  key: string;
  action: () => void;
  onRelease?: () => void;
}

class KeyBindings {
  private bindings: KeyAction[] = [];
  private pressedKeys: Set<string> = new Set();

  bind(key: string, action: () => void, onRelease?: () => void): void {
    this.bindings.push({ key, action, onRelease });
  }

  update(): void {
    const input = InputSystem.getInstance();
    
    for (const binding of this.bindings) {
      const isDown = input.isKeyDown(binding.key);
      const wasDown = this.pressedKeys.has(binding.key);
      
      if (isDown && !wasDown) {
        binding.action();
        this.pressedKeys.add(binding.key);
      } else if (!isDown && wasDown) {
        binding.onRelease?.();
        this.pressedKeys.delete(binding.key);
      }
    }
  }
}

// Usage
const keys = new KeyBindings();
keys.bind('space', () => player.jump());
keys.bind('shift', () => player.startSprint(), () => player.stopSprint());
```

---

## 💀 Simple Death/Respawn Logic

```typescript
import { EventBus } from '@/engine/core/EventBus';

class PlayerHealth {
  private health: number = 100;
  private maxHealth: number = 100;
  private alive: boolean = true;

  takeDamage(amount: number, attackerId?: string): void {
    if (!this.alive) return;
    
    this.health = Math.max(0, this.health - amount);
    
    EventBus.emit('player:damaged', { 
      health: this.health, 
      damage: amount 
    });
    
    if (this.health <= 0) {
      this.die(attackerId);
    }
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  private die(killerId?: string): void {
    this.alive = false;
    EventBus.emit('player:death', { killerId });
    
    // Respawn after delay
    setTimeout(() => this.respawn(), 3000);
  }

  private respawn(): void {
    this.health = this.maxHealth;
    this.alive = true;
    EventBus.emit('player:spawn', {});
  }
}
```

---

## See Also

- [Console System](../guides/console-system.md) - Full console guide
- [Command Reference](../guides/command-reference.md) - All commands
- [Networking](../guides/networking.md) - Multiplayer setup
- [Movement System](../guides/movement-system.md) - Q3 physics
