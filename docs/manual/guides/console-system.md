# Console system

SHAG has an in-game developer console and a shared command registry used by the browser UI, headless tools, and tests.

## Opening the console

Press the backquote/tilde key (the key normally below Escape). The current input binding does not use F1.

Some commands are registered only in developer mode — `map`, `pk3`, `render`, `debug`, `physics`, `teleport`, `god`, `noclip` and around twenty more. The console refuses them with `requires developer mode` and hides them from completion until:

```text
developer 1
help
help render
```

`bsp`, `camera`, `shader`, `pvs` and `freefly_collision` are not gated, so map inspection works without developer mode.

Useful commands include:

```text
map wdm2 duel
bsp load wdm2
bsp info
camera mode freefly
camera fov 100
pk3 stats
shader count
render list
debug wireframe
```

`map` starts the normal server-backed FPS flow. `bsp load` is the lower-level inspection path and is the command to use in the headless game CLI.

## Adding a command

Engine commands live in `src/engine/console/commands/`; FPS commands live in `src/games/fps/console/commands/`. Command modules in those directories are auto-discovered through Vite's `import.meta.glob`, so a file named `*Command.ts` with a default export needs no registration call. Export a default class extending `Command`:

```ts
import { Command, type CommandDef } from '../../../../engine/console/Command';

export default class HelloCommand extends Command {
  readonly definition: CommandDef = {
    name: 'hello',
    description: 'Print a greeting',
    usage: 'hello [name]',
  };

  async execute(args: string[]): Promise<string> {
    return `Hello, ${args[0] ?? 'player'}!`;
  }
}
```

Add `developer: true` to the definition to gate a command behind developer mode.

Use `fail(message)` from `Command.ts` when a failure must produce a non-zero headless/batch result. Returning a string is successful display output.

For runtime-only integrations, the legacy registration overload remains available:

```ts
import { CommandRegistry } from './engine/console/CommandRegistry';

CommandRegistry.getInstance().register(
  'hello_runtime',
  async (args) => `Hello, ${args[0] ?? 'player'}!`,
  'Print a greeting',
);
```

Clean up runtime registrations with `unregister(name)`.

## Programmatic execution

```ts
const registry = CommandRegistry.getInstance();
const output = await registry.execute('bsp info');
const result = await registry.executeChecked('bsp load wdm2');
```

`executeChecked` is preferable in automation because its `ok` field distinguishes command failure from ordinary output.

## Source of truth

- `src/engine/console/Command.ts`
- `src/engine/console/CommandRegistry.ts`
- `src/engine/console/commands/`
- `src/games/fps/console/commands/`

See [Command reference](./command-reference.md) for the user-facing command list.
