# Headless game CLI

The headless game runner creates a Babylon `NullEngine`, initializes shared engine services, registers engine console commands, and supports interactive or batch execution.

## Interactive mode

```bash
npm run cli:game
```

Use `help` to inspect commands and `quit` to stop. This runner adds `sim`, `anim`, `headless`, `leaktest` and `trace_test` to the engine command set.

## Batch mode

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

`--command` is an alias for `--exec`. A semicolon-separated batch is the simplest CI form. There is no `--map` option.

This composition does not register the browser gameplay launcher, so use `bsp load` rather than `map`.

## Useful batches

```bash
npm run cli:game -- --exec 'developer 1; pk3 stats; bsp load wdm2; bsp entities; quit'
npm run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
```

`pk3` is one of the developer-gated commands, so a batch that uses it starts with `developer 1`; `bsp` is not gated. A batch is split on semicolons and newlines except inside double quotes, which is why the replay sequence above is quoted.

Batch failures set a non-zero exit status when the command reports an explicit failure, throws, or cannot be resolved: a batch whose first command is refused exits 1, and the remaining commands still run.

## Limitations

- no WebGL rendering;
- no interactive browser input;
- browser-only Havok initialization is skipped;
- rendering still needs a browser verification pass.

See [Headless mode](../guides/headless-mode.md) for the full validation workflow.
