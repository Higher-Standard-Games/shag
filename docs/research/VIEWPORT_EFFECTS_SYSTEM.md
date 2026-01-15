# Viewport Effects System Design

A modular, event-driven system for camera/viewport effects that enhance player immersion.

## Implementation Status (2026-01-15)

✅ **Phase 1 + 2 Complete** - Core system and all movement-based effects implemented and integrated into FPSController.

| Component | Status | Location |
|-----------|--------|----------|
| ViewportEffectsManager | ✅ Done | `src/engine/viewport/ViewportEffectsManager.ts` |
| ViewportEffect interface | ✅ Done | `src/engine/viewport/ViewportEffect.ts` |
| ViewportDelta | ✅ Done | `src/engine/viewport/ViewportDelta.ts` |
| PlayerState | ✅ Done | `src/engine/viewport/PlayerState.ts` |
| Easing library | ✅ Done | `src/engine/viewport/Easing.ts` |
| FPSApplicator | ✅ Done | `src/engine/viewport/applicators/FPSApplicator.ts` |
| WalkBobEffect | ✅ Done | `src/engine/viewport/effects/WalkBobEffect.ts` |
| LandingImpactEffect | ✅ Done | `src/engine/viewport/effects/LandingImpactEffect.ts` |
| StrafeLeanEffect | ✅ Done | `src/engine/viewport/effects/StrafeLeanEffect.ts` |
| SpeedFOVEffect | ✅ Done | `src/engine/viewport/effects/SpeedFOVEffect.ts` |
| IdleBreathingEffect | ✅ Done | `src/engine/viewport/effects/IdleBreathingEffect.ts` |
| FPSController integration | ✅ Done | `src/engine/camera/controllers/FPSController.ts` |

**Remaining (Phase 3+):**
- DamageShakeEffect (needs combat system)
- RecoilEffect (needs weapon system)
- Server-triggered effects
- IsometricApplicator, ThirdPersonApplicator

### Bug Fixes Applied

**🔴 "Barrel Roll" Bug (2026-01-15):**  
Rotation offsets were accumulating infinitely because camera rotation persists across frames.
- **Root cause**: Effects output absolute offsets, but `FPSApplicator` added them to existing rotation
- **Symptom**: Moving mouse caused camera to spin wildly (roll accumulation)
- **Fix**: FPSController now stores mouse rotation separately and resets camera rotation before applying effects

**🔴 "Drunken Sailor" Bug (2026-01-15):**
Position offsets from walk bob were feeding back into physics calculations.
- **Root cause**: Only Y position was reset before physics; X/Z kept viewport offsets
- **Symptom**: Walking forward caused lateral drift (like being drunk!)
- **Fix**: Store and reset full physics position (X, Y, Z) before physics, save after collision

**🟡 Pitch Drift in IdleBreathingEffect:**
- Removed pitch output from IdleBreathingEffect - position-only is sufficient and safer

**🟢 IdleBreathingEffect Tuning:**
- Reduced amplitude from 0.3 to 0.05 (6x smaller)
- Reduced frequency from 1.5 to 0.8 (slower, more natural)
- Reduced horizontal sway to near-zero (breathing is vertical)
- Enabled by default for testing (cg_idle 1), can be disabled for competitive

**🟢 Enhanced WalkBobEffect (2026-01-15):**
- Increased default amplitude for visibility (0.5 → 1.5)
- **Forward lean when sprinting** - camera pitches down slightly like a cheetah running
- Speed-matched frequency - footstep cadence scales with movement speed
- Horizontal sway intensifies when running for realistic motion
- Smooth interpolated transitions when starting/stopping

---

## ⚠️ Critical Design Guidelines

### 1. Rotation vs Position Offsets

| Type | Camera State | Effect Behavior | Safe? |
|------|--------------|-----------------|-------|
| **Position** | Reset by physics each frame | Absolute offset OK | ✅ Safe |
| **FOV** | Set directly `=` not `+=` | Multiplier OK | ✅ Safe |
| **Rotation (Roll)** | Not user-controlled in FPS | Absolute offset OK after reset | ✅ Safe with reset |
| **Rotation (Pitch/Yaw)** | User-controlled via mouse | ⚠️ DANGEROUS - accumulates! | ❌ Avoid |

### 2. The "Accumulation Problem"

Effects output **absolute** offsets (e.g., "lean 1.5° right"). If the applicator **adds** these to camera state that **persists**, offsets accumulate each frame:

```
Frame 1: camera.roll = 0 + 1.5 = 1.5°
Frame 2: camera.roll = 1.5 + 1.5 = 3.0°
Frame 3: camera.roll = 3.0 + 1.5 = 4.5°
...
Frame 60: camera.roll = 90° (BARREL ROLL!)
```

### 3. Solution Pattern: "Reset Before Apply"

The controller stores the "base" camera state (mouse-controlled rotation) separately, then resets camera to base before applying effects each frame:

```typescript
// FPSController.update() - before applying viewport effects:
this.camera.rotation.x = this.mouseRotationX;  // Reset pitch to mouse value
this.camera.rotation.y = this.mouseRotationY;  // Reset yaw to mouse value  
this.camera.rotation.z = 0;                     // Roll is never user-controlled

// NOW apply effects (they add on top of clean base)
this.viewportApplicator.apply(delta, this.camera, this.baseFOV);
```

### 4. Effect Author Guidelines

When creating new effects:

1. **Position offsets**: Safe ONLY if controller properly isolates physics position
2. **FOV multiplier**: Always safe, directly set each frame
3. **Roll rotation**: Safe if controller resets roll to 0 before effects
4. **Pitch/Yaw rotation**: **AVOID** - these are user-controlled and will drift
5. **If pitch/yaw needed**: Consider making effect triggered (not continuous) with auto-decay

### 5. The "Drunken Sailor" Bug (Position Accumulation)

**🔴 Bug discovered (2026-01-15):**
Horizontal position offsets (walk bob sway) were feeding back into physics!

**Symptom:** Player drifts sideways when walking forward - like a drunken sailor.

**Root cause:** We only reset Y position before physics, but X and Z kept viewport offsets:
```typescript
// BUG: Only Y was reset
this.camera.position.y = this.physicsY;
// X and Z still have last frame's bob offset!
```

**Fix:** Store and reset ALL physics coordinates:
```typescript
// Before physics calculations:
this.camera.position.x = this.physicsX;
this.camera.position.y = this.physicsY;
this.camera.position.z = this.physicsZ;

// After physics/collision:
this.physicsX = this.camera.position.x;
this.physicsY = this.camera.position.y;
this.physicsZ = this.camera.position.z;

// Then apply effects (visual only)
this.viewportApplicator.apply(delta, this.camera, this.baseFOV);
```

**Lesson:** Viewport effects must be **purely visual**. Physics must use isolated values.

---

## Goals

1. **Modular** - Each effect is self-contained and can be enabled/disabled independently
2. **Stackable** - Multiple effects combine additively (bob + landing + shake)
3. **Event-Driven** - Effects can be triggered by game events, server messages, scripts
4. **Configurable** - All parameters exposed as cvars for player preference
5. **Performant** - Lightweight per-frame calculations, no allocations
6. **Extensible** - Easy to add new effects without modifying core system
7. **Camera-Agnostic** - Works with FPS, Isometric, ThirdPerson, and other camera types

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ViewportEffects System                        │
├─────────────────────────────────────────────────────────────────┤
│  Event Sources              │  Effect Processors                 │
│  ─────────────────          │  ─────────────────────             │
│  • PlayerState (velocity,   │  • WalkBobEffect                   │
│    grounded, jumping)       │  • LandingImpactEffect             │
│  • Server Events            │  • StrafeLeanEffect                │
│  • GameType Scripts         │  • SpeedFOVEffect                  │
│  • Damage/Hit Events        │  • DamageShakeEffect               │
│  • Weapon Fire              │  • IdleBreathingEffect             │
│  • Environment (explosions) │  • RecoilEffect                    │
├─────────────────────────────────────────────────────────────────┤
│                    ViewportEffectsManager                        │
│  ─────────────────────────────────────────────────────────────  │
│  • Registers effect processors                                   │
│  • Receives events via EventBus                                  │
│  • Calls update() on each active effect                          │
│  • Aggregates ViewportDelta from all effects                     │
│  • Passes delta to Camera Applicator                             │
├─────────────────────────────────────────────────────────────────┤
│                    ViewportDelta (output)                        │
│  ─────────────────────────────────────────────────────────────  │
│  • positionOffset: Vector3 (x, y, z displacement)                │
│  • rotationOffset: Vector3 (pitch, yaw, roll)                    │
│  • fovMultiplier: number (1.0 = no change)                       │
├─────────────────────────────────────────────────────────────────┤
│                    Camera Applicators                            │
│  ─────────────────────────────────────────────────────────────  │
│  • FPSApplicator     - Direct camera offset/rotation             │
│  • IsometricApplicator - Target point offset, zoom               │
│  • ThirdPersonApplicator - Orbit offset, distance                │
│  • FreeflyApplicator - Direct with different axes                │
└─────────────────────────────────────────────────────────────────┘
```

### Camera-Agnostic Design

Effects output a generic `ViewportDelta`, which is then interpreted by camera-specific **Applicators**:

| Camera Type | Position Offset | Rotation Offset | FOV |
|-------------|-----------------|-----------------|-----|
| **FPS** | Direct camera translation | Direct pitch/yaw/roll | Direct FOV change |
| **Isometric** | Target point offset | Limited (maybe roll only) | Orthographic zoom |
| **ThirdPerson** | Orbit pivot offset | Pitch/yaw orbit, roll tilt | FOV or distance |
| **Freefly** | Direct translation | Direct rotation | Direct FOV |

This separation means:
- Effects don't need to know which camera type is active
- Same landing impact works in FPS (camera dip) and Isometric (target dip)
- Easy to add new camera types without touching effect code

---

## Effect Categories

### 1. Continuous Effects (Movement-Based)

These run every frame based on player movement state.

#### 1.1 Walk/Run Bobbing (`WalkBobEffect`)

Classic Q3-style view bob while moving on ground.

**Behavior:**
- Vertical sine wave (up/down) synced to footstep cycle
- Horizontal sway (left/right) offset by 90° phase
- Amplitude scales with movement speed
- Disabled when airborne or standing still

**Math:**
```typescript
// Bob cycle based on distance traveled
bobCycle += horizontalSpeed * deltaTime * cg_bobfrequency;

// Vertical bob (primary)
offsetY = sin(bobCycle) * cg_bobamplitude * speedFactor;

// Horizontal sway (secondary, phase offset)
offsetX = sin(bobCycle + PI/2) * cg_bobamplitude * 0.5 * speedFactor;

// Optional: subtle roll
roll = sin(bobCycle) * cg_bobroll * speedFactor;
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_bob` | 1 | 0-1 | Enable view bobbing |
| `cg_bobamplitude` | 0.5 | 0-2 | Vertical bob strength (units) |
| `cg_bobfrequency` | 0.01 | 0.005-0.02 | Bob cycle speed |
| `cg_bobroll` | 0.2 | 0-1 | Roll tilt during bob (degrees) |

---

#### 1.2 Strafe Lean (`StrafeLeanEffect`)

Camera tilts into strafe direction for "leaning into turns" feel.

**Behavior:**
- Roll camera toward strafe direction
- Smooth interpolation (not instant)
- Scales with strafe input, not speed

**Math:**
```typescript
// Target lean based on strafe input (-1 to 1)
targetLean = strafeInput * cg_strafetilt;

// Smooth interpolation
currentLean = lerp(currentLean, targetLean, deltaTime * cg_strafetiltspeed);

// Apply as roll
roll = currentLean;
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_strafetilt` | 1.5 | 0-5 | Max strafe lean (degrees) |
| `cg_strafetiltspeed` | 8 | 1-20 | Lean interpolation speed |

---

#### 1.3 Speed FOV (`SpeedFOVEffect`)

FOV widens at high speeds for sense of velocity.

**Behavior:**
- FOV increases proportionally above base speed
- Smooth interpolation to avoid jarring changes
- Caps at maximum FOV increase

**Math:**
```typescript
// Speed above threshold triggers FOV increase
speedRatio = (currentSpeed - baseSpeed) / (maxSpeed - baseSpeed);
speedRatio = clamp(speedRatio, 0, 1);

// Target FOV multiplier
targetFOV = 1.0 + speedRatio * cg_speedfov;

// Smooth interpolation
currentFOV = lerp(currentFOV, targetFOV, deltaTime * cg_speedfovspeed);
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_speedfov` | 0.15 | 0-0.5 | Max FOV increase (multiplier) |
| `cg_speedfovspeed` | 5 | 1-15 | FOV interpolation speed |

---

#### 1.4 Idle Breathing (`IdleBreathingEffect`)

Subtle camera movement when standing still.

**Behavior:**
- Very slow, small amplitude sine wave
- Only active when velocity near zero
- Fades in/out smoothly

**Math:**
```typescript
// Breathing cycle (slow)
breathCycle += deltaTime * cg_idlefrequency;

// Only when nearly still
idleFactor = 1.0 - clamp(speed / 50, 0, 1);

offsetY = sin(breathCycle) * cg_idleamplitude * idleFactor;
offsetX = sin(breathCycle * 0.7) * cg_idleamplitude * 0.3 * idleFactor;
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_idle` | 1 | 0-1 | Enable idle breathing |
| `cg_idleamplitude` | 0.3 | 0-1 | Breathing amplitude |
| `cg_idlefrequency` | 1.5 | 0.5-3 | Breathing speed |

---

### 2. Triggered Effects (Event-Based)

These are triggered by discrete events and play out over time.

#### 2.1 Landing Impact (`LandingImpactEffect`)

Camera dips on landing, proportional to fall distance.

**Behavior:**
- Triggered when `wasGrounded=false` → `isGrounded=true`
- Impact strength based on vertical velocity at landing
- Quick ease-out down, slower spring back up
- Optional FOV pulse on hard landings

**Math:**
```typescript
// On landing trigger:
impactStrength = clamp(abs(fallVelocity) / 800, 0, 1);
impactOffset = impactStrength * cg_landingamplitude;
impactPhase = 0;

// Each frame while active:
impactPhase += deltaTime * cg_landingspeed;

if (impactPhase < 0.3) {
  // Quick drop (ease-out)
  t = impactPhase / 0.3;
  offsetY = -impactOffset * easeOutQuad(t);
} else if (impactPhase < 1.0) {
  // Slow recovery (ease-in-out)
  t = (impactPhase - 0.3) / 0.7;
  offsetY = -impactOffset * (1 - easeInOutQuad(t));
} else {
  // Done
  impactOffset = 0;
}
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_landing` | 1 | 0-1 | Enable landing effect |
| `cg_landingamplitude` | 8 | 0-20 | Max landing dip (units) |
| `cg_landingspeed` | 4 | 1-10 | Landing animation speed |
| `cg_landingfov` | 0 | 0-1 | FOV pulse on hard landing |

---

#### 2.2 Jump Anticipation (`JumpAnticipationEffect`)

Slight crouch before leaving ground.

**Behavior:**
- Triggered on jump input (before leaving ground)
- Quick small dip that completes as player leaves ground
- Very subtle, adds "weight" to jumping

**Math:**
```typescript
// On jump trigger (before airborne):
jumpPhase = 0;

// Each frame while grounded and phase < 1:
jumpPhase += deltaTime * cg_jumpanticspeed;
t = clamp(jumpPhase, 0, 1);
offsetY = -cg_jumpanticamplitude * sin(t * PI);
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_jumpantic` | 0 | 0-1 | Enable jump anticipation |
| `cg_jumpanticamplitude` | 1 | 0-3 | Anticipation dip amount |
| `cg_jumpanticspeed` | 15 | 5-30 | Anticipation speed |

---

#### 2.3 Damage Shake (`DamageShakeEffect`)

Screen shake when taking damage.

**Behavior:**
- Triggered by damage events
- Intensity based on damage amount
- Rapid random offsets with decay
- Direction can bias toward damage source

**Math:**
```typescript
// On damage trigger:
shakeIntensity = clamp(damage / 50, 0.2, 1.0) * cg_shakescale;
shakeDuration = cg_shakeduration;
shakeTime = 0;

// Each frame while active:
shakeTime += deltaTime;
decay = 1 - (shakeTime / shakeDuration);
decay = max(0, decay * decay); // Quadratic falloff

// Random offsets
offsetX = (random() - 0.5) * shakeIntensity * decay * cg_shakeamplitude;
offsetY = (random() - 0.5) * shakeIntensity * decay * cg_shakeamplitude;
roll = (random() - 0.5) * shakeIntensity * decay * cg_shakeroll;
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_shake` | 1 | 0-1 | Enable damage shake |
| `cg_shakeamplitude` | 3 | 0-10 | Shake offset amount |
| `cg_shakeroll` | 2 | 0-5 | Shake roll amount |
| `cg_shakeduration` | 0.3 | 0.1-1 | Shake duration (seconds) |
| `cg_shakescale` | 1 | 0-2 | Overall shake intensity scale |

---

#### 2.4 Weapon Recoil (`RecoilEffect`)

View kicks up/back when firing.

**Behavior:**
- Triggered by weapon fire events
- Quick kick up, slow recovery
- Amount based on weapon type
- Can include slight random spread

**Math:**
```typescript
// On fire trigger:
recoilPitch = weaponRecoil * cg_recoilscale;
recoilPhase = 0;

// Each frame:
recoilPhase += deltaTime * cg_recoilspeed;

if (recoilPhase < 0.15) {
  // Quick kick
  t = recoilPhase / 0.15;
  pitch = recoilPitch * easeOutQuad(t);
} else if (recoilPhase < 1.0) {
  // Slow recovery
  t = (recoilPhase - 0.15) / 0.85;
  pitch = recoilPitch * (1 - easeInQuad(t));
} else {
  pitch = 0;
}
```

**Cvars:**
| Cvar | Default | Range | Description |
|------|---------|-------|-------------|
| `cg_recoil` | 1 | 0-1 | Enable weapon recoil |
| `cg_recoilscale` | 1 | 0-2 | Recoil intensity scale |
| `cg_recoilspeed` | 8 | 2-15 | Recoil animation speed |

---

### 3. Server-Triggered Effects

These can be triggered remotely by server events for game-specific effects.

#### 3.1 Event Protocol

Server can send viewport effect commands via game events:

```typescript
// EventBus events that ViewportEffectsManager listens for:
EventBus.emit('viewport:shake', { intensity: 0.8, duration: 0.5 });
EventBus.emit('viewport:punch', { pitch: -5, yaw: 2, duration: 0.3 });
EventBus.emit('viewport:zoom', { fov: 0.7, duration: 0.5, easing: 'easeInOut' });
EventBus.emit('viewport:roll', { angle: 15, duration: 1.0 });
EventBus.emit('viewport:blur', { amount: 0.5, duration: 0.3 }); // Future: post-process
```

#### 3.2 Use Cases

- **Explosions**: `viewport:shake` with intensity based on distance
- **Rocket Jump**: `viewport:punch` downward + `viewport:shake`
- **Zoom Weapons**: `viewport:zoom` on right-click
- **Death Cam**: `viewport:roll` + fade to black
- **Stun Effect**: `viewport:shake` sustained + `viewport:blur`
- **Speed Boost Pickup**: Quick FOV pulse
- **Teleporter**: `viewport:zoom` in then out

---

## Implementation

### Core Types

```typescript
interface ViewportDelta {
  positionOffset: Vector3;  // Camera position adjustment
  rotationOffset: Vector3;  // Pitch, Yaw, Roll adjustment (degrees)
  fovMultiplier: number;    // FOV scale (1.0 = no change)
}

interface PlayerState {
  position: Vector3;
  velocity: Vector3;
  horizontalSpeed: number;
  isGrounded: boolean;
  wasGroundedLastFrame: boolean;
  isJumping: boolean;
  strafeInput: number;      // -1 (left) to 1 (right)
  forwardInput: number;     // -1 (back) to 1 (forward)
}

interface ViewportEffect {
  name: string;
  enabled: boolean;

  // Called every frame
  update(deltaTime: number, state: PlayerState): ViewportDelta;

  // Called to trigger event-based effects
  trigger?(event: string, data: any): void;

  // Reset effect state
  reset(): void;
}

// Camera-specific applicator interface
interface ViewportApplicator {
  apply(delta: ViewportDelta, camera: Camera): void;
  reset(camera: Camera): void;
}
```

### Easing Library

Standard easing functions for smooth animations:

```typescript
type EasingFunction = (t: number) => number;

const Easing = {
  // Linear
  linear: (t: number) => t,

  // Quadratic
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  // Cubic
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // Elastic (for bouncy effects)
  easeOutElastic: (t: number) => Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1,

  // Back (overshoot)
  easeOutBack: (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
```

Used in effects like LandingImpact:
- **Drop phase**: `easeOutQuad` - fast deceleration into the dip
- **Recovery phase**: `easeInOutQuad` - smooth spring back to neutral

### Effect Curves (Future)

For complex multi-phase animations, keyframe-based curves:

```typescript
interface EffectKeyframe {
  time: number;       // 0.0 to 1.0 normalized time
  value: number;      // Target value at this keyframe
  easing: string;     // Easing function name to next keyframe
}

interface EffectCurve {
  keyframes: EffectKeyframe[];
  evaluate(t: number): number;  // Get value at normalized time
}

// Example: Landing impact curve
const landingCurve: EffectCurve = {
  keyframes: [
    { time: 0.0, value: 0, easing: 'easeOutQuad' },    // Start at neutral
    { time: 0.3, value: -1, easing: 'easeInOutQuad' }, // Quick drop to max
    { time: 1.0, value: 0, easing: 'linear' },         // Slow recovery
  ]
};
```

**Questions for later:**
- Should curves be defined in code or loaded from JSON/config?
- Do we need multi-channel curves (position + rotation + FOV)?
- Visual curve editor tool?

### ViewportEffectsManager

```typescript
class ViewportEffectsManager {
  private effects: Map<string, ViewportEffect> = new Map();
  private basePosition: Vector3;
  private baseRotation: Vector3;
  private baseFOV: number;

  registerEffect(effect: ViewportEffect): void;
  unregisterEffect(name: string): void;

  // Called every frame from FPSController
  update(deltaTime: number, state: PlayerState): ViewportDelta {
    const combined: ViewportDelta = {
      positionOffset: Vector3.Zero(),
      rotationOffset: Vector3.Zero(),
      fovMultiplier: 1.0,
    };

    for (const effect of this.effects.values()) {
      if (!effect.enabled) continue;

      const delta = effect.update(deltaTime, state);
      combined.positionOffset.addInPlace(delta.positionOffset);
      combined.rotationOffset.addInPlace(delta.rotationOffset);
      combined.fovMultiplier *= delta.fovMultiplier;
    }

    return combined;
  }

  // Handle event-triggered effects
  trigger(event: string, data: any): void {
    for (const effect of this.effects.values()) {
      effect.trigger?.(event, data);
    }
  }
}
```

### Integration with FPSController

```typescript
// In FPSController.update():

// 1. Run physics, get final camera position
const physicsPosition = this.camera.position.clone();
const physicsRotation = this.camera.rotation.clone();

// 2. Build player state for effects
const playerState: PlayerState = {
  position: physicsPosition,
  velocity: this.velocity,
  horizontalSpeed: Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2),
  isGrounded: this.isGrounded,
  wasGroundedLastFrame: this.wasGroundedLastFrame,
  isJumping: this.keys.up && this.isGrounded,
  strafeInput: (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0),
  forwardInput: (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0),
};

// 3. Get viewport effects delta
const viewDelta = this.viewportEffects.update(deltaTime, playerState);

// 4. Apply effects to camera (additive, doesn't affect physics)
this.camera.position.addInPlace(viewDelta.positionOffset);
this.camera.rotation.x += viewDelta.rotationOffset.x * DEG2RAD;
this.camera.rotation.y += viewDelta.rotationOffset.y * DEG2RAD;
this.camera.rotation.z += viewDelta.rotationOffset.z * DEG2RAD;
this.camera.fov = this.baseFOV * viewDelta.fovMultiplier;
```

---

## File Structure

```
src/engine/viewport/
├── ViewportEffectsManager.ts    # Core manager
├── ViewportEffect.ts            # Base interface/types
├── ViewportDelta.ts             # Delta type + helpers
├── Easing.ts                    # Easing function library
├── applicators/
│   ├── ViewportApplicator.ts    # Base interface
│   ├── FPSApplicator.ts         # FPS camera implementation
│   └── (future: IsometricApplicator.ts, etc.)
├── effects/
│   ├── WalkBobEffect.ts         # Phase 1: Core
│   ├── LandingImpactEffect.ts   # Phase 1: Core
│   ├── StrafeLeanEffect.ts      # Phase 2: Movement feel
│   ├── SpeedFOVEffect.ts        # Phase 2
│   ├── IdleBreathingEffect.ts   # Phase 2
│   ├── DamageShakeEffect.ts     # Phase 3: Events
│   ├── RecoilEffect.ts          # Phase 3
│   └── ServerTriggeredEffect.ts # Phase 3: Handles viewport:* events
└── index.ts                     # Exports
```

---

## Implementation Priority

### Phase 1: Core + Essential Effects
1. ViewportEffectsManager infrastructure
2. WalkBobEffect (most requested)
3. LandingImpactEffect (classic feel)
4. Basic cvars

### Phase 2: Movement Feel
5. StrafeLeanEffect
6. SpeedFOVEffect
7. IdleBreathingEffect

### Phase 3: Combat/Events
8. DamageShakeEffect
9. RecoilEffect
10. Server-triggered effects (EventBus integration)

### Phase 4: Polish
11. Easing function library
12. Effect presets (Low/Medium/High)
13. Per-effect cvar persistence

---

## Cvar Summary

| Cvar | Default | Description |
|------|---------|-------------|
| `cg_vieweffects` | 1 | Master toggle for all viewport effects |
| `cg_bob` | 1 | Walk/run bobbing |
| `cg_bobamplitude` | 0.5 | Bob strength |
| `cg_bobfrequency` | 0.01 | Bob speed |
| `cg_bobroll` | 0.2 | Bob roll tilt |
| `cg_landing` | 1 | Landing impact |
| `cg_landingamplitude` | 8 | Landing dip amount |
| `cg_landingspeed` | 4 | Landing animation speed |
| `cg_strafetilt` | 1.5 | Strafe lean amount |
| `cg_strafetiltspeed` | 8 | Strafe lean speed |
| `cg_speedfov` | 0.15 | Speed FOV increase |
| `cg_idle` | 1 | Idle breathing |
| `cg_shake` | 1 | Damage shake |
| `cg_recoil` | 1 | Weapon recoil |

---

## API Accessibility

**Core Question: Is the API open and available for game code and server events?**

**Answer: Yes.** The architecture is designed for extensibility:

### 1. EventBus Integration (Built-in)

ViewportEffectsManager subscribes to `viewport:*` events automatically:

```typescript
// Any code can trigger effects via EventBus:
EventBus.emit('viewport:shake', { intensity: 0.8, duration: 0.5 });
EventBus.emit('viewport:landing', { velocity: -500 });
```

### 2. Direct API Access

```typescript
// Get manager instance
const effects = ViewportEffectsManager.getInstance();

// Trigger effects programmatically
effects.trigger('shake', { intensity: 0.5, duration: 0.3 });

// Enable/disable individual effects
effects.setEffectEnabled('walkbob', false);

// Register custom effects
effects.registerEffect(new MyCustomEffect());
```

### 3. Server Events (Future)

Server messages can be routed to viewport events:

```typescript
// In network message handler:
case MSG_VIEWPORT_EFFECT:
  const { type, data } = parseMessage(msg);
  EventBus.emit(`viewport:${type}`, data);
  break;
```

**Questions for later:**
- Server event protocol format?
- Security: which effects can server trigger?
- Prediction/interpolation for networked effects?

---

## Phase 1 Focus: Local Player Effects

For initial implementation, focus on **local effects only**:

1. **WalkBobEffect** - Classic view bobbing while moving
2. **LandingImpactEffect** - Camera dip on landing

These are purely client-side, driven by local PlayerState. No server involvement needed.

Server-triggered effects (damage shake, explosions, etc.) come in Phase 3 after the core system is proven.

---

## References

- Quake 3: `cg_bob*` cvars in cgame
- Warsow: Landing animation, speed effects
- Titanfall/Apex: Strafe lean, speed FOV
- Half-Life 2: View punch system
- Modern Warfare: Weapon recoil patterns
