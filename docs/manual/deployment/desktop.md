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

The intended output directory is `release/<version>/`, with electron-builder targets configured in `electron-builder.config.js`.

### Known packaging blocker

At the time of this audit, `electron-builder.config.js` requires `src/game/game.json`, but that path does not exist; active game metadata lives under the game modules. Update the packaging configuration to an existing, selected game manifest before expecting `electron:build` to complete.

This is a repository configuration issue, not an extra Electron installation step.

## Security model

The renderer receives a small API from `preload.ts`; keep Node integration disabled and expose only capabilities required by the game. Validate external links, navigation, and any future filesystem IPC in the main process.

## Release checklist

- make `electron:preview` pass on the target OS;
- fix and verify the selected game-metadata source;
- provide icons under `build-resources/`;
- sign platform artifacts where required;
- confirm production asset paths and native fullscreen behavior;
- test installers on a clean machine.
