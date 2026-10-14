# Deployment

The repository has three delivery paths, at different levels of maturity.

| Target | Current path | Status |
| --- | --- | --- |
| Web | Vite static build | Primary and directly buildable |
| Android | Capacitor 8 project in `android/` | Project exists; native startup and lifecycle need verifying on a device |
| Desktop | Electron 40 and electron-builder | Shell and packaging config exist; installers need testing per platform |
| iOS | Capacitor | No iOS project is committed |

Start with a clean web build:

```bash
npm run typecheck
npm run test:run
npm run build
```

Then follow the target guide:

- [Web deployment](./web.md)
- [Android/Capacitor](./mobile.md)
- [Desktop/Electron](./desktop.md)

Do not use fixed package-size estimates as release criteria. Measure the current artifacts, including any external PK3 data shipped with the game.
