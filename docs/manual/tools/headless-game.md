# Headless game CLI

The headless game runner creates a Babylon `NullEngine`, initializes shared engine services, registers engine console commands, and supports interactive or batch execution.

## Interactive mode

```bash
npm run cli:game
```

Use `help` to inspect commands and `quit` to stop.

## Batch mode

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

`--command` is an alias for `--exec`. A semicolon-separated batch is the simplest CI form. There is no `--map` option.

This composition does not register the browser gameplay launcher, so use `bsp load` rather than `map`.

## Useful batches

```bash
npm run cli:game -- --exec 'pk3 stats; bsp load wdm2; bsp entities; quit'
npm run cli:game -- --exec 'sim replay W+CROUCH 60; JUMP 1; W 30; quit'
```

Batch failures set a non-zero exit status when the command reports an explicit failure, throws, or cannot be resolved.

## Limitations

- no WebGL rendering;
- no interactive browser input;
- browser-only Havok initialization is skipped;
- rendering still needs a browser verification pass.

See [Headless mode](../guides/headless-mode.md) for the full validation workflow.
