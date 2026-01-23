# Player Animation System

**Created:** 2026-01-23  
**Status:** Research & Design  
**Priority:** High

## Overview

This document outlines the design for a flexible player animation system that supports:
- AI-generated models (Layer.ai, etc.)
- Mixamo auto-rigging and animation library
- Hybrid pre-baked + procedural animation approach
- Arena FPS movement requirements (crouchslide, wall jump, etc.)

## Goals

1. **Flexibility**: Any T-posed humanoid model can be used as a player character
2. **Responsive**: Animation system responds instantly to movement state changes
3. **Efficient**: Shared animations across all character models
4. **Asset Pipeline**: Clear workflow from model generation to in-game character

---

## Asset Pipeline

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Model Source   │     │     Mixamo       │     │   SHAG Engine    │
│   (Layer.ai,     │ ──► │   Auto-Rigger    │ ──► │   Animation      │
│    custom, etc.) │     │                  │     │   Controller     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### Step 1: Model Acquisition
- Generate via AI (Layer.ai, Meshy, etc.)
- Create in 3D software (Blender, Maya)
- Purchase from asset stores
- **Requirement**: T-pose or A-pose, humanoid proportions

### Step 2: Mixamo Auto-Rigging
1. Upload model to [Mixamo](https://www.mixamo.com/)
2. Place rig markers (chin, wrists, elbows, knees, groin)
3. Download rigged model as **FBX** or **GLB**
4. Select: **"Without Skin"** for animations, **"With Skin"** for character mesh

### Step 3: Animation Library (One-Time Setup)
Download core animations from Mixamo library (without skin):

| Animation | Mixamo Search | Notes |
|-----------|---------------|-------|
| Idle | "Idle", "Breathing Idle" | Combat-ready stance preferred |
| Run Forward | "Running" | ~6-8 m/s speed |
| Run Backward | "Running Backward" | |
| Strafe Left | "Left Strafe" | Combat strafe |
| Strafe Right | "Right Strafe" | Combat strafe |
| Jump Start | "Jump" | First few frames |
| Jump Airborne | "Falling Idle" | Loop while airborne |
| Jump Land | "Landing" | Impact absorption |
| Crouch Idle | "Crouch Idle" | |
| Crouch Walk | "Crouch Walk" | |

### Step 4: Engine Integration
- Character mesh → `assets/models/players/{name}/{name}.glb`
- Shared animations → `assets/animations/humanoid/`

---

## Animation Architecture

### Mixamo Skeleton Standard

All Mixamo-rigged models use identical bone structure (65 bones):

```
Hips
├── Spine
│   ├── Spine1
│   │   ├── Spine2
│   │   │   ├── Neck
│   │   │   │   └── Head
│   │   │   │       ├── HeadTop_End
│   │   │   │       ├── LeftEye
│   │   │   │       └── RightEye
│   │   │   ├── LeftShoulder
│   │   │   │   └── LeftArm
│   │   │   │       └── LeftForeArm
│   │   │   │           └── LeftHand
│   │   │   │               └── (fingers...)
│   │   │   └── RightShoulder
│   │   │       └── (mirrors left)
├── LeftUpLeg
│   └── LeftLeg
│       └── LeftFoot
│           └── LeftToeBase
└── RightUpLeg
    └── (mirrors left)
```

### Core Classes

```typescript
// src/engine/animation/HumanoidRig.ts
interface HumanoidBoneMap {
  hips: string;
  spine: string;
  spine1: string;
  spine2: string;
  neck: string;
  head: string;
  
  leftShoulder: string;
  leftArm: string;
  leftForeArm: string;
  leftHand: string;
  
  rightShoulder: string;
  rightArm: string;
  rightForeArm: string;
  rightHand: string;
  
  leftUpLeg: string;
  leftLeg: string;
  leftFoot: string;
  leftToeBase: string;
  
  rightUpLeg: string;
  rightLeg: string;
  rightFoot: string;
  rightToeBase: string;
}

// Default Mixamo bone names
const MIXAMO_BONE_MAP: HumanoidBoneMap = {
  hips: "mixamorigHips",
  spine: "mixamorigSpine",
  spine1: "mixamorigSpine1",
  spine2: "mixamorigSpine2",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  leftShoulder: "mixamorigLeftShoulder",
  leftArm: "mixamorigLeftArm",
  leftForeArm: "mixamorigLeftForeArm",
  leftHand: "mixamorigLeftHand",
  rightShoulder: "mixamorigRightShoulder",
  rightArm: "mixamorigRightArm",
  rightForeArm: "mixamorigRightForeArm",
  rightHand: "mixamorigRightHand",
  leftUpLeg: "mixamorigLeftUpLeg",
  leftLeg: "mixamorigLeftLeg",
  leftFoot: "mixamorigLeftFoot",
  leftToeBase: "mixamorigLeftToeBase",
  rightUpLeg: "mixamorigRightUpLeg",
  rightLeg: "mixamorigRightLeg",
  rightFoot: "mixamorigRightFoot",
  rightToeBase: "mixamorigRightToeBase",
};
```

```typescript
// src/engine/animation/PlayerAnimationController.ts
class PlayerAnimationController {
  private skeleton: Skeleton;
  private boneMap: Map<string, Bone>;
  
  // Animation groups (pre-baked from Mixamo)
  private animations: Map<string, AnimationGroup>;
  
  // Current state
  private currentAnimation: string = "idle";
  private blendWeight: number = 0;
  
  constructor(mesh: Mesh, skeleton: Skeleton) {
    this.skeleton = skeleton;
    this.mapBones();
  }
  
  /**
   * Called every frame with character state
   */
  update(state: PlayerAnimationState, deltaTime: number) {
    // Determine target animation from state
    const targetAnim = this.selectAnimation(state);
    
    // Blend to target
    this.blendTo(targetAnim, deltaTime);
    
    // Apply procedural layers
    this.applyProceduralLayers(state);
  }
  
  private selectAnimation(state: PlayerAnimationState): string {
    // Priority order for state resolution
    if (state.isSliding) return "slide";        // Procedural
    if (state.isWallJumping) return "walljump"; // Procedural
    if (!state.grounded) return "airborne";
    if (state.isCrouching) {
      return state.speed > 0.1 ? "crouch_walk" : "crouch_idle";
    }
    if (state.speed > 0.1) {
      return this.selectLocomotion(state);
    }
    return "idle";
  }
  
  private selectLocomotion(state: PlayerAnimationState): string {
    // 8-directional locomotion
    const angle = Math.atan2(state.localVelocity.x, state.localVelocity.z);
    
    if (angle > -0.4 && angle < 0.4) return "run_forward";
    if (angle > 2.7 || angle < -2.7) return "run_backward";
    if (angle > 0) return "strafe_right";
    return "strafe_left";
  }
}
```

```typescript
// src/engine/animation/PlayerAnimationState.ts
interface PlayerAnimationState {
  // From CharacterController
  velocity: Vector3;       // World-space velocity
  localVelocity: Vector3;  // Player-local velocity (for direction)
  speed: number;           // Horizontal speed magnitude
  grounded: boolean;
  isCrouching: boolean;
  
  // Advanced movement states
  isSliding: boolean;      // Crouchslide active
  slideDirection: Vector3; // Direction of slide
  slideSpeed: number;
  
  isWallJumping: boolean;
  wallNormal: Vector3;     // Wall surface normal
  wallJumpPhase: number;   // 0-1 progress through wall jump
  
  // Aiming
  aimPitch: number;        // Looking up/down (-90 to 90)
  aimYaw: number;          // Looking left/right
}
```

---

## Procedural Animation Layers

### Layer 1: Upper Body Aiming (IK)

The upper body follows the aim direction independently of locomotion:

```typescript
applyAimIK(state: PlayerAnimationState) {
  const spine2 = this.getBone("spine2");
  const neck = this.getBone("neck");
  const head = this.getBone("head");
  
  // Distribute pitch across spine chain
  const pitchRad = state.aimPitch * (Math.PI / 180);
  spine2.rotation.x += pitchRad * 0.3;
  neck.rotation.x += pitchRad * 0.3;
  head.rotation.x += pitchRad * 0.4;
}
```

### Layer 2: Strafe Lean

Lean into strafe direction for dynamic feel:

```typescript
applyStrafeLean(state: PlayerAnimationState) {
  const spine = this.getBone("spine");
  const lateralSpeed = state.localVelocity.x;
  
  // Lean opposite to strafe direction
  const leanAmount = Math.clamp(lateralSpeed / 10, -0.15, 0.15);
  spine.rotation.z = -leanAmount;
}
```

### Layer 3: Crouchslide Pose

Fully procedural slide animation:

```typescript
applySlide(state: PlayerAnimationState) {
  if (!state.isSliding) return;
  
  const slideIntensity = Math.min(state.slideSpeed / 15, 1);
  
  // Torso lean back
  this.getBone("spine").rotation.x = -0.4 * slideIntensity;
  this.getBone("spine1").rotation.x = -0.2 * slideIntensity;
  
  // Lead leg extended forward
  this.getBone("rightUpLeg").rotation.x = -1.3 * slideIntensity;
  this.getBone("rightLeg").rotation.x = 0.2 * slideIntensity;
  
  // Back leg tucked
  this.getBone("leftUpLeg").rotation.x = 0.5 * slideIntensity;
  this.getBone("leftLeg").rotation.x = -1.2 * slideIntensity;
  
  // Arms for balance
  this.getBone("leftArm").rotation.z = 0.6 * slideIntensity;
  this.getBone("rightArm").rotation.z = -0.3 * slideIntensity;
}
```

### Layer 4: Wall Jump

Directional wall jump based on wall normal:

```typescript
applyWallJump(state: PlayerAnimationState) {
  if (!state.isWallJumping) return;
  
  const phase = state.wallJumpPhase;
  
  if (phase < 0.2) {
    // Contact phase: legs toward wall
    const wallDir = state.wallNormal.negate();
    // Position feet toward wall...
  } else if (phase < 0.5) {
    // Push-off phase: extend legs
    const pushStrength = (phase - 0.2) / 0.3;
    this.getBone("leftUpLeg").rotation.x = -0.8 * pushStrength;
    this.getBone("rightUpLeg").rotation.x = -0.8 * pushStrength;
  } else {
    // Flight phase: tuck for momentum
    const tuckStrength = 1 - ((phase - 0.5) / 0.5);
    this.getBone("leftUpLeg").rotation.x = -0.3 * tuckStrength;
    this.getBone("rightUpLeg").rotation.x = -0.3 * tuckStrength;
  }
}
```

---

## First-Person Hands

For first-person view, only arms and hands are visible:

```typescript
class FirstPersonArmsController {
  private leftArm: Mesh;
  private rightArm: Mesh;
  private weaponAttachBone: Bone;
  
  update(state: {
    weaponBob: Vector3;     // From ViewportEffectsManager
    aimDownSights: boolean;
    reloadProgress: number;
  }) {
    // Apply weapon bob from existing ViewportEffectsManager
    this.rightHand.position.addInPlace(state.weaponBob);
    
    // ADS interpolation
    if (state.aimDownSights) {
      // Move weapon to center screen...
    }
  }
}
```

---

## File Structure

```
src/engine/
└── animation/
    ├── index.ts
    ├── HumanoidRig.ts           # Bone mapping and rig abstraction
    ├── AnimationLoader.ts       # Load shared animation packs
    ├── AnimationBlender.ts      # Blend between animation states
    ├── PlayerAnimationController.ts  # Main animation driver
    ├── ProceduralLayers.ts      # Aim IK, lean, slide, walljump
    └── FirstPersonArms.ts       # FP hands/weapon animation

assets/
├── animations/
│   └── humanoid/               # Shared Mixamo animations
│       ├── idle.glb
│       ├── run_forward.glb
│       ├── run_backward.glb
│       ├── strafe_left.glb
│       ├── strafe_right.glb
│       ├── jump.glb
│       ├── fall.glb
│       ├── land.glb
│       ├── crouch_idle.glb
│       └── crouch_walk.glb
│
└── models/
    └── players/
        ├── default/
        │   ├── model.glb        # Full character (rigged, no anims)
        │   ├── arms.glb         # First-person arms only
        │   └── player.json      # Metadata (scale, offset, etc.)
        └── {other characters}/
```

---

## Integration with Existing Systems

### CharacterController Integration

```typescript
// In CharacterController.update()
const animState: PlayerAnimationState = {
  velocity: this.velocity,
  localVelocity: this.getLocalVelocity(),
  speed: this.getHorizontalSpeed(),
  grounded: this.state.grounded,
  isCrouching: this.state.crouching,
  isSliding: this.state.sliding,
  slideDirection: this.slideDirection,
  slideSpeed: this.slideSpeed,
  isWallJumping: this.state.wallJumping,
  wallNormal: this.wallNormal,
  wallJumpPhase: this.wallJumpPhase,
  aimPitch: camera.rotation.x,
  aimYaw: camera.rotation.y,
};

this.animationController.update(animState, deltaTime);
```

### EventBus Events

```typescript
// New events for animation system
EventBus.emit("player:animation:stateChange", { 
  from: "run", 
  to: "slide" 
});

EventBus.emit("player:animation:footstep", { 
  foot: "left", 
  surface: "metal" 
});
```

---

## Console Variables

```
cl_animBlendSpeed 10     # Animation blend speed (frames)
cl_proceduralSlide 1     # Use procedural slide vs baked
cl_proceduralWalljump 1  # Use procedural walljump vs baked
cl_aimIK 1               # Enable upper body aim IK
cl_strafeLean 1          # Enable strafe lean effect
cl_strafeLeanAmount 0.15 # Max lean angle (radians)
```

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Create `animation/` directory structure
- [ ] Implement `HumanoidRig` with Mixamo bone mapping
- [ ] Implement `AnimationLoader` for GLB animation import
- [ ] Basic animation playback (idle only)

### Phase 2: Locomotion
- [ ] Implement `AnimationBlender` for smooth transitions
- [ ] 8-directional locomotion (run, strafe, backward)
- [ ] Jump/fall/land sequence
- [ ] Crouch states

### Phase 3: Procedural Layers
- [ ] Upper body aim IK
- [ ] Strafe lean
- [ ] Procedural crouchslide
- [ ] Procedural wall jump

### Phase 4: First-Person
- [ ] First-person arms mesh loading
- [ ] Integrate with WeaponViewManager
- [ ] Weapon bob from ViewportEffectsManager

### Phase 5: Polish
- [ ] Animation events (footsteps, sounds)
- [ ] Network sync for third-person animations
- [ ] Model LOD switching

---

## Research Links

- [Mixamo](https://www.mixamo.com/) - Auto-rigging and animation library
- [Layer.ai](https://layer.ai/) - AI model generation
- [Babylon.js Animation](https://doc.babylonjs.com/features/featuresDeepDive/animation)
- [Babylon.js Skeleton](https://doc.babylonjs.com/features/featuresDeepDive/mesh/bonesSkeletons)
- [Animation Retargeting in Babylon](https://doc.babylonjs.com/features/featuresDeepDive/animation/animationRetargeting)

---

## Licensing

### Mixamo License

| Aspect | Status |
|--------|--------|
| **Animations** | ✅ Free for commercial use |
| **Characters** | ✅ Free for commercial use |
| **Auto-rigging your own models** | ✅ Free for commercial use |
| **Attribution required?** | ❌ No |
| **Redistribution of raw files** | ⚠️ Not as standalone assets |

**Summary**: Mixamo content is royalty-free for games, films, and personal projects. You can use animations and characters commercially without attribution. The only restriction is you cannot redistribute the raw assets as a standalone asset pack.

**For SHAG**: Using Mixamo animations in the game is fully permitted. AI-generated models rigged through Mixamo maintain a clean licensing chain.

### Layer.ai / AI Model Licensing
Check the specific terms of the AI model generation service used. Most grant full commercial rights to generated content, but verify per-service.

---

## Open Questions

1. **Animation Format**: GLB vs FBX for engine? GLB is more web-native.
2. **Root Motion**: Should locomotion use root motion or in-place? In-place is simpler for FPS.
3. **Third-Person Camera**: Will we support third-person view? Affects animation quality requirements.
4. **LOD**: Do we need animation LOD for distant players?
5. **Network Bandwidth**: How much animation state to sync? Just pose ID or full bone state?
