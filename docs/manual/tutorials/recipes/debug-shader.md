# Recipe: Debug Shader on Surface

Inspect materials and shaders on map surfaces.

## Console Commands

### Inspect Aimed Surface

```
shader info
```

Shows shader info for the surface under crosshair.

### Highlight Aimed Surface

```
shader aim 1    # Enable highlight
shader aim 0    # Disable
```

### Inspect Specific Shader

```
shader info textures/base_wall/concrete
```

### List All Shaders

```
shader list
shader list base_wall    # Filter by name
shader count
```

## Code

```typescript
import { Q3ShaderRegistry } from '../../engine/loader/shader/Q3ShaderRegistry';

const registry = Q3ShaderRegistry.getInstance();

// Get shader by texture name
const shader = registry.getShader('textures/base_wall/concrete');

if (shader) {
  console.log('Shader:', shader.name);
  console.log('Cull:', shader.cull);
  console.log('Surface parms:', Array.from(shader.surfaceParms));
  console.log('Stages:', shader.stages.length);
  
  shader.stages.forEach((stage, i) => {
    console.log(`Stage ${i}:`, stage.map, stage.blendFunc);
  });
}

// Get resolved material properties
const props = registry.resolveMaterialProps('textures/base_wall/concrete');
console.log('Diffuse map:', props.diffuseMap);
console.log('Alpha mode:', props.alphaMode);
console.log('Is sky:', props.isSky);
```

## Raycasting to Surface

```typescript
scene.onPointerDown = (evt, pickResult) => {
  if (pickResult.hit && pickResult.pickedMesh) {
    const mesh = pickResult.pickedMesh;
    const material = mesh.material;
    
    console.log('Mesh:', mesh.name);
    console.log('Material:', material?.name);
    
    // Get texture name from mesh name (if grouped by texture)
    const textureName = mesh.metadata?.textureName;
    if (textureName) {
      registry.debugShader(textureName);
    }
  }
};
```
