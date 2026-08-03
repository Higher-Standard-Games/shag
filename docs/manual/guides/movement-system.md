# Movement System

The SHAG Engine movement system provides Quake/Warsow-style FPS movement with bunny hopping, wall jumping, ledge grabbing, and crouchslide mechanics.

## Architecture

```
CharacterController
    ├── applyMovementInput() - WASD → velocity
    ├── jump() - Jump with grounded check
    ├── update(dt) - Apply gravity, collision
    └── moveWithCollision() → CollisionManager.slideMove()

MovementVars (Singleton)
    └── ~80 cvars for movement/physics tuning
```

## Quick Start

```typescript
import { CharacterController } from '@/engine/movement';

const controller = new CharacterController(spawnPos, {
  radius: 16,    // Collision radius
  height: 56,    // Standing height
  crouchHeight: 32,
  eyeOffset: 48, // Camera height
});

// Game loop
function update(dt: number) {
  controller.applyMovementInput(forward, strafe, camForward, camRight);
  if (wantJump) controller.jump();
  controller.update(dt);
  
  camera.position = controller.getEyePosition();
}
```

## Q3-Style Movement (Strafe Jumping)

The engine implements authentic Quake 3 / Warsow movement physics:

### Strafe Jumping

Strafe jumping exploits the air acceleration code to gain speed:

```
1. Jump while moving forward
2. Release W, hold A or D (strafe key)
3. Smoothly turn mouse in strafe direction
4. Jump again on landing (autohop helps)
5. Repeat, alternating sides
```

Each strafe jump adds ~20-30 u/s if done correctly. Speed can exceed 600+ u/s.

### Air Control

The `sv_aircontrol` cvar enables Warsow-style sharp turning in air:

```
sv_aircontrol  0   = No air turning (Q3 default)
sv_aircontrol  150 = Sharp air turning (Warsow style)
```

With air control enabled, releasing strafe key and just holding W lets you turn sharply mid-air.

### Speed Preservation

Unlike most modern games, speed is preserved through:

- Bunny hopping (continuous jumping)
- Strafe jumping (builds speed)
- Crouch sliding (maintains momentum)

Ground friction only applies when actually walking on ground.

## Character State

```typescript
interface CharacterState {
  position: Vector3;   // Feet position
  velocity: Vector3;   // Current velocity
  isGrounded: boolean; // On walkable surface
  isJumping: boolean;  // In jump
  isCrouching: boolean;
  isSliding: boolean;  // Crouchslide active
  wallJumpState: string;  // Wall jump phase
  ledgeGrabState: string; // Ledge grab phase
  actualHorizSpeed: number; // Measured horizontal speed
}
```

| Method | Description |
|--------|-------------|
| `getPosition()` | Feet position |
| `getEyePosition()` | Camera position |
| `getVelocity()` | Current velocity |
| `isGrounded()` | On ground |
| `setPosition(pos)` | Teleport |

## Movement Variables (CVars)

Access via console or `MovementVars.getInstance().get('name')`:

### Core Movement

| Variable | Default | Description |
|----------|---------|-------------|
| `cl_speed` | 320 | Base movement speed |
| `cl_sprintmult` | 1.5 | Sprint multiplier |
| `cl_crouchmult` | 0.5 | Crouch multiplier |
| `cl_autorun` | 0 | Invert run/walk |

### Physics

| Variable | Default | Description |
|----------|---------|-------------|
| `sv_gravity` | 1000 | Gravity (u/s²) |
| `sv_jumpheight` | 320 | Jump velocity |
| `sv_friction` | 6.0 | Ground friction |
| `sv_accelerate` | 10.0 | Ground acceleration |
| `sv_airaccelerate` | 1.0 | Air acceleration |
| `sv_maxairspeed` | 30 | Air strafe cap |
| `sv_aircontrol` | 150 | Warsow-style turning |
| `sv_autohop` | 1 | Bunny hop enabled |
| `sv_stepheight` | 18 | Auto-climb height |
| `sv_movementSpeed` | 280 | Base movement speed |
| `sv_runSpeed` | 400 | Sprint/run speed |

> **Note:** Gravity multiplier for falling (`FALLING_GRAVITY_MULTIPLIER`) was reduced from 1.8 to 1.25 in v0.9.3 for less harsh descents while maintaining jump height.

### Wall Jump

| Variable | Default | Description |
|----------|---------|-------------|
| `sv_walljump` | 1 | Enable |
| `sv_walljump_height` | 280 | Upward velocity |
| `sv_walljump_bounce` | 0.8 | Horizontal preservation |
| `sv_walljump_cooldown` | 1.0 | Cooldown (seconds) |

### Ledge Grab

| Variable | Default | Description |
|----------|---------|-------------|
| `sv_ledgegrab` | 1 | Enable |
| `sv_ledge_reach` | 32 | Detection distance |
| `sv_ledge_height` | 64 | Max height |
| `sv_ledge_timeout` | 2.0 | Hang time |

### Crouchslide

| Variable | Default | Description |
|----------|---------|-------------|
| `sv_slide` | 1 | Enable |
| `sv_slideMinSpeed` | 375 | Min speed to trigger |
| `sv_slideDuration` | 800 | Max duration (ms) |
| `sv_slideJumpBoost` | 1.3 | Jump cancel boost |
| `sv_slideCooldown` | 1500 | Cooldown (ms) |

## Crouchslide Mechanics

Sprint (425+ speed) → Crouch = Slide

**Behavior:**

- 800ms max duration, 1500ms cooldown
- Speed preserved for 400ms, then decays
- Jump cancel after 400ms grace period
- Hold jump for 1.3x velocity boost

**Camera Effects:**

- Camera tilts up ~12°
- Walk bob disabled
- Vertical look locked during animation

## Ground Detection

```typescript
// Walkable slope threshold
const MIN_GROUND_NORMAL = 0.7; // ~45°

isGrounded = trace.fraction < 1.0 && trace.normal.y > 0.7;
```

## Console Commands

```
mv              - Show all movement variables
mv <name>       - Show specific variable
mv <name> <val> - Set variable
mv_reset        - Reset all to defaults
```

## Network Synchronization

In multiplayer, movement runs server-authoritative:

- **Server:** `FPSMovementSubsystem` runs identical physics at 125Hz
- **Client:** `V2NetworkClient` predicts locally and reconciles with server snapshots
- **Visual smoothing:** `visualOffset` absorbs reconciliation corrections over ~50ms
- **Grounded state:** Client preserves its own grounded flag when no inputs need replay (prevents walk bob jitter)

See [Networking System](./networking.md) for details.

## See Also

- [Physics System](./physics-system.md) - Collision detection
- [Camera System](./camera-system.md) - View handling
- [CVar System](./cvar-system.md) - Console variables
- [Networking System](./networking.md) - Server-authoritative sync
