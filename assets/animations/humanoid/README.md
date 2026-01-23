# Humanoid Animations

This directory contains shared animation files for humanoid characters.

## File Naming Convention

| Animation | Filename | Source |
|-----------|----------|--------|
| Idle | `idle.fbx` | Mixamo: "Idle", "Breathing Idle" |
| Run Forward | `run_forward.fbx` | Mixamo: "Running" |
| Run Backward | `run_backward.fbx` | Mixamo: "Running Backward" |
| Strafe Left | `strafe_left.fbx` | Mixamo: "Left Strafe" |
| Strafe Right | `strafe_right.fbx` | Mixamo: "Right Strafe" |
| Jump Start | `jump_start.fbx` | Mixamo: "Jump" (first frames) |
| Fall/Airborne | `fall.fbx` | Mixamo: "Falling Idle" |
| Landing | `land.fbx` | Mixamo: "Landing" |
| Crouch Idle | `crouch_idle.fbx` | Mixamo: "Crouch Idle" |
| Crouch Walk | `crouch_walk.fbx` | Mixamo: "Crouch Walk" |

## Download Instructions (Mixamo)

1. Go to [Mixamo](https://www.mixamo.com/)
2. Sign in with Adobe ID
3. Search for the animation name in the table above
4. Select your rigged character (or use a Mixamo character)
5. Adjust animation parameters if needed
6. Download with settings:
   - **Format**: FBX Binary (.fbx)
   - **Skin**: Without Skin (animation only)
   - **Frames per Second**: 30
   - **Keyframe Reduction**: None

## File Structure

```
assets/animations/humanoid/
├── README.md (this file)
├── idle.fbx
├── run_forward.fbx
├── run_backward.fbx
├── strafe_left.fbx
├── strafe_right.fbx
├── jump_start.fbx
├── fall.fbx
├── land.fbx
├── crouch_idle.fbx
└── crouch_walk.fbx
```

## Notes

- All animations use the standard Mixamo 65-bone skeleton
- Animations are shared across all player models
- Crouchslide and wall jump are procedurally generated (no files needed)
- FBX format is used because Mixamo doesn't offer GLB export
