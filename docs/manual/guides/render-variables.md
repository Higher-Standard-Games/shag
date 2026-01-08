# Render Variables Guide

Runtime-configurable rendering settings.

## Overview

Render variables (r_*) allow adjusting graphics at runtime without restarting. They're inspired by Quake 3's cvar system.

## Architecture

```
RenderVars (Singleton)
    │
    ├── vars: Map<name, { value, default, min, max }>
    ├── scene: Scene
    │
    ├── get(name) → number
    ├── set(name, value)
    └── applyToScene()
```

## Available Variables

### Texture/Material

| Variable | Range | Default | Description |
|----------|-------|---------|-------------|
| `r_normalmap` | 0-4 | 1 | Normal/bump map intensity |
| `r_glossmap` | 0-4 | 1 | Specular/gloss intensity |
| `r_lightmap` | 0-4 | 1 | Lightmap intensity |
| `r_emissive` | 0-4 | 1 | Emissive/glow intensity |
| `r_anisotropy` | 1-16 | 8 | Anisotropic filtering |

### Lighting

| Variable | Range | Default | Description |
|----------|-------|---------|-------------|
| `r_ambient` | 0-4 | 1 | Ambient light intensity |
| `r_lightintensity` | 0-4 | 1 | Global light multiplier |

### Post-Processing

| Variable | Range | Default | Description |
|----------|-------|---------|-------------|
| `r_bloom` | 0-3 | 1 | Bloom intensity |
| `r_exposure` | 0-3 | 1 | Exposure multiplier |
| `r_contrast` | 0-3 | 1 | Contrast multiplier |

### Debug

| Variable | Range | Default | Description |
|----------|-------|---------|-------------|
| `r_wireframe` | 0-1 | 0 | Per-mesh wireframe |
| `r_showtris` | 0-1 | 0 | Scene wireframe |

## Using RenderVars

### Console

```
r_list                  # List all variables
r_lightmap 2            # Set value
r_reset                 # Reset to defaults
r_apply                 # Force apply to scene
r_export                # Export as commands
```

### Code

```typescript
import { RenderVars } from './engine/rendering/RenderVars';

const renderVars = RenderVars.getInstance();

// Initialize with scene
renderVars.setScene(scene);

// Get value
const lightmap = renderVars.get('r_lightmap');

// Set value
renderVars.set('r_lightmap', 2);

// Reset all
renderVars.resetAll();

// Listen for changes
renderVars.onChange('r_lightmap', (value) => {
  console.log('Lightmap changed:', value);
});
```

## Persistence

Most variables persist to localStorage automatically:

```typescript
// Saved on change
renderVars.set('r_lightmap', 2); // Saved

// Loaded on init
renderVars.loadFromStorage();
```

### Debug Variables

Debug variables (`r_wireframe`, `r_showtris`) do NOT persist - they reset on page reload.

## Application to Scene

When a variable changes, `applyToScene()` is called:

```typescript
public applyToScene(): void {
  // Apply to all materials
  for (const mesh of this.scene.meshes) {
    const material = mesh.material as StandardMaterial;
    if (!material) continue;
    
    // Apply normal map intensity
    if (material.bumpTexture) {
      material.bumpTexture.level = this.get('r_normalmap');
    }
    
    // Apply wireframe
    material.wireframe = this.get('r_wireframe') >= 0.5;
  }
  
  // Apply scene wireframe
  this.scene.forceWireframe = this.get('r_showtris') >= 0.5;
}
```

## Adding Custom Variables

```typescript
// In RenderVars.ts DEFAULT_VARS
r_myvar: {
  value: 1,
  default: 1,
  min: 0,
  max: 10,
  category: 'custom',
  description: 'My custom variable'
}
```

## Categories

Variables are grouped by category:

- `texture` - Texture/material settings
- `lighting` - Light settings
- `postprocess` - Post-processing
- `debug` - Debug visualization

## Console Commands

| Command | Description |
|---------|-------------|
| `r_list` | List all with values |
| `r_<name>` | Get value |
| `r_<name> <val>` | Set value |
| `r_reset` | Reset to defaults |
| `r_apply` | Force scene update |
| `r_export` | Export config |

## Related

- [Tutorial: Tweaking Render Variables](../tutorials/beginner/render-variables.md)
- [Tutorial: Export Settings](../tutorials/recipes/export-settings.md)
