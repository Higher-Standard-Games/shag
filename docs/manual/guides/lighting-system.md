# Lighting System

The engine provides comprehensive lighting support for both BSP maps and spawned models.

## BSP Lighting

### LightGrid (Static)

BSP maps contain pre-computed lighting data in a 3D grid. When models are spawned into the scene, they automatically receive lighting from this grid:

- **Ambient light** - Base illumination color
- **Directional light** - Main light direction and color
- **Automatic application** - `spawnmodel` command applies lighting automatically

### Day/Night Cycle (Dynamic)

BSP maps support dynamic day/night lighting that affects the entire scene.

#### Console Commands

```bash
# Enable developer mode first
developer 1

# Basic control
daynight on              # Enable day/night cycle
daynight off             # Disable (reset to default lighting)

# Time presets
daynight noon            # Brightest (time=0.5)
daynight midnight        # Darkest (time=0.0)
daynight sunrise         # Morning (time=0.25)
daynight sunset          # Evening (time=0.75)

# Animation
daynight start           # Start animated cycle
daynight stop            # Stop animation
daynight cycle 5         # Set 5-minute cycle length

# Manual control
daynight time 0.3        # Set specific time (0-1)
daynight info            # Show current state
```

#### Worldspawn Configuration

Map authors can configure day/night settings in the worldspawn entity:

```
// In .map file worldspawn entity:
"daynight_enabled" "1"      // Enable day/night cycle
"daynight_time" "0.25"      // Starting time (0=midnight, 0.5=noon)
"daynight_cycle" "15"       // Full cycle length in minutes
"daynight_animate" "1"      // Auto-start animation on load
```

These settings are loaded once when the map loads and cannot be overridden by triggers.

#### Visual Effects

The day/night system affects:

| Element | Effect |
|---------|--------|
| BSP geometry | Diffuse color modulation (0.1x - 1.5x) |
| Skybox | Tint from bright white to dark blue |
| Spawned models | Same modulation as world |
| Street lamps | Auto on/off at night (time < 0.2 or > 0.8) |

#### Time Scale

Time values range from 0.0 to 1.0:

| Time | Period | Lighting |
|------|--------|----------|
| 0.00 | Midnight | Darkest (0.1x intensity) |
| 0.25 | Sunrise | Morning light |
| 0.50 | Noon | Brightest (1.5x intensity) |
| 0.75 | Sunset | Evening light |
| 1.00 | Midnight | Wraps to 0.00 |

## Street Lamps

The StreetLampSystem automatically manages point lights for nighttime illumination.

### Integration with Day/Night

When the day/night cycle is active, street lamps automatically:
- Turn **ON** when time < 0.2 or time > 0.8 (night period)
- Turn **OFF** during daytime

### Creating Street Lamps

```typescript
import { StreetLampSystem } from '@engine/lighting/StreetLampSystem';

const lamps = StreetLampSystem.getInstance();
lamps.init(scene);

lamps.createLamp({
  id: 'lamp1',
  position: new Vector3(100, 200, 50),
  color: new Color3(1.0, 0.85, 0.5),  // Warm yellow
  intensity: 1.0,
  range: 100,
  turnOnHour: 18,   // 6 PM
  turnOffHour: 6,   // 6 AM
  showBulb: true,   // Visible glowing bulb
});
```

## API Reference

### SkyLightSystem

```typescript
import { SkyLightSystem } from '@engine/lighting/SkyLightSystem';

const sky = SkyLightSystem.getInstance();

// BSP Day/Night API
sky.setBspDayNightEnabled(true);     // Enable cycle
sky.setBspTimeOfDay(0.5);            // Set to noon
sky.setBspAnimating(true);           // Start animation
sky.setBspCycleLength(10);           // 10-minute cycle
sky.loadFromWorldspawn();            // Load from BSP entity

// Query state
sky.getBspTimeOfDay();               // Returns 0.0-1.0
sky.getBspCycleLength();             // Returns minutes
sky.isWorldspawnLoaded();            // True if loaded from map
```

### BspManager Lighting

```typescript
import { BspManager } from '@engine/loader/bsp/BspManager';

const bsp = BspManager.getInstance();

// Set lightmap intensity for all BSP materials
bsp.setLightmapIntensity(1.5);  // 1.0 = normal, <1 darker, >1 brighter

// Query lightgrid at position
const lighting = bsp.getLightingAt(position);
// Returns { ambient, directional, direction }
```
