# Render Variables (r_*)

Runtime-configurable renderer settings in Q3/Warsow style. All variables are persisted to localStorage and applied live to the scene.

## Quick Start

```
r_normalmap 2.0     # Increase normal map intensity
r_lightmap 1.5      # Brighten lightmaps
r_list              # Show all variables
r_reset             # Reset all to defaults
```

## Currently Implemented

### Material Intensities

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `r_normalmap` | 1.0 | 0-4 | Normal/bump map intensity multiplier |
| `r_glossmap` | 1.0 | 0-4 | Specular/gloss map intensity multiplier |
| `r_lightmap` | 1.0 | 0-4 | Lightmap intensity multiplier |
| `r_ambient` | 1.0 | 0-4 | Ambient light intensity multiplier |
| `r_emissive` | 1.0 | 0-4 | Emissive/glow intensity multiplier |

### Texture Quality

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `r_anisotropy` | 8 | 1-16 | Anisotropic filtering level |

### Lighting

| Variable | Default | Range | Description |
|----------|---------|-------|-----------|
| `r_lightintensity` | 1.0 | 0-4 | Global light intensity multiplier |

### Debug / Visualization

| Variable | Default | Range | Description |
|----------|---------|-------|-----------|
| `r_wireframe` | 0 | 0-1 | Wireframe mode toggle (per-material) |
| `r_showtris` | 0 | 0-1 | Force wireframe on entire scene |
| `r_shownormals` | 0 | 0-1 | Show normal direction debug colors (PBR only) |

### Display / Post-processing

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `r_bloom` | 1.0 | 0-3 | Bloom intensity multiplier |
| `r_exposure` | 1.0 | 0-3 | Exposure multiplier |
| `r_contrast` | 1.0 | 0-3 | Contrast multiplier |

> **Note:** Post-processing variables (`r_bloom`, `r_exposure`, `r_contrast`) only work on pure Babylon.js scenes. They do not affect BSP maps loaded via `scene empty` + `bsp render` (which use a separate scene without post-processing pipeline).

### Utility Commands

| Command | Description |
|---------|-------------|
| `r_list` | List all render variables and their current values |
| `r_reset` | Reset all render variables to defaults |
| `r_export` | Export render variables as config text |
| `r_apply` | Force apply render variables to current scene |

## Usage

### Getting Values
```
r_normalmap         # Prints current value, default, and range
```

### Setting Values
```
r_normalmap 2.0     # Set to 2.0
r_normalmap reset   # Reset to default
```

### Exporting Config
```
r_export            # Outputs config block you can copy/paste
```

Example output:
```
// Render variables config
r_ambient 1
r_glossmap 1.5
r_lightmap 1.2
r_normalmap 2
```

---

## Planned Variables (Roadmap)

The following variables are documented for future implementation:

### Material Intensities
| Variable | Description |
|----------|-------------|
| `r_showlightmaps` | Show only lightmaps (no diffuse) |

### Lighting
| Variable | Description |
|----------|-------------|
| `r_shadows` | Shadow intensity (0-1) or toggle |
| `r_shadowquality` | Shadow map resolution |

### Display / Post-processing
| Variable | Description |
|----------|-------------|
| `r_gamma` | Display gamma correction |
| `r_saturation` | Color saturation |

### Texture Quality
| Variable | Description |
|----------|-------------|
| `r_picmip` | Texture mipmap bias (classic Q3 style) |

### Debug / Visualization
| Variable | Description |
|----------|-------------|
| `r_showlightmaps` | Show only lightmaps (no diffuse) |

---

## Technical Details

### Persistence
- All values saved to `localStorage` under key `engine.renderVars`
- Values persist across browser sessions
- Can be exported/imported as config text

### Live Updates
- Changes apply immediately to all scene materials
- Uses `requestAnimationFrame` batching for performance
- Works with both `StandardMaterial` and `PBRMaterial`

### Babylon.js Mappings

| Variable | StandardMaterial | PBRMaterial |
|----------|------------------|-------------|
| `r_normalmap` | `bumpTexture.level` | `bumpTexture.level` |
| `r_glossmap` | `specularPower` multiplier | `reflectivityTexture.level` |
| `r_lightmap` | `lightmapTexture.level` | `lightmapTexture.level` |
| `r_ambient` | `scene.ambientColor` multiplier | `scene.ambientColor` multiplier |
| `r_emissive` | `emissiveColor` multiplier | `emissiveColor` multiplier |
| `r_anisotropy` | `*.anisotropicFilteringLevel` | `*.anisotropicFilteringLevel` |
| `r_wireframe` | `material.wireframe` | `material.wireframe` |
| `r_lightintensity` | `light.intensity` multiplier | `light.intensity` multiplier |
| `r_showtris` | `scene.forceWireframe` | `scene.forceWireframe` |
| `r_shownormals` | N/A | `material.debugMode = 2` |
| `r_bloom` | `DefaultRenderingPipeline.bloomWeight` multiplier | `DefaultRenderingPipeline.bloomWeight` multiplier |
| `r_exposure` | `imageProcessing.exposure` multiplier | `imageProcessing.exposure` multiplier |
| `r_contrast` | `imageProcessing.contrast` multiplier | `imageProcessing.contrast` multiplier |

### Adding New Variables

To add a new render variable:

1. Add definition to `DEFAULT_VARS` in `src/engine/rendering/RenderVars.ts`
2. Add type to `RenderVarName` union
3. Register console command in `src/engine/debug/EngineCommands.ts`
4. Add to `engine-commands.json` for autocomplete
5. Implement application logic in `applyToMesh()` or `applyToScene()`

---

## See Also

- [Debug Console](DEBUG_CONSOLE.md) - Full console command reference
- [Shader Commands](DEBUG_CONSOLE.md#q3-shader-commands) - Shader debugging utilities
