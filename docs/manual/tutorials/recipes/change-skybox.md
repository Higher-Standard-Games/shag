# Recipe: inspect or replace a map skybox

## BSP sky workflow

```text
developer 1
bsp load washoi_dm2
bsp render
bsp sky info
bsp sky apply
bsp sky toggle
bsp sky remove
```

Use `bsp sky debug` to verify face orientation.

## Loader API

```ts
const loader = SkyboxLoader.getInstance();
loader.init(scene);

const result = await loader.loadSkybox(basePath);
if (!result.success) {
  console.warn(result.error);
}

// On map/scene teardown:
loader.disposeSkybox();
```

Skyboxes load with their map. The `skybox` command reports (`skybox info`) and clears (`skybox clear`) the current one; `skybox load` does not load an arbitrary sky.
