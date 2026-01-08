# Sky Shader Support - Design Document

## Overview

This document outlines the implementation plan for Q3/Warsow sky shader support in the engine.

## Current State

### What We Have
- `SkyParms` interface defined in `Q3ShaderTypes.ts`
- `skyparms` directive recognized but skipped in `Q3ShaderParser.ts`
- `surfaceparm sky` detection available
- `SkyLightSystem` exists for shadow/lighting

### What's Missing
- Actual `skyparms` parsing
- Skybox texture loading from PK3s
- Sky surface detection in BSP rendering
- Skybox mesh/material creation

---

## Test Case: wdm11 (stormydays)

This is our reference shader from the Warsow map `wdm11`:

```
textures/sky/stormydays
{
    qer_editorimage env/stormydays/stormydays_ft.tga
    surfaceparm noimpact
    surfaceparm nolightmap
    surfaceparm sky
    q3map_sunExt 1 1 1 100 315 40 3 16
    q3map_lightmapFilterRadius 0 8
    q3map_skyLight 100 3
    skyparms env/stormydays/stormydays - -
}
```

### Key Observations
- **Skybox path:** `env/stormydays/stormydays` (uses `env/` not `textures/`)
- **No cloud layer:** Both cloudheight and nearbox are `-`
- **Warsow-specific directives** (see below)

---

## Warsow vs Q3 Shader Differences

| Directive | Q3 | Warsow | Notes |
|-----------|-----|--------|-------|
| Sun | `q3map_sun r g b intensity yaw pitch` | `q3map_sunExt r g b intensity yaw pitch deviance samples` | Extended with soft shadows |
| Sky light | `q3map_surfacelight` | `q3map_skyLight intensity samples` | Different syntax |
| Lightmap filter | N/A | `q3map_lightmapFilterRadius self other` | Warsow addition |
| Skybox path | Usually `textures/skies/` | Often `env/` | Different convention |

### Directives We Need to Handle

**Must implement (runtime):**
- `surfaceparm sky` - Mark as sky surface
- `skyparms <farbox> <cloudheight> <nearbox>` - Skybox texture path

**Can ignore (compile-time only):**
- `q3map_sunExt` - Used by map compiler for lightmaps
- `q3map_skyLight` - Used by map compiler
- `q3map_lightmapFilterRadius` - Used by map compiler
- `qer_editorimage` - Editor preview only

---

## Q3/Warsow Sky Shader Syntax

### Basic Skybox (Q3 style)
```
textures/skies/mysky
{
    qer_editorimage textures/sky/mysky/mysky_ft.tga
    surfaceparm sky
    surfaceparm noimpact
    surfaceparm nolightmap
    q3map_sun 1 0.9 0.8 100 30 60
    q3map_surfacelight 80
    skyparms textures/sky/mysky/mysky 512 -
}
```

### Skyparms Syntax
```
skyparms <farbox> <cloudheight> <nearbox>
```
- **farbox**: Path prefix for 6 skybox textures (suffixes: `_ft`, `_bk`, `_lf`, `_rt`, `_up`, `_dn`)
- **cloudheight**: Height for cloud layer (or `-` for none)
- **nearbox**: Near skybox (usually `-` for none)

### Cloud Layers (Stage-based)
```
textures/skies/clouds
{
    surfaceparm sky
    {
        map textures/skies/clouds.tga
        tcMod scroll 0.01 0.005
        blendFunc add
    }
}
```

---

## Implementation Plan

### Phase 1: Sky Surface Detection ✅
**Goal:** Identify and skip sky faces in BSP rendering

**Tasks:**
1. Add `isSky` check to `Q3ShaderRegistry.resolveMaterialProps()`
   - Return `isSky: true` if shader has `surfaceparm sky`
2. In `BspMeshBuilder.buildBspMesh()`:
   - Check `shaderProps.isSky` for each texture group
   - Skip adding faces to mesh if `isSky === true`
   - Store sky shader name for Phase 3
3. Add `skyShaders: string[]` to `BspMeshBuildResult`

**Files to modify:**
- `src/engine/loader/Q3ShaderRegistry.ts` - Add `isSky` to resolved props
- `src/engine/loader/BspMeshBuilder.ts` - Skip sky faces, track sky shaders

### Phase 2: Skyparms Parsing ✅
**Goal:** Parse skybox texture paths from shaders

**Tasks:**
1. Update `skyparms` case in `Q3ShaderParser.ts`:
   ```typescript
   case 'skyparms':
     shader.skyParms = {
       farbox: tokens[pos + 1] !== '-' ? tokens[pos + 1] : '',
       cloudHeight: tokens[pos + 2] !== '-' ? parseFloat(tokens[pos + 2]) : 0,
       nearbox: tokens[pos + 3] !== '-' ? tokens[pos + 3] : '',
     };
     pos += 4;
     break;
   ```
2. Test with `shader info textures/sky/stormydays`

**Files to modify:**
- `src/engine/loader/Q3ShaderParser.ts`

### Phase 3: Skybox Texture Loading ✅
**Goal:** Load 6 skybox textures from PK3s

**Tasks:**
1. Create `SkyboxLoader.ts` with:
   - `loadSkyboxTextures(basePath: string, scene: Scene): Promise<CubeTexture>`
   - Load 6 textures: `_ft`, `_bk`, `_lf`, `_rt`, `_up`, `_dn`
   - Use `PK3TextureLoader` to fetch from PK3s
   - Convert to Babylon.js `RawCubeTexture`
2. Handle `env/` path prefix (Warsow convention)
3. Try multiple extensions: `.tga`, `.jpg`, `.png`

**Files to create:**
- `src/engine/loader/SkyboxLoader.ts`

### Phase 4: Skybox Mesh Creation ✅
**Goal:** Render skybox in scene

**Tasks:**
1. In `SkyboxLoader.ts` add `createSkybox(scene, cubeTexture)`:
   ```typescript
   const skybox = MeshBuilder.CreateBox("skybox", { size: 10000 }, scene);
   skybox.infiniteDistance = true;
   const mat = new StandardMaterial("skyMat", scene);
   mat.backFaceCulling = false;
   mat.reflectionTexture = cubeTexture;
   mat.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
   mat.disableLighting = true;
   mat.diffuseColor = new Color3(0, 0, 0);
   mat.specularColor = new Color3(0, 0, 0);
   skybox.material = mat;
   ```
2. Add `BspMeshBuilder.applySkybox()` static method
3. Handle coordinate system mapping (Q3 → Babylon.js)

**Files to modify:**
- `src/engine/loader/SkyboxLoader.ts`
- `src/engine/loader/BspMeshBuilder.ts`

### Phase 5: Console Commands ✅
**Goal:** Debug and control sky rendering

**Commands:**
```
bsp sky              - Show sky shader info from loaded BSP
bsp sky apply        - Create and apply skybox
bsp sky toggle       - Toggle skybox visibility
```

**Files to modify:**
- `src/engine/debug/EngineCommands.ts`

---

## Checklist for wdm11 stormydays

- [ ] `textures/sky/stormydays` detected as sky shader
- [ ] Sky faces NOT rendered as geometry (should see hole in map)
- [ ] `skyparms env/stormydays/stormydays - -` parsed correctly
- [ ] 6 textures loaded from `env/stormydays/stormydays_*`
- [ ] Skybox visible through sky openings
- [ ] Skybox matches original Warsow appearance

---

## Technical Details

### Babylon.js Skybox Options

**Option A: Built-in Skybox (Recommended)**
```typescript
const skybox = MeshBuilder.CreateBox("skybox", { size: 10000 }, scene);
const skyMaterial = new StandardMaterial("skyMat", scene);
skyMaterial.backFaceCulling = false;
skyMaterial.reflectionTexture = new CubeTexture("path/to/sky", scene);
skyMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
skyMaterial.disableLighting = true;
skybox.material = skyMaterial;
skybox.infiniteDistance = true;
```

**Option B: Custom CubeTexture from Raw Data**
```typescript
// Load 6 images from PK3
const faces = ['_rt', '_lf', '_up', '_dn', '_ft', '_bk'];
const images = await Promise.all(faces.map(f => loadTexture(basePath + f)));
const cubeTexture = new RawCubeTexture(scene, images, size);
```

### Q3 to Babylon.js Coordinate Mapping
| Q3 Suffix | Direction | Babylon.js Face |
|-----------|-----------|-----------------|
| `_ft` | Front (+X) | positiveX |
| `_bk` | Back (-X) | negativeX |
| `_lf` | Left (+Y) | positiveY |
| `_rt` | Right (-Y) | negativeY |
| `_up` | Up (+Z) | positiveZ |
| `_dn` | Down (-Z) | negativeZ |

*Note: May need rotation/flip adjustments for coordinate system differences*

---

## Testing

### Test Commands
```bash
# Load map with sky
pk3 path game/basewsw/
pk3 index build
scene empty
bsp load wdm11
bsp loadrequired
shader load
bsp render
bsp applytextures
bsp sky
```

### Verification
1. Sky faces should NOT render as geometry
2. Skybox should be visible through sky openings
3. Skybox should stay at infinite distance
4. Skybox textures should match original Warsow appearance

---

## Known Challenges

1. **Coordinate system differences** - Q3 uses different axis orientation
2. **Texture format conversion** - TGA to web-compatible format
3. **Cloud layers** - Requires `tcMod` implementation (future)
4. **Multiple sky shaders** - Some maps have multiple sky types

---

## Current Status (v0.8.2 - RELEASED)

### What Works
- ✅ Sky surface detection (`surfaceparm sky`)
- ✅ `skyparms` parsing with proper token boundary detection
- ✅ Sky faces skipped from BSP geometry rendering
- ✅ Skybox textures load from PK3s (TGA/JPG/PNG)
- ✅ RawCubeTexture creation with 6 faces
- ✅ Skybox mesh with infinite distance
- ✅ Console commands: `bsp sky info/apply/toggle/remove`
- ✅ **All 6 skybox faces align correctly!**

### Skybox Face Alignment Fix (v0.8.2)

**Status:** ✅ FIXED AND WORKING

**Root Cause Found:**
1. **Wrong suffix order**: Original code had `_ft, _bk, _lf, _rt, _up, _dn` but Q3 uses `_rt, _bk, _lf, _ft, _up, _dn`
2. **Coordinate system mapping**: Q3 uses Z-up (right-handed), Babylon uses Y-up (left-handed)
3. **Handedness correction**: Required horizontal flip for side faces
4. **Top/bottom rotation**: Required compound transforms (rotate + flip) for ceiling/floor

**Q3 Source Analysis:**
From `tr_shader.c`:
```c
static char *suf[6] = {"rt", "bk", "lf", "ft", "up", "dn"};
```

**Final Working Mapping (in SkyboxLoader.ts):**
```typescript
const Q3_FACE_SUFFIXES = ['_rt', '_bk', '_lf', '_ft', '_up', '_dn'];

// Babylon RawCubeTexture order: [nx, px, py, ny, nz, pz]
const Q3_TO_BABYLON_FACE_MAP = [
  { index: 2, transform: 'flipH' },           // slot 0: nx ← lf
  { index: 0, transform: 'flipH' },           // slot 1: px ← rt
  { index: 4, transform: 'rotate90CCW_flipH' }, // slot 2: py ← up (ceiling)
  { index: 5, transform: 'rotate90CW_flipH' },  // slot 3: ny ← dn (floor)
  { index: 1, transform: 'flipH' },           // slot 4: nz ← bk
  { index: 3, transform: 'flipH' },           // slot 5: pz ← ft
];
```

**Key Discoveries:**
- Babylon.js RawCubeTexture order is `[nx, px, py, ny, nz, pz]`, NOT `[px, py, pz, nx, ny, nz]`
- Side faces (lf, rt, bk, ft) need `flipH` for handedness correction
- Ceiling (up) needs `rotate90CCW_flipH` compound transform
- Floor (dn) needs `rotate90CW_flipH` compound transform (opposite rotation from ceiling)

### Known Limitations

1. **tex_env.pk3 not auto-loaded:** The `bsp loadrequired` command only finds PK3s 
   containing textures directly referenced by the BSP, not textures referenced by 
   shaders (like skybox textures from `skyparms`). Workaround: manual `pk3 load`.

2. **PK3s in basewsw/ fail to load:** JSZip errors when loading PK3s from 
   `game/basewsw/` path. Workaround: copy PK3s to `game/` root.

---

## Future Enhancements (v0.9.x)

- [ ] Cloud layer animation (`tcMod scroll`)
- [ ] Procedural sky option
- [ ] Sun/moon rendering from `q3map_sun`
- [ ] Fog integration
- [ ] Day/night cycle support

---

## References

- [Q3 Shader Manual - Sky](https://www.quake3world.com/q3guide/shaders.html#sky)
- [Babylon.js Skybox](https://doc.babylonjs.com/features/featuresDeepDive/environment/skybox)
- [Warsow/QFusion Source](https://github.com/Warsow/qfusion)
