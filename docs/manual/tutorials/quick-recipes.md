# Quick recipes

These examples use current entry points. Adjust relative imports to the source file where the code is placed; the repository does not define a general `@/*` alias.

## Execute a console command

```ts
import { CommandRegistry } from './engine/console/CommandRegistry';

const result = await CommandRegistry.getInstance().executeChecked('bsp info');
if (!result.ok) {
  console.error(result.output);
}
```

Use `executeChecked` in automation and `execute` when display output alone is sufficient.

## Load an inspection map

```ts
await CommandRegistry.getInstance().executeChecked('bsp load wdm2');
await CommandRegistry.getInstance().executeChecked('bsp render');
```

`bsp load` parses; `bsp render` builds the low-level inspection scene.

## Launch gameplay

```ts
await CommandRegistry.getInstance().executeChecked('map wdm2 duel');
```

This requires a registered gameplay launcher and reachable lobby/server setup.

## List indexed maps

```ts
const index = PK3Index.getInstance();
await index.ensureIndex();
const maps = index.findByPattern('maps/*.bsp');
```

Do not scan `public/data/` from browser code.

## Add a temporary command

```ts
const commands = CommandRegistry.getInstance();
commands.register(
  'hello_runtime',
  async (args) => `Hello, ${args[0] ?? 'player'}!`,
  'Print a greeting',
);

// Teardown:
commands.unregister('hello_runtime');
```

For a permanent command, add a `Command` subclass to a command directory; see [Custom commands](./intermediate/custom-commands.md).

## Toggle wireframe

```ts
const vars = RenderVars.getInstance();
const current = vars.get('r_wireframe') ?? 0;
vars.set('r_wireframe', current >= 0.5 ? 0 : 1);
```

Console equivalent:

```text
r_wireframe 1
r_wireframe 0
```

## Subscribe and clean up

```ts
const unsubscribe = EventBus.on(eventName, handler);

// Teardown:
unsubscribe();
```

Use the event names and payload types the subsystem already defines rather than introducing new global events as an integration contract.

## Camera inspection

```ts
const camera = CameraSystem.getInstance().getCamera();
if (camera) {
  console.log(camera.position.toString());
}
```

Console equivalents:

```text
camera mode freefly
camera fov 100
pos
teleport 0 128 0
```

## Headless smoke test

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

See [Console system](../guides/console-system.md), [PK3 filesystem](../guides/pk3-filesystem.md), and [Headless mode](../guides/headless-mode.md).
