# Adding a console command

Commands are classes in a command directory that the console discovers automatically.

## Game-specific command

Create `src/games/fps/console/commands/HelloCommand.ts` (the file name must end in `Command.ts` to be discovered):

```ts
import { Command, type CommandDef, fail } from '../../../../engine/console/Command';

export default class HelloCommand extends Command {
  readonly definition: CommandDef = {
    name: 'hello',
    aliases: ['hi'],
    description: 'Print a greeting',
    usage: 'hello [name]',
  };

  async execute(args: string[]) {
    const name = args[0]?.trim();
    if (name === 'error') {
      return fail('The example was asked to fail');
    }
    return `Hello, ${name || 'player'}!`;
  }
}
```

Engine commands use the same pattern under `src/engine/console/commands/`.

Restart the development server after adding a module if Vite does not refresh the discovery glob, then run:

```text
hello
hi Ranger
help hello
```

## Metadata

`CommandDef` supports:

- `name`, `description`, and optional `usage`;
- aliases;
- a developer-only gate;
- subcommand and argument definitions used by help/completion.

Metadata describes and completes arguments; the command still owns semantic validation.

## Failures

Return `fail(message)` when automation must see a failure. An ordinary returned string is successful output even if the text says error.

## Cleanup for dynamic commands

Discovered command classes stay registered for the registry's lifetime. A runtime integration can register a handler function instead and remove it on teardown:

```ts
const registry = CommandRegistry.getInstance();
registry.register('temporary', async () => 'ok', 'Temporary command');

// On teardown:
registry.unregister('temporary');
```

See [Console system](../../guides/console-system.md) for programmatic execution.
