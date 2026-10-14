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

`set` returns false, and changes nothing, when the cvar does not exist, is read-only, or is numeric and was given text — `Cvar.set("r_bloom", "abc")` is refused rather than read as zero. A number outside `min`/`max` is clamped to the range and the set succeeds. The console reports a refused set as a failure, which is what headless and batch runners turn into a non-zero exit code.

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

Persisted values are stored in browser local storage under `engine_cvars`, and only values that differ from their default are written. Debug-only state should normally use `persist: false`.

Registering a cvar that already has a value — one loaded from storage before its type was known, or an earlier registration — keeps that value but holds it to the type and bounds the registration declares. A stored `99` for a cvar later registered with `max: 3` reads as `3`.

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

Render-variable changes apply immediately; `render apply` is accepted but has nothing left to commit.

## Configuration text

```ts
const config = Cvar.exportConfig();
Cvar.execConfig(config);
```

`execConfig` applies configuration text and returns the number of accepted lines and the rejected ones, with reasons. The `exec` console command loads configuration files through the virtual filesystem.

## Current ownership

- Generic variables: `src/engine/core/Cvar.ts`
- Render variables: `src/engine/rendering/RenderVars.ts`
- Movement variables: `src/engine/movement/MovementVars.ts`
- Audio variables: registered by `AudioManager`

Do not document a cvar merely because it would be useful; confirm that it is registered in source. The exact renderer list is maintained in [Render variables](./render-variables.md).
