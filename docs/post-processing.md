# Post-Processing Effects

The engine includes a `PostProcessingManager` that provides global graphics effects using Babylon.js's `DefaultRenderingPipeline`. These effects enhance the visual atmosphere of the game.

## Available Effects

### Bloom
Makes bright objects emit a soft glow. Ideal for grow lights, lamps, and emissive materials.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `enabled` | `true` | boolean | Enable/disable bloom |
| `threshold` | `0.8` | 0-1 | Brightness level that triggers glow |
| `weight` | `0.3` | 0-1 | Glow intensity |
| `kernel` | `64` | 32-128 | Blur kernel size (quality) |
| `scale` | `0.5` | 0.25-1 | Resolution scale (lower = better performance) |

### Vignette
Subtle darkening at screen edges for a cinematic feel.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `enabled` | `true` | boolean | Enable/disable vignette |
| `weight` | `0.3` | 0-1 | Darkening intensity |
| `stretch` | `0.5` | 0-1 | How much to stretch the vignette |
| `color` | `{r:0, g:0, b:0}` | RGB 0-1 | Vignette color |

### Color Grading
Adjusts exposure, contrast, and saturation. Automatically modulates based on time of day.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `enabled` | `true` | boolean | Enable/disable color grading |
| `contrast` | `1.05` | 0.5-2 | Contrast multiplier |
| `exposure` | `1.0` | 0.5-2 | Brightness multiplier |
| `saturation` | `1.1` | 0-2 | Color saturation |

**Day/Night Integration:**
- Dawn (5-7 AM): Gradually brightens
- Day (7 AM - 5 PM): Normal exposure
- Dusk (5-8 PM): Golden hour, then darkens
- Night (8 PM - 5 AM): Reduced exposure (0.7x)

### SSAO (Screen Space Ambient Occlusion)
Adds soft shadows in corners and where objects meet. Creates a more grounded, realistic feel.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `enabled` | `false` | boolean | Enable/disable SSAO |
| `radius` | `2` | 0.5-8 | Sample radius |
| `samples` | `16` | 8-32 | Quality (more = better but slower) |
| `intensity` | `1.0` | 0-2 | Shadow darkness |

> **Note:** SSAO is disabled by default due to performance impact. Enable only on capable hardware.

### Chromatic Aberration
Subtle color fringing at screen edges for a "lens" effect.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `enabled` | `false` | boolean | Enable/disable effect |
| `amount` | `0.5` | 0-1 | Effect intensity |

## Console Commands

All effects can be controlled via the browser console using the `fx` object:

```javascript
// Toggle effects
fx.bloom(true)           // Enable bloom
fx.bloom(false)          // Disable bloom
fx.vignette(true)        // Enable vignette
fx.ssao(true)            // Enable SSAO (performance heavy)
fx.chromatic(true)       // Enable chromatic aberration

// Adjust intensity
fx.bloomIntensity(0.5)   // Set bloom weight (0-1)
fx.bloomThreshold(0.7)   // Set bloom threshold (0-1)
fx.vignetteIntensity(0.4) // Set vignette weight (0-1)
fx.ssaoIntensity(1.5)    // Set SSAO strength (0-2)

// Master controls
fx.enabled(false)        // Disable ALL effects
fx.enabled(true)         // Enable ALL effects
fx.reset()               // Reset to default settings
fx.settings()            // View current settings
```

## Programmatic API

```typescript
import { PostProcessingManager } from "./engine/effects/PostProcessingManager";

const pp = PostProcessingManager.getInstance();

// Toggle effects
pp.setBloomEnabled(true);
pp.setVignetteEnabled(true);
pp.setSSAOEnabled(false);

// Adjust settings
pp.setBloomIntensity(0.4);
pp.setBloomThreshold(0.75);
pp.setVignetteIntensity(0.3);

// Bulk update
pp.updateSettings({
  bloom: { enabled: true, weight: 0.5, threshold: 0.8, kernel: 64, scale: 0.5 },
  vignette: { enabled: true, weight: 0.25, color: { r: 0, g: 0, b: 0 }, stretch: 0.5 },
});

// Get current settings
const settings = pp.getSettings();

// Reset to defaults
pp.resetToDefaults();
```

## Performance Considerations

| Effect | Performance Impact | Recommendation |
|--------|-------------------|----------------|
| Bloom | Low | Safe to enable |
| Vignette | Very Low | Safe to enable |
| Color Grading | Very Low | Safe to enable |
| SSAO | High | Disable on low-end devices |
| Chromatic Aberration | Low | Optional, stylistic choice |

### Optimization Tips

1. **Bloom Scale**: Lower `scale` (e.g., 0.25) reduces bloom resolution for better performance
2. **SSAO Samples**: Reduce `samples` to 8 for faster but lower quality AO
3. **Disable on Mobile**: Consider disabling SSAO and reducing bloom quality on mobile devices

## Future: Weather Effects

The PostProcessingManager is designed to be extended for weather effects:

```typescript
// Planned API (not yet implemented)
pp.setWeatherPreset("rain");      // Desaturated, darker
pp.setWeatherPreset("storm");     // Dark, high contrast, chromatic aberration
pp.setWeatherPreset("sunny");     // Bright, saturated
pp.setWeatherPreset("foggy");     // Low contrast, desaturated
```

Weather presets will combine multiple effects to create atmospheric conditions, potentially including:
- Particle systems (rain drops, snow)
- Screen overlays (rain on lens)
- Dynamic color grading
- Fog/depth effects
