# BSP Support Investigation

This document investigates adding compiled BSP map support to the SHAG Engine.

## Executive Summary

**Current State**: The engine parses `.map` text files (Q3Map2/NetRadiant editor format) and builds geometry at runtime from brush plane definitions.

**Goal**: Add support for loading compiled `.bsp` files (Quake 3, Warsow/FBSP, Q3Map2 output).

**Feasibility**: HIGH - The engine already has many prerequisite systems in place (texture loading, PK3 support, brush geometry, patches). BSP support is a natural evolution.

---

## Current Engine Capabilities

### What We Have

| Feature | Status | Notes |
|---------|--------|-------|
| .map file parsing | ✅ Complete | Valve & brushDef2 formats |
| Brush geometry (CSG) | ✅ Complete | Plane intersection algorithm |
| Bezier patches | ✅ Complete | Quadratic tessellation |
| PK3 texture loading | ✅ Complete | ZIP-based archive support |
| KTX2 compressed textures | ✅ Complete | GPU-optimized |
| Normal/gloss maps | ✅ Complete | Auto-loads `_norm`, `_gloss` |
| Entity parsing | ✅ Complete | Key-value format |
| Dynamic lighting | ✅ Complete | Day/night cycle, point lights |
| GPU instancing | ✅ Complete | For repeated models |
| Collision detection | ⚠️ Basic | Babylon.js built-in only |

### What We're Missing for BSP

| Feature | Status | BSP Impact |
|---------|--------|------------|
| BSP tree traversal | ❌ Missing | Visibility culling |
| PVS (Potentially Visible Set) | ❌ Missing | Cluster-based visibility |
| Lightmaps | ❌ Missing | Pre-baked lighting |
| BSP file parser | ❌ Missing | Binary lump format |
| Compiled collision hulls | ❌ Missing | Optimized collision |
| Shader/surface flags parsing | ⚠️ Partial | Q3 shader system |

---

## BSP Format Overview

### File Structure

BSP files use an **IBSP** format with a header and lump directory:

```
Header (8 bytes)
├── Magic: "IBSP" (4 bytes)
├── Version: 0x2E = 46 for Q3 (4 bytes)
└── Lump Directory (17 entries × 8 bytes = 136 bytes)
    └── Each: offset (4 bytes) + length (4 bytes)
```

### The 17 Quake 3 BSP Lumps

| Index | Name | Purpose |
|-------|------|---------|
| 0 | Entities | Text blob with entity definitions (same as .map) |
| 1 | Textures | Surface material references |
| 2 | Planes | BSP splitting planes |
| 3 | Nodes | BSP tree interior nodes |
| 4 | Leafs | BSP tree leaf nodes (convex regions) |
| 5 | Leaffaces | Face indices per leaf |
| 6 | Leafbrushes | Brush indices per leaf (collision) |
| 7 | Models | Brush groups (world + movers) |
| 8 | Brushes | Collision volumes |
| 9 | Brushsides | Brush face definitions |
| 10 | Vertexes | Vertex positions, UVs, normals, colors |
| 11 | Meshverts | Index buffer for mesh faces |
| 12 | Effects | Fog/shader effects |
| 13 | Faces | Renderable surfaces |
| 14 | Lightmaps | 128×128 RGB textures |
| 15 | Lightvols | Volumetric lighting for models |
| 16 | Visdata | PVS cluster visibility |

### BSP Format Variants

| Format | Magic | Version | Used By |
|--------|-------|---------|---------|
| Quake 3 BSP | IBSP | 46 (0x2E) | Quake 3, Q3Map2 |
| Wolf BSP | IBSP | 47 | Wolfenstein: ET |
| RBSP | RBSP | varies | Jedi Knight II/Academy, SOF2 |
| **FBSP (Warsow)** | **FBSP** | **1** | **Warsow, Warfork, Xonotic** |

---

## FBSP Format Deep Dive (Primary Target)

FBSP is derived from RBSP (Raven BSP) and compiled via `q3map2 -game qfusion`.

### FBSP vs Q3 IBSP Comparison

| Feature | Q3 IBSP (v46) | FBSP (v1) |
|---------|---------------|-----------|
| Magic header | `IBSP` | `FBSP` |
| Version | 46 | 1 |
| Lightmap size | 128×128 | **512×512** |
| Lightmaps per surface | 1 | **Up to 4** |
| Lightstyle support | No | **Yes (styles 0-11)** |
| Loader function | LoadIBSPFile | LoadRBSPFile |
| Max lightmapped verts | 1024 | **2048** |
| Max surface indexes | 6144 | **12288** |

### FBSP Lump Structure

FBSP uses the **same 17 lumps as Q3 IBSP** but with RBSP-style vertex format for lightstyles:

```c
// Standard Q3 vertex (drawVert_t)
struct Q3Vertex {
  float xyz[3];          // Position
  float st[2];           // Texture coords
  float lightmap[2];     // Single lightmap UV
  float normal[3];       // Normal
  byte color[4];         // Vertex color
};

// RBSP/FBSP vertex (supports multiple lightmaps)
struct FBSPVertex {
  float xyz[3];          // Position
  float st[2];           // Texture coords
  float lightmap[4][2];  // 4 lightmap UVs (for lightstyles)
  float normal[3];       // Normal
  byte color[4][4];      // 4 vertex colors (per lightstyle)
};
```

### Lightstyle Effects (Built-in)

| Style | Name | Effect |
|-------|------|--------|
| 0 | Normal | Static light |
| 1 | Flicker A | Random flicker |
| 2 | Slow Strong Pulse | Smooth sine wave |
| 3 | Candle A | Gentle flicker |
| 4 | Fast Strobe | Rapid on/off |
| 5 | Gentle Pulse | Slow fade |
| 6 | Flicker B | Different random |
| 7 | Candle B | Alternative candle |
| 8 | Candle C | Third candle variant |
| 9 | Slow Strobe | Slow on/off |
| 10 | Fluorescent Flicker | Tube light startup |
| 11 | Slow Pulse No Black | Never fully dark |

### Available Test Assets

```
public/game/
├── map_wdm11.pk3      → maps/wdm11.bsp (12.4 MB)
├── map_wdm12.pk3      → maps/wdm12.bsp
├── tex_exwsw.pk3      → Warsow textures
├── tex_lights.pk3     → Light textures
└── tex_metal.pk3      → Metal textures
```

---

## What Would BSP Support Give Us?

### 1. Performance Benefits

| Benefit | Description |
|---------|-------------|
| **PVS Culling** | Only render visible clusters (massive speedup for complex maps) |
| **Pre-computed Geometry** | No runtime CSG - vertices already triangulated |
| **Lightmaps** | High-quality pre-baked lighting without runtime cost |
| **Optimized Collision** | BSP tree + brush hulls for fast collision queries |

### 2. Content Ecosystem

- **Thousands of existing maps** from Quake 3, Warsow, OpenArena, etc.
- **Professional tooling** (NetRadiant, TrenchBroom, Q3Map2)
- **Community assets** in PK3 format

### 3. Feature Parity

Standard features expected in id Tech-style engines:
- Curved surfaces (patches) ✅ already have
- Shader system for material effects
- Area portals for indoor/outdoor transitions
- Volumetric fog regions

---

## Mobile Performance Recommendations

### Lightmap Strategy (Critical for Mobile)

| Approach | Pros | Cons | Mobile Perf |
|----------|------|------|-------------|
| **Individual Textures** | Simple, works on all devices | Many texture switches, high draw calls | Poor |
| **Texture Atlas** | Single large texture, fewer switches | Complex UV remapping, wasted space | Good |
| **WebGL2 Texture Array** | Optimal, indexed access, no atlas waste | WebGL2 only, slightly complex | Best |

**Recommendation: WebGL2 Texture Array with Atlas Fallback**

```typescript
// Lightmap storage strategy
if (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) >= 128) {
  // Use TEXTURE_2D_ARRAY - one bind, indexed in shader
  useLightmapArray(lightmaps); // 512x512 x N layers
} else {
  // Fallback to atlas - pack lightmaps into single large texture
  useLightmapAtlas(lightmaps); // 4096x4096 atlas
}
```

### PVS Culling (Biggest Performance Win)

PVS (Potentially Visible Set) is **essential for mobile**:

| Scenario | Without PVS | With PVS |
|----------|-------------|----------|
| Indoor map (10 rooms) | Render all 10 rooms | Render 1-2 visible rooms |
| Draw calls | 500+ | 50-100 |
| Mobile FPS | 15-20 | 45-60 |

**Implementation Priority**: Phase 3 (PVS) should be considered part of MVP for mobile.

### Geometry Batching

BSP faces should be batched by:
1. **Lightmap index** (minimize texture switches)
2. **Shader/material** (group similar surfaces)
3. **Visibility cluster** (cull entire batches)

```typescript
interface FaceBatch {
  lightmapIndex: number;
  shaderIndex: number;
  cluster: number;
  vertexBuffer: VertexBuffer;
  indexBuffer: IndexBuffer;
}
```

### LOD for Patches (Bezier Surfaces)

FBSP patches can be expensive. Dynamic tessellation based on distance:

| Distance | Tessellation | Triangles (5x5 patch) |
|----------|--------------|----------------------|
| Near (<100) | 8 | 512 |
| Medium (100-500) | 4 | 128 |
| Far (>500) | 2 | 32 |

### Memory Budget (Mobile)

| Component | Budget | Notes |
|-----------|--------|-------|
| Lightmaps | 32-64 MB | 512×512 × N (compress with ETC2/ASTC) |
| Geometry | 16-32 MB | Vertices + indices |
| Textures | 64-128 MB | Use existing TextureMemoryManager |
| PVS data | 1-2 MB | Bit vectors, compress well |

### Recommended Lightmap Compression

| Format | Size (512×512) | Quality | Support |
|--------|----------------|---------|---------|
| RGB8 (raw) | 768 KB | Perfect | Universal |
| ETC2 | 128 KB | Good | WebGL2 + mobile |
| ASTC 6x6 | 85 KB | Excellent | iOS, modern Android |
| BC7 | 256 KB | Excellent | Desktop only |

**Strategy**: Compress lightmaps to KTX2 with ETC2 at build time.

---

## Implementation Plan

### Phase 1: BSP Loader Foundation

**Goal**: Parse BSP file and render static world geometry

**Tasks**:
1. Create `BspLoader.ts` - Binary lump parser
2. Parse lumps: Entities, Textures, Vertexes, Faces, Meshverts
3. Convert Q3 vertices to Babylon.js mesh
4. Handle face types: polygons, patches, meshes, billboards
5. Apply existing TextureManager for materials

**Complexity**: Medium (mostly binary parsing + mesh construction)

### Phase 2: Lightmap Support

**Goal**: Render pre-baked lighting from BSP lightmaps

**Tasks**:
1. Extract 128×128 RGB lightmaps from lump
2. Create texture atlas or individual textures
3. Apply lightmap UV coordinates to geometry
4. Blend diffuse × lightmap in shader
5. Support FBSP multi-lightmap styles (optional)

**Complexity**: Medium (texture handling + shader modification)

### Phase 3: BSP Tree & PVS

**Goal**: Implement visibility culling for performance

**Tasks**:
1. Parse Nodes, Leafs, Planes lumps
2. Build BSP tree structure in memory
3. Implement point-in-leaf lookup
4. Parse Visdata (PVS bit vectors)
5. Cull non-visible clusters during render

**Complexity**: High (spatial data structure + bit manipulation)

### Phase 4: Collision System

**Goal**: Replace Babylon.js collision with BSP-based collision

**Tasks**:
1. Parse Brushes, Brushsides, Leafbrushes
2. Implement brush-based collision detection
3. Use BSP tree for spatial queries
4. Support hull expansion for player size
5. Trace rays through BSP for hit detection

**Complexity**: High (physics/collision math)

### Phase 5: Advanced Features (Optional)

- **Shader parsing**: Q3 `.shader` files for animated/blended textures
- **Fog volumes**: Per-face fog effects from Effects lump
- **Area portals**: Visibility blockers
- **Lightvols**: Volumetric lighting for dynamic objects

---

## Architecture Considerations

### Option A: Parallel Loaders

```
AssetLoader
├── MapParser.ts      (existing .map support)
└── BspLoader.ts      (new .bsp support)
    ↓
MapRenderer.ts (unified rendering)
```

**Pros**: Minimal changes to existing code
**Cons**: Some duplication

### Option B: Unified Pipeline

```
AssetLoader
├── detectFormat() → .map or .bsp
├── MapParser.ts → ParsedMap interface
└── BspLoader.ts → ParsedMap interface
    ↓
MapRenderer.ts (uses ParsedMap)
```

**Pros**: Clean abstraction
**Cons**: Requires refactoring MapRenderer

### Recommendation: Option A First, Then B

Start with parallel loaders to get BSP working, then refactor to unified pipeline once the format is well understood.

### Data Structures

```typescript
interface BspFile {
  header: BspHeader;
  entities: string;           // Raw entity text
  textures: BspTexture[];
  planes: BspPlane[];
  nodes: BspNode[];
  leafs: BspLeaf[];
  leafFaces: number[];
  leafBrushes: number[];
  models: BspModel[];
  brushes: BspBrush[];
  brushSides: BspBrushSide[];
  vertices: BspVertex[];
  meshVerts: number[];
  effects: BspEffect[];
  faces: BspFace[];
  lightmaps: Uint8Array[];    // 128×128×3 RGB each
  lightVols: BspLightVol[];
  visData: BspVisData;
}

interface BspVertex {
  position: [number, number, number];
  texCoord: [number, number];
  lmCoord: [number, number];
  normal: [number, number, number];
  color: [number, number, number, number];
}

interface BspFace {
  texture: number;
  effect: number;
  type: 1 | 2 | 3 | 4;  // polygon, patch, mesh, billboard
  firstVertex: number;
  numVertices: number;
  firstMeshVert: number;
  numMeshVerts: number;
  lmIndex: number;
  lmStart: [number, number];
  lmSize: [number, number];
  // ... patch control points if type=2
}
```

---

## Effort Estimation

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: BSP Loader | 1-2 weeks | None |
| Phase 2: Lightmaps | 1 week | Phase 1 |
| Phase 3: PVS | 1-2 weeks | Phase 1 |
| Phase 4: Collision | 2-3 weeks | Phase 3 |
| Phase 5: Advanced | Ongoing | Phase 1-2 |

**Minimum Viable BSP**: Phases 1-2 (render with lightmaps, ~2-3 weeks)
**Full BSP**: Phases 1-4 (~6-8 weeks)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Coordinate system mismatch | Rendering bugs | Q3 uses Z-up, Babylon uses Y-up (already handled for .map) |
| Lightmap UV precision | Visual artifacts | Use Float32 UVs, proper atlas padding |
| Memory usage for large maps | Performance | Lazy load lightmaps, stream geometry |
| FBSP vs IBSP differences | Loader complexity | Start with IBSP, add FBSP support later |
| Shader compatibility | Missing effects | Basic fallback materials, progressive shader support |

---

## Testing Strategy

### Test Maps
1. **Simple Q3 maps**: `test_bigbox.bsp` - single room
2. **Official Q3 maps**: `q3dm1.bsp` - known good reference
3. **Warsow maps**: Test FBSP variant
4. **Large maps**: Stress test with complex geometry

### Validation
- Compare visual output to Quake 3 / Warsow
- Verify entity parsing matches existing MapParser output
- Profile render performance with/without PVS
- Test collision accuracy vs source engine

---

## Next Steps

1. [ ] Create feature branch ✅ `feature/bsp-support-investigation`
2. [ ] Obtain test BSP files (Q3, Warsow)
3. [ ] Prototype BspLoader with header/lump parsing
4. [ ] Render first BSP geometry (no lightmaps)
5. [ ] Add lightmap support
6. [ ] Document findings and refine plan

---

## References

- [Unofficial Quake 3 Map Specs](http://www.mralligator.com/q3/) - Comprehensive BSP format documentation
- [Quake BSP Format - Quake Wiki](https://quakewiki.org/wiki/Quake_BSP_Format) - Original Quake format
- [Unvanquished BSP Documentation](https://wiki.unvanquished.net/wiki/Formats/BSP) - Modern BSP variants
- [BSP Sekai](https://github.com/zturtleman/bsp-sekai) - Multi-format BSP reference implementation
- [Blender BSP Importer](https://github.com/SomaZ/Blender_BSP_Importer) - id Tech 3 BSP importer

---

## Decisions Made

| Question | Decision | Rationale |
|----------|----------|-----------|
| **BSP variant** | FBSP (Warsow) primary | Engine goal is Warsow compatibility; test assets available |
| **Lightmap handling** | WebGL2 Texture Array + Atlas fallback | Best mobile performance with broad compatibility |
| **Collision approach** | Plan later | Focus on rendering first |
| **Shader system** | Skip for now | Use basic materials; add later if needed |

## Open Questions

1. **Lightstyle animation**: Implement full 11 styles or subset?
2. **PVS priority**: Include in MVP or Phase 2?
3. **Patch tessellation**: Static or dynamic LOD?

---

*Document created: 2026-01-02*
*Branch: feature/bsp-support-investigation*
