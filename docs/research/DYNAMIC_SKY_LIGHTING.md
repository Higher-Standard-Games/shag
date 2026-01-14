# Dynamic Sky Lighting for BSP Maps

**Status:** Design Phase  
**Branch:** `feature/dynamic-sky-lighting`  
**Author:** Cascade  
**Date:** 2026-01-14

## Overview

Implement a day/night cycle system for BSP maps that dynamically affects world lighting. This creates immersive time-of-day changes despite BSP maps having pre-baked lightmaps.

## Goals

1. **Visual immersion** - World feels alive with changing lighting
2. **Performance** - Minimal overhead, suitable for real-time games
3. **Configurability** - Everything controllable via cvars
4. **Compatibility** - Works with existing BSP rendering pipeline

## Existing System Analysis

### SkyLightSystem.ts (src/engine/lighting/)

A comprehensive day/night system already exists for .map brushes:

**Features:**
- Sun DirectionalLight with arc movement (rises east, sets west)
- Moon DirectionalLight (opposite arc, blue tint)
- HemisphericLight for ambient with ground color
- 12 COLOR_STOPS defining beautiful transitions
- Scene clearColor (sky background) changes
- Integration with SpriteBuildingManager for tinting
- GameClock event-driven updates

**Limitations:**
- No cvar integration (hardcoded config)
- No BSP lightmap modulation
- No skybox texture/shader tinting
- Tied to GameClock only

### GameClock.ts (src/engine/core/)

Time management system:
- Configurable day length (default 3 minutes = 24h)
- Time periods: night, dawn, morning, afternoon, dusk, evening
- Event system: time_update, period_changed, day_changed
- Pause/resume support

### Integration Decision

**Extend existing SkyLightSystem** rather than replace:
1. Add cvar layer that can override GameClock
2. Add BSP-specific methods (lightmap modulation, skybox tinting)
3. Keep backward compatibility with .map brush system

## Challenges

| Challenge | Mitigation |
|-----------|------------|
| Lightmaps are pre-baked | Tint/scale lightmap contribution at runtime |
| Shadows don't move | Accept as limitation, or use additive dynamic shadows |
| Indoor areas shouldn't change like outdoor | Phase 2: outdoor detection via PVS/sky trace |
| Skybox is static texture | Apply shader tint overlay to darken at night |
| Skybox varies per map | Tint dynamically works regardless of source texture |

---

## New Features

### Skybox Shader Tinting

**Goal:** Make any skybox texture darken/tint at night without needing separate textures.

**Approach:**
```typescript
// Get skybox mesh material
const skyboxMaterial = skyboxMesh.material as StandardMaterial | PBRMaterial;

// Apply multiplicative tint based on time
// At noon: tint = (1, 1, 1) - no change
// At night: tint = (0.05, 0.05, 0.1) - dark blue
skyboxMaterial.emissiveColor = skyColor.scale(timeIntensity);
```

**For CubeTexture skyboxes:**
- Use `material.emissiveColor` as multiplier
- Or inject custom shader uniform for tint

**For Procedural/Shader skyboxes:**
- Already have clearColor which changes
- Could add overlay plane with alpha

### Moonlight (Already Exists!)

The existing `SkyLightSystem` already has moonlight:
```typescript
// Moon light (directional, opposite direction to sun)
this.moonLight = new DirectionalLight("moonLight", ...);
this.moonLight.diffuse = MOON_COLOR; // Cool blue (0.4, 0.45, 0.6)
```

Moon intensity is inverse of sun:
```typescript
const moonIntensity = Math.max(0, 1 - sunIntensity * 2) * this.config.moonIntensity;
```

**Enhancement:** Expose moon settings via cvars.

---

## Architecture

### Extending SkyLightSystem

Rather than creating new files, extend the existing system:

```
┌─────────────────────────────────────────────────────────────┐
│                   SkyLightSystem (extended)                  │
│  - Existing: sun, moon, ambient, sky color                   │
│  + NEW: cvar integration layer                               │
│  + NEW: BSP lightmap modulation                              │
│  + NEW: Skybox tinting                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┬─────────────────┐
        ▼             ▼             ▼                 ▼
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────┐
│ Lightmap  │  │ Sun/Moon  │  │ Ambient   │  │ Skybox Tint   │
│ Modulator │  │ (existing)│  │ (existing)│  │ (new)         │
└───────────┘  └───────────┘  └───────────┘  └───────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ BspManager.setLightmapIntensity()     │
│ - Modifies material.lightmapTexture   │
└───────────────────────────────────────┘
```

### File Changes With Code Locations

#### 1. `src/engine/lighting/SkyLightSystem.ts`

| Location | Change |
|----------|--------|
| Line ~170 (config) | Add `useCvarTime: boolean` flag |
| Line ~198 (init) | Register cvars, add cvar change listeners |
| Line ~246 (subscribe) | Make GameClock subscription conditional |
| NEW method | `update(deltaTime)` - frame update for cvar-driven mode |
| NEW method | `updateSkyboxTint(intensity, tint)` - skybox material modulation |
| NEW method | `updateBspLightmaps(intensity)` - call BspManager |
| Line ~262 (updateLighting) | Add lightmap + skybox updates at end |

#### 2. `src/engine/loader/bsp/BspManager.ts`

| Location | Change |
|----------|--------|
| NEW property | `private bspMaterials: Material[]` - track for batch updates |
| Line ~236 (render) | Store materials in `bspMaterials` array |
| NEW method | `setLightmapIntensity(intensity: number)` |
| NEW method | `getLightmapMaterials(): Material[]` |

#### 3. `src/engine/rendering/RenderVars.ts`

| Location | Change |
|----------|--------|
| Constructor | Register all `r_daynight_*` cvars |

#### 4. NEW `src/engine/console/commands/DayNightCommand.ts`

Quick testing command:
```
daynight 0.5        # Set time to noon
daynight 0.0        # Set time to midnight  
daynight start      # Start animation
daynight stop       # Stop animation
daynight info       # Show current state
```

#### 5. Game Loop Integration - EXACT LOCATION

**File:** `src/engine/EngineScene.ts`  
**Method:** `startRenderLoop()` at line ~571

```typescript
// EXISTING CODE (line 570-573):
const deltaTime = this.engine.getDeltaTime();
if (StreetLampSystem.getInstance().isInitialized()) {
  StreetLampSystem.getInstance().update(deltaTime);
}

// ADD HERE:
if (SkyLightSystem.getInstance().isInitialized()) {
  SkyLightSystem.getInstance().update(deltaTime);
}
```

**Note:** `engine.getDeltaTime()` returns milliseconds, may need to convert to seconds.

---

## Implementation Details

### 1. CVar Integration in SkyLightSystem

**Add dual-mode operation:**
- **GameClock mode** (existing): Time driven by GameClock events
- **CVar mode** (new): Time driven by `r_daynight_time` cvar

```typescript
// In SkyLightSystem.updateLighting()
public updateLighting(time?: TimeOfDay): void {
  // If cvars are controlling time, use them instead of GameClock
  if (cvar.get('r_daynight') && cvar.get('r_daynight_cvar_override')) {
    const cvarTime = cvar.get('r_daynight_time'); // 0.0-1.0
    time = this.normalizedToTimeOfDay(cvarTime);
  }
  
  // Rest of existing logic...
}
```

### 2. BSP Lightmap Modulation

**Add to BspManager:**
```typescript
public setLightmapIntensity(intensity: number): void {
  if (!this.meshResult) return;
  
  for (const material of this.meshResult.materials) {
    if (material.lightmapTexture) {
      material.lightmapTexture.level = intensity;
    }
  }
}

public setLightmapTint(tint: Color3): void {
  // For future: requires shader modification
  // Store tint for when we add shader support
  this.lightmapTint = tint;
}
```

**Hook into SkyLightSystem:**
```typescript
// In updateLighting(), after calculating sunIntensity
const lmMin = cvar.get('r_daynight_lm_min');
const lmMax = cvar.get('r_daynight_lm_max');
const lmIntensity = lmMin + (lmMax - lmMin) * sunIntensity;

BspManager.getInstance().setLightmapIntensity(lmIntensity);
```

### 3. Skybox Tinting

**Approach: Modify skybox material emissive/diffuse**

```typescript
public updateSkyboxTint(intensity: number, tint: Color3): void {
  const scene = this.scene;
  if (!scene) return;
  
  // Find skybox mesh (created by SkyboxLoader)
  const skybox = scene.getMeshByName('skybox');
  if (!skybox || !skybox.material) return;
  
  const mat = skybox.material;
  
  if (mat instanceof StandardMaterial) {
    // For StandardMaterial skyboxes, modulate emissive
    // Skybox typically uses emissiveTexture, so scale emissiveColor
    mat.emissiveColor = tint.scale(intensity);
  } else if (mat instanceof PBRMaterial) {
    // For PBR, use emissiveColor as multiplier
    mat.emissiveColor = tint.scale(intensity);
  }
}
```

**Called from updateLighting:**
```typescript
// Calculate sky tint (white at day, dark blue at night)
const skyTintIntensity = 0.1 + sunIntensity * 0.9; // Never fully black
const skyTint = this.lerpColor3(
  new Color3(0.1, 0.1, 0.2),  // Night: dark blue
  new Color3(1, 1, 1),         // Day: white (no tint)
  sunIntensity
);
this.updateSkyboxTint(skyTintIntensity, skyTint);
```

### 4. Time Animation Loop

**In SkyLightSystem.update() - new method:**
```typescript
public update(deltaTime: number): void {
  if (!cvar.get('r_daynight')) return;
  
  // Animate time if enabled
  if (cvar.get('r_daynight_animate')) {
    const cycleLength = cvar.get('r_daynight_length');
    const speed = cvar.get('r_daynight_speed');
    
    let time = cvar.get('r_daynight_time');
    time += (deltaTime / cycleLength) * speed;
    time = time % 1.0;
    
    cvar.set('r_daynight_time', time);
  }
  
  // Apply lighting based on current time
  const time = cvar.get('r_daynight_time');
  this.updateLightingFromNormalized(time);
}
```

### 5. DayNightController

**Responsibilities:**
- Register all cvars on initialization
- Update loop called from render loop or game tick
- Calculate current time based on `r_daynight_animate` and `r_daynight_speed`
- Provide API for other systems to query current state

**API:**
```typescript
class DayNightController {
  // Singleton
  static getInstance(): DayNightController;
  
  // Lifecycle
  init(scene: Scene): void;
  update(deltaTime: number): void;
  dispose(): void;
  
  // State queries
  getTime(): number;           // 0.0-1.0 (0=midnight, 0.5=noon)
  getSunPosition(): Vector3;   // Normalized direction TO sun
  getSunColor(): Color3;       // Current sun color
  getSunIntensity(): number;   // 0.0-1.0
  getAmbientColor(): Color3;   // Current ambient color
  getLightmapScale(): number;  // Lightmap intensity multiplier
  
  // Manual control
  setTime(time: number): void;
  startCycle(): void;
  stopCycle(): void;
}
```

### 2. Time Calculation

Time is normalized 0.0 to 1.0:
- **0.00** = Midnight
- **0.25** = Sunrise (6 AM)
- **0.50** = Noon (12 PM)
- **0.75** = Sunset (6 PM)
- **1.00** = Midnight (wraps to 0.0)

**Sun angle calculation:**
```typescript
// Sun rotates around X axis (east-west arc)
// At noon (0.5), sun is directly overhead
// At midnight (0.0), sun is below horizon

const sunAngle = (time - 0.25) * Math.PI * 2; // Offset so sunrise=0
const sunY = Math.sin(sunAngle);              // Height (-1 to 1)
const sunZ = Math.cos(sunAngle);              // Depth

// Sun direction (pointing FROM sun TO world)
const sunDirection = new Vector3(0, -sunY, -sunZ).normalize();
```

### 3. Lightmap Tinting

**Approach A: Material Level Property**

Babylon.js materials have `lightmapTexture.level` which multiplies lightmap contribution.

```typescript
// In BspManager or dedicated LightmapTinter
function setLightmapIntensity(intensity: number): void {
  for (const material of bspMaterials) {
    if (material.lightmapTexture) {
      material.lightmapTexture.level = intensity;
    }
  }
}
```

**Approach B: Uniform Injection (More Control)**

Inject a custom uniform into BSP shaders for color tinting:

```typescript
// Requires shader customization
material.onBindObservable.add(() => {
  effect.setColor3("lightmapTint", tintColor);
  effect.setFloat("lightmapScale", scale);
});
```

**Recommendation:** Start with Approach A (simpler), upgrade to B if color tinting needed.

### 4. Sun DirectionalLight

**Creation:**
```typescript
const sun = new DirectionalLight("sun_dynamic", sunDirection, scene);
sun.intensity = 0;  // Start disabled, ramp up at sunrise
sun.diffuse = sunColor;
sun.specular = sunColor.scale(0.3);

// CRITICAL: Exclude BSP world mesh to avoid double-lighting
sun.excludedMeshes = [bspWorldMesh];

// Only affects spawned models, players, dynamic objects
```

**Why exclude BSP?**
BSP already has baked lighting. Adding sun on top = overbright. The sun should only light dynamic objects (players, models, particles).

### 5. Ambient Color

Scene ambient follows sky color for cohesive feel:

```typescript
scene.ambientColor = dayNightController.getAmbientColor();
```

Ambient curve:
- Night: Dark blue `(0.02, 0.02, 0.05)`
- Dawn: Warm orange `(0.3, 0.2, 0.1)`
- Day: Neutral `(0.4, 0.4, 0.45)`
- Dusk: Pink/orange `(0.3, 0.15, 0.1)`

---

## CVar Specification

### Master Controls

| CVar | Type | Default | Description |
|------|------|---------|-------------|
| `r_daynight` | int | 0 | Enable day/night system (0=off, 1=on) |
| `r_daynight_time` | float | 0.5 | Current time (0.0-1.0, 0=midnight, 0.5=noon) |
| `r_daynight_animate` | int | 0 | Enable real-time progression |
| `r_daynight_speed` | float | 1.0 | Animation speed multiplier |
| `r_daynight_length` | float | 1440 | Full cycle length in seconds (24 min default) |

### Lightmap Controls

| CVar | Type | Default | Description |
|------|------|---------|-------------|
| `r_daynight_lm` | int | 1 | Enable lightmap modulation |
| `r_daynight_lm_min` | float | 0.05 | Minimum lightmap intensity (night) |
| `r_daynight_lm_max` | float | 1.0 | Maximum lightmap intensity (noon) |
| `r_daynight_lm_curve` | float | 1.0 | Intensity curve power (1=linear, 2=smooth) |

### Sun Controls

| CVar | Type | Default | Description |
|------|------|---------|-------------|
| `r_daynight_sun` | int | 1 | Enable dynamic sun light |
| `r_daynight_sun_intensity` | float | 1.0 | Sun brightness multiplier |
| `r_daynight_sun_angle` | float | 0 | Sun east-west offset in degrees |

### Ambient Controls

| CVar | Type | Default | Description |
|------|------|---------|-------------|
| `r_daynight_ambient` | int | 1 | Enable ambient color changes |

---

## Update Loop

```typescript
// Called every frame or at fixed interval
update(deltaTime: number): void {
  if (!this.enabled) return;
  
  // 1. Advance time if animating
  if (this.animating) {
    const cycleLength = cvar.get('r_daynight_length');
    const speed = cvar.get('r_daynight_speed');
    this.time += (deltaTime / cycleLength) * speed;
    this.time = this.time % 1.0;  // Wrap at 1.0
    cvar.set('r_daynight_time', this.time);
  } else {
    this.time = cvar.get('r_daynight_time');
  }
  
  // 2. Calculate derived values
  this.calculateSunPosition();
  this.calculateColors();
  this.calculateLightmapScale();
  
  // 3. Apply to scene
  this.updateSunLight();
  this.updateLightmaps();
  this.updateAmbient();
}
```

---

## Color Curves

### Sun Color Over Time

```
Time     Color (RGB)           Description
──────────────────────────────────────────
0.00     (0.0, 0.0, 0.0)       Midnight - no sun
0.20     (0.0, 0.0, 0.0)       Pre-dawn - no sun
0.25     (1.0, 0.4, 0.2)       Sunrise - orange
0.30     (1.0, 0.7, 0.5)       Early morning - warm
0.50     (1.0, 0.98, 0.95)     Noon - white/slight warm
0.70     (1.0, 0.7, 0.5)       Late afternoon - warm
0.75     (1.0, 0.4, 0.2)       Sunset - orange
0.80     (0.0, 0.0, 0.0)       Dusk - no sun
1.00     (0.0, 0.0, 0.0)       Midnight - no sun
```

### Lightmap Scale Over Time

```
Time     Scale    Description
─────────────────────────────
0.00     0.05     Midnight - very dark
0.20     0.05     Night
0.25     0.20     Sunrise - brightening
0.35     0.60     Morning
0.50     1.00     Noon - full brightness
0.65     0.60     Afternoon
0.75     0.20     Sunset - dimming
0.80     0.05     Dusk
1.00     0.05     Midnight
```

---

## Phase 2: Outdoor Detection

For more realistic results, detect which faces are "outdoor" and apply stronger lighting changes there.

**Approach:**
1. At map load, trace from each face center upward
2. If trace hits sky brush/shader → mark as outdoor
3. Store outdoor flag per-face or per-material
4. Apply different lightmap curves for indoor vs outdoor

**Pseudo-code:**
```typescript
for (const face of bspFaces) {
  const center = getFaceCenter(face);
  const trace = traceLine(center, center.add(new Vector3(0, 10000, 0)));
  face.isOutdoor = trace.hitSky || !trace.hit;
}
```

---

## Console Commands

```bash
# Quick testing
daynight 0.5          # Set to noon
daynight 0.0          # Set to midnight
daynight start        # Start animation
daynight stop         # Stop animation
daynight info         # Show current state
```

---

## Integration Points

### BspManager
- Expose `setLightmapIntensity(scale: number)` method
- Track all BSP materials for batch updates

### RenderVars
- Register all `r_daynight_*` cvars

### Game Loop
- Call `DayNightController.update(deltaTime)` each frame

### ModelLoader
- Sun light should affect spawned models (already using `includedOnlyMeshes`)

---

## Testing Checklist

- [ ] Cvars register and persist correctly
- [ ] `r_daynight_time` scrubbing changes lighting in real-time
- [ ] Animation cycles smoothly with configurable speed
- [ ] Lightmaps dim at night, brighten at noon
- [ ] Sun direction matches expected position
- [ ] Dynamic models lit by sun, BSP not double-lit
- [ ] Ambient color follows time of day
- [ ] Performance acceptable (< 1ms per frame overhead)

---

## Open Questions

1. **Should we tint lightmaps or just scale intensity?**
   - Tinting (warm sunrise, cool night) looks better but requires shader work
   - Scaling is simpler, may look flat

2. **How to handle maps with no skybox?**
   - Could still modulate lightmaps
   - Or disable day/night for those maps

3. **Should sun cast shadows?**
   - Babylon.js DirectionalLight can use ShadowGenerator
   - Performance cost, but very immersive
   - Make it optional via cvar

---

## Files to Create/Modify

### New Files
- `src/engine/lighting/DayNightController.ts`
- `src/engine/lighting/DayNightCvars.ts`
- `src/engine/console/commands/DayNightCommand.ts`

### Modified Files
- `src/engine/loader/bsp/BspManager.ts` - Add lightmap control API
- `src/engine/rendering/RenderVars.ts` - Register new cvars
- `src/engine/core/GameLoop.ts` or equivalent - Call update

---

---

## Potential Holes / Risks

### 1. Skybox Material Type Unknown
**Risk:** BSP skyboxes may use custom shader materials, not StandardMaterial.  
**Mitigation:** Test first. If emissiveColor doesn't work, try:
- Injecting uniform via `onBindObservable`
- Creating overlay mesh with alpha blend
- Modifying shader code directly

### 2. Lightmap Materials Not Tracked
**Risk:** BspManager doesn't currently store material references.  
**Mitigation:** Already planned - add `bspMaterials` array during render.

### 3. Multiple Skybox Meshes
**Risk:** Some maps may have multiple sky layers (clouds, stars, etc.)  
**Mitigation:** Find all meshes with "sky" in name, apply tint to all.

### 4. Performance of Per-Frame Updates
**Risk:** Updating many materials every frame could be slow.  
**Mitigation:** 
- Only update when time actually changes (threshold check)
- Cache material references
- Use dirty flag pattern

### 5. GameClock vs CVar Conflict
**Risk:** Both systems trying to control time simultaneously.  
**Mitigation:** Clear priority: if `r_daynight_animate=1`, cvars drive time. GameClock only used when cvars disabled.

### 6. Sun/Moon on BSP Geometry
**Decision:** Sun/moon lights WILL affect BSP geometry, with tuned intensity.

**Rationale:**
- Excluding BSP would look odd - dynamic objects lit differently than world
- Lightmap modulation alone may look flat
- Sun/moon adds dynamic feel even on static geometry

**Implementation:**
- Sun/moon lights affect ALL meshes (no `excludedMeshes`)
- Use **lower intensity** for sun on BSP to avoid overbright (lightmaps + sun)
- Tune values: `r_daynight_sun_bsp_intensity` cvar for fine control
- Combined effect: lightmap dimming + subtle sun color = natural day/night

**Tuning strategy:**
```
Noon:   lightmap=1.0, sun=0.3  → bright, slight warm tint from sun
Night:  lightmap=0.1, sun=0.0  → dark, moon provides subtle blue
```

---

## Implementation Checklist

- [ ] Register cvars in RenderVars
- [ ] Add `update(deltaTime)` to SkyLightSystem
- [ ] Add cvar listeners for `r_daynight_time`
- [ ] Implement `setLightmapIntensity()` in BspManager
- [ ] Track BSP materials during render
- [ ] Implement skybox tinting (test approach)
- [ ] Add `daynight` console command
- [ ] Hook update into game loop
- [ ] Test with actual BSP map
- [ ] Test performance impact

---

## References

- Babylon.js DirectionalLight: https://doc.babylonjs.com/features/featuresDeepDive/lights/lights_introduction
- Lightmap texture level: Material.lightmapTexture.level property
- Similar implementations: Source Engine env_sun, Unreal Sky Atmosphere
