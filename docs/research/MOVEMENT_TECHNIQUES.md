# Q3/Warsow Movement Techniques Matrix

This document tracks the implementation status and roadmap for Quake 3 and Warsow-style movement physics in the SHAG Engine.

## Current FPS Implementation Status
- [x] Basic WASD movement
- [x] Gravity + falling
- [x] Jumping (Space)
- [x] Ground detection (probe-based)
- [x] Stair stepping (stepSlideMove)
- [x] Viewport smoothing
- [x] Eye offset (sv_eyeoffset)
- [x] Sprint (Shift key, sv_runSpeed)

---

## Movement Techniques to Implement

| Technique | Priority | Complexity | Description | Implementation Notes |
|-----------|----------|------------|-------------|---------------------|
| **Strafe Jumping** | 🔴 High | Medium | Gain speed by strafing + turning while airborne | Requires air acceleration math: add velocity when `wishdir` angle < 90° from current velocity |
| **Bunny Hopping** | 🔴 High | Low | Chain jumps to maintain speed | Just need to allow jump input slightly before landing (jump buffer) |
| **Circle Jumping** | 🟡 Medium | Medium | Pre-jump rotation for initial speed boost | Apply extra acceleration during first jump frame when turning |
| **Air Control** | 🟡 Medium | Low | Steer direction in air | Add `sv_aircontrol` factor to air movement (already have the cvar!) |
| **Crouching** | 🟡 Medium | Medium | Crouch with Ctrl, shorter hitbox | Need crouch state, change collision height, lower camera |
| **Ramp Jumping** | 🟡 Medium | Medium | Extra height from slopes | Preserve upward velocity component when leaving ramps |
| **Wall Jumping** | 🟠 Low | Medium | Jump off walls (Warsow) | Detect wall collision, apply perpendicular + upward impulse |
| **Crouch Sliding** | 🟠 Low | Medium | Slide when crouching at speed | Reduce friction while crouched and fast |
| **Dash/Dodge** | 🟠 Low | Medium | Quick directional burst (Warsow) | Double-tap direction, apply instant velocity |

---

## Physics Variables Already Available

| Variable | Default | Description |
|----------|---------|-------------|
| `sv_gravity` | 800 | Gravity strength |
| `sv_jumpheight` | 270 | Jump velocity |
| `sv_friction` | 6.0 | Ground friction |
| `sv_aircontrol` | 0.1 | Air control factor (NOT YET USED) |
| `sv_stepheight` | 18 | Max stair height |
| `sv_movementSpeed` | 320 | Base walk speed |
| `sv_runSpeed` | 480 | Sprint speed |
| `sv_eyeoffset` | 48 | Eye height above feet |
| `sv_playerheight` | 56 | Player collision height |

---

## Recommended Implementation Order

### Phase 1: Core Movement Feel (High Priority)
1. **Air Control** - Use existing `sv_aircontrol` for basic air steering
2. **Bunny Hopping** - Add jump buffer for smooth hop chains
3. **Strafe Jumping** - Q3-style air acceleration

### Phase 2: Advanced Techniques (Medium Priority)  
4. **Crouching** - Full crouch with height change
5. **Circle Jumping** - Pre-jump acceleration bonus
6. **Ramp Jumping** - Slope velocity preservation

### Phase 3: Warsow-Specific (Low Priority)
7. **Wall Jumping** - Warsow-style wall kicks
8. **Crouch Sliding** - Speed-based slide
9. **Dash/Dodge** - Double-tap movement

---

## References
- [Quake 3 Movement Physics](https://www.adriancourreges.com/blog/2016/02/29/quake-iii-arena-the-movement/)
- [Warsow Movement Guide](https://wiki.warsow.net/Movement)
