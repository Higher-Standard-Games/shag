# tcMod Animation System Design

## Overview

This document outlines the architecture for implementing Q3/Warsow shader tcMod animations in the IWM Engine. tcMod directives modify texture coordinates over time to create effects like scrolling water, rotating fans, pulsing lights, and turbulent surfaces.

---

## Current State

### Already Implemented
- **Q3ShaderTypes.ts** - Full tcMod type definitions
- **Q3ShaderParser.ts** - Parsing all tcMod variants
- **Q3ShaderRegistry.ts** - Passes `tcMod[]` and `needsAnimation: true` to materials

### Missing
- No runtime animation system
- Materials don't receive tcMod updates
- No render loop integration

---

## Architecture Design

### Option A: Centralized ShaderAnimationSystem (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                    ShaderAnimationSystem                     │
│  (Singleton - manages all animated materials)                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐    ┌─────────────────┐                 │
│  │ AnimatedMaterial│    │ AnimatedMaterial│    ...          │
│  │ - material      │    │ - material      │                 │
│  │ - texture       │    │ - texture       │                 │
│  │ - tcMods[]      │    │ - tcMods[]      │                 │
│  │ - state (uOff..)│    │ - state         │                 │
│  └─────────────────┘    └─────────────────┘                 │
│                                                              │
│  update(deltaTime) ──────────────────────────────────────►  │
│    for each AnimatedMaterial:                                │
│      evaluate tcMods                                         │
│      apply to texture UV                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
           │
           │ scene.onBeforeRenderObservable
           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Babylon.js Scene                        │
│                      Render Loop                             │
└─────────────────────────────────────────────────────────────┘
```

### Why Centralized?

1. **Single render observer** - One `onBeforeRenderObservable` callback instead of N
2. **Efficient batching** - Can optimize similar animations together
3. **Easy pause/resume** - One toggle pauses all shader animations
4. **Memory tracking** - Clear list of all animated materials for cleanup
5. **LOD support** - Can reduce animation updates for distant objects

---

## Core Components

### 1. ShaderAnimationSystem

```typescript
// src/engine/loader/shader/ShaderAnimationSystem.ts

export interface AnimatedMaterialEntry {
  /** The Babylon material */
  material: StandardMaterial;
  /** The animated texture */
  texture: Texture;
  /** tcMod directives to apply */
  tcMods: TcMod[];
  /** Current animation state */
  state: {
    uOffset: number;
    vOffset: number;
    rotation: number;  // radians
    uScale: number;
    vScale: number;
  };
}

export class ShaderAnimationSystem {
  private static instance: ShaderAnimationSystem;
  private scene: Scene | null = null;
  private entries: Map<string, AnimatedMaterialEntry> = new Map();
  private renderObserver: Observer<Scene> | null = null;
  private enabled: boolean = true;
  private timeScale: number = 1.0;
  
  // Lifecycle
  init(scene: Scene): void;
  dispose(): void;
  
  // Registration
  registerMaterial(id: string, material: StandardMaterial, texture: Texture, tcMods: TcMod[]): void;
  unregisterMaterial(id: string): void;
  
  // Control
  setEnabled(enabled: boolean): void;
  setTimeScale(scale: number): void;
  
  // Called each frame
  private update(deltaTime: number): void;
  private applyTcMods(entry: AnimatedMaterialEntry, deltaTime: number): void;
}
```

### 2. TcMod Evaluator

```typescript
// Evaluate tcMod and update state

function applyTcMods(entry: AnimatedMaterialEntry, deltaTime: number): void {
  for (const tcMod of entry.tcMods) {
    switch (tcMod.type) {
      case 'scroll':
        entry.state.uOffset += tcMod.sSpeed * deltaTime;
        entry.state.vOffset += tcMod.tSpeed * deltaTime;
        break;
        
      case 'scale':
        entry.state.uScale = tcMod.sScale;
        entry.state.vScale = tcMod.tScale;
        break;
        
      case 'rotate':
        const radPerSec = tcMod.degreesPerSecond * (Math.PI / 180);
        entry.state.rotation += radPerSec * deltaTime;
        break;
        
      case 'stretch':
        const wave = evaluateWaveFunc(tcMod.func, this.totalTime);
        entry.state.uScale = wave;
        entry.state.vScale = wave;
        break;
        
      case 'turb':
        // Simplified turbulence using offset oscillation
        const turbU = Math.sin(this.totalTime * tcMod.frequency + tcMod.phase) * tcMod.amplitude;
        const turbV = Math.cos(this.totalTime * tcMod.frequency + tcMod.phase + 0.5) * tcMod.amplitude;
        entry.state.uOffset += turbU * deltaTime;
        entry.state.vOffset += turbV * deltaTime;
        break;
        
      case 'transform':
        // Full 2D matrix transform - complex, implement later
        break;
    }
  }
  
  // Apply state to texture
  entry.texture.uOffset = entry.state.uOffset;
  entry.texture.vOffset = entry.state.vOffset;
  entry.texture.uScale = entry.state.uScale;
  entry.texture.vScale = entry.state.vScale;
  entry.texture.wAng = entry.state.rotation;
}
```

### 3. Wave Function Evaluator

```typescript
function evaluateWaveFunc(wave: WaveFunc, time: number): number {
  const phase = wave.phase + time * wave.frequency;
  let value: number;
  
  switch (wave.func) {
    case 'sin':
      value = Math.sin(phase * 2 * Math.PI);
      break;
    case 'triangle':
      value = Math.abs((phase % 1) * 2 - 1) * 2 - 1;
      break;
    case 'square':
      value = (phase % 1) < 0.5 ? 1 : -1;
      break;
    case 'sawtooth':
      value = (phase % 1) * 2 - 1;
      break;
    case 'inversesawtooth':
      value = 1 - (phase % 1) * 2;
      break;
    case 'noise':
      value = Math.random() * 2 - 1; // Simplified
      break;
    default:
      value = 0;
  }
  
  return wave.base + value * wave.amplitude;
}
```

---

## Integration Points

### 1. BspMeshBuilder Integration

When creating materials with `needsAnimation: true`:

```typescript
// In BspMeshBuilder.createMaterialFromShaderProps()

if (props.needsAnimation && props.tcMod) {
  // Register with animation system after texture is loaded
  const animSystem = ShaderAnimationSystem.getInstance();
  animSystem.registerMaterial(
    textureName,
    material,
    material.diffuseTexture,
    props.tcMod
  );
}
```

### 2. GameScene Integration

```typescript
// In GameScene or MapRenderer initialization

const animSystem = ShaderAnimationSystem.getInstance();
animSystem.init(scene);

// On scene dispose
animSystem.dispose();
```

### 3. Console Commands

```
shader anim status     - Show animated material count
shader anim pause      - Pause all animations
shader anim resume     - Resume animations
shader anim speed 2.0  - Set time scale
```

---

## Implementation Phases

### Phase 1: Core System + Scroll (Water/Lava)
- [ ] Create ShaderAnimationSystem class
- [ ] Implement scroll tcMod
- [ ] Register from BspMeshBuilder
- [ ] Add console commands
- [ ] Test with water textures

### Phase 2: Scale + Rotate
- [ ] Implement static scale
- [ ] Implement rotation (wAng)
- [ ] Test with fan/spinner textures

### Phase 3: Wave Functions
- [ ] Implement wave function evaluator
- [ ] Implement stretch tcMod
- [ ] Test with pulsing effects

### Phase 4: Turbulence (Simplified)
- [ ] Implement turb as animated offset
- [ ] Good enough for water ripples

### Phase 5: Advanced (Optional)
- [ ] Full transform matrix support
- [ ] Custom shader for vertex turbulence
- [ ] Multi-stage shader support

---

## Performance Considerations

1. **Batch similar animations** - Materials with same tcMod could share state
2. **LOD-based updates** - Reduce frequency for distant materials
3. **Frustum culling aware** - Skip updates for materials not visible
4. **Time accumulation** - Use modulo to prevent float overflow on long sessions

---

## Example Shaders

### Water
```
textures/liquids/water
{
  surfaceparm trans
  surfaceparm water
  cull none
  {
    map textures/liquids/water
    blendfunc blend
    tcMod scroll 0.02 0.01
    tcMod turb 0 0.05 0 0.2
  }
}
```

### Lava
```
textures/liquids/lava
{
  surfaceparm lava
  {
    map textures/liquids/lava
    tcMod scroll 0.03 0.02
    rgbGen wave sin 0.5 0.5 0 0.5
  }
}
```

### Rotating Fan
```
textures/base/fan
{
  {
    map textures/base/fan
    tcMod rotate 180
  }
}
```

---

## Files to Create/Modify

### New Files
- `src/engine/loader/shader/ShaderAnimationSystem.ts`
- `src/engine/loader/shader/WaveEvaluator.ts` (optional, can inline)

### Modified Files
- `src/engine/loader/bsp/BspMeshBuilder.ts` - Register animated materials
- `src/engine/loader/shader/index.ts` - Export new system
- `src/engine/debug/EngineCommands.ts` - Add shader anim commands
- `src/engine/index.ts` - Export ShaderAnimationSystem

---

## Design Decisions

### Multi-Stage Shaders
**Decision:** Animate first stage only (for now)

Q3 shaders can have multiple stages with different textures and blend modes. Full multi-stage would require:
- NodeMaterial for custom blending
- Or multiple render passes (expensive)

For v1, we animate the first stage that has animation directives. This covers ~90% of use cases (water, lava, fans, pulsing lights).

### rgbGen/alphaGen
**Decision:** Include in same system

Only `wave` type needs animation:
- `rgbGen wave` → animate `material.diffuseColor` or `material.emissiveColor`
- `alphaGen wave` → animate `material.alpha`

Static types (`identity`, `const`, `vertex`) are set once at material creation.

### Console Commands
Speed/time scale should respect shader defaults. Commands for debug/override only.

---

## Current Limitations

> **Track these for future implementation**

### Not Yet Implemented
- [ ] **Multi-stage rendering** - Only first animated stage is processed
- [ ] **tcGen** - Texture coordinate generation (environment mapping, etc.)
- [ ] **deformVertexes** - Vertex deformation (wave, bulge, autosprite)
- [ ] **True turbulence** - Current turb is simplified oscillation, not per-vertex distortion
- [ ] **rgbGen lightingDiffuse** - Dynamic per-vertex lighting
- [ ] **alphaGen portal** - Distance-based alpha for portal surfaces
- [ ] **animMap** - Animated texture sequences (flipbook)
- [ ] **fogParms** - Volumetric fog per-shader

### Implemented (v0.8.4)
- [x] **tcMod scroll** - ✅ Working (water, lava flow)
- [x] **tcMod scale** - ✅ Working (static UV scale)
- [x] **tcMod rotate** - ✅ Working (fans, spinners)
- [x] **tcMod stretch** - ✅ Working (wave-based scale)
- [x] **tcMod turb** - ⚠️ Simplified (oscillation, not true distortion)
- [ ] **tcMod transform** - Full 2D matrix (low priority)
- [x] **rgbGen wave** - ✅ Working (color pulsing)
- [x] **alphaGen wave** - ✅ Working (alpha pulsing)

### Multi-Stage NodeMaterial (Experimental)
- [x] **Q3NodeMaterialBuilder** - Created but disabled by default
- [ ] **Auto-detection** - Disabled (broke transparency/animation)
- [ ] **NodeMaterial animation** - Needs InputBlock uniform integration

### Known Differences from Q3/Warsow
1. **Turbulence** - Faked with UV oscillation instead of vertex distortion
2. **Multi-pass blending** - Single-stage only for now (NodeMaterial WIP)
3. **Overbright** - No `identityLighting` overbright adjustment

---

## Open Questions

1. **Lightmap interaction** - Animated textures with lightmaps - any special handling needed?

2. **Memory cleanup** - When BSP unloads, ensure all registered materials are cleaned up.

3. **Performance threshold** - At what point do we need LOD-based animation updates?

---

## tcGen Implementation Research (v0.8.25)

### tcGen Modes Overview

| Mode | Q3 Behavior | Babylon.js Equivalent | Priority |
|------|-------------|----------------------|----------|
| `base` | Use mesh UV coords (default) | Already works | ✅ Done |
| `lightmap` | Use lightmap UV coords | UV2 channel | ✅ Done |
| `environment` | Spherical environment mapping | `reflectionTexture` + `coordinatesMode` | 🔴 HIGH |
| `vector (sx sy sz) (tx ty tz)` | World-space projection | Custom UV calculation | 🟡 MEDIUM |

### tcGen environment - Detailed Research

**Q3/OpenGL Implementation:**
```c
// Q3 uses GL_SPHERE_MAP for environment mapping
glTexGenf(GL_S, GL_TEXTURE_GEN_MODE, GL_SPHERE_MAP);
glTexGenf(GL_T, GL_TEXTURE_GEN_MODE, GL_SPHERE_MAP);
glEnable(GL_TEXTURE_GEN_S);
glEnable(GL_TEXTURE_GEN_T);
```

The sphere map generates texture coordinates based on the reflected view vector:
```
R = I - 2 * dot(N, I) * N  // Reflect view vector around normal
u = Rx / (2 * sqrt(Rx² + Ry² + (Rz+1)²)) + 0.5
v = Ry / (2 * sqrt(Rx² + Ry² + (Rz+1)²)) + 0.5
```

**Babylon.js Implementation Options:**

1. **Using `reflectionTexture`** (Recommended for static envmaps):
```typescript
material.reflectionTexture = texture;
texture.coordinatesMode = Texture.SPHERICAL_MODE;
// or Texture.CUBIC_REFLECTION_MODE for cubemaps
```

2. **Using Custom ShaderMaterial** (For per-vertex calculation):
```glsl
// Vertex shader
varying vec2 vEnvUV;
void main() {
    vec3 worldNormal = normalize(mat3(world) * normal);
    vec3 viewDir = normalize(cameraPosition - worldPos);
    vec3 reflected = reflect(-viewDir, worldNormal);
    
    float m = 2.0 * sqrt(reflected.x*reflected.x + reflected.y*reflected.y + (reflected.z+1.0)*(reflected.z+1.0));
    vEnvUV = vec2(reflected.x/m + 0.5, reflected.y/m + 0.5);
}
```

**Use Cases in Warsow/Q3:**
- Shiny metal surfaces
- Reflective armor/weapons
- Chrome-like effects
- Fake water reflections

### tcGen vector - Detailed Research

**Q3 Behavior:**
```
tcGen vector ( <sx> <sy> <sz> ) ( <tx> <ty> <tz> )
```
Projects world position onto texture coordinates using two direction vectors:
```
u = dot(worldPos, S_vector)
v = dot(worldPos, T_vector)
```

**Babylon.js Implementation:**
Requires custom shader or vertex attribute modification:
```typescript
// In vertex shader or pre-process:
uv.x = dot(worldPosition, vec3(sx, sy, sz));
uv.y = dot(worldPosition, vec3(tx, ty, tz));
```

**Use Cases:**
- World-aligned textures (water surface that doesn't stretch)
- Procedural terrain texturing
- Decals that align to world grid

---

## tcMod transform - Implementation Details

### Current State
- **Parsing:** ✅ Implemented in `Q3ShaderParser.ts`
- **Runtime:** ❌ Skipped in `ShaderAnimationSystem.ts`

### Mathematical Definition
```
tcMod transform <m00> <m01> <m10> <m11> <t0> <t1>

| u' |   | m00  m01 |   | u |   | t0 |
|    | = |          | × |   | + |    |
| v' |   | m10  m11 |   | v |   | t1 |
```

This is an affine 2D transformation combining:
- Rotation
- Scale (non-uniform)
- Shear
- Translation

### Babylon.js Implementation

Babylon's Texture class supports:
```typescript
texture.uOffset  // Translation U
texture.vOffset  // Translation V
texture.uScale   // Scale U
texture.vScale   // Scale V
texture.wAng     // Rotation (radians)
texture.uAng     // Rotation around U axis (rarely used)
texture.vAng     // Rotation around V axis (rarely used)
```

**Limitation:** Babylon doesn't natively support shear/non-uniform rotation.

**Solution Options:**

1. **Decompose matrix into supported components** (Good for most cases):
```typescript
// Extract scale
const scaleU = Math.sqrt(m00*m00 + m01*m01);
const scaleV = Math.sqrt(m10*m10 + m11*m11);

// Extract rotation (assumes no shear)
const rotation = Math.atan2(m01, m00);

// Apply
texture.uScale = scaleU;
texture.vScale = scaleV;
texture.wAng = rotation;
texture.uOffset = t0;
texture.vOffset = t1;
```

2. **Use ShaderMaterial for full matrix** (For shear support):
```glsl
uniform mat2 uvTransform;
uniform vec2 uvTranslate;

vec2 transformedUV = uvTransform * uv + uvTranslate;
```

### Animation Considerations

If `tcMod transform` is meant to animate (e.g., via template parameters):
- Parse initial transform values
- Store as animated state
- Apply each frame

Most Q3 maps use `transform` for static adjustments, not animation.

---

## Implementation Priority

### Phase 1: tcMod transform (Easy)
1. Add matrix decomposition to `ShaderAnimationSystem.applyTcMods()`
2. Apply scale, rotation, translation to texture
3. Log warning if shear detected

### Phase 2: tcGen environment (Medium)
1. Add `TcGen` type to `Q3ShaderTypes.ts`
2. Parse `tcGen` in `Q3ShaderParser.ts`
3. Store in `Q3ShaderStage`
4. In `BspMeshBuilder`, apply `reflectionTexture` when tcGen=environment

### Phase 3: tcGen vector (Advanced)
1. Requires vertex shader modification
2. May need ShaderMaterial for affected surfaces
3. Lower priority - rarely used in Warsow maps

---

## Type Definitions to Add

```typescript
// Q3ShaderTypes.ts

export type TcGenMode = 'base' | 'lightmap' | 'environment' | 'vector';

export interface TcGenVector {
  mode: 'vector';
  sVector: [number, number, number];  // S direction in world space
  tVector: [number, number, number];  // T direction in world space
}

export interface TcGen {
  mode: TcGenMode;
  vectorParams?: TcGenVector;  // Only for mode='vector'
}

// In Q3ShaderStage:
export interface Q3ShaderStage {
  // ... existing fields ...
  tcGen?: TcGen;  // NEW: texture coordinate generation mode
}
```
