# Babylon.js Tree-Shaking Migration

**Branch:** `feature/babylonjs-tree-shaking`  
**Target:** v0.8.12+  
**Goal:** Reduce bundle size for mobile by enabling tree-shaking

---

## Executive Summary

Migrate from `babylonjs` (UMD bundle) to `@babylonjs/core` (ES6 modules) to enable tree-shaking and significantly reduce bundle size for mobile builds.

### Expected Results

| Metric | Before | After (Est.) | Savings |
|--------|--------|--------------|---------|
| Babylon chunk | ~8 MB | ~3-4 MB | 50-60% |
| Total JS bundle | ~9 MB | ~4-5 MB | ~45% |
| Mobile load time | ~8-12s | ~4-6s | ~50% |

---

## Current State Analysis

### Package Dependencies

```json
// package.json (current)
{
  "dependencies": {
    "babylonjs": "^7.x",           // UMD bundle - NOT tree-shakeable
    "babylonjs-loaders": "^7.x"    // Loaders bundle
  }
}
```

### Import Style (Current)

```typescript
// UMD style - imports entire Babylon.js (~8 MB)
import { Scene, Vector3, Mesh } from 'babylonjs';
```

### Files Using Babylon.js (17 files)

| File | Imports |
|------|---------|
| `src/main.ts` | Engine, babylonjs-loaders (side-effect) |
| `src/engine/debug/EngineCommands.ts` | Vector3, AbstractMesh, Mesh, StandardMaterial, Color3, Scene, Engine, FreeCamera, HemisphericLight, Color4, MeshBuilder, Ray, VertexData |
| `src/engine/loader/bsp/BspMeshBuilder.ts` | Mesh, Scene, StandardMaterial, ShaderMaterial, Color3, VertexData, VertexBuffer, Vector3, RawTexture, Texture, Constants, Engine |
| `src/engine/loader/bsp/BspEntityHandlers.ts` | Vector3, Animation, Scene, Mesh |
| `src/engine/loader/bsp/PVSCuller.ts` | Vector3, Mesh, AbstractMesh |
| `src/engine/loader/map/MapLoader.ts` | Scene, MeshBuilder, Vector3 |
| `src/engine/loader/shader/Q3ShaderMaterialFactory.ts` | Scene, Material, StandardMaterial, Texture, Constants |
| `src/engine/loader/shader/Q3NodeMaterialBuilder.ts` | Scene, NodeMaterial, Texture, InputBlock, TextureBlock, MultiplyBlock, AddBlock, LerpBlock, FragmentOutputBlock, VertexOutputBlock, TransformBlock, VectorMergerBlock, NodeMaterialSystemValues |
| `src/engine/loader/shader/ShaderAnimationSystem.ts` | Scene, Observer, Texture, StandardMaterial, Color3 |
| `src/engine/loader/shader/GlowOverlayShaderMaterial.ts` | Scene, ShaderMaterial, Texture, Effect |
| `src/engine/loader/shader/FilterBlendShaderMaterial.ts` | Scene, ShaderMaterial, Texture, Effect, Constants |
| `src/engine/physics/BabylonPhysicsBackend.ts` | Vector3, Scene, Ray, Mesh, AbstractMesh |
| `src/engine/physics/BrushCollisionBackend.ts` | Vector3 |
| `src/engine/physics/BspCollision.ts` | Vector3 |
| `src/engine/physics/ClipBrushBackend.ts` | Vector3, Scene |
| `src/engine/physics/CollisionBackend.ts` | Vector3, Scene |
| `src/engine/physics/CollisionManager.ts` | Vector3, Scene |
| `src/engine/rendering/RenderVars.ts` | Scene, AbstractMesh, StandardMaterial, PBRMaterial |

---

## Target State

### Package Dependencies (After Migration)

```json
// package.json (target)
{
  "dependencies": {
    "@babylonjs/core": "^7.x",     // ES6 modules - tree-shakeable
    "@babylonjs/loaders": "^7.x"   // Optional: only if GLB/GLTF needed
  }
}
```

### Import Style (Target)

```typescript
// ES6 style - imports only what's needed
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
```

---

## Babylon.js ES6 Module Paths

### Core Classes

| Class | ES6 Import Path |
|-------|-----------------|
| `Engine` | `@babylonjs/core/Engines/engine` |
| `NullEngine` | `@babylonjs/core/Engines/nullEngine` |
| `Scene` | `@babylonjs/core/scene` |

### Math

| Class | ES6 Import Path |
|-------|-----------------|
| `Vector3` | `@babylonjs/core/Maths/math.vector` |
| `Color3` | `@babylonjs/core/Maths/math.color` |
| `Color4` | `@babylonjs/core/Maths/math.color` |

### Meshes

| Class | ES6 Import Path |
|-------|-----------------|
| `Mesh` | `@babylonjs/core/Meshes/mesh` |
| `AbstractMesh` | `@babylonjs/core/Meshes/abstractMesh` |
| `MeshBuilder` | `@babylonjs/core/Meshes/meshBuilder` |
| `VertexData` | `@babylonjs/core/Meshes/mesh.vertexData` |
| `VertexBuffer` | `@babylonjs/core/Buffers/buffer` |

### Materials

| Class | ES6 Import Path |
|-------|-----------------|
| `Material` | `@babylonjs/core/Materials/material` |
| `StandardMaterial` | `@babylonjs/core/Materials/standardMaterial` |
| `PBRMaterial` | `@babylonjs/core/Materials/PBR/pbrMaterial` |
| `ShaderMaterial` | `@babylonjs/core/Materials/shaderMaterial` |
| `Effect` | `@babylonjs/core/Materials/effect` |
| `NodeMaterial` | `@babylonjs/core/Materials/Node/nodeMaterial` |

### Node Material Blocks

| Class | ES6 Import Path |
|-------|-----------------|
| `InputBlock` | `@babylonjs/core/Materials/Node/Blocks/Input/inputBlock` |
| `TextureBlock` | `@babylonjs/core/Materials/Node/Blocks/Dual/textureBlock` |
| `MultiplyBlock` | `@babylonjs/core/Materials/Node/Blocks/multiplyBlock` |
| `AddBlock` | `@babylonjs/core/Materials/Node/Blocks/addBlock` |
| `LerpBlock` | `@babylonjs/core/Materials/Node/Blocks/lerpBlock` |
| `FragmentOutputBlock` | `@babylonjs/core/Materials/Node/Blocks/Fragment/fragmentOutputBlock` |
| `VertexOutputBlock` | `@babylonjs/core/Materials/Node/Blocks/Vertex/vertexOutputBlock` |
| `TransformBlock` | `@babylonjs/core/Materials/Node/Blocks/transformBlock` |
| `VectorMergerBlock` | `@babylonjs/core/Materials/Node/Blocks/vectorMergerBlock` |

### Textures

| Class | ES6 Import Path |
|-------|-----------------|
| `Texture` | `@babylonjs/core/Materials/Textures/texture` |
| `RawTexture` | `@babylonjs/core/Materials/Textures/rawTexture` |

### Cameras

| Class | ES6 Import Path |
|-------|-----------------|
| `FreeCamera` | `@babylonjs/core/Cameras/freeCamera` |
| `Camera` | `@babylonjs/core/Cameras/camera` |

### Lights

| Class | ES6 Import Path |
|-------|-----------------|
| `HemisphericLight` | `@babylonjs/core/Lights/hemisphericLight` |
| `Light` | `@babylonjs/core/Lights/light` |

### Animation

| Class | ES6 Import Path |
|-------|-----------------|
| `Animation` | `@babylonjs/core/Animations/animation` |

### Other

| Class | ES6 Import Path |
|-------|-----------------|
| `Ray` | `@babylonjs/core/Culling/ray` |
| `Observer` | `@babylonjs/core/Misc/observable` |
| `Constants` | `@babylonjs/core/Engines/constants` |
| `NodeMaterialSystemValues` | `@babylonjs/core/Materials/Node/Enums/nodeMaterialSystemValues` |

---

## Migration Strategy

### Phase 1: Preparation (No Code Changes)

1. **Audit current imports** - Document all Babylon.js classes used ✅
2. **Create import mapping** - Map UMD imports to ES6 paths ✅
3. **Set up test environment** - Ensure build and runtime tests work
4. **Remove Vite alias** - Currently redirecting `@babylonjs/core` to `babylonjs`

### Phase 2: Package Migration

1. **Update package.json**
   ```bash
   npm uninstall babylonjs babylonjs-loaders
   npm install @babylonjs/core @babylonjs/loaders
   ```

2. **Update vite.config.ts**
   - Remove the `@babylonjs/core` → `babylonjs` alias
   - May need to adjust `manualChunks` for new package structure

### Phase 3: Import Migration (By Module)

Migrate imports file-by-file in this order:

#### 3.1 Physics Module (6 files) - Simplest, only uses Vector3/Scene
- `src/engine/physics/BrushCollisionBackend.ts`
- `src/engine/physics/BspCollision.ts`
- `src/engine/physics/ClipBrushBackend.ts`
- `src/engine/physics/CollisionBackend.ts`
- `src/engine/physics/CollisionManager.ts`
- `src/engine/physics/BabylonPhysicsBackend.ts`

#### 3.2 Shader Module (5 files) - Materials, Effects, NodeMaterial
- `src/engine/loader/shader/ShaderAnimationSystem.ts`
- `src/engine/loader/shader/Q3ShaderMaterialFactory.ts`
- `src/engine/loader/shader/GlowOverlayShaderMaterial.ts`
- `src/engine/loader/shader/FilterBlendShaderMaterial.ts`
- `src/engine/loader/shader/Q3NodeMaterialBuilder.ts`

#### 3.3 BSP/Map Module (4 files) - Mesh building, entity handling
- `src/engine/loader/bsp/PVSCuller.ts`
- `src/engine/loader/bsp/BspEntityHandlers.ts`
- `src/engine/loader/bsp/BspMeshBuilder.ts`
- `src/engine/loader/map/MapLoader.ts`

#### 3.4 Core Engine (3 files) - Main entry, commands, rendering
- `src/engine/rendering/RenderVars.ts`
- `src/engine/debug/EngineCommands.ts`
- `src/main.ts`

### Phase 4: Verification

1. **Build verification** - `npm run build` succeeds
2. **Bundle size analysis** - Check `dist/stats.html` for reduction
3. **Runtime testing** - Test all features in browser
4. **Mobile testing** - Test on Capacitor builds

---

## Potential Issues & Solutions

### Issue 1: Side-Effect Imports

Some Babylon.js features require side-effect imports to register themselves.

```typescript
// May need explicit side-effect imports for:
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/meshBuilder';
```

**Solution:** Add side-effect imports as needed when features don't work.

### Issue 2: NodeMaterial Blocks

NodeMaterial blocks need explicit registration.

```typescript
// Blocks must be imported to be available
import '@babylonjs/core/Materials/Node/Blocks';
```

**Solution:** Import the blocks index or individual blocks explicitly.

### Issue 3: Effect.ShadersStore

Custom shaders are registered to `Effect.ShadersStore`. This pattern should still work but may need verification.

```typescript
import { Effect } from '@babylonjs/core/Materials/effect';
Effect.ShadersStore["customVertexShader"] = `...`;
```

### Issue 4: babylonjs-loaders

If GLTF/GLB loading is needed, the loaders package must be imported.

```typescript
import '@babylonjs/loaders/glTF';
```

---

## Rollback Plan

If migration causes issues:

1. Revert package.json changes
2. Restore Vite alias configuration
3. Keep ES6-style imports (they'll work with alias)

---

## Success Criteria

- [ ] Build succeeds with no errors
- [ ] Bundle size reduced by at least 40%
- [ ] All existing features work correctly
- [ ] Mobile build loads faster
- [ ] No runtime errors in console

---

## Timeline Estimate

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Preparation | 1 hour | Low |
| Phase 2: Package Migration | 30 min | Medium |
| Phase 3: Import Migration | 3-4 hours | Medium |
| Phase 4: Verification | 1-2 hours | Low |
| **Total** | **6-8 hours** | Medium |

---

## References

- [Babylon.js ES6 Guide](https://doc.babylonjs.com/setup/frameworkPackages/es6Support)
- [Tree Shaking in Babylon.js](https://doc.babylonjs.com/setup/frameworkPackages/es6Support#tree-shaking)
- [Vite Rollup Manual Chunks](https://rollupjs.org/configuration-options/#output-manualchunks)
