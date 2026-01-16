# Wall Jump System Design

A system that allows players to jump off walls while airborne, gaining height and redirecting momentum.

## Overview

When a player is airborne, near a wall, and presses jump, they perform a wall jump - pushing off the wall to gain height and redirecting their velocity away from the wall. Unlike Warsow's `+special` bind, this uses the same jump button for simplicity.

## Goals

1. **Simple** - Same jump button, no extra binds
2. **Intuitive** - Works when you'd expect it to
3. **Safe** - Doesn't trigger on stairs or when grounded
4. **Satisfying** - Good "bounce" feel with velocity reflection
5. **Skillful** - Rewards good timing and positioning

## Detection Conditions

All of these must be true:

1. **Not grounded** - Must be in the air
2. **Pressing jump** - Jump key just pressed (not held from ground jump)
3. **Near a wall** - Trace forward/sideways hits wall within reach
4. **Above stair height** - At least 24 units above ground (prevents accidental triggers)
5. **Moving toward wall** - Velocity has component toward wall
6. **Cooldown expired** - Can't spam wall jumps (0.3s cooldown)

## Wall Detection

```
          Wall
           │
    ───────┼──────►  Trace 1: Forward (camera direction)
           │
     ╲     │     ╱
      ╲    │    ╱
       ╲   │   ╱     Traces 2-5: Diagonal/side traces
        ╲  │  ╱
         ╲ │ ╱
          ╲│╱
         Player
```

Check multiple directions to find walls:
1. Forward (camera direction, flattened)
2. Forward-left (45°)
3. Forward-right (45°)
4. Left (90°)
5. Right (90°)

Use the first wall hit. Store the wall normal for velocity reflection.

## Velocity Reflection

The key to good wall jumping is proper velocity reflection:

```
     Incoming        Wall        Outgoing
     velocity         │          velocity
         ↘            │            ↗
           ↘          │          ↗
             ↘        │        ↗
               ↘      │      ↗
                 ↘    │    ↗
                   ↘  │  ↗
                     ↘│↗
                      │
```

### Formula

```typescript
// Reflect horizontal velocity off wall
const incoming = velocity.clone();
const normal = wallNormal;  // Points away from wall

// Reflection formula: v' = v - 2(v·n)n
const dot = incoming.x * normal.x + incoming.z * normal.z;
const reflected = new Vector3(
  incoming.x - 2 * dot * normal.x,
  0,  // Y handled separately
  incoming.z - 2 * dot * normal.z
);

// Apply wall jump
velocity.x = reflected.x * bounceMultiplier;
velocity.z = reflected.z * bounceMultiplier;
velocity.y = wallJumpHeight;  // Fixed upward boost
```

### Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| bounceMultiplier | 0.8 | How much horizontal speed to preserve |
| wallJumpHeight | 280 | Upward velocity (same as normal jump) |
| minIncomingSpeed | 100 | Minimum speed toward wall to trigger |

## Height Above Ground Check

To prevent triggering on stairs:

```typescript
// Trace downward
const groundTrace = trace(position, position - (0, 24, 0));
if (groundTrace.fraction < 1.0) {
  return false;  // Too close to ground - might be stairs
}
```

The 24-unit threshold is slightly above max stair height (18), with buffer.

## Cooldown System

Prevent wall jump spam:

```typescript
private lastWallJumpTime: number = 0;
private wallJumpCooldown: number = 0.3;  // seconds

// In detection
if (currentTime - lastWallJumpTime < wallJumpCooldown) {
  return false;  // On cooldown
}

// After successful wall jump
lastWallJumpTime = currentTime;
```

## State Flow

```
                     ┌─────────────┐
                     │   FALLING   │
                     └──────┬──────┘
                            │ press jump + near wall
                            │ + above ground + cooldown ok
                            ▼
                     ┌─────────────┐
                     │  WALL JUMP  │ (instant)
                     └──────┬──────┘
                            │ reflect velocity
                            │ apply upward boost
                            ▼
                     ┌─────────────┐
                     │   FALLING   │ (new trajectory)
                     └─────────────┘
```

Wall jump is instant - no animation states needed (unlike ledge grab).

## CVars

| Cvar | Default | Description |
|------|---------|-------------|
| `sv_walljump` | 1 | Enable wall jumping (0/1) |
| `sv_walljump_height` | 280 | Upward velocity on wall jump |
| `sv_walljump_bounce` | 0.8 | Horizontal velocity preservation |
| `sv_walljump_reach` | 16 | Wall detection distance |
| `sv_walljump_cooldown` | 0.3 | Cooldown between wall jumps |
| `sv_walljump_minheight` | 24 | Min height above ground |

## Viewport Effects

Optional camera effects during wall jump:

### WallJumpEffect (new effect)
- Quick camera roll toward wall normal (kick away feel)
- Small FOV punch
- Very brief (~0.1s)

## Implementation Plan

### Phase 1: Core Detection
1. Add wall jump cvars to MovementVars
2. Add cooldown tracking to FPSController
3. Implement wall detection (multi-direction traces)
4. Add height-above-ground check

### Phase 2: Execution
1. Implement velocity reflection
2. Apply upward boost
3. Trigger on jump key while conditions met
4. Add cooldown after successful jump

### Phase 3: Polish
1. Add viewport effect (optional)
2. Sound hook for wall jump
3. Particle/effect hook

## Integration Points

### FPSController.ts
- In jump handling section, before normal jump:
  ```typescript
  if (this.keys.up && !this.isGrounded && !this.jumpConsumed) {
    if (this.canWallJump(cm, mv)) {
      this.executeWallJump(mv);
      this.jumpConsumed = true;  // Prevent repeat
      return;  // Don't do normal jump
    }
  }
  ```

### Jump Key Handling
- Only trigger wall jump on fresh press (not held)
- Use `jumpConsumed` flag to prevent multiple triggers

## Edge Cases

1. **Corner walls** - Pick wall with best normal (most perpendicular to velocity)
2. **Moving parallel to wall** - Require minimum approach angle
3. **Very fast approach** - Cap outgoing velocity to prevent exploits
4. **Stacked wall jumps** - Cooldown prevents infinite climbing

## Reference Games

| Game | Style | Notes |
|------|-------|-------|
| Warsow | +special bind | Original, requires separate button |
| Titanfall 2 | Auto on jump | Very forgiving, multiple jumps |
| Super Meat Boy | Auto on jump | Precise, tight cooldown |
| Mirror's Edge | Context | Only on runnable walls |
| Celeste | Auto | Stamina limited |

## Comparison with Ledge Grab

| Feature | Ledge Grab | Wall Jump |
|---------|------------|-----------|
| Trigger | Auto (falling + forward) | Jump button |
| Duration | 0.35s+ animation | Instant |
| Direction | Up and forward | Away from wall |
| Height gain | Onto ledge | Fixed boost |
| Velocity | Zeroed then restored | Reflected |
| Cooldown | None | 0.3s |

## Future Enhancements

1. **Wall run** - Extend to lateral movement on walls
2. **Chain jumps** - Reduced cooldown for skilled chains
3. **Wall slide** - Slow fall when against wall
4. **Double wall jump** - Jump between parallel walls
