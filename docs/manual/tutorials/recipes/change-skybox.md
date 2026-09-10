# Recipe: inspect or replace a map skybox

## BSP sky workflow

```text
developer 1
bsp load wdm2
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

The standalone `skybox load` command is not a general loader at present; it directs users back to map loading.
