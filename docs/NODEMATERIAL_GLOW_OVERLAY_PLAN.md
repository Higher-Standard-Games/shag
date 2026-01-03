# NodeMaterial Glow Overlay Implementation Plan

## Problem Statement

Many Warsow/Q3 light shaders use a **3-stage glow overlay** pattern:
1. Base texture (full brightness)
2. Lightmap (darkens based on baked lighting)
3. Glow texture (additive blend - makes lights pop)

Current implementation only handles `surfaceparm nolightmap` shaders.
Glow overlay shaders like `textures/boqu/lightstripe_blue_800` don't render correctly.

---

## Target Shader Pattern

```
textures/boqu/lightstripe_blue_800
{
  q3map_surfacelight 800
  
  {
    map textures/boqu/lightstripe_blue.tga
    rgbGen identity                              // Stage 0: Base at full brightness
  }
  {
    map $lightmap
    blendFunc filter                             // Stage 1: Multiply with lightmap
  }
  {
    map textures/boqu/lightstripe_blue_glow.tga
    blendFunc add                                // Stage 2: Add glow overlay
  }
}
```

### Visual Result
- Base texture shows the lamp surface
- Lightmap darkens areas in shadow
- Glow texture ADDS brightness back to the emissive parts
- Net result: lamp surface glows even in dark areas

---

## NodeMaterial Graph Design

```
┌─────────────────────────────────────────────────────────────┐
│                      NodeMaterial                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [UV1] ─────────────────┬─────────────────────────────────  │
│                         │                                    │
│  [Base Texture] ────────┼──► [Multiply] ──┬──► [Add] ──► [FragOut] │
│                         │        ▲        │       ▲         │
│  [UV2] ─────────────────┼────────┤        │       │         │
│                         │        │        │       │         │
│  [Lightmap Texture] ────┼────────┘        │       │         │
│                         │                 │       │         │
│  [Glow Texture] ────────┴─────────────────┴───────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Node Breakdown

1. **Position/Vertex Output** - Standard MVP transform
2. **UV1 Input** - Primary texture coordinates (base + glow)
3. **UV2 Input** - Lightmap coordinates
4. **Base TextureBlock** - `textures/boqu/lightstripe_blue.tga`
5. **Lightmap TextureBlock** - `$lightmap` (from BSP)
6. **Glow TextureBlock** - `textures/boqu/lightstripe_blue_glow.tga`
7. **MultiplyBlock** - base.rgb * lightmap.rgb
8. **AddBlock** - result + glow.rgb
9. **FragmentOutput** - Final color

---

## Detection Logic

### When to Use NodeMaterial

```typescript
function needsGlowOverlayNodeMaterial(shader: Q3Shader): boolean {
  // Must have at least 3 stages
  if (shader.stages.length < 3) return false;
  
  // Pattern: base + lightmap + additive glow
  const hasLightmap = shader.stages.some(s => s.map === '$lightmap');
  const hasAdditiveStage = shader.stages.some(s => 
    s.blendFunc && 
    s.blendFunc[0] === 'GL_ONE' && 
    s.blendFunc[1] === 'GL_ONE' &&
    s.map !== '$lightmap'
  );
  
  return hasLightmap && hasAdditiveStage;
}
```

### Stage Classification

| Stage Pattern | Role | UV Channel |
|---------------|------|------------|
| `map <texture>` (first) | Base | UV1 |
| `map $lightmap` | Lightmap | UV2 |
| `map <texture>, blendFunc add` | Glow | UV1 |

---

## Implementation Status

- [x] Pattern analysis utility (`Q3ShaderMaterialFactory.analyzeShaderPattern`)
- [x] GlowOverlayShaderMaterial class (custom GLSL)
- [x] Integration with BspMeshBuilder
- [x] Animation support (UV offsets ready)
- [x] Console commands for debugging (`shader glow`, `shader lightmap`, `shader blendmode`)
- [x] Alpha blend mode support for `blendFunc blend` glow stages

## Known Limitations

### 1. `if/endif` Conditional Blocks Not Parsed
Q3/Warsow shaders can have conditional blocks like:
``` 
if ! deluxe
  { ... stages ... }
endif
if deluxe
  { ... stages ... }
endif
``` 
Currently, **all stages from all blocks are merged**, causing duplicate or incorrect stages.

**Affected shaders:** `textures/boqu/lightstripe_blue_800` and similar.

**Workaround:** None currently. These shaders may render incorrectly.

### 2. `material` Directive Not Supported
The `material` directive used in deluxe lighting paths is not parsed:
``` 
material textures/foo.tga textures/foo_norm.tga textures/foo_gloss.tga textures/foo_glow.tga
``` 

### 3. Complex Multi-Stage Shaders
Shaders with more than 3 stages or unusual blend combinations may not render correctly.

### 4. Glow Texture Alpha
If the glow texture has `alpha=1.0` everywhere, alpha-blend mode will completely replace the base texture. Use `shader blendmode add` as a workaround.

---

## Implementation Steps

### Phase 1: Glow-Specific NodeMaterial Builder

Create a specialized builder for the glow overlay pattern:

```typescript
// src/engine/loader/shader/GlowOverlayMaterialBuilder.ts

export class GlowOverlayMaterialBuilder {
  static build(
    name: string,
    baseTexture: Texture,
    lightmapTexture: Texture,
    glowTexture: Texture,
    scene: Scene
  ): NodeMaterial {
    // 1. Create NodeMaterial
    // 2. Add position/vertex output
    // 3. Add UV1 input (base + glow)
    // 4. Add UV2 input (lightmap)
    // 5. Add texture blocks
    // 6. Base * Lightmap -> Multiply
    // 7. Result + Glow -> Add
    // 8. Connect to fragment output
  }
}
```

### Phase 2: Integration with BspMeshBuilder

```typescript
// In BspMeshBuilder.applyTextures()

if (needsGlowOverlayNodeMaterial(shader)) {
  // Load all textures
  const baseTex = await loadStageTexture(shader.stages[0]);
  const glowTex = await loadGlowTexture(shader);
  const lightmapTex = result.lightmapTextures[lightmapIndex];
  
  // Build NodeMaterial
  const mat = GlowOverlayMaterialBuilder.build(
    texName, baseTex, lightmapTex, glowTex, scene
  );
  
  mesh.material = mat;
}
```

### Phase 3: Texture Loading

Need to load the glow texture from the shader's additive stage:

```typescript
function findGlowTexturePath(shader: Q3Shader): string | null {
  for (const stage of shader.stages) {
    if (stage.map === '$lightmap') continue;
    if (stage.blendFunc?.[0] === 'GL_ONE' && stage.blendFunc?.[1] === 'GL_ONE') {
      return stage.map;
    }
  }
  return null;
}
```

---

## Key Differences from Previous Attempt

### Why Previous NodeMaterial Failed

1. **Applied to ALL multi-stage shaders** - broke transparency
2. **Didn't handle lightmap correctly** - needed UV2
3. **No stage classification** - just chained everything

### This Approach

1. **Targeted pattern** - only glow overlay shaders
2. **Explicit lightmap handling** - uses UV2
3. **Simple 3-node graph** - base * lightmap + glow
4. **Fallback** - if NodeMaterial fails, use StandardMaterial

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `GlowOverlayMaterialBuilder.ts` | **NEW** - Specialized NodeMaterial builder |
| `Q3ShaderRegistry.ts` | Add `needsGlowOverlay` detection |
| `Q3ShaderTypes.ts` | Add `isGlowOverlay` to ResolvedMaterialProps |
| `BspMeshBuilder.ts` | Integrate glow overlay building |

---

## Testing

### Shaders to Test
- `textures/boqu/lightstripe_blue_800` - Blue light strip
- `textures/boqu/lightstripe_*` - All light strip variants
- Other 3-stage glow shaders in Warsow maps

### Expected Console Output
```
[GlowOverlayMaterialBuilder] Building glow overlay: textures/boqu/lightstripe_blue_800
  Base: textures/boqu/lightstripe_blue.tga
  Glow: textures/boqu/lightstripe_blue_glow.tga
  Lightmap: index 5
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| NodeMaterial build fails | Fall back to StandardMaterial with emissive |
| Performance impact | Only applies to glow overlay shaders (~5-10 per map) |
| Lightmap UV mismatch | Use mesh UV2 attribute explicitly |
| Glow texture missing | Skip glow stage, render base + lightmap only |

---

## Open Questions

1. **tcMod on glow?** - Some glow textures might animate. Need to add UV offset inputs.

2. **Multiple glow stages?** - Rare, but possible. Start with single glow stage.

3. **Alpha handling?** - If glow has alpha, should it affect final alpha?

---

## Estimated Effort

- **GlowOverlayMaterialBuilder:** ~1 hour
- **Detection logic:** ~15 minutes
- **Integration:** ~30 minutes
- **Testing:** ~30 minutes
- **Total:** ~2-2.5 hours
