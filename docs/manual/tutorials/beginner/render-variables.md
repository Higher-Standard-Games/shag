# Tweaking Render Variables

**Time:** 10 minutes  
**Level:** Beginner

Adjust graphics at runtime using render variables.

## Prerequisites

- Console basics ([Using the Console](./using-console.md))
- A map loaded

## What Are Render Variables?

Render variables (r_*) control how the scene is rendered. They can be changed at runtime without restarting.

## Listing All Variables

Render variables are part of the [Cvar System](../../guides/cvar-system.md):

```
cvarlist r_
```

Shows all r_* cvars with current values:

```
 r_normalmap = "1"
 r_lightmap = "1"
 r_wireframe = "0"
...
```

Use `help r_lightmap` for detailed info on a specific cvar.

## Common Variables

### Lightmap Intensity

```
r_lightmap 0     # No lightmaps (fullbright)
r_lightmap 1     # Normal (default)
r_lightmap 2     # Brighter
r_lightmap 4     # Maximum
```

### Wireframe Mode

```
r_wireframe 1    # Enable
r_wireframe 0    # Disable
```

### Scene Wireframe

Forces all meshes to wireframe:

```
r_showtris 1     # Enable
r_showtris 0     # Disable
```

### Normal Map Intensity

```
r_normalmap 0    # Flat
r_normalmap 1    # Normal (default)
r_normalmap 2    # Enhanced
```

### Bloom Effect

```
r_bloom 0        # Off
r_bloom 1        # Normal
r_bloom 2        # Strong
```

### Light Intensity

```
r_lightintensity 0.5    # Dim
r_lightintensity 1      # Normal
r_lightintensity 2      # Bright
```

## Applying Changes

Changes apply automatically via the cvar system's onChange callbacks.

## Resetting to Defaults

```
reset r_lightmap    # Reset single cvar
resetall            # Reset all cvars to defaults
```

## Exporting Settings

Save your modified settings as text:

```
cvarexport
```

Outputs only cvars that differ from defaults:

```
r_lightmap 1.5
r_bloom 0.8
```

You can paste these commands to restore settings.

## Persistence

Most render variables persist to localStorage. Debug variables (`r_wireframe`, `r_showtris`) reset on reload.

## Performance Tips

For better FPS on slow devices:

```
r_anisotropy 1       # Lower texture filtering
r_bloom 0            # Disable bloom
r_normalmap 0        # Disable normal maps
```

For better visuals:

```
r_anisotropy 16      # Maximum filtering
r_bloom 1.5          # Enhanced bloom
r_normalmap 2        # Strong normal maps
```

## Quick Reference

| Variable | Range | Description |
|----------|-------|-------------|
| `r_normalmap` | 0-4 | Normal map intensity |
| `r_glossmap` | 0-4 | Specular intensity |
| `r_lightmap` | 0-4 | Lightmap intensity |
| `r_ambient` | 0-4 | Ambient light |
| `r_emissive` | 0-4 | Glow intensity |
| `r_anisotropy` | 1-16 | Texture filtering |
| `r_wireframe` | 0/1 | Wireframe mode |
| `r_showtris` | 0/1 | Scene wireframe |
| `r_bloom` | 0-3 | Bloom intensity |
| `r_exposure` | 0-3 | Exposure |
| `r_contrast` | 0-3 | Contrast |
| `r_lightintensity` | 0-4 | Global light |

## Next Steps

- [Building a Map Viewer](../intermediate/map-viewer.md)
- [Guide: Render Variables](../../guides/render-variables.md)
