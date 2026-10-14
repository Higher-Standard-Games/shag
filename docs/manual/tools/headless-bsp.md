# Headless BSP CLI

`cli:bsp` parses a BSP file supplied as an ordinary filesystem path. Unlike `cli:game`, it does not resolve a map name through the PK3 index.

## Usage

```bash
npm run cli:bsp -- info path/to/map.bsp
```

If the first argument is a path rather than a command, `info` is used.

## Commands

| Command | Purpose |
| --- | --- |
| `info` | Header, lump, face-type, and PVS summary |
| `entities` | Entity counts by classname |
| `textures` | Referenced textures and important flags |
| `effects` | BSP effects lump |
| `build` | Build meshes using Babylon `NullEngine` |
| `collision` | Exercise collision data |
| `clipbrushes` | Analyze clip-brush coverage |
| `liquids` | Audit liquid surfaces and contents |
| `test` | Run the tool self-test |

For a map that remains inside a PK3, use:

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

The direct parser API is synchronous:

```ts
const bytes = readFileSync(file);
const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const bsp = BspLoader.load(data);
```

See `src/cli/headless-bsp.ts` for current command output and arguments.
