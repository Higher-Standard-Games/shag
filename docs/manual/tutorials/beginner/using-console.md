# Using the console

Open the console with backquote/tilde. Use Up/Down for history and Tab for completion.

## Discover commands

```text
help
help bsp
help camera
```

The command classes and definitions are the source of truth; command counts and version strings change and are not duplicated here.

## Common workflow

```text
developer 1
pk3 stats
bsp load wdm2
bsp info
bsp render
camera mode freefly
pos
```

For gameplay:

```text
map wdm2 duel
connect localhost:7777
```

Whether `map` or `connect` succeeds depends on the configured lobby/server process.

## Variables

Registered cvars are commands:

```text
r_wireframe
r_wireframe 1
r_wireframe 0
sv_gravity
sv_gravity 800
```

Renderer group operations use:

```text
render list
render reset
render export
```

## Debugging

```text
debug info
debug wireframe
debug bounds
shader aim 1
shader info
```

`show_fps` toggles the frame-rate counter.

## Quoting and batches

Arguments containing spaces are quoted with double quotes; the parser does not treat single quotes as quoting:

```text
echo "hello world"
```

Headless batches are semicolon-separated:

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

The console has no user-defined aliases. Put repeatable sequences in a configuration file and run it with `exec`, or add a command class.
