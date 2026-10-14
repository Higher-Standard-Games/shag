# Tools

## CLI entry points

| Tool | Command | Purpose |
| --- | --- | --- |
| [Headless game](./headless-game.md) | `npm run cli:game` | Engine commands and indexed map inspection |
| [Headless BSP](./headless-bsp.md) | `npm run cli:bsp` | Direct BSP-file analysis |
| [Network server](./network-server.md) | `npm run net:server` | Dedicated authoritative server |
| [Network client](./network-client.md) | `npm run net:client` | Protocol/connectivity smoke client |
| [Agent orchestration](./agent-orchestration.md) | `npm run dev:research:wizard` | Multi-agent research document workflow |

Other focused scripts are listed in `package.json` and the [Headless mode guide](../guides/headless-mode.md).

## Browser diagnostics

```text
developer 1
show_fps on
perf capture 5
debug wireframe
debug bounds
shader aim 1
shader info
bsp info
mem
```

## Documentation

```bash
npm run docs:dev
npm run docs:api
npm run docs:build
npm run docs:preview
```

`docs:api` generates TypeDoc under `docs/api/`; the other scripts serve/build the VitePress manual.
