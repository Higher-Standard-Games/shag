# Tools

CLI tools and debugging utilities included with SHAG Engine.

## CLI Tools

| Tool | Command | Description |
|------|---------|-------------|
| [Headless Game](./headless-game.md) | `npm run cli:game` | Full engine without GPU |
| [Headless BSP](./headless-bsp.md) | `npm run cli:bsp` | BSP loader only |
| [Network Server](./network-server.md) | `npm run net:server` | Dedicated game server |
| [Network Client](./network-client.md) | `npm run net:client` | Headless network client |
| [Agent Orchestration](./agent-orchestration.md) | `npm run dev:research:wizard` | Multi-agent document research |

Use Agent Orchestration when you want a low-friction research pass over one document and a synthesized result under `.agent/runs/`.

## Debug Commands

In-game debugging via console:

| Command | Description |
|---------|-------------|
| `debug fps` | Toggle FPS display |
| `debug wireframe` | Toggle wireframe |
| `debug bounds` | Show bounding boxes |
| `shader info` | Inspect aimed surface |
| `shader aim 1` | Highlight aimed surface |
| `bsp info` | Map statistics |
| `bsp entities` | List entities |
| `mem` | Memory usage |

## Bundle Analysis

After building, analyze bundle composition:

```bash
npm run build
# Open dist/stats.html in browser
```

## API Documentation

Generate TypeDoc documentation:

```bash
npm run docs
# Opens docs/api/index.html
```

## Performance Profiling

Use browser DevTools with:

```
show_fps 1          # Enable FPS counter
pvs toggle          # Toggle PVS culling
r_wireframe 1       # See geometry complexity
```
