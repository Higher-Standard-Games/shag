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

### Partially Implemented
- [x] **tcMod scroll** - ✅ Planned
- [x] **tcMod scale** - ✅ Planned  
- [x] **tcMod rotate** - ✅ Planned
- [x] **tcMod stretch** - ✅ Planned (wave-based)
- [x] **tcMod turb** - ⚠️ Simplified (oscillation, not true distortion)
- [ ] **tcMod transform** - Full 2D matrix (low priority)
- [x] **rgbGen wave** - ✅ Planned
- [x] **alphaGen wave** - ✅ Planned

### Known Differences from Q3/Warsow
1. **Turbulence** - Faked with UV oscillation instead of vertex distortion
2. **Multi-pass blending** - Single-stage only for now
3. **Overbright** - No `identityLighting` overbright adjustment

---

## Open Questions

1. **Lightmap interaction** - Animated textures with lightmaps - any special handling needed?

2. **Memory cleanup** - When BSP unloads, ensure all registered materials are cleaned up.

3. **Performance threshold** - At what point do we need LOD-based animation updates?
