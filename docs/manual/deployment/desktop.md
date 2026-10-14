# Desktop with Electron

The desktop shell is implemented in `src/electron/main.ts` and `src/electron/preload.ts`.

## Development and preview

```bash
npm run electron:dev
npm run electron:preview
```

`electron:dev` starts Vite and Electron together. `electron:preview` builds the web app, compiles the main/preload processes to `dist-electron/`, and starts the packaged layout without producing an installer.

## Packaging

```bash
npm run electron:build
```

Installers are written to `release/<version>/`, with the electron-builder targets configured in `electron-builder.config.cjs`. The `.cjs` extension matters: this package is `"type": "module"`, so a `.js` config's `module.exports` would assign nothing and electron-builder would receive an empty object. The config picks its game manifest the way `vite.config.ts` does — `GAME`, else `engine.json`'s `defaultGame` — and takes the app's name from that game's `displayName`.

## Security model

The renderer receives a small API from `preload.ts`; keep Node integration disabled and expose only capabilities required by the game. Validate external links, navigation, and any future filesystem IPC in the main process.

## Release checklist

- make `electron:preview` pass on the target OS;
- confirm the installer carries the selected game's name;
- provide icons under `build-resources/`;
- sign platform artifacts where required;
- confirm production asset paths and native fullscreen behavior;
- test installers on a clean machine.
