# Weather Effects

The engine includes a comprehensive weather system with particle-based precipitation, atmospheric fog, and dramatic thunder/lightning effects.

## Overview

Weather effects are managed through three main classes:
- **PrecipitationEffect** - Rain and snow particles
- **ThunderEffect** - Lightning flashes with ambient darkening
- **FogEffect** - Atmospheric fog using Babylon.js fog modes

All effects are initialized automatically and accessible via console commands or programmatically.

---

## Precipitation (Rain & Snow)

### Rain

Particle-based rain that follows the camera and auto-scales to viewport size.

```javascript
// Console commands
weather.rain(true)              // Start rain
weather.rain(false)             // Stop rain
weather.rainIntensity(0.8)      // Particle density (0-1)
weather.rainSize(2)             // Drop size
weather.rainSpeed(9)            // Fall speed (default: 9)
weather.rainWind(Math.PI/4, 0.5) // Wind angle (radians) + strength (0-1)
```

### Snow

Uses the same particle system with different settings - round flakes, slower speed, gentle drift.

```javascript
// Console commands
weather.snow(true)              // Start snow
weather.snow(false)             // Stop snow
weather.snowIntensity(0.6)      // Particle density
weather.snowSize(1.5)           // Flake size
```

### Programmatic API

```typescript
import { PrecipitationEffect } from "./engine/effects/RainEffect";

const precip = new PrecipitationEffect(scene);

// Start with custom settings
precip.startRain({
  intensity: 0.7,
  speed: 9,
  particleSize: 1.5,
  windAngle: Math.PI / 6,
  windStrength: 0.3,
  opacity: 0.7
});

precip.startSnow({
  intensity: 0.6,
  speed: 1.5,
  particleSize: 1.0,
  windStrength: 0.2
});

// Update while running
precip.updateSettings({ intensity: 0.9 });

// Check state
precip.isRaining();  // boolean
precip.isSnowing();  // boolean
precip.getType();    // 'rain' | 'snow' | null

precip.stop();
```

### Settings Interface

```typescript
interface PrecipitationSettings {
  type: 'rain' | 'snow';
  intensity: number;       // 0-1, affects particle count
  speed: number;           // Fall speed multiplier
  windAngle: number;       // Wind direction in radians
  windStrength: number;    // Wind force (0-1)
  particleSize: number;    // Size of particles
  opacity: number;         // Visibility (0-1)
}
```

---

## Thunder & Lightning

Creates dramatic storm effects with random lightning flashes, ambient darkening, and sound.

### Features
- **Screen flash** - White overlay with random intensity
- **Double flashes** - Occasional secondary flash for realism
- **Ambient darkening** - Scene gets darker blue tint
- **Thunder sound** - Plays `thunderstorm.mp3` once per trigger
- **Self-fading** - Automatically ends after duration

### Console Commands

```javascript
weather.thunder()           // 3-second storm (default)
weather.thunder(5000)       // 5-second storm
weather.thunderStop()       // Stop immediately

// Combine with rain for full storm!
weather.rain(true)
weather.thunder(10000)
```

### Programmatic API

```typescript
import { ThunderEffect } from "./engine/effects/ThunderEffect";

const thunder = new ThunderEffect(scene);

thunder.trigger({
  duration: 5000,          // Storm duration (ms)
  flashInterval: 400,      // Min time between flashes
  flashVariance: 600,      // Random variance for timing
  ambientDarkness: 0.4,    // How much to darken (0-1)
  flashIntensity: 0.8      // Flash brightness (0-1)
});

thunder.isStorming();  // boolean
thunder.stop();
```

### Settings Interface

```typescript
interface ThunderSettings {
  duration: number;        // Storm duration in ms
  flashInterval: number;   // Min ms between flashes
  flashVariance: number;   // Random variance for timing
  ambientDarkness: number; // Scene darkening (0-1)
  flashIntensity: number;  // Flash brightness (0-1)
}
```

---

## Fog

Atmospheric fog using Babylon.js built-in fog system.

### Console Commands

```javascript
weather.fog(true)           // Start fog (default settings)
weather.fog(false)          // Stop fog
weather.fogDensity(0.02)    // Adjust density
weather.fogColor(0.8, 0.85, 0.9)  // Set RGB color

// Presets
weather.lightMist()         // Light, bright mist
weather.heavyFog()          // Dense, gray fog
weather.morningFog()        // Warm-tinted morning fog
weather.spookyFog()         // Dark, ominous fog
```

### Programmatic API

```typescript
import { FogEffect } from "./engine/effects/FogEffect";

const fog = new FogEffect(scene);

fog.start({
  mode: 'exp',             // 'none' | 'linear' | 'exp' | 'exp2'
  density: 0.01,           // For exponential modes
  start: 50,               // For linear mode - fog start distance
  end: 300,                // For linear mode - full fog distance
  color: { r: 0.8, g: 0.85, b: 0.9 }
});

// Presets
fog.lightMist();
fog.heavyFog();
fog.morningFog();
fog.spookyFog();

fog.isFoggy();  // boolean
fog.stop();
```

### Settings Interface

```typescript
interface FogSettings {
  mode: 'none' | 'linear' | 'exp' | 'exp2';
  density: number;         // For exponential fog
  start: number;           // Linear fog start distance
  end: number;             // Linear fog end distance
  color: { r: number; g: number; b: number };
}
```

---

## Combining Effects

Weather effects can be combined for realistic scenarios:

```javascript
// Rainstorm
weather.rain(true)
weather.thunder(8000)
weather.fogDensity(0.005)
weather.fog(true)

// Blizzard
weather.snow(true)
weather.snowIntensity(0.9)
weather.heavyFog()

// Misty morning
weather.morningFog()
weather.rainIntensity(0.2)
weather.rain(true)

// Clear weather
weather.rain(false)
weather.fog(false)
```

---

## Status Commands

```javascript
weather.isRaining()    // boolean
weather.isSnowing()    // boolean
weather.isStorming()   // boolean
weather.isFoggy()      // boolean
weather.settings()     // Returns all current settings
```

---

## Performance Notes

- **Precipitation** uses GPU-accelerated particles via Babylon.js ParticleSystem
- **Emit area** auto-scales based on camera view - only renders particles in visible area
- **Fog** uses native Babylon.js fog which is very efficient
- **Thunder** overlay is a simple DOM element with CSS transitions

For lower-end devices, reduce `intensity` for precipitation or disable fog.

---

## Future Enhancements

Planned weather features:
- [ ] Weather events system (random weather changes)
- [ ] Weather influence on gameplay (plant growth, NPC behavior)
- [ ] Puddles/wet ground shader during rain
- [ ] Snow accumulation
- [ ] Wind affecting trees/plants
