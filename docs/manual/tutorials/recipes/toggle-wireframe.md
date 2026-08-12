# Recipe: toggle wireframe

## Console

```text
developer 1
r_wireframe 1
r_wireframe 0
r_showtris 1
r_showtris 0
```

`r_wireframe` changes material wireframe state. `r_showtris` is the scene-level debug switch.

## Code

```ts
const renderVars = RenderVars.getInstance();

const current = renderVars.get('r_wireframe') ?? 0;
renderVars.set('r_wireframe', current >= 0.5 ? 0 : 1);
```

Both variables are debug category and are not persisted as durable render preferences. If you add a key binding, register it through `InputSystem` and remove its context/handler during teardown rather than attaching an unmanaged global DOM listener.
