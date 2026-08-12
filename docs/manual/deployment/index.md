# Deployment

The repository has three delivery paths, but they are not at the same maturity level.

| Target | Current path | Status |
| --- | --- | --- |
| Web | Vite static build | Primary and directly buildable |
| Android | Capacitor 8 project in `android/` | Project exists; native lifecycle wiring needs verification |
| Desktop | Electron 40 and electron-builder | Shell exists; packaging metadata path is currently stale |
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
