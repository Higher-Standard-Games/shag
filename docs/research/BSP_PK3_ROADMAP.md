# BSP/PK3 Map Support - Feature Matrix & Roadmap

This document tracks the implementation status of Quake 3 / Warsow map support in the engine.

## Version: 0.8.0 (Current Development)

---

## Feature Matrix

### PK3 System

| Feature | Status | Notes |
|---------|--------|-------|
| PK3 loading (ZIP extraction) | ✅ Done | JSZip-based |
| Multi-path support | ✅ Done | `pk3 path` command |
| PK3 manifest for browser directory listing | ✅ Done | User creates `pk3_manifest.json` |
| PK3 index system (file → package lookup) | ✅ Done | localStorage cached |
| Auto-load required PK3s for map | ✅ Done | `bsp loadrequired` |
| Texture loading from PK3 (TGA, JPG, PNG) | ✅ Done | PK3TextureLoader |
| KTX texture support | ✅ Done | KTX1 format |

### BSP Loading

| Feature | Status | Notes |
|---------|--------|-------|
| IBSP format (Quake 3) | ✅ Done | v46/v47 |
| FBSP format (Warsow) | ✅ Done | v1 |
| RBSP format (RTCW/ET) | ⚠️ Partial | Basic support |
| Vertices parsing | ✅ Done | |
| Faces parsing | ✅ Done | |
| Textures/shaders list | ✅ Done | |
| Lightmaps | ⚠️ Partial | Parsed, not applied |
| Entities | ✅ Done | Parsed to objects |
| Vis data | ❌ Not started | PVS culling |
| Collision/clip brushes | ❌ Not started | Physics |

### BSP Rendering

| Feature | Status | Notes |
|---------|--------|-------|
| Polygon faces (type 1) | ✅ Done | |
| Patch/bezier faces (type 2) | ✅ Done | Tessellated |
| Mesh faces (type 3) | ✅ Done | |
| Billboard faces (type 4) | ❌ Skipped | Sprites |
| Separate mesh per texture | ✅ Done | Good for mobile |
| Texture UV mapping | ✅ Done | |
| Lightmap UV mapping | ⚠️ Partial | UV2 prepared |
| Coordinate system conversion | ✅ Done | Q3 → Babylon.js |

### Q3 Shader System

| Feature | Status | Notes |
|---------|--------|-------|
| Shader file parsing (.shader) | ✅ Done | Q3ShaderParser |
| Shader registry with lookup | ✅ Done | Q3ShaderRegistry |
| Underscore→slash name conversion | ✅ Done | BSP compatibility |
| Incremental shader loading | ✅ Done | From multiple PK3s |
| `cull none` (double-sided) | ✅ Done | backFaceCulling |
| `cull front` | ⚠️ Partial | |
| `surfaceparm trans` | ✅ Done | isTransparent |
| `blendFunc` parsing | ✅ Done | |
| Alpha blending (SRC_ALPHA) | ⚠️ Issues | Material timing |
| Additive blending (GL_ONE) | ⚠️ Issues | |
| `alphaFunc` (alpha testing) | ✅ Done | alphaCutoff |
| `polygonOffset` (decals) | ✅ Done | zOffset |
| `tcMod` (UV animation) | ❌ Not started | scroll, rotate, etc. |
| `animMap` (frame animation) | ❌ Not started | |
| `deformVertexes` | ❌ Not started | Vertex animation |
| `fogParms` | ❌ Not started | |
| `skyParms` | ❌ Not started | Skybox |

### Console Commands

| Command | Status | Description |
|---------|--------|-------------|
| `pk3 load <file>` | ✅ Done | Load a PK3 file |
| `pk3 list [filter]` | ✅ Done | List files in loaded PK3s |
| `pk3 path <path>` | ✅ Done | Add search path |
| `pk3 index build` | ✅ Done | Index all PK3 contents |
| `pk3 index find <file>` | ✅ Done | Find which PK3 has file |
| `pk3 index search <term>` | ✅ Done | Search index |
| `pk3 index clear` | ✅ Done | Clear index |
| `bsp load <map>` | ✅ Done | Load BSP from PK3 |
| `bsp info` | ✅ Done | Show BSP details |
| `bsp render` | ✅ Done | Render BSP to scene |
| `bsp clear` | ✅ Done | Remove BSP from scene |
| `bsp textures` | ✅ Done | List textures used |
| `bsp loadrequired` | ✅ Done | Auto-load needed PK3s |
| `bsp applytextures` | ✅ Done | Apply textures to meshes |
| `bsp applylightmaps` | ✅ Done | Apply lightmaps (desktop/mobile) |
| `shader load` | ✅ Done | Load shaders from PK3s |
| `shader list [filter]` | ✅ Done | List loaded shaders |
| `shader info <name>` | ✅ Done | Show shader definition |
| `shader resolve <name>` | ✅ Done | Show resolved material props |
| `shader clear` | ✅ Done | Clear shader registry |

---

## Known Issues (v0.8.0)

1. ~~**Alpha blending timing** - Transparent textures may not render correctly if shaders load after mesh creation~~ ✅ Fixed in v0.8.1
2. **Decal z-fighting** - Some decals still flicker despite polygonOffset
3. ~~**Double extension bug** - Some texture paths get `.tga.tga`~~ ✅ Fixed in v0.8.1
4. ~~**Halo/fence overlap** - Transparency sorting issues with overlapping alpha meshes~~ ✅ Fixed in v0.8.1

---

## Roadmap

### v0.8.1 (Current)
- [x] Fix alpha blending material timing
- [x] Fix double extension texture path bug
- [x] Improve transparency sorting (alphaIndex, mustDepthSortFacets)
- [x] Apply lightmaps to materials (desktop/mobile modes)
- [x] Add `bsp applylightmaps` console command

### v0.9.0 (Future)
- [ ] `tcMod` UV animations (scroll, rotate, scale)
- [ ] `animMap` texture frame animation
- [ ] Skybox support (`skyParms`)
- [ ] Entity spawning (lights, models, items)

### v1.0.0 (Future)
- [ ] PVS visibility culling
- [ ] Collision detection with BSP brushes
- [ ] `deformVertexes` support
- [ ] Full shader stage multi-pass rendering

---

## Quick Start

```bash
# Load a Warsow map with textures
pk3 path game/basewsw/
pk3 index build
scene empty
bsp load wdm11
bsp loadrequired
shader load
bsp render
bsp applytextures
```

---

## Architecture

```
PK3Loader (singleton)
  ├── loadPK3(filename) - Load from search paths
  ├── loadPK3FromUrl(url) - Load from full URL
  ├── getFile(path) - Get file from any loaded PK3
  └── listFiles(pattern) - Glob search

PK3Index (singleton)
  ├── buildIndex() - Index all PK3 contents
  ├── findFile(path) - Find which PK3 has file
  └── getPK3Path(filename) - Get full URL for PK3

BspLoader
  ├── loadFromPK3(pk3, path) - Load BSP from PK3
  ├── parseFaces() - Parse IBSP/FBSP faces
  └── parseVertices() - Parse vertices

BspMeshBuilder
  ├── buildAll() - Create meshes per texture
  ├── buildPolygonFace() - Polygon geometry
  ├── buildPatchFace() - Bezier tessellation
  └── applyTextures() - Load and apply textures

Q3ShaderRegistry (singleton)
  ├── loadShaders() - Parse .shader files
  ├── getShader(name) - Lookup shader
  └── resolveMaterialProps() - Convert to Babylon.js

Q3ShaderParser
  └── parseShaderFile() - Parse shader text

PK3TextureLoader
  └── loadTexture(path) - Load texture from PK3
```

---

*Last updated: v0.8.0*
