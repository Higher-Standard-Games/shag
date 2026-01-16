# Ledge Grabbing System Design

A system that allows players to automatically grab and pull themselves up onto ledges they almost miss.

## Overview

When a player is falling and hits a wall near a reachable ledge, they automatically grab the ledge. The player can then either pull themselves up (continue forward) or drop (turn away/move backward).

## Goals

1. **Forgiving** - Catch those "almost made it" jumps
2. **Intuitive** - Auto-grab, natural controls to release
3. **Smooth** - Animated transitions, not instant snaps
4. **Non-intrusive** - Should feel like a natural extension of movement
5. **Optional** - Controllable via cvar for competitive modes

## State Machine

```
                   hit ledge
    FALLING ──────────────────► GRABBING
                                    │
                    ┌───────────────┼───────────────┐
                    │ turn away     │ hold forward  │ timeout
                    ▼               ▼               ▼
               DROPPING       PULLING_UP        FALLING
                    │               │
                    ▼               ▼
               FALLING         GROUNDED
```

### States

| State | Duration | Player Control | Velocity |
|-------|----------|----------------|----------|
| FALLING | - | Normal | Normal gravity |
| GRABBING | 0.1s min, 2s max | Limited (release only) | Zeroed |
| PULLING_UP | ~0.35s | None (animation) | Scripted curve |
| DROPPING | Instant | Returns to FALLING | Preserved horizontal |
| GROUNDED | - | Normal | Normal |

## Detection Algorithm

### When to Check
- Player is **falling** (`velocity.y < -50`)
- Player is **facing/moving toward** a wall
- Player is **not grounded**

### Ledge Detection Traces

```
                    ┌─────┐
        HEAD ─────► │     │ ◄── Trace 2: Should be CLEAR
                    │█████│
       CHEST ─────► │█████│ ◄── Trace 1: Should be BLOCKED
                    │█████│
        FEET ─────► │█████│
                    └─────┘
                      Wall
```

**Trace 1 (Chest):**
- Origin: Player position + (0, chestHeight, 0)
- Direction: Forward (camera direction, flattened)
- Distance: `sv_ledge_reach` (default 24 units)
- Result: Should **HIT** solid wall

**Trace 2 (Head + Reach):**
- Origin: Player position + (0, headHeight + armReach, 0)
- Direction: Same as Trace 1
- Distance: Same as Trace 1
- Result: Should be **CLEAR** (no collision)

**If both conditions met → Ledge detected!**

### Height Constants (Quake-style units)

| Constant | Value | Description |
|----------|-------|-------------|
| chestHeight | 32 | Chest trace height |
| headHeight | 48 | Top of head |
| armReach | 16 | How high above head player can grab |
| maxGrabHeight | 64 | headHeight + armReach |

## Grabbing State

### Position Lock
When grabbing, player position is locked relative to the ledge:
- **X/Z**: At wall surface, offset by `sv_ledge_reach`
- **Y**: Calculated so hands are at ledge level

### Camera Adjustment
While grabbing, camera lowers to simulate hanging:
- **Offset**: -12 to -16 units (hanging from hands)
- **Transition**: Smooth lerp over 0.1s

### Input Handling
| Input | Action |
|-------|--------|
| Forward (W) or Jump | Begin PULLING_UP |
| Backward (S) | Release → DROPPING |
| Look away (>90° from wall) | Release → DROPPING |
| Timeout (2s) | Release → DROPPING |

## Pull-Up Animation

### Curve
The pull-up follows a smooth acceleration curve:
```typescript
// t goes from 0 to 1 over pullDuration
const curve = Easing.easeInOutQuad(t);

position.y = grabY + (targetY - grabY) * curve;
position.x = grabX + (targetX - grabX) * curve; // Move onto ledge
position.z = grabZ + (targetZ - grabZ) * curve;
```

### Parameters
| Parameter | Value | Description |
|-----------|-------|-------------|
| pullDuration | 0.35s | Time to complete pull-up |
| pullHeight | ~64 units | Total vertical distance |
| pullForward | ~32 units | How far onto the ledge |
| endVelocity | 100 u/s forward | Momentum after landing |

### Camera During Pull-Up
- Smooth rise following position
- Optional: Slight forward pitch (effort)
- Optional: Minor shake/strain effect

## Dropping

When player releases the grab:
1. Immediately exit GRABBING state
2. Restore camera offset
3. Return horizontal velocity (was preserved internally)
4. Apply small downward velocity kick (-50 u/s)
5. Enter FALLING state

## CVars

| Cvar | Default | Description |
|------|---------|-------------|
| `sv_ledgegrab` | 1 | Enable ledge grabbing (0/1) |
| `sv_ledge_reach` | 24 | Forward trace distance |
| `sv_ledge_height` | 64 | Max height above feet to detect |
| `sv_ledge_minfall` | -50 | Min downward velocity to trigger |
| `sv_ledge_timeout` | 2.0 | Max hang time before auto-drop |
| `sv_ledge_pulltime` | 0.35 | Pull-up animation duration |
| `cg_ledgecam` | 1 | Enable camera effects (0/1) |

## Viewport Effects Integration

Optional viewport effects during ledge grab:

### GrabStrainEffect (new effect)
- While GRABBING: Subtle camera shake (strain)
- Amplitude scales with hang time
- Removed when pulling up or dropping

### LedgePullEffect (new effect)
- During PULLING_UP: Forward camera pitch
- Smooth ease-in/ease-out matching animation curve

## Implementation Plan

### Phase 1: Core Detection
1. Add ledge grab state enum to FPSController
2. Implement trace-based ledge detection
3. Add basic GRABBING state (freeze position)
4. Add release detection (turn away)

### Phase 2: Animation
1. Implement pull-up curve animation
2. Add camera offset during grab
3. Smooth transitions in/out

### Phase 3: Polish
1. Add viewport effects (strain, pull)
2. Sound hooks for grab/pull/drop
3. Edge case handling (moving platforms, etc.)

## Integration Points

### FPSController.ts
- New state: `ledgeGrabState: 'none' | 'grabbing' | 'pulling' | 'dropping'`
- New members for grab position, timing, wall normal
- Detection in update() after movement, before ground check
- State-specific update logic

### CollisionManager
- Use existing trace() for ledge detection
- May need trace from arbitrary point (not just player position)

### ViewportEffectsManager
- New effects: GrabStrainEffect, LedgePullEffect
- Triggered by state changes from FPSController

## Edge Cases

1. **Moving platforms**: Re-check ledge validity each frame
2. **Sloped surfaces**: Reject if surface normal isn't vertical enough
3. **Thin walls**: Must have solid volume to grab
4. **Multiple ledges**: Prefer closest/lowest valid ledge
5. **Bunny hop landing**: Don't trigger if just landed (brief ground contact)
6. **Rapid grab/release**: Cooldown to prevent spam

## Reference Games

| Game | Style | Notes |
|------|-------|-------|
| Mirror's Edge | Auto-grab | Very forgiving, smooth animations |
| Dying Light | Auto-grab | Can grab edges, rails, anything |
| Titanfall 2 | Hold-to-grab | Preserves momentum direction |
| Prince of Persia | Auto-grab | Classic ledge mechanics |
| Assassin's Creed | Auto-grab | Context-sensitive surfaces |

## Future Enhancements

1. **Wall running** - Extend to lateral movement on walls
2. **Mantling** - Smaller obstacles, vault-over animation
3. **Climbing** - Multi-grab vertical surfaces
4. **Rope/chain grabbing** - Swinging physics
