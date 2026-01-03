# Fullbright / Lamp Shader Support

## Problem Statement

In Warsow/Quake3 maps, certain surfaces like lamp panels, glowing signs, and light strips appear **fullbright** - they maintain their full color intensity regardless of lightmap darkening. Currently in our renderer, these surfaces appear dull and dark because the lightmap is applied uniformly.

### Visual Comparison
- **Our renderer:** Lamp surfaces are dark/dull, affected by lightmap shadows
- **Warsow/Q3:** Lamp surfaces glow bright, unaffected by surrounding darkness

---

## How Q3/Warsow Does It

### Key Shader Properties

```
textures/wsw_city1/light_orange
{
  qer_editorimage textures/wsw_city1/light_orange
  q3map_surfacelight 3000        // Emit light for lightmap compile (baked)
  surfaceparm nolightmap         // Don't receive lightmap
  surfaceparm nomarks            // No decals
  {
    map textures/wsw_city1/light_orange
    rgbGen identity              // Full brightness (1,1,1)
  }
}
```

### Important Properties

| Property | Meaning |
|----------|---------|
| `surfaceparm nolightmap` | Surface doesn't use lightmap UV2 |
| `q3map_surfacelight N` | Emits light during compile (we ignore this) |
| `rgbGen identity` | Full white color modulation (no darkening) |

### What Makes a "Lamp" Shader?

1. **Has `surfaceparm nolightmap`** - Most reliable indicator
2. **Has `q3map_surfacelight`** - Indicates it's a light source
3. **Uses `rgbGen identity`** - Full brightness color
4. **No `$lightmap` stage** - Doesn't blend with lightmap

---

## Babylon.js Implementation

### The Simple Solution: Emissive Color

For fullbright surfaces, we don't need multi-pass rendering! We can simply:

1. **Skip lightmap application** for these materials
2. **Set emissive color** to make the texture appear self-lit

```typescript
// In BspMeshBuilder when applying materials
if (shaderProps.isFullbright) {
  mat.emissiveTexture = mat.diffuseTexture;  // Use same texture for emission
  mat.emissiveColor = new Color3(1, 1, 1);   // Full emission
  mat.diffuseColor = new Color3(0, 0, 0);    // No diffuse (avoid double-brightness)
  // Don't apply lightmap to this mesh
}
```

### Detection Logic

```typescript
// In Q3ShaderRegistry.resolveMaterialProps()

// Detect fullbright/lamp surfaces
const isFullbright = 
  shader.surfaceParms.has('nolightmap') ||
  (firstStage.rgbGen?.type === 'identity' && !hasLightmapStage);

if (isFullbright) {
  props.isFullbright = true;
  props.useLightmap = false;
}
```

---

## Implementation Plan

### Phase 1: Detection
- [ ] Add `isFullbright` to `ResolvedMaterialProps`
- [ ] Parse `surfaceparm nolightmap` in shader parser (already parsed!)
- [ ] Detect fullbright in `resolveMaterialProps()`
- [ ] Add console command: `shader fullbright list`

### Phase 2: Rendering
- [ ] In `BspMeshBuilder.applyTextures()`:
  - Skip lightmap for fullbright materials
  - Set emissive texture = diffuse texture
  - Set emissive color to (1,1,1)
- [ ] In `BspMeshBuilder.applyLightmaps()`:
  - Skip meshes with fullbright materials

### Phase 3: Refinement
- [ ] Handle `rgbGen identity` detection
- [ ] Consider `q3map_surfacelight` parsing (optional metadata)
- [ ] Test with various Warsow maps

---

## Files to Modify

| File | Changes |
|------|---------|
| `Q3ShaderTypes.ts` | Add `isFullbright` to ResolvedMaterialProps |
| `Q3ShaderRegistry.ts` | Detect nolightmap, rgbGen identity |
| `BspMeshBuilder.ts` | Apply emissive for fullbright, skip lightmap |
| `EngineCommands.ts` | Add debug commands |

---

## Edge Cases

### 1. Partial Fullbright
Some shaders have a diffuse texture + fullbright overlay. These would need multi-stage NodeMaterial. For v1, we'll treat the whole surface as fullbright.

### 2. Animated Lamps
Lamps with `rgbGen wave` should still animate. The animation system already handles this.

### 3. Colored Lights
Lamp textures often have colored regions. The emissive approach preserves these colors.

---

## Testing

### Maps to Test
- wdm1 - Has various lamp panels
- wdm11 - City map with many light sources
- wdm5 - Tech map with glowing surfaces

### Expected Results
- Lamp panels appear bright regardless of surrounding darkness
- Signs and glowing textures visible in dark areas
- No change to regular textured surfaces

---

## Questions

1. **Performance** - Setting emissive texture = diffuse texture means same texture used twice. Should be fine, they share GPU memory.

2. **Intensity** - Should we add a `fullbrightIntensity` config option? Q3 doesn't have this, but could be useful for tuning.

3. **Bloom** - Fullbright surfaces could benefit from post-process bloom. Future enhancement?

---

## Estimated Effort

- **Detection:** ~30 minutes
- **Rendering:** ~30 minutes  
- **Testing:** ~30 minutes
- **Total:** ~1.5 hours

This is much simpler than multi-stage NodeMaterial because we're just making surfaces emissive rather than blending multiple textures!
