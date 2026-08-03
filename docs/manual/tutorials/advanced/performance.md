# Performance Optimization

**Time:** 45 minutes  
**Level:** Advanced

Optimize your game for smooth performance.

## Prerequisites

- Understanding of 3D rendering concepts
- Browser DevTools profiling

## Measuring Performance

### FPS Counter

```
show_fps 1
```

Or in code:

```typescript
const fpsDiv = document.createElement('div');
fpsDiv.id = 'fps';
document.body.appendChild(fpsDiv);

scene.onBeforeRenderObservable.add(() => {
  fpsDiv.textContent = `FPS: ${engine.getFps().toFixed(0)}`;
});
```

### Browser Profiling

1. Open DevTools (F12)
2. Performance tab
3. Record during gameplay
4. Analyze flame graph

## PVS Culling

Potentially Visible Set culling uses BSP visibility data:

```
pvs toggle    # Enable/disable
pvs info      # Show stats
```

In code:

```typescript
import { PVSCuller } from '../engine/loader/bsp/PVSCuller';

const culler = new PVSCuller(bspData);

scene.onBeforeRenderObservable.add(() => {
  const cameraPos = camera.position;
  const visibleMeshes = culler.getVisibleMeshes(cameraPos);
  
  // Hide non-visible meshes
  scene.meshes.forEach(mesh => {
    mesh.isVisible = visibleMeshes.has(mesh);
  });
});
```

## Mesh Merging

Reduce draw calls by merging meshes:

```typescript
// Merge meshes with same material
const merged = Mesh.MergeMeshes(
  meshesToMerge,
  true,  // disposeSource
  true,  // allow32BitsIndices
  undefined,
  false, // subdivideWithSubMeshes
  true   // multiMultiMaterials
);
```

BspMeshBuilder already groups faces by texture to minimize draw calls.

## Texture Optimization

### Anisotropic Filtering

```
r_anisotropy 1   # Low (faster)
r_anisotropy 8   # Medium
r_anisotropy 16  # High (slower)
```

### KTX2 Compression

GPU-compressed textures load faster:

```bash
npm run tools:textures            # convert
npm run tools:textures:audit      # dry run — report what would convert
npm run tools:textures:clean      # remove generated .ktx2
```

### Texture Resolution

Large textures consume VRAM. Consider:

```typescript
texture.updateSamplingMode(Texture.BILINEAR_SAMPLINGMODE);
```

## Render Variables for Performance

```
r_bloom 0          # Disable post-processing
r_normalmap 0      # Disable normal maps
r_lightmap 1       # Keep lightmaps (cheap)
r_anisotropy 4     # Lower filtering
```

## Level of Detail (LOD)

```typescript
mesh.addLODLevel(200, lowPolyMesh);
mesh.addLODLevel(500, veryLowPolyMesh);
mesh.addLODLevel(1000, null); // Cull at distance
```

## Frustum Culling

Babylon.js does this automatically, but ensure:

```typescript
mesh.alwaysSelectAsActiveMesh = false; // Default
```

## Occlusion Queries

For complex scenes:

```typescript
mesh.occlusionQueryAlgorithmType = 
  AbstractMesh.OCCLUSION_ALGORITHM_TYPE_ACCURATE;
mesh.occlusionType = AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC;
```

## Instancing

For repeated objects:

```typescript
const baseTree = createTreeMesh();

for (let i = 0; i < 1000; i++) {
  const instance = baseTree.createInstance(`tree_${i}`);
  instance.position = getRandomPosition();
}
```

## Object Pooling

Reuse objects instead of creating/destroying:

```typescript
class ProjectilePool {
  private pool: Mesh[] = [];
  private active: Set<Mesh> = new Set();
  
  get(): Mesh {
    let projectile = this.pool.pop();
    if (!projectile) {
      projectile = this.createProjectile();
    }
    projectile.setEnabled(true);
    this.active.add(projectile);
    return projectile;
  }
  
  release(projectile: Mesh) {
    projectile.setEnabled(false);
    this.active.delete(projectile);
    this.pool.push(projectile);
  }
}
```

## Memory Management

Monitor memory:

```
mem
```

Dispose unused resources:

```typescript
texture.dispose();
material.dispose();
mesh.dispose();
```

## Performance Checklist

- [ ] Enable PVS culling
- [ ] Lower r_anisotropy on mobile
- [ ] Disable unused post-processing
- [ ] Use KTX2 textures
- [ ] Merge static meshes
- [ ] Pool dynamic objects
- [ ] Profile with DevTools
- [ ] Test on target devices

## Mobile-Specific

```typescript
// Detect mobile
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

if (isMobile) {
  engine.setHardwareScalingLevel(2); // Render at half res
  RenderVars.getInstance().set('r_bloom', 0);
  RenderVars.getInstance().set('r_anisotropy', 1);
}
```

## Next Steps

- [Guide: Render Variables](../../guides/render-variables.md)
- [Deployment](../../deployment/)
