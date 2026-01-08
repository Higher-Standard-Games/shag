# Recipe: Change Skybox at Runtime

Swap the skybox dynamically during gameplay.

## Console Command

```
bsp skybox env/stormydays/stormydays
```

## Code

```typescript
import { SkyboxLoader } from '../../engine/loader/texture/SkyboxLoader';

async function changeSkybox(scene: Scene, skyPath: string) {
  const skyboxLoader = SkyboxLoader.getInstance();
  skyboxLoader.init(scene);
  
  // Remove existing skybox
  skyboxLoader.disposeSkybox();
  
  // Load new skybox
  const result = await skyboxLoader.loadSkybox(skyPath);
  
  if (result.success) {
    console.log('Skybox changed to:', skyPath);
  } else {
    console.error('Failed:', result.error);
  }
}

// Usage
changeSkybox(scene, 'env/stormydays/stormydays');
```

## Available Skyboxes

List skyboxes in PK3:

```
pk3 list env/
```

Common paths:
- `env/stormydays/stormydays`
- `env/bluesky/bluesky`
- `env/desert/desert`
