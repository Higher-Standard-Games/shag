# Viewport effects

`ViewportEffectsManager` combines modular camera-presentation effects into one `ViewportDelta`.

## Use

```ts
import { ViewportEffectsManager } from '../../../src/engine/viewport/ViewportEffectsManager';
import { WalkBobEffect } from '../../../src/engine/viewport/effects/WalkBobEffect';

const effects = ViewportEffectsManager.getInstance();
effects.init();
effects.registerEffect(new WalkBobEffect());

const delta = effects.update(deltaTimeSeconds, playerState);
```

The caller applies the combined position, rotation, FOV, and shake values to presentation. Never feed camera offsets back into authoritative player position.

## Built-in behavior

The FPS controller registers the list from `createFirstPersonEffects()`: walk bob, landing impact, strafe lean, speed FOV and idle breathing. ADS FOV is also blended by the manager from movement variables.

Views behind another player's eyes (spectating, demo playback) run the same list through their own `FirstPersonEffectStack`, fed with that player's recorded state; see [Camera system](./camera-system.md#first-person-views). `cl_vieweffects 0` turns the effects off for those views too.

Damage tint is a HUD overlay, not a viewport delta.

## Event triggers

`init()` subscribes to:

- `viewport:shake`;
- `viewport:punch`;
- `viewport:zoom`;
- `viewport:roll`;
- `viewport:landing`.

It forwards them to registered effects using shorter trigger names.

## Custom effect

```ts
import type { ViewportEffect } from '../../../src/engine/viewport/ViewportEffect';

class MyEffect implements ViewportEffect {
  readonly name = 'my-effect';
  enabled = true;

  update(deltaTime: number, state: PlayerState): ViewportDelta {
    return createNeutralDelta();
  }

  reset(): void {}
  dispose(): void {}
}
```

Register with `registerEffect` and remove it with `unregisterEffect(name)`; replacement/unregistration calls optional `dispose`.

## Configuration and cleanup

`cl_vieweffects` is the master cvar. Effect-specific values are registered by their owning effect or `MovementVars`; use `cvarlist cl_` and `cvarlist cg_` for current defaults.

Call the manager disposal path during application teardown so EventBus subscriptions are removed. Reset effects on respawn/map transitions when their transient state must not carry over.

Easing helpers live in `src/engine/viewport/Easing.ts`.
