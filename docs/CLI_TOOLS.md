# CLI Tools

Command-line tools for headless engine operations without a browser or WebGL.

## Overview

These tools use Babylon.js **NullEngine** to run engine operations in Node.js without rendering. This enables:

- CI/CD validation of maps and assets
- Automated testing and analysis
- Scripting and batch processing
- Development debugging without launching a browser

## Prerequisites

```bash
# Tools are run with vite-node (included in dev dependencies)
npx vite-node <script>
```

## Available Tools

### headless-game.ts

Full headless game runner that mirrors the real game startup. Loads all PK3 files and shaders, then provides an interactive or batch console with **all engine commands** available.

**Usage:**

```bash
# Interactive REPL mode
npx vite-node src/cli/headless-game.ts

# Batch mode - execute commands and exit
npx vite-node src/cli/headless-game.ts --exec "bsp load wdm11; bsp info"

# Multiple commands with output capture
npx vite-node src/cli/headless-game.ts --exec "bsp load wdm11; bsp textures; writeconsole output.log"
```

**Commands:**

The headless runner registers ~26 commands from the engine. Key commands for headless work:

| Command | Description |
|---------|-------------|
| `help` | Show all available commands |
| `help <cmd>` | Show detailed help for a command |
| `pk3 list` | List all loaded PK3 files with file counts |
| `pk3 find <pattern>` | Find files matching pattern in PK3 archives |
| `shader list` | List all loaded shaders |
| `shader find <pattern>` | Find shaders by name |
| `shader info <name>` | Show full shader definition as JSON |
| `bsp load <name>` | Load a BSP from PK3 (e.g., `bsp load wdm11`) |
| `bsp info` | Show BSP header info (format, version, counts) |
| `bsp entities [filter]` | List entities (optionally filtered by classname) |
| `bsp textures [filter]` | List textures used by the map |
| `bsp faces` | Show face type breakdown (polygon/patch/mesh) |
| `bsp worldspawn` | Show worldspawn entity properties |
| `bsp required` | Show required PK3 files for textures |
| `headless info` | Show headless engine status |
| `headless history [n]` | Show last n lines of console output |
| `writeconsole [file]` | Write all console output to file (default: console.log) |
| `version` | Show engine and Node.js version |
| `quit` | Exit the headless runner |

**Note:** Some commands like `map`, `scene`, and `bsp render` require DOM/canvas and will report errors in headless mode. Use `bsp load` instead of `map` for headless BSP loading.

**Example Session:**

```
> npx vite-node src/cli/headless-game.ts

=== Headless Game Engine ===

[Init] Creating NullEngine...
[Init] Engine created: WebGL1
[Init] Loading game systems...
[Init] Found 94 PK3 files
[Init] Indexed 94/94 PK3 files
[Init] Loaded 1741 shaders
[Init] Commands registered: 26

[Init] Startup complete!

[Ready] Type commands, 'help' for list, 'quit' to exit

> bsp load wdm11
Loaded: maps/wdm11.bsp
Format: FBSP v1
Lightmap size: 512x512
Entities: 79
Faces: 6245
Vertices: 48690
Lightmaps: 8
Textures: 113
Shaders: 1741

> bsp info
=== BSP Info ===
Format: FBSP v1
Lightmap size: 512x512

Entities: 79
Textures: 113
Planes: 4126
Nodes: 3041
Leafs: 3046
Models: 4
Brushes: 866
Vertices: 48690
Faces: 6245
MeshVerts: 41202
Lightmaps: 8
LightVols: 23351
VisData: 1618 clusters

> bsp faces
=== Face Types ===
Polygons (type 1): 5781
Patches (type 2): 60
Meshes (type 3): 389
Billboards (type 4): 0
Total: 6245

> writeconsole debug-output.log
Console output written to debug-output.log (156 lines)

> quit
[Headless] Shutting down...
```

---

### headless-bsp.ts

Lightweight BSP file inspector for quick analysis of individual BSP files without loading PK3 indexes.

**Usage:**

```bash
# Default: show info
npx vite-node src/cli/headless-bsp.ts <bspfile>

# Specific commands
npx vite-node src/cli/headless-bsp.ts info <bspfile>
npx vite-node src/cli/headless-bsp.ts entities <bspfile>
npx vite-node src/cli/headless-bsp.ts textures <bspfile>
npx vite-node src/cli/headless-bsp.ts effects <bspfile>
npx vite-node src/cli/headless-bsp.ts build <bspfile>

# Test NullEngine
npx vite-node src/cli/headless-bsp.ts test
```

**Commands:**

| Command | Description |
|---------|-------------|
| `info` | Show BSP header, lump counts, face type breakdown |
| `entities` | List all entities grouped by classname |
| `textures` | List all texture names with surface/content flags |
| `effects` | List fog effects with brush info |
| `build` | Build meshes headlessly and show stats |
| `test` | Test NullEngine functionality |

**Example:**

```bash
> npx vite-node src/cli/headless-bsp.ts info temp/wdm11.bsp

[HeadlessBSP] Command: info
[HeadlessBSP] File: temp/wdm11.bsp

[HeadlessBSP] Loaded 11.29 MB
[HeadlessBSP] BSP parsed: FBSP v1

=== BSP Info ===

Format: FBSP (Warsow)
Version: 1
Lightmap size: 512x512

Lumps:
  Entities: 79
  Textures: 113
  Planes: 5174
  Nodes: 3299
  Leafs: 4157
  Faces: 6245
  Vertices: 48690
  MeshVerts: 70236
  Lightmaps: 8
  Effects: 1
  Brushes: 866
  BrushSides: 5618
  Models: 1

Face types:
  Polygons: 5781
  Patches: 60
  Meshes: 389
  Billboards: 0
```

## Use Cases

### CI/CD Validation

Validate all maps in a build pipeline:

```bash
#!/bin/bash
for map in wdm1 wdm2 wdm11; do
  npx vite-node src/cli/headless-game.ts --exec "bsp load $map; bsp info" || exit 1
done
echo "All maps validated"
```

### Asset Analysis

Generate a report of all textures used across maps:

```bash
npx vite-node src/cli/headless-game.ts --exec "bsp load wdm11; bsp textures; writeconsole wdm11-textures.log"
```

### Debugging

Inspect BSP structure without launching a browser:

```bash
npx vite-node src/cli/headless-game.ts --exec "bsp load wdm11; bsp info; bsp faces"
```

### Shader Investigation

Find and inspect shaders:

```bash
npx vite-node src/cli/headless-game.ts --exec "shader find fog"
npx vite-node src/cli/headless-game.ts --exec "shader info textures/criziswdm4/fog"
```

## Technical Details

### NullEngine

Babylon.js NullEngine is a headless WebGL implementation that:

- Processes scenes, meshes, and materials without rendering pixels
- Works in Node.js without a browser or canvas
- Supports full geometry operations (vertex buffers, indices)
- Cannot perform actual rendering or texture operations

### Limitations

- **No visual output**: NullEngine processes geometry but doesn't render images
- **No texture loading**: Textures are referenced but not decoded
- **No DOM access**: Commands that require `document` or `window` will fail
- **Startup time**: Loading all 94 PK3 files takes several seconds
- **Memory**: Full PK3 index uses significant memory (~500MB+)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GAME_PATH` | `./public/game` | Path to PK3 files |
