# Q3/Warsow Movement Techniques Matrix

This document tracks the implementation status and roadmap for Quake 3 and Warsow-style movement physics in the SHAG Engine.

> **STATUS: ✅ IMPLEMENTED** (v0.8.19)
> 
> Warsow-style movement physics fully implemented based on `gs_pmove.c` source code analysis.

## Current FPS Implementation Status
- [x] Basic WASD movement
- [x] Gravity + falling
- [x] Jumping (Space)
- [x] Ground detection (probe-based)
- [x] Stair stepping (stepSlideMove)
- [x] Viewport smoothing
- [x] Eye offset (sv_eyeoffset)
- [x] Sprint (Shift key, sv_runSpeed)
- [x] **Ground Friction** - Q3-style PM_Friction with sv_stopspeed
- [x] **Ground Acceleration** - PM_Accelerate toward wishdir
- [x] **Air Control** - Warsow 3-mode system (forward bunny, strafe bunny, standard)
- [x] **Auto-bunny hop** - sv_autohop cvar, Warsow-style
- [x] **Strafe jumping** - Speed gain via perpendicular acceleration
- [x] **Jetpack bug fix** - Ground only when velocity.y ≤ 0

---

## Q3 Movement Physics: Core Algorithms

The following algorithms need to be implemented to achieve authentic Q3 movement feel.

### PM_Friction (Ground Deceleration)

When on ground and not pressing movement keys, apply friction to slow down:

```typescript
function applyFriction(velocity: Vector3, friction: number, deltaTime: number): Vector3 {
  const speed = velocity.length();
  if (speed < 1) {
    velocity.x = 0;
    velocity.z = 0;
    return velocity;
  }
  
  // Calculate drop based on friction
  const control = speed < sv_stopspeed ? sv_stopspeed : speed;
  const drop = control * friction * deltaTime;
  
  // Scale velocity
  let newSpeed = speed - drop;
  if (newSpeed < 0) newSpeed = 0;
  
  return velocity.scale(newSpeed / speed);
}
```

**Variables:**
- `sv_friction` = 6.0 (already exists!)
- `sv_stopspeed` = 100 (new - speed below which we use stopspeed for friction calc)

### PM_Accelerate (Ground Acceleration)

When pressing movement keys, accelerate toward wish direction:

```typescript
function accelerate(
  velocity: Vector3, 
  wishdir: Vector3, 
  wishspeed: number, 
  accel: number, 
  deltaTime: number
): Vector3 {
  // Current speed in wish direction
  const currentspeed = Vector3.Dot(velocity, wishdir);
  
  // How much speed we can add
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return velocity;
  
  // Calculate acceleration amount
  let accelspeed = accel * deltaTime * wishspeed;
  if (accelspeed > addspeed) accelspeed = addspeed;
  
  // Add to velocity
  return velocity.add(wishdir.scale(accelspeed));
}
```

**Variables:**
- `sv_accelerate` = 10.0 (new - ground acceleration rate)

### PM_AirMove (Air Control)

In air, very limited movement influence:

```typescript
function airMove(
  velocity: Vector3,
  wishdir: Vector3,
  wishspeed: number,
  deltaTime: number
): Vector3 {
  // Clamp wishspeed for air (can't go faster than max air speed)
  const airWishspeed = Math.min(wishspeed, sv_maxairspeed);
  
  // Apply air acceleration (much lower than ground)
  return accelerate(velocity, wishdir, airWishspeed, sv_airaccelerate, deltaTime);
}
```

**Variables:**
- `sv_airaccelerate` = 1.0 (already exists, but not used!)
- `sv_maxairspeed` = 30 (new - max speed for air steering input)

---

## Implementation Plan: Phase 1 - Core Ground Movement

### Step 1: Add New Movement Variables

Add to `MovementVars.ts`:
```typescript
sv_accelerate: 10.0,    // Ground acceleration
sv_stopspeed: 100,      // Friction control threshold
sv_maxairspeed: 30,     // Max air input speed
```

### Step 2: Refactor FPSController.update()

Change from instant movement to velocity-based:

**Before (current):**
```typescript
const movement = Vector3.Zero();
if (this.keys.forward) movement.addInPlace(flatForward.scale(speed));
// ... directly add to position
```

**After (Q3-style):**
```typescript
// Calculate wishdir and wishspeed from input
const wishdir = this.getWishDir(); // Unit vector of desired direction
const wishspeed = this.keys.sprint ? sv_runSpeed : sv_movementSpeed;

if (this.isGrounded) {
  // Apply friction first
  this.velocity = applyFriction(this.velocity, sv_friction, deltaTime);
  // Then accelerate toward wishdir
  this.velocity = accelerate(this.velocity, wishdir, wishspeed, sv_accelerate, deltaTime);
} else {
  // Air movement - much less control
  this.velocity = airMove(this.velocity, wishdir, wishspeed, deltaTime);
}

// Gravity (already have this)
if (!this.isGrounded) {
  this.velocity.y -= sv_gravity * deltaTime;
}

// Apply velocity to position
const movement = this.velocity.scale(deltaTime);
// ... collision as before
```

### Step 3: Persist Horizontal Velocity

Currently we don't persist horizontal velocity between frames. Need to:
1. Store `velocity` as a class member (already exists but only used for Y)
2. Use velocity.x/z for horizontal movement
3. Only reset velocity on landing/stopping

---

## Movement Techniques Implementation Status

| Technique | Priority | Complexity | Status |
|-----------|----------|------------|--------|
| **Ground Friction** | 🔴 High | Low | ✅ Implemented |
| **Ground Acceleration** | 🔴 High | Low | ✅ Implemented |
| **Air Control** | 🔴 High | Low | ✅ Implemented (3-mode Warsow) |
| **Strafe Jumping** | 🟡 Medium | Medium | ✅ Implemented |
| **Bunny Hopping** | 🟡 Medium | Low | ✅ Implemented (sv_autohop) |
| **Circle Jumping** | 🟠 Low | Medium | Not started |
| **Crouching** | 🟠 Low | Medium | Not started |

---

## Physics Variables Summary

| Variable | Default | Description | Status |
|----------|---------|-------------|--------|
| `sv_gravity` | 800 | Gravity strength | ✅ Used |
| `sv_jumpheight` | 270 | Jump velocity | ✅ Used |
| `sv_friction` | 8.0 | Ground friction (Warsow: 8) | ✅ Used |
| `sv_accelerate` | 12.0 | Ground acceleration (Warsow: 12) | ✅ Used |
| `sv_airaccelerate` | 1.0 | Air acceleration | ✅ Used |
| `sv_stopspeed` | 100 | Friction threshold | ✅ Used |
| `sv_maxairspeed` | 30 | Max air input speed (strafe cap) | ✅ Used |
| `sv_movementSpeed` | 320 | Base walk speed | ✅ Used |
| `sv_runSpeed` | 480 | Sprint speed | ✅ Used |
| `sv_autohop` | 1 | Auto-bunny hop on hold jump | ✅ Used |
| `sv_aircontrol` | 150 | Air control multiplier (Warsow) | ✅ Used |
| `m_sensitivity` | 2.0 | Mouse sensitivity (float) | ✅ Used |

---

## References
- [Warsow Source: gs_pmove.c](https://github.com/Qfusion/qfusion/blob/warsow_2.1/source/gameshared/gs_pmove.c) - **Primary reference for this implementation**
- [Quake 3 Source: bg_pmove.c](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c)
- [Q3 Movement Paper by myria666](https://github.com/myria666/qern/blob/main/docs/quake3_player_movement.pdf)
- [Air Strafing Explained](https://www.niklewski.com/post/quake-3-air-strafing)
