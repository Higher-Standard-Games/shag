# BSP LightGrid Implementation

This document details the implementation of Quake 3 (IBSP) and Warsow (FBSP) LightGrid support in SHAG Engine, providing high-quality environmental lighting for dynamic models.

## Overview

The LightGrid is a 3D volumetric texture storing ambient and directional lighting information at regular intervals throughout the map. We use this data to light dynamic models (`spawnmodel`) so they blend seamlessly with the static map geometry.

## Data Structures

### Light Volumes (`dlightVol_t`)
Each sample point contains:
- **Ambient Color** (RGB bytes): Base lighting level.
- **Directional Color** (RGB bytes): Color of the primary light source.
- **Direction** (Theta/Phi bytes): Vector pointing towards the primary light source.

### IBSP vs FBSP

- **IBSP (Quake 3)**: Uses a standard dense 3D array. The grid dimensions are inferred from the map bounds and `gridsize`.
- **FBSP (Warsow)**: Uses a similar structure but often has truncated vertical bounds or sparse-like characteristics.

## Implementation Details

### 1. BspLoader: Dimension Calculation
A critical challenge was aligning the LightGrid with world coordinates, especially for FBSP maps where the `LightVolCount` often doesn't match the theoretical count derived from map bounds (e.g., `wdm2` implied 11 vertical slices but only provided data for 10).

**The Solution: Count-Derived Z-Dimension**
Instead of trusting the map bounds for the vertical count, we derive the Z-dimension from the actual lump size:
```typescript
sizeZ = Math.ceil(lightVolCount / (sizeX * sizeY));
```
This ensures that the grid dimensions exactly match the data layout, preventing "black sphere" artifacts caused by index-out-of-bounds errors or stride misalignment.

### 2. Trilinear Interpolation
To prevent "popping" as models move between grid cells, we implement trilinear interpolation in `BspManager.getLightingAt(pos)`:
1. Identify the 8 grid points surrounding the position.
2. Clamp indices to valid grid bounds (handling the truncated Z-slices).
3. Interpolate Ambient and Directional colors linearly.
4. Average the Light Direction vectors (renormalizing the result).

### 3. Model Lighting (`ModelLoader`)
We apply the interpolated lighting to Babylon.js models using a hybrid approach for realism:

- **Ambient**: Applied directly to the PBR/Standard material `ambientColor`.
- **Directional**: A scoped `DirectionalLight` is created for each model.
  - **Direction**: Decoded from Theta/Phi and **inverted** to match Babylon.js ray direction conventions.
  - **Intensity**: Tuned (Ambient 0.3, Directional 2.0) for high contrast.
  - **Gamma Correction**: Applied (`pow(c, 2.2)`) to ensure colors match the monitor-ready map textures.

### 4. Fallback System
If a model traverses outside the LightGrid or into a void area (or if the map type is unsupported), `ModelLoader` automatically falls back to a default "Sun" light setup to ensure the model remains visible.

## Debugging Tools

- **`bsp lightgrid`**: Prints precise lighting data at the camera position.
- **`bsp debug_grid`**: Spawns a cloud of debug spheres around the player, colored by their LightGrid ambient value. This is essential for verifying alignment.

## Limitstions & Future Work

- **Sparse Grids**: True sparse grids (using an indirection table) are not fully implemented. We currently map FBSP grids as dense arrays, which works for most `wdm` maps but may encounter issues on extremely large/complex maps.
- **Occlusion**: The current implementation does not raycast against world geometry for model lighting (shadows depend on the LightGrid's pre-calculated shadows).
