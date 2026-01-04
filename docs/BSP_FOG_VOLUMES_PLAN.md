# BSP Fog Volumes Implementation Plan

This document describes the implementation plan for supporting Q3/Warsow BSP fog volumes.

## Overview

BSP maps can contain **fog brushes** - volumetric regions that apply distance-based fog to geometry within them. This is used for atmospheric effects like fog pits, underwater areas, or map-wide atmospheric fog.

### How Q3 Fog Works

1. **Fog shader** defines fog parameters via `fogParms`:
   ```
   textures/fog/myfog
   {
     qer_editorimage textures/common/fog.tga
     surfaceparm fog
     surfaceparm nodraw
     surfaceparm nonsolid
     surfaceparm trans
     fogParms ( 0.5 0.5 0.5 ) 512
   }
   ```
   - `( R G B )` - Fog color (0-1 range)
   - `<depthForOpaque>` - Distance in units where fog becomes fully opaque

2. **Fog brush** is a convex volume linked via BSP Effects lump:
   - Effects lump entry contains: shader name + brush index
   - Brush geometry defines the fog volume bounds

3. **Rendering behavior**:
   - Surfaces inside fog volume fade toward fog color based on distance
   - Looking into a fog pit from outside: see geometry fading into fog
   - Camera inside fog: everything fades based on distance from camera

---

## Current Engine State

### What We Have

| Component | Status | Location |
|-----------|--------|----------|
| `FogEffect.ts` | Complete atmospheric fog system | `src/engine/effects/FogEffect.ts` |
| `fogParms` type | Defined but parsing skipped | `src/engine/loader/shader/Q3ShaderTypes.ts:203` |
| Effects lump parsing | Parsed but unused | `src/engine/loader/bsp/BspLoader.ts:697` |
| Brush geometry | Parsed (brushes, brushSides, planes) | `src/engine/loader/bsp/BspLoader.ts:546` |
| Content flags | Loaded but unused | `BspTexture.contentFlags` |

### What's Missing

1. **fogParms parsing** - Currently skipped in Q3ShaderParser.ts
2. **Fog brush identification** - Effects lump → brush mapping not used
3. **Fog volume geometry** - Brush → convex mesh conversion
4. **Fog volume rendering** - Depth-based translucent fog mesh

---

## Implementation Approach

### Fog Volume Mesh with Depth-Based Blending

For proper BSP fog compatibility (localized fog volumes like fog pits), we render fog brushes as translucent meshes with depth-based alpha:

```
┌─────────────────────────────────────┐
│  Camera (outside fog)               │
│       │                             │
│       ▼                             │
│  ┌─────────────────────┐            │
│  │ Fog Volume Surface  │ ← alpha=0  │
│  │                     │            │
│  │    ●────────●       │            │
│  │    │ depth  │       │ ← alpha increases with depth
│  │    ▼        ▼       │            │
│  │  Geometry fades     │            │
│  │  to fog color       │ ← alpha=1 at depthForOpaque
│  └─────────────────────┘            │
└─────────────────────────────────────┘
```

**Rendering approach**:
1. Render fog volume as mesh with back-face culling disabled
2. Fragment shader calculates depth into fog volume
3. Alpha = clamp(depth / depthForOpaque, 0, 1)
4. Blend fog color over scene

---

## Implementation Phases

### Phase 1: Parse fogParms from Shaders

**File**: `src/engine/loader/shader/Q3ShaderParser.ts`

Currently fogParms is skipped:
```typescript
case 'fogparms':
  // Skip fog params for now
  pos++;
  while (...) { pos++; }
  break;
```

**Change to**:
```typescript
case 'fogparms': {
  // fogParms ( R G B ) depthForOpaque
  // May have parentheses around color: fogParms ( 0.5 0.5 0.5 ) 512
  pos++;

  // Skip opening parenthesis if present
  if (tokens[pos] === '(') pos++;

  const r = parseFloat(tokens[pos++]) || 0;
  const g = parseFloat(tokens[pos++]) || 0;
  const b = parseFloat(tokens[pos++]) || 0;

  // Skip closing parenthesis if present
  if (tokens[pos] === ')') pos++;

  const depthForOpaque = parseFloat(tokens[pos++]) || 512;

  shader.fogParms = {
    color: [r, g, b],
    depthForOpaque
  };
  break;
}
```

**Validation**: Log parsed fogParms, verify against known shader files.

---

### Phase 2: Extract Fog Brushes from BSP

**New file**: `src/engine/loader/bsp/BspFogVolume.ts`

The Effects lump links fog shaders to brushes:
```typescript
export interface BspEffect {
  name: string;      // Shader name (e.g., "textures/fog/fog_dark")
  brushIndex: number; // Index into brushes array
  unknown: number;
}
```

**Implementation**:
```typescript
export interface FogVolumeData {
  shaderName: string;
  brushIndex: number;
  fogColor: [number, number, number];
  depthForOpaque: number;
  planes: BspPlane[];  // Brush bounding planes
}

export function extractFogVolumes(
  bspData: BspFile,
  shaderRegistry: Q3ShaderRegistry
): FogVolumeData[] {
  const fogVolumes: FogVolumeData[] = [];

  for (const effect of bspData.effects) {
    // Look up shader for fog params
    const shader = shaderRegistry.getShader(effect.name);
    if (!shader?.fogParms) continue;

    // Get brush geometry
    const brush = bspData.brushes[effect.brushIndex];
    if (!brush) continue;

    // Collect planes that define the brush
    const planes: BspPlane[] = [];
    for (let i = 0; i < brush.numSides; i++) {
      const side = bspData.brushSides[brush.firstSide + i];
      planes.push(bspData.planes[side.planeIndex]);
    }

    fogVolumes.push({
      shaderName: effect.name,
      brushIndex: effect.brushIndex,
      fogColor: shader.fogParms.color,
      depthForOpaque: shader.fogParms.depthForOpaque,
      planes
    });
  }

  return fogVolumes;
}
```

---

### Phase 3: Build Fog Volume Geometry

Convert brush planes to renderable mesh geometry.

**Approach**: Plane intersection algorithm (similar to existing BrushGenerator.ts)

```typescript
export function buildFogVolumeMesh(
  fogVolume: FogVolumeData,
  scene: Scene
): Mesh {
  // Convert Q3 planes to vertices using plane intersection
  // Similar to src/engine/loader/map/BrushGenerator.ts

  const vertices = computeConvexHullFromPlanes(fogVolume.planes);

  // Create Babylon.js mesh
  const mesh = new Mesh("fogVolume_" + fogVolume.brushIndex, scene);

  // Apply custom positions, indices
  const vertexData = new VertexData();
  vertexData.positions = vertices.positions;
  vertexData.indices = vertices.indices;
  vertexData.normals = vertices.normals;
  vertexData.applyToMesh(mesh);

  return mesh;
}
```

**Note**: We already have plane-intersection code in `BrushGenerator.ts` that can be adapted.

---

### Phase 4: Create Fog Volume Material

**File**: `src/engine/loader/bsp/FogVolumeMaterial.ts`

The fog material needs:
1. Fog color from fogParms
2. Depth-based alpha (fragment depth into volume)
3. Two-sided rendering (visible from inside and outside)
4. Additive or alpha blending

**Babylon.js options**:

**Option A: ShaderMaterial (most control)**
```typescript
const fogMaterial = new ShaderMaterial("fogMat", scene, {
  vertex: fogVolumeVertexShader,
  fragment: fogVolumeFragmentShader,
}, {
  attributes: ["position"],
  uniforms: ["worldViewProjection", "fogColor", "depthForOpaque", "cameraPosition"]
});
```

Fragment shader calculates depth from camera to fragment, applies alpha based on depthForOpaque.

**Option B: NodeMaterial (visual graph)**
Build fog effect using Babylon.js node material system.

**Option C: StandardMaterial with tweaks (simplest)**
```typescript
const fogMaterial = new StandardMaterial("fogMat", scene);
fogMaterial.diffuseColor = new Color3(fogR, fogG, fogB);
fogMaterial.alpha = 0.5;  // Static alpha
fogMaterial.backFaceCulling = false;
fogMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
```

**Recommendation**: Start with Option C for proof-of-concept, then upgrade to ShaderMaterial for proper depth-based fog.

---

### Phase 5: Integration

**Add to BspMeshBuilder.ts or create FogVolumeManager.ts**:

```typescript
export class FogVolumeManager {
  private fogMeshes: Mesh[] = [];

  async buildFogVolumes(
    bspData: BspFile,
    scene: Scene,
    shaderRegistry: Q3ShaderRegistry
  ): Promise<void> {
    const fogVolumes = extractFogVolumes(bspData, shaderRegistry);

    console.log(`[FogVolumes] Found ${fogVolumes.length} fog volumes`);

    for (const vol of fogVolumes) {
      const mesh = buildFogVolumeMesh(vol, scene);
      applyFogMaterial(mesh, vol, scene);
      this.fogMeshes.push(mesh);
    }
  }

  dispose(): void {
    for (const mesh of this.fogMeshes) {
      mesh.dispose();
    }
    this.fogMeshes = [];
  }
}
```

---

## Q3 Content Flags Reference

For additional fog detection (brushes with CONTENTS_FOG):

```typescript
// Q3 content flags
const CONTENTS_SOLID     = 0x00000001;
const CONTENTS_LAVA      = 0x00000008;
const CONTENTS_SLIME     = 0x00000010;
const CONTENTS_WATER     = 0x00000020;
const CONTENTS_FOG       = 0x00000040;  // Fog volume
const CONTENTS_AREAPORTAL = 0x00008000;
const CONTENTS_PLAYERCLIP = 0x00010000;

// Check if brush is fog via content flags
function isFogBrush(texture: BspTexture): boolean {
  return (texture.contentFlags & CONTENTS_FOG) !== 0;
}
```

---

## Test Maps

| Map | Fog Type | Notes |
|-----|----------|-------|
| wdm11 | Map-wide fog | Large fog brush covering entire map |
| wbomb6 | Unknown | Check for fog pits |
| q3dm7 | Fog pit | Classic Q3 fog example |

---

## Current Status (2026-01-04)

### What Works
- ✅ `fogParms` parsing from shaders
- ✅ Effects lump → brush mapping
- ✅ Fog volume data extraction
- ✅ Custom fog shader material

### What Doesn't Work
- ❌ Brush geometry reconstruction fails for most fog brushes
- ❌ Many fog brushes are intentionally unbounded (2D slabs, not 3D volumes)
- ❌ Some maps have corrupted/invalid plane indices

### Root Cause Discovery

**Q3 fog doesn't render fog brush geometry as a mesh.**

The actual Q3 fog system works differently:
1. Each **Face** in the BSP has an `effect` field (index into Effects lump, or -1)
2. Faces with `effect != -1` are rendered with fog applied
3. The fog shader calculates depth into the fog volume per-pixel
4. The brush geometry is only for collision detection, not rendering

This means our approach of reconstructing fog brush meshes is fundamentally incorrect.

### Test Results

| Map | Issue |
|-----|-------|
| wdm17 | Fog brushes have only 4 planes (missing X-axis), creating unbounded 2D slabs |
| wdm11 | Invalid plane index (1615724676, max valid: 4126) - corrupted brush data |
| criziswdm4 | Same invalid plane index issue |

---

## Proper Implementation Plan (Per-Face Fog)

To properly implement Q3 fog, we need to:

### Phase 1: Identify Fog Faces
```typescript
// In BspMeshBuilder, when processing faces:
for (const face of bsp.faces) {
  if (face.effect >= 0 && face.effect < bsp.effects.length) {
    const effect = bsp.effects[face.effect];
    const shader = shaderRegistry.getShader(effect.name);
    if (shader?.fogParms) {
      // This face needs fog applied
      face.fogParams = shader.fogParms;
    }
  }
}
```

### Phase 2: Modify Face Materials
Create a fog-enabled variant of the standard material that:
1. Accepts fog color and depthForOpaque uniforms
2. Calculates distance from camera to fragment
3. Blends fog color based on depth

### Phase 3: Per-Face Fog Uniforms
Each mesh with fog needs:
- `fogColor: vec3`
- `depthForOpaque: float`
- `fogVolumeMin/Max: vec3` (optional, for bounded fog)

### Estimated Effort
- **Medium-High** - Requires modifying the material system
- Affects: `BspMeshBuilder.ts`, `Q3ShaderMaterialFactory.ts`, shader code

---

## Alternative: Global Fog Console Commands

For testing purposes, added console commands:
```
fog on [r] [g] [b] [density]  - Enable global fog
fog off                        - Disable global fog
fog color <r> <g> <b>         - Set fog color
fog density <value>           - Set fog density
```

This uses Babylon's built-in fog system, not Q3's per-volume fog.

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| ~~Brush geometry conversion complex~~ | **BLOCKED** - Q3 fog doesn't use brush geometry |
| Per-face fog requires material changes | Create fog material variant |
| Performance with many fog faces | Batch faces with same fog params |
| Overlapping fog volumes | Handle edge case if encountered |

---

## Success Criteria (Revised)

1. ✅ fogParms parsed correctly from shaders
2. ✅ Fog volumes extracted from Effects lump
3. ❌ ~~Fog mesh rendered at correct position~~ (wrong approach)
4. 🔄 **New:** Faces with fog effect render with depth-based fog
5. 🔄 **New:** Global fog console commands for testing

---

## File Changes Summary

| File | Change | Status |
|------|--------|--------|
| `src/engine/loader/shader/Q3ShaderParser.ts` | Parse fogParms | ✅ Done |
| `src/engine/loader/bsp/BspFogVolume.ts` | Fog volume extraction | ✅ Done (mesh building blocked) |
| `src/engine/debug/EngineCommands.ts` | Global fog commands | 🔄 TODO |
| `src/engine/loader/bsp/BspMeshBuilder.ts` | Per-face fog | 🔄 Future |

---

*Document created: 2026-01-04*
*Updated: 2026-01-04 - Documented mesh reconstruction limitation*
*Branch: feature/bsp-fog-volumes*
