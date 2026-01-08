# Headless Game CLI

Run the full SHAG Engine without a GPU using NullEngine.

## Overview

Headless mode allows you to:

- Run console commands without a browser
- Validate maps and assets
- Automate testing in CI/CD pipelines
- Script batch operations

## Usage

```bash
npm run cli:game
```

Or with commands:

```bash
npm run cli:game -- --command "map wdm7" --command "bsp info"
```

## Options

| Option | Description |
|--------|-------------|
| `--command "cmd"` | Execute command(s) |
| `--map <name>` | Load map on startup |

## Interactive Mode

Without commands, enters interactive REPL:

```
=== Headless Game Engine ===

[Init] Creating NullEngine...
[Init] Found 94 PK3 files
[Init] Loaded 1741 shaders
[Init] Commands registered: 45

[Ready] Type commands, 'help' for list, 'quit' to exit

> map wdm7
[MapLoader] Loading map: wdm7
...
> bsp info
Format: FBSP
Vertices: 12,456
...
> quit
[Headless] Shutting down...
```

## Available Commands

All 45+ console commands work in headless mode:

```
help                # List commands
map <name>          # Load map
bsp info            # Map statistics
bsp entities        # Entity list
shader count        # Shader count
pk3 list <path>     # Browse PK3s
version             # Engine version
quit                # Exit
```

## CI/CD Integration

Use in GitHub Actions:

```yaml
- name: Validate Maps
  run: |
    npm run cli:game -- \
      --command "map wdm7" \
      --command "bsp info"
```

## Scripting

Chain multiple commands:

```bash
npm run cli:game -- \
  --command "map wdm7" \
  --command "bsp info" \
  --command "bsp entities" \
  --command "quit"
```

## Limitations

- No visual rendering (NullEngine)
- No mouse/keyboard input
- No audio playback
- Texture loading skipped

## Related

- [Headless BSP](./headless-bsp.md) - BSP-only loader
- [Guide: Headless Mode](../guides/headless-mode.md) - In-depth explanation
