# Rendering Pipeline

> From zero to final frame — how a Warsow map becomes pixels on screen.

## Overview

The rendering pipeline takes Warsow/Quake 3 BSP maps packaged in PK3 archives and renders them using Babylon.js. The pipeline handles coordinate system conversion (Q3 Z-up → Babylon Y-up), Warsow's shader system (with template extensions), multiple material strategies, and a suite of post-processing effects.

```mermaid
flowchart LR
    PK3["📦 PK3 Archive"] --> LOAD["Asset Loading"]
    LOAD --> BSP["BSP Parsing"]
    BSP --> SHADER["Shader Processing"]
    BSP --> MESH["Mesh Building"]
    SHADER --> MAT["Material Creation"]
    MAT --> MESH
    MESH --> SCENE["Scene Assembly"]
    SCENE --> LIGHT["Lighting"]
    LIGHT --> FX["Effects & Post"]
    FX --> FRAME["🖥️ Final Frame"]
```

---

## 1. Asset Loading

Assets live in **PK3 archives** (ZIP files). The loader extracts textures, shaders, BSP maps, and models.

```mermaid
flowchart TD
    subgraph PK3["PK3Loader"]
        MOUNT["Mount PK3 Archive"] --> INDEX["PK3Index<br/>Build file lookup table"]
        INDEX --> TEX_LOAD["PK3TextureLoader<br/>Extract & decode images"]
        INDEX --> SHADER_LOAD["Extract .shader files"]
        INDEX --> BSP_LOAD["Extract .bsp file"]
    end

    TEX_LOAD --> TEX_CACHE["Texture Cache<br/>(Babylon Texture objects)"]
    SHADER_LOAD --> PARSER["Q3ShaderParser"]
    BSP_LOAD --> BSP_PARSE["BspLoader"]
```

| File | Role |
|---|---|
| `PK3Loader.ts` | Mount ZIP archives, file extraction |
| `PK3Index.ts` | O(1) file path lookup across all mounted PK3s |
| `PK3TextureLoader.ts` | Load textures (TGA, JPG, PNG) from PK3 into Babylon `Texture` objects |

---

## 2. BSP Parsing

`BspLoader` parses both **IBSP v46** (Quake 3) and **FBSP v1** (Warsow/qfusion) binary formats.

```mermaid
flowchart TD
    subgraph BspLoader["BspLoader.parse()"]
        HEADER["Read Header<br/>Magic: IBSP or FBSP"] --> LUMPS["Parse 17 Lumps<br/>(offset + length table)"]
        LUMPS --> ENTITIES["Lump 0: Entities<br/>(key-value text)"]
        LUMPS --> TEXTURES["Lump 1: Textures<br/>(shader references)"]
        LUMPS --> VERTS["Lump 10: Vertices<br/>IBSP: 44 bytes<br/>FBSP: 68 bytes"]
        LUMPS --> FACES["Lump 13: Faces<br/>(polygon, patch, mesh, billboard)"]
        LUMPS --> LIGHTMAPS["Lump 14: Lightmaps<br/>IBSP: 128×128<br/>FBSP: 512×512"]
        LUMPS --> VIS["Lump 16: Vis Data<br/>(PVS bit vectors)"]
        LUMPS --> BRUSHES["Lumps 8-9: Brushes<br/>(collision geometry)"]
        LUMPS --> NODES["Lumps 3-6: BSP Tree<br/>(nodes, leafs)"]
    end

    ENTITIES --> ENTITY_PARSE["Parse Entity Strings<br/>→ BspEntity[]"]
    VERTS --> VERT_CONVERT["FBSP: 4 lightmap slots<br/>4 vertex colors"]
    LIGHTMAPS --> LM_TEX["Build Lightmap<br/>Texture Atlas"]
```

### FBSP vs IBSP Differences

| Feature | IBSP (Quake 3) | FBSP (Warsow) |
|---|---|---|
| Lightmap size | 128×128 | **512×512** |
| Lightmap slots per vertex | 1 | **4** (lightstyles) |
| Vertex colors | 1 RGBA | **4 RGBA** |
| Vertex size | 44 bytes | **68 bytes** |
| Face lightmap indices | 1 | **4** |

---

## 3. Warsow Shader System

Warsow shaders extend Q3's shader format with a **template system** for shader reuse.

```mermaid
flowchart TD
    subgraph ShaderPipeline["Shader Pipeline"]
        FILES[".shader files<br/>(from PK3)"] --> TOKENIZE["Tokenize<br/>(strip comments, handle quotes)"]
        TOKENIZE --> TEMPLATES{"Has template<br/>definition?"}
        TEMPLATES -->|Yes| STORE_TPL["Store Template<br/>(name → body tokens)"]
        TEMPLATES -->|No| PARSE_BODY["Parse Shader Body"]
        
        PARSE_BODY --> GLOBAL["Global Directives<br/>surfaceparm, cull,<br/>deformVertexes, sort"]
        PARSE_BODY --> STAGES["Parse Stages<br/>(inner { } blocks)"]
        
        STAGES --> MAP["map directive<br/>(texture path)"]
        STAGES --> BLEND["blendFunc<br/>(src, dst factors)"]
        STAGES --> TCMOD["tcMod<br/>(scroll, rotate, scale,<br/>turb, stretch)"]
        STAGES --> RGBGEN["rgbGen<br/>(wave, vertex, entity,<br/>const, identity)"]
        STAGES --> ALPHAGEN["alphaGen<br/>(wave, vertex, entity)"]
        STAGES --> TCGEN["tcGen<br/>(environment, lightmap,<br/>base)"]
        STAGES --> ALPHAFUNC["alphaFunc<br/>(GT0, LT128, GE128)"]
    end

    PARSE_BODY --> REGISTRY["Q3ShaderRegistry<br/>Map&lt;textureName, Q3Shader&gt;"]
```

### Template Example (Warsow-specific)

```c
// Template definition
template mycoolshader,<base>,<glow>
{
    { map $1 }              // $1 = <base> parameter
    { map $lightmap }
    { map $2; blendFunc add } // $2 = <glow> parameter
}

// Template usage
textures/mymap/wall1
  mycoolshader,textures/mymap/wall1,textures/mymap/wall1_glow
```

---

## 4. Material Creation

`Q3ShaderMaterialFactory` detects shader patterns and routes to the optimal Babylon.js material type.

```mermaid
flowchart TD
    SHADER["Q3Shader"] --> ANALYZE["analyzeShaderPattern()"]
    
    ANALYZE --> PAT{"Detected Pattern"}
    
    PAT -->|"base + lightmap<br/>(2-stage standard)"| STD["StandardMaterial<br/>diffuse × lightmap"]
    PAT -->|"base + lightmap + glow<br/>(3-stage emissive)"| GLOW["GlowOverlayShaderMaterial<br/>(custom GLSL)"]
    PAT -->|"multi-stage complex<br/>(blending, animation)"| NODE["Q3NodeMaterialBuilder<br/>(Babylon NodeMaterial)"]
    PAT -->|"filter/multiply blend<br/>(decals, graffiti)"| FILTER["FilterBlendShaderMaterial<br/>(luminance→alpha)"]
    PAT -->|"additive-only<br/>(flares, halos)"| ADD["StandardMaterial<br/>+ additive blending"]
    PAT -->|"no shader definition"| FALLBACK["Fallback StandardMaterial<br/>texture-only"]

    STD --> REG_ANIM{"Has tcMod<br/>or rgbGen?"}
    NODE --> REG_ANIM
    REG_ANIM -->|Yes| ANIM_SYS["Register with<br/>ShaderAnimationSystem"]
    REG_ANIM -->|No| DONE["Material Ready"]
    ANIM_SYS --> DONE
```

### Material Types Detail

| Material | When Used | How It Works |
|---|---|---|
| **StandardMaterial** | Simple base+lightmap, additive glow | Babylon built-in, `diffuseTexture × lightmapTexture` |
| **GlowOverlayShaderMaterial** | 3-stage: base + lightmap + glow | Custom GLSL: `(base × lightmap) + glow`. Supports additive and alpha blend modes |
| **Q3NodeMaterialBuilder** | Multi-stage shaders with complex blending | Babylon NodeMaterial graph: per-stage texture nodes with blend operations |
| **FilterBlendShaderMaterial** | Decals, graffiti (`blendFunc filter`) | Custom GLSL: computes alpha from inverse luminance (Q3's GL_DST_COLOR, GL_ZERO) |
| **Fallback** | No shader defined | StandardMaterial with just the diffuse texture |

---

## 5. Mesh Building

`BspMeshBuilder` converts BSP face data into Babylon.js meshes with proper coordinate transformation.

```mermaid
flowchart TD
    subgraph BspMeshBuilder["BspMeshBuilder.buildAll()"]
        FACES["BSP Faces"] --> FILTER["Filter Tool Textures<br/>(clip, caulk, trigger, skip)"]
        FILTER --> GROUP["Group by Texture Index"]
        
        GROUP --> TYPE{"Face Type?"}
        TYPE -->|"Type 1: Polygon"| POLY["Build Polygon Mesh<br/>(pre-triangulated)"]
        TYPE -->|"Type 2: Patch"| PATCH["Tessellate Bézier Patch<br/>(subdivision surface)"]
        TYPE -->|"Type 3: Mesh"| SOUP["Build Triangle Soup<br/>(misc_model)"]
        TYPE -->|"Type 4: Billboard"| SPRITE["Build Billboard Sprite<br/>(autosprite/autosprite2)"]

        POLY --> COORD["Coordinate Conversion<br/>Q3 (X,Y,Z) → Babylon (X,Z,Y)"]
        PATCH --> COORD
        SOUP --> COORD
        SPRITE --> COORD

        COORD --> WINDING["Reverse Triangle Winding<br/>(handedness change)"]
        WINDING --> MERGE["Merge by Texture<br/>(batch into single mesh)"]
        MERGE --> ASSIGN["Assign Materials<br/>(from ShaderRegistry)"]
    end

    ASSIGN --> LIGHTMAP["Apply Lightmap Texture<br/>(UV2 channel)"]
    LIGHTMAP --> SKY{"Is Sky Shader?"}
    SKY -->|Yes| SKY_BOX["Create Skybox<br/>(6-face cube)"]
    SKY -->|No| WORLD["World Mesh"]

    WORLD --> FOG["Apply Fog Volumes<br/>(BspFogVolume)"]
```

### Coordinate System

```
Q3 Engine (Z-up, right-handed):     Babylon.js (Y-up, left-handed):
    Z (up)                               Y (up)
    |                                    |
    |__ Y (forward)                      |__ Z (forward)
   /                                    /
  X (right)                            X (right)

Transform: (x, y, z) → (x, z, y) + reverse triangle winding
```

### Fog Volumes (BSP Effects Lump)

`BspFogVolume` extracts volumetric fog regions from BSP brush geometry. Each fog volume is a convex brush with a custom GLSL shader that computes distance-based fog:

```
fogFactor = clamp(cameraDistance / depthForOpaque, 0.0, 0.85)
```

---

## 6. Entity Rendering

`MapRenderer.renderEntities()` processes BSP entities into scene objects. `BspEntityHandlers` handles brush-model entities.

```mermaid
flowchart TD
    subgraph MapRenderer["MapRenderer.renderEntities()"]
        ENTITIES["BSP Entities"] --> CLASSIFY{"Entity Type"}
        
        CLASSIFY -->|"info_player_start<br/>info_player_deathmatch"| SPAWN["Set Spawn Points"]
        CLASSIFY -->|"light"| DYN_LIGHT["Create Point Light<br/>(color, radius, intensity)"]
        CLASSIFY -->|"misc_model<br/>misc_mapmodel"| MODEL["Load GLB/glTF Model<br/>(async)"]
        CLASSIFY -->|"func_door"| DOOR["BspEntityHandlers<br/>Build Brush Model +<br/>Door Animation"]
        CLASSIFY -->|"worldspawn"| WORLD_CFG["Parse Map Settings<br/>(sky, fog, ambient)"]
        CLASSIFY -->|"weapon_*<br/>ammo_*<br/>item_*"| PICKUP["Create Pickup Entity<br/>(Havok physics drop + settle)"]
        CLASSIFY -->|"target_speaker"| AUDIO["Register Audio Source"]
    end

    DYN_LIGHT --> CLUSTER["Clustered Lighting<br/>(Babylon ClusteredLight)"]
    MODEL --> TAG["Tag as Map-Owned<br/>(for cleanup)"]
    DOOR --> TAG
```

### Skybox Rendering

`SkyboxLoader` creates a Babylon skybox from Q3 sky shaders. Q3 sky shaders define 6 face textures (`_ft`, `_bk`, `_lf`, `_rt`, `_up`, `_dn`) which are assembled into a cube texture.

---

## 7. Lighting Systems

```mermaid
flowchart TD
    subgraph Lighting["Lighting Pipeline"]
        BSP_LM["BSP Lightmaps<br/>(baked static GI)"] --> LM_TEX["Lightmap Textures<br/>(uploaded to GPU)"]
        LM_TEX --> LM_UV["Applied via UV2<br/>(lightmap channel)"]

        ENTITY_LIGHTS["Entity Lights<br/>(point lights from BSP)"] --> CLUSTERED["ClusteredLightContainer<br/>(Babylon clustered forward)"]

        SKY_SYS["SkyLightSystem<br/>(directional + hemisphere)"] --> AMBIENT["Ambient + Directional<br/>Sun Light"]
        
        STREET["StreetLampSystem<br/>(volumetric spots)"] --> SPOT["SpotLight Instances<br/>(configured per entity)"]
    end

    LM_UV --> SHADE["Final Shading"]
    CLUSTERED --> SHADE
    AMBIENT --> SHADE
    SPOT --> SHADE
```

---

## 8. Shader Animation (Per-Frame)

`ShaderAnimationSystem` drives all runtime shader effects via a single `onBeforeRender` observer.

```mermaid
flowchart TD
    subgraph AnimLoop["ShaderAnimationSystem.update() — Every Frame"]
        DT["Get deltaTime"] --> ENTRIES["For Each Registered Material"]
        
        ENTRIES --> TCMOD{"Has tcMod?"}
        TCMOD -->|scroll| SCROLL["Accumulate UV offset<br/>u += speed_u × dt<br/>v += speed_v × dt"]
        TCMOD -->|rotate| ROTATE["Accumulate rotation angle<br/>θ += degsPerSec × dt"]
        TCMOD -->|scale| SCALE["Set UV scale"]
        TCMOD -->|turb| TURB["Sine-based UV distortion<br/>offset = amp × sin(freq×t + phase)"]
        TCMOD -->|stretch| STRETCH["Sine-based UV scale<br/>scale = 1/(wave(t))"]
        
        ENTRIES --> RGBGEN{"Has rgbGen wave?"}
        RGBGEN -->|Yes| WAVE_RGB["Evaluate wave function<br/>color = base + amp × wave(freq×t + phase)"]
        
        ENTRIES --> ALPHAGEN{"Has alphaGen wave?"}
        ALPHAGEN -->|Yes| WAVE_ALPHA["Evaluate wave function<br/>alpha = base + amp × wave(freq×t + phase)"]
    end

    SCROLL --> APPLY["Apply to Material<br/>texture.uOffset / vOffset<br/>material.diffuseColor<br/>material.alpha"]
    ROTATE --> APPLY
    TURB --> APPLY
    WAVE_RGB --> APPLY
    WAVE_ALPHA --> APPLY
```

### Wave Functions

| Function | Formula | Used For |
|---|---|---|
| `sin` | `sin(2π × freq × t + phase)` | Pulsing lights, water |
| `triangle` | Triangle wave | Smooth oscillation |
| `square` | Sign of sine | Blinking |
| `sawtooth` | `frac(freq × t + phase)` | Scrolling |
| `inversesawtooth` | `1 - frac(...)` | Reverse scrolling |
| `noise` | Random per-frame | Flickering |

---

## 9. Game Effects Layer

Visual effects rendered on top of the world geometry:

```mermaid
flowchart TD
    subgraph GameEffects["Per-Frame Effects"]
        REMOTE["RemotePlayerRenderer<br/>(interpolated hitbox meshes)"]
        PROJ["ProjectileManager<br/>(rocket, grenade, shaft trails)"]
        GIBS["GibSystem<br/>(death debris physics)"]
        RAGDOLL["RagdollSystem<br/>(Havok-driven skeleton ragdolls)"]
        DMG_NUM["DamageNumbers<br/>(floating damage text)"]
        CARTOON["CartoonHitEffect<br/>(POW! sprite billboards)"]
        CHARGE["Charge Glow<br/>(pulsing PointLight for blade charge)"]
        WEAPON["WeaponViewManager<br/>(1st person weapon model)"]
        HITSCAN["HitscanEffects<br/>(beam trails, LG shaft)"]
        DROPPED["DroppedWeaponRenderer<br/>(dropped weapon models)"]
    end

    subgraph Sprites["Sprite System"]
        BILLBOARD["BillboardSprite<br/>Camera-facing quads"]
        BILLBOARD --> ANIM_SPR["SpriteSheet Animation<br/>(frame-based UV updates)"]
        BILLBOARD --> DIR_SPR["8-Directional Sprites<br/>(facing angle → sprite row)"]
        BILLBOARD --> LIGHT_SPR["Dynamic Sprite Lighting<br/>(sample nearby PointLights)"]
        BILLBOARD --> SHADOW_SPR["Sprite Shadows<br/>(ground ellipse projections)"]
    end

    subgraph Weather["Weather Effects"]
        RAIN["RainEffect<br/>(particle rain + splash)"]
        FOG_FX["FogEffect<br/>(distance + height fog)"]
        DEBRIS["LocalDebrisEffect<br/>(floating particles)"]
        WIND["WindSystem<br/>(affects particles)"]
        THUNDER["ThunderEffect<br/>(flash + sound)"]
    end
```

---

## 10. Runtime Configuration

`RenderVars` provides Q3/Warsow-style `r_*` console variables for runtime rendering tuning. Values persist to `localStorage`.

| Variable | Description | Range |
|---|---|---|
| `r_normalmap` | Normal/bump map intensity | 0–4 |
| `r_glossmap` | Gloss/specular intensity | 0–4 |
| `r_lightmap` | Lightmap brightness | 0–4 |
| `r_glow` | Additive glow intensity | 0–4 |
| `r_bloom` | Post-processing bloom multiplier | 0–3 |
| `r_exposure` | Exposure multiplier | 0–3 |
| `r_contrast` | Contrast adjustment | 0–3 |
| `r_daynight_*` | Day/night cycle parameters | varies |

---

## 11. Post-Processing Pipeline

Applied after all geometry and effects are rendered:

```mermaid
flowchart LR
    SCENE_RENDER["Scene Render<br/>(all geometry)"] --> CEL["CelOutlinePostProcess<br/>Depth-based edge detection<br/>(Warsow-style toon outlines)"]
    CEL --> BLOOM["Bloom<br/>(bright object glow)"]
    BLOOM --> VIGNETTE["Vignette<br/>(edge darkening)"]
    VIGNETTE --> COLOR["Color Grading<br/>(day/night mood)"]
    COLOR --> SSAO["SSAO<br/>(ambient occlusion, optional)"]
    SSAO --> CHROMA["Chromatic Aberration<br/>(optional)"]
    CHROMA --> FINAL["🖥️ Final Frame"]
```

### CelOutlinePostProcess (Warsow-style)

Custom GLSL post-process that reads the depth buffer:

1. **Depth edge detection** — Samples 4 neighbors, computes depth gradient relative to center depth
2. **Normal reconstruction** — Reconstructs surface normals from depth, compares via dot product
3. **Bright fade** — Outlines fade on bright surfaces to avoid over-darkening
4. **Mesh exclusion** — Projectiles, particles, and UI elements are excluded from the depth pass

---

## Full Pipeline: End-to-End

```mermaid
flowchart TD
    subgraph LOAD["① Asset Loading"]
        PK3["PK3 Archives"] --> PK3L["PK3Loader"]
        PK3L --> TEXTURES["Textures"]
        PK3L --> SHADERS[".shader Files"]
        PK3L --> BSP_FILE[".bsp File"]
    end

    subgraph PARSE["② Parsing"]
        BSP_FILE --> BSP_PARSE["BspLoader.parse()<br/>IBSP/FBSP binary → BspFile"]
        SHADERS --> SHADER_PARSE["Q3ShaderParser<br/>tokenize → parse stages"]
        SHADER_PARSE --> REGISTRY["Q3ShaderRegistry<br/>O(1) shader lookup"]
    end

    subgraph BUILD["③ Build"]
        BSP_PARSE --> MESH_BUILD["BspMeshBuilder<br/>faces → meshes<br/>coord convert<br/>winding reverse"]
        REGISTRY --> MAT_CREATE["Q3ShaderMaterialFactory<br/>pattern detect →<br/>material routing"]
        MAT_CREATE --> MESH_BUILD
        BSP_PARSE --> ENTITY_RENDER["MapRenderer<br/>entities → scene objects"]
        BSP_PARSE --> COLLISION["BSPCollisionWorld<br/>brushes → collision"]
        BSP_PARSE --> FOG_BUILD["FogVolumeManager<br/>effects lump → fog meshes"]
    end

    subgraph RUNTIME["④ Per-Frame"]
        ANIM["ShaderAnimationSystem<br/>tcMod, rgbGen, alphaGen"]
        EFFECTS["GameEffects<br/>players, projectiles,<br/>gibs, weapons, sprites"]
        WEATHER["Weather<br/>rain, fog, debris"]
        RVARS["RenderVars<br/>r_* runtime tuning"]
    end

    subgraph POST["⑤ Post-Processing"]
        CEL_OUT["CelOutlinePostProcess"]
        PIPELINE["DefaultRenderingPipeline<br/>bloom, vignette,<br/>color grading, SSAO"]
    end

    MESH_BUILD --> SCENE["Babylon Scene"]
    ENTITY_RENDER --> SCENE
    FOG_BUILD --> SCENE
    COLLISION --> PHYSICS["Physics / Prediction"]
    
    SCENE --> ANIM
    SCENE --> EFFECTS
    SCENE --> WEATHER
    RVARS --> ANIM
    
    ANIM --> RENDER["Babylon Render Loop"]
    EFFECTS --> RENDER
    WEATHER --> RENDER
    
    RENDER --> CEL_OUT
    CEL_OUT --> PIPELINE
    PIPELINE --> FRAME["🖥️ Final Frame"]
```

---

## Key Source Files

| Stage | File | Lines | Responsibility |
|---|---|---|---|
| Asset Loading | `PK3Loader.ts` | — | Mount ZIP, extract files |
| Asset Loading | `PK3Index.ts` | — | O(1) file path lookup |
| Asset Loading | `PK3TextureLoader.ts` | — | Load TGA/JPG/PNG from PK3 |
| BSP Parsing | `BspLoader.ts` | 1,107 | Parse IBSP/FBSP binary |
| Mesh Building | `BspMeshBuilder.ts` | 2,164 | Faces → Babylon meshes |
| Fog Volumes | `BspFogVolume.ts` | 867 | BSP fog → custom GLSL volumes |
| Entity Handlers | `BspEntityHandlers.ts` | 263 | func_door brush model + animation |
| Skybox | `SkyboxLoader.ts` | — | Q3 sky faces → cube texture |
| Shader Parsing | `Q3ShaderParser.ts` | 899 | Parse .shader syntax + templates |
| Shader Registry | `Q3ShaderRegistry.ts` | 366 | O(1) shader lookup, material props |
| Material Factory | `Q3ShaderMaterialFactory.ts` | 394 | Pattern detection + material routing |
| Node Materials | `Q3NodeMaterialBuilder.ts` | 326 | Multi-stage → NodeMaterial graph |
| Glow Overlay | `GlowOverlayShaderMaterial.ts` | 225 | Custom GLSL: base × lightmap + glow |
| Filter Blend | `FilterBlendShaderMaterial.ts` | 142 | Custom GLSL: luminance → alpha decals |
| Animation | `ShaderAnimationSystem.ts` | 415 | Per-frame tcMod/rgbGen/alphaGen |
| Sprites | `BillboardSprite.ts` | 492 | Camera-facing animated sprites |
| Sprites | `SpriteSheet.ts` / `SpriteManager.ts` | — | Frame-based animation + 8-dir |
| Entity Rendering | `MapRenderer.ts` | 979 | Entities → scene objects + lighting |
| Render Variables | `RenderVars.ts` | 858 | Q3-style r_* console variables |
| Lighting | `SkyLightSystem.ts` | — | Directional + hemisphere ambient |
| Lighting | `StreetLampSystem.ts` | — | Volumetric spot lights |
| Cel Outlines | `CelOutlinePostProcess.ts` | 364 | Depth-based toon outlines |
| Post-Processing | `PostProcessingManager.ts` | 578 | Bloom, vignette, SSAO, color grading |
