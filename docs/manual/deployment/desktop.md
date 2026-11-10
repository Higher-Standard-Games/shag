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

Installers are written to `release/<version>/`, with the electron-builder targets
configured in `electron-builder.config.cjs`. The config uses CommonJS in this
ES-module package. It selects the application through `SHAG_APP`, then
`.shag-application.json`, defaulting to `engine`. A selected application's
`game.json` supplies desktop metadata; the product name uses `displayName`,
then `display.title`, then `name`. The engine example uses neutral SHAG metadata.

To package Washoi from the assembled checkout, run
`npm --prefix src/games/fps run electron:build`. Its package command selects
the game for both the web build and Electron packaging.

## Security model

The renderer receives a small API from `preload.ts`; keep Node integration disabled and expose only capabilities required by the game. Validate external links, navigation, and any future filesystem IPC in the main process.

## Release checklist

- make `electron:preview` pass on the target OS;
- confirm the installer carries the selected game's name;
- provide icons under `build-resources/`;
- sign platform artifacts where required;
- confirm production asset paths and native fullscreen behavior;
- test installers on a clean machine.
