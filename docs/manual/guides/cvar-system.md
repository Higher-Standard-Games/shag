# Cvar system

Console variables provide typed runtime configuration with validation, change callbacks, and optional browser persistence.

## Reading and writing

```ts
import { Cvar } from '../../../src/engine/core/Cvar';

const bloom = Cvar.getNumber('r_bloom');
const developer = Cvar.getBool('developer');

Cvar.set('r_bloom', 1.25);
Cvar.toggle('r_wireframe');
Cvar.reset('r_bloom');
```

`Cvar.get(name)` returns the stored `CvarValue | undefined`. Use `getNumber`, `getInt`, `getBool`, or `getString` when a specific type is required.

## Registering a variable

```ts
Cvar.register('g_example', 1, {
  description: 'Example game setting',
  type: 'float',
  min: 0,
  max: 4,
  persist: true,
  onChange: (value, previous) => {
    console.log('g_example changed', previous, value);
  },
});
```

Persisted values are stored in browser local storage under `engine_cvars`. Debug-only state should normally use `persist: false`.

## Console use

A registered cvar is also available directly in the command registry:

```text
r_bloom
r_bloom 1.5
cvarlist
cvarexport
```

The renderer has a specialized facade and commands:

```text
render list
render reset
render export
render apply
```

`render apply` exists for compatibility; render-variable callbacks already apply changes immediately.

## Configuration text

```ts
const config = Cvar.exportConfig();
Cvar.execConfig(config);
```

`execConfig`, not `importConfig`, is the current import API. The `exec` console command loads configuration files through the virtual filesystem.

## Current ownership

- Generic variables: `src/engine/core/Cvar.ts`
- Render variables: `src/engine/rendering/RenderVars.ts`
- Movement variables: `src/engine/movement/MovementVars.ts`
- Audio variables: registered by `AudioManager`

Do not document a cvar merely because it would be useful; confirm that it is registered in source. The exact renderer list is maintained in [Render variables](./render-variables.md).
