# Custom Shader Materials

**Time:** 60 minutes  
**Level:** Advanced

Create custom Babylon.js materials that work with Q3 shaders.

## Prerequisites

- [Guide: Shader System](../../guides/shader-system.md)
- Babylon.js material knowledge

## Understanding the Pipeline

```
Q3 Shader (.shader file)
    ↓
Q3ShaderParser → Q3Shader object
    ↓
Q3ShaderRegistry.resolveMaterialProps()
    ↓
ResolvedMaterialProps
    ↓
BspMeshBuilder → Babylon.js Material
```

## ResolvedMaterialProps Interface

```typescript
interface ResolvedMaterialProps {
  diffuseMap?: string;
  normalMap?: string;
  glossMap?: string;
  alphaMode: 'opaque' | 'blend' | 'add' | 'multiply';
  cullMode: 'back' | 'front' | 'none';
  useLightmap: boolean;
  isSky: boolean;
  isTransparent: boolean;
  sort?: number;
  skyParms?: { farbox: string; cloudHeight: number; nearbox: string };
}
```

## Creating a Custom Material

### Example: Glow Material

```typescript
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';

// Register shader code
Effect.ShadersStore['glowVertexShader'] = `
  precision highp float;
  
  attribute vec3 position;
  attribute vec2 uv;
  
  uniform mat4 worldViewProjection;
  
  varying vec2 vUV;
  
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vUV = uv;
  }
`;

Effect.ShadersStore['glowFragmentShader'] = `
  precision highp float;
  
  uniform sampler2D diffuseTexture;
  uniform float time;
  uniform float glowIntensity;
  
  varying vec2 vUV;
  
  void main() {
    vec4 color = texture2D(diffuseTexture, vUV);
    float glow = sin(time * 2.0) * 0.5 + 0.5;
    color.rgb += color.rgb * glow * glowIntensity;
    gl_FragColor = color;
  }
`;

function createGlowMaterial(scene: Scene, texture: Texture): ShaderMaterial {
  const material = new ShaderMaterial('glow', scene, 'glow', {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'time', 'glowIntensity']
  });
  
  material.setTexture('diffuseTexture', texture);
  material.setFloat('glowIntensity', 1.0);
  
  // Update time uniform
  scene.onBeforeRenderObservable.add(() => {
    material.setFloat('time', performance.now() / 1000);
  });
  
  return material;
}
```

## Integrating with Q3 Shaders

### Custom Material Factory

```typescript
import { Q3ShaderRegistry } from '../../engine/loader/shader/Q3ShaderRegistry';

class MaterialFactory {
  private scene: Scene;
  private registry: Q3ShaderRegistry;
  
  constructor(scene: Scene) {
    this.scene = scene;
    this.registry = Q3ShaderRegistry.getInstance();
  }
  
  createMaterial(textureName: string): Material {
    const props = this.registry.resolveMaterialProps(textureName);
    const shader = this.registry.getShader(textureName);
    
    // Check for special shader types
    if (this.isGlowShader(shader)) {
      return this.createGlowMaterial(props);
    }
    
    if (this.isAnimatedShader(shader)) {
      return this.createAnimatedMaterial(shader);
    }
    
    // Default material
    return this.createStandardMaterial(props);
  }
  
  private isGlowShader(shader: Q3Shader | undefined): boolean {
    if (!shader) return false;
    return shader.stages.some(s => 
      s.blendFunc?.[0] === 'GL_ONE' && 
      s.blendFunc?.[1] === 'GL_ONE'
    );
  }
}
```

## Animated Textures

Handle Q3 `animMap` directive:

```typescript
class AnimatedMaterial extends StandardMaterial {
  private frames: Texture[] = [];
  private fps: number;
  private currentFrame = 0;
  private lastUpdate = 0;
  
  constructor(name: string, scene: Scene, frames: string[], fps: number) {
    super(name, scene);
    this.fps = fps;
    
    // Load all frame textures
    this.frames = frames.map(path => new Texture(path, scene));
    this.diffuseTexture = this.frames[0];
    
    // Update animation
    scene.onBeforeRenderObservable.add(() => this.updateAnimation());
  }
  
  private updateAnimation() {
    const now = performance.now();
    const frameTime = 1000 / this.fps;
    
    if (now - this.lastUpdate > frameTime) {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.diffuseTexture = this.frames[this.currentFrame];
      this.lastUpdate = now;
    }
  }
}
```

## tcMod Effects

Implement texture coordinate modifiers:

```typescript
// Scroll effect via UV offset
material.diffuseTexture.uOffset += scrollX * deltaTime;
material.diffuseTexture.vOffset += scrollY * deltaTime;

// Scale effect
material.diffuseTexture.uScale = scaleX;
material.diffuseTexture.vScale = scaleY;

// Rotate effect (requires shader)
```

## Blend Modes

Map Q3 blend functions to Babylon.js:

```typescript
function applyBlendMode(material: StandardMaterial, blendFunc: string[]) {
  const [src, dst] = blendFunc;
  
  if (src === 'GL_ONE' && dst === 'GL_ONE') {
    // Additive
    material.alphaMode = Constants.ALPHA_ADD;
  } else if (src === 'GL_SRC_ALPHA' && dst === 'GL_ONE_MINUS_SRC_ALPHA') {
    // Alpha blend
    material.alphaMode = Constants.ALPHA_COMBINE;
  } else if (src === 'GL_DST_COLOR' && dst === 'GL_ZERO') {
    // Multiply
    material.alphaMode = Constants.ALPHA_MULTIPLY;
  }
}
```

## Best Practices

1. **Cache materials** - Reuse for same shader
2. **Pool textures** - Don't reload same texture
3. **Batch updates** - Update uniforms once per frame
4. **Dispose properly** - Clean up when done

## Next Steps

- [Tutorial: Entity System](./entity-system.md)
- [Guide: Shader System](../../guides/shader-system.md)
