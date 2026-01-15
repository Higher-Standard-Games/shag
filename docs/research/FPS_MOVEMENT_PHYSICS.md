# FPS Movement & Physics System

**Status:** Design Phase  
**Branch:** `feature/fps-movement`  
**Author:** Cascade  
**Date:** 2026-01-14

## Overview

Consolidate camera systems into a unified FPS camera with spectator mode, add proper physics-based movement with gravity/jumping, and fix viewport smoothing for stairs.

## Goals

1. **Unified Camera** - Single FPS camera system with spectator toggle
2. **Physics Integration** - Proper gravity, jumping, ground detection
3. **Smooth Movement** - Fix stair jitter without breaking collision
4. **Versatile Physics** - Support projectiles, player models, etc.

---

## Current State Analysis

### Existing Camera Controllers

| Controller | Purpose | Status |
|------------|---------|--------|
| `FreeflyController` | Debug noclip camera | ✅ Working, has collision modes |
| `FPSController` | Old FPS camera | ❌ Dead code, not used |
| `IsometricController` | RTS camera | ✅ Working |
| `SidescrollController` | 2D platformer | ✅ Working |

### FreeflyController Features (To Keep)
- Pointer lock for mouse capture
- WASD movement + Space/Shift for up/down
- BSP collision via `CollisionManager.traceBox()`
- Native Babylon collision mode
- Configurable speed, sensitivity, FOV
- Works well as "spectator/noclip" mode

### Problems to Solve

1. **Stair Jitter** - Physics collision is correct, but viewport snaps instantly to new height
2. **No Gravity** - FreeFly is purely velocity-based, no physics simulation
3. **No Jumping** - Can only fly up/down, no jump arc
4. **Dual Systems** - Confusing to have separate FPS and FreeFly concepts

---

## Physics Engine Options

### Babylon.js Built-in: Havok Physics (Recommended)

**Pros:**
- Official Babylon.js integration since 6.0
- MIT licensed, free to use
- WebAssembly for performance
- `PhysicsCharacterController` for FPS movement
- Supports gravity, jumping, ground detection
- Works with projectiles, rigid bodies, etc.

**Cons:**
- Requires WebAssembly SIMD (iOS 16.4+)
- Additional ~2MB download
- Learning curve for physics API

**Installation:**
```bash
npm install @babylonjs/havok
```

**Basic Setup:**
```typescript
import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";

const havokInstance = await HavokPhysics();
const havokPlugin = new HavokPlugin(true, havokInstance);
scene.enablePhysics(new Vector3(0, -9.8, 0), havokPlugin);
```

### PhysicsCharacterController (Perfect for FPS!)

Babylon.js has a built-in character controller specifically for FPS:

```typescript
const characterController = new PhysicsCharacterController(
  position,
  { capsuleHeight: 1.8, capsuleRadius: 0.6 },
  scene
);

// Main loop
const support = characterController.checkSupport(dt, down);
const velocity = getDesiredVelocity(dt, support, orientation, currentVelocity);
characterController.setVelocity(velocity);
characterController.integrate(dt, support, gravity);
const newPosition = characterController.getPosition();
```

### Alternative: Keep Custom Collision

Could extend current `CollisionManager.traceBox()` approach:
- Add gravity simulation manually
- Add ground detection via downward trace
- Add jump velocity

**Pros:** No new dependencies, works with BSP collision
**Cons:** More manual work, less robust

---

## Proposed Architecture

### Unified FPSCamera Class

```typescript
class FPSCamera {
  // Modes
  private spectatorMode: boolean = false;
  
  // Physics (when not spectator)
  private characterController: PhysicsCharacterController | null;
  private velocity: Vector3 = Vector3.Zero();
  private isGrounded: boolean = false;
  
  // Viewport smoothing (separate from physics!)
  private renderPosition: Vector3;      // What camera sees
  private physicsPosition: Vector3;     // Where collision says we are
  private smoothingFactor: number = 0.15;
  
  // Toggle spectator mode
  setSpectator(enabled: boolean) {
    this.spectatorMode = enabled;
    if (enabled) {
      // Disable physics, enable noclip
      this.characterController?.setEnabled(false);
    } else {
      // Enable physics, snap to ground
      this.characterController?.setEnabled(true);
    }
  }
  
  update(deltaTime: number) {
    if (this.spectatorMode) {
      // FreeFly-style movement (existing code)
      this.updateSpectatorMovement(deltaTime);
    } else {
      // Physics-based movement
      this.updatePhysicsMovement(deltaTime);
    }
    
    // Viewport smoothing (ALWAYS, both modes)
    this.smoothViewport(deltaTime);
  }
  
  private smoothViewport(deltaTime: number) {
    // Interpolate render position toward physics position
    // This fixes stair jitter without affecting collision!
    this.renderPosition = Vector3.Lerp(
      this.renderPosition,
      this.physicsPosition,
      this.smoothingFactor
    );
    this.camera.position = this.renderPosition;
  }
}
```

### Console Commands

```bash
# Toggle spectator mode
spectator 0          # Physics mode (solid, gravity)
spectator 1          # Spectator mode (noclip, fly)
spectator            # Toggle

# Movement settings
cl_speed 300         # Movement speed
cl_jumpheight 270    # Jump velocity (Quake-style units)
cl_gravity 800       # Gravity strength

# Viewport smoothing
cl_smoothstairs 1    # Enable stair smoothing
cl_smoothfactor 0.15 # Smoothing interpolation factor
```

---

## Implementation Plan

### Phase 1: Viewport Smoothing (No Physics Change)

Fix stair jitter first without adding physics:

1. Add `renderPosition` separate from `physicsPosition` in FreeflyController
2. Lerp `renderPosition` toward actual position each frame
3. Camera renders at `renderPosition`, collision uses actual position
4. Test with existing BSP collision

### Phase 2: Unified FPS Camera

1. Create new `FPSController` class based on FreeflyController
2. Add `spectatorMode` toggle
3. Spectator mode = current FreeFly behavior exactly
4. Non-spectator mode = same for now (will add physics later)
5. Add `spectator` console command
6. Remove/deprecate old FPS camera code

### Phase 3: Havok Physics Integration

1. Install `@babylonjs/havok`
2. Create `PhysicsSystem` singleton to manage Havok
3. Initialize physics when BSP loads
4. Create BSP collision mesh for Havok (or use existing)

### Phase 4: Character Controller

1. Create `PhysicsCharacterController` for player
2. Implement ground detection, gravity, jumping
3. Wire up to FPS camera non-spectator mode
4. Add jump command (Space key)

### Phase 5: Polish

1. Tune movement feel (acceleration, friction)
2. Add crouch support
3. Add sprint support
4. Projectile physics (grenades, etc.)

---

## Stair Smoothing Deep Dive

### The Problem

When walking up stairs:
1. Collision detects step, snaps position up instantly
2. Camera position = collision position
3. Result: Jittery, snappy vertical movement

### The Solution: Decouple Render from Physics

```typescript
// Physics runs at fixed rate, snaps position
physicsPosition = CollisionManager.traceBox(...);

// Render interpolates smoothly
const heightDiff = physicsPosition.y - renderPosition.y;
if (Math.abs(heightDiff) < MAX_STEP_HEIGHT) {
  // Smooth small height changes (stairs)
  renderPosition.y = lerp(renderPosition.y, physicsPosition.y, smoothing);
} else {
  // Snap large changes (falling, teleporting)
  renderPosition.y = physicsPosition.y;
}

// Horizontal always matches physics (no smoothing needed)
renderPosition.x = physicsPosition.x;
renderPosition.z = physicsPosition.z;
```

### Key Insight

Physics collision MUST stay instant/accurate - we don't want the player to clip through geometry. Only the VIEWPORT (what you see) should be smoothed.

---

## BSP Collision with Havok

### Option A: Use Havok for Everything

Convert BSP brushes to Havok collision shapes:
- Generate mesh from BSP brushes
- Create `PhysicsAggregate` with mesh shape
- Let Havok handle all collision

**Pros:** Single physics system, consistent behavior
**Cons:** Need to convert BSP data, potential accuracy differences

### Option B: Hybrid Approach (Recommended)

- Use Havok for physics simulation (gravity, velocity, forces)
- Use BSP collision for actual collision detection
- Character controller queries BSP collision manually

```typescript
// Havok handles physics simulation
const desiredMove = characterController.getDesiredMovement();

// BSP collision validates the move
const result = CollisionManager.traceBox(start, start + desiredMove, ...);

// Apply validated position
characterController.setPosition(result.endPosition);
```

---

## Files to Create/Modify

### New Files
- `src/engine/physics/PhysicsSystem.ts` - Havok initialization
- `src/engine/camera/controllers/FPSController.ts` - Unified FPS camera
- `src/engine/console/commands/SpectatorCommand.ts` - spectator command

### Modified Files
- `src/engine/camera/CameraSystem.ts` - Register new FPS controller
- `src/engine/EngineScene.ts` - Initialize physics system
- `package.json` - Add @babylonjs/havok dependency

### Deprecated Files
- Old FPS camera code (identify and remove)

---

## Questions to Resolve

1. **BSP vs Havok collision?** - Hybrid recommended: Havok physics + BSP collision
2. **Bundle size concern?** - Havok adds ~2MB, acceptable for game
3. **Mobile support?** - WebAssembly SIMD needed (iOS 16.4+)
4. **Multiplayer sync?** - Physics should be deterministic for netcode

---

## References

- [Babylon.js Havok Plugin](https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin)
- [PhysicsCharacterController](https://doc.babylonjs.com/features/featuresDeepDive/physics/characterController)
- [Quake 3 Movement](https://www.youtube.com/watch?v=v3zT3Z5apaM) - Classic FPS movement reference
- Current `FreeflyController.ts` - Base for unified camera
