# Console system

SHAG has an in-game developer console and a shared command registry used by the browser UI, headless tools, and tests.

## Opening the console

Press the backquote/tilde key (the key normally below Escape).

Some commands require developer mode, among them `map`, `pk3`, `render`, `debug`, `physics`, `teleport`, `god` and `noclip`. The console refuses them with `requires developer mode` and hides them from completion until developer mode is on:

```text
developer 1
help
help render
```

`bsp`, `camera`, `shader`, `pvs` and `freefly_collision` are not gated, so map inspection works without developer mode.

Production browser builds lock `developer` to `0`, including saved preferences,
config imports and the `dev` alias. Developer commands such as `editor` remain
unavailable there. Use the development server for those tools; Node/headless
tools retain developer mode.

Useful commands include:

```text
map washoi_dm2 duel
bsp load washoi_dm2
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

A runtime integration can register a handler function instead of a class:

```ts
import { CommandRegistry } from './engine/console/CommandRegistry';

CommandRegistry.getInstance().register(
  'hello_runtime',
  async (args) => `Hello, ${args[0] ?? 'player'}!`,
  'Print a greeting',
);
```

Clean up runtime registrations with `unregister(name)`.

## Key bindings

`bind <key> <command>` runs a console command from a key press;
`unbind <key>` and `unbind all` remove them. Bindings live in
`src/engine/input/CommandBindings.ts`, persist per browser, and are attached to
the window by `registerEngineCommands()`, so any composition with commands has
them.

They are not the action map: an action binding answers what a key means while
it is held, a command binding fires once on the press, and a key can be both.
A press is ignored while a text field has the keyboard, while the console is
open, or when Ctrl, Alt or Meta is held.

## Logging

Lines that repeat in play (a death, a weapon change, a projectile, a model or
per-map and per-effect setup) go through `devLog()` from
`src/engine/core/DevLog.ts`, which prints only while `developer` is on; check
`devLogEnabled()` first when a line is costly to build. With `developer 0` the
browser console shows one-off events and warnings.

Production builds strip `console.log` and `console.debug` calls, while
`console.warn` and `console.error` remain. esbuild keeps any argument with a
side effect, so `console.log(queue.shift())` still shifts. The `log` façade in
`src/engine/core/Log.ts` (`log.debug`, `log.info`, `log.warn`, `log.error`)
adds a tag and a rate-limited warning for hot paths.

## Programmatic execution

```ts
const registry = CommandRegistry.getInstance();
const output = await registry.execute('bsp info');
const result = await registry.executeChecked('bsp load washoi_dm2');
```

`executeChecked` is preferable in automation because its `ok` field distinguishes command failure from ordinary output.

## Source of truth

- `src/engine/console/Command.ts`
- `src/engine/console/CommandRegistry.ts`
- `src/engine/console/commands/`
- `src/games/fps/console/commands/`

See [Command reference](./command-reference.md) for the user-facing command list.
