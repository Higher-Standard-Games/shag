# Building

## Web production build

```bash
npm run build
```

This runs TypeScript and Vite and writes the deployable site to `dist/`. Build filenames and sizes are generated artifacts; inspect the current output instead of relying on fixed values in documentation.

A `postbuild` step then moves the hidden source maps out of `dist/` into `sourcemaps/`. Keep them for symbolicating error reports; do not deploy them, and do not let them into the Electron or Capacitor packages, both of which copy `dist/` wholesale.

Preview it locally:

```bash
npm run preview
```

## Texture conversion

```bash
npm run tools:textures:audit
npm run build:prod
```

`build:prod` converts eligible textures before the ordinary web build. Texture conversion mutates generated asset outputs, so review its audit before using it on a new data set.

## Game selection

Vite reads `GAME` and defaults to the configured FPS game. In PowerShell:

```powershell
$env:GAME = 'fps'
npm run build
```

The build-time alias does not by itself make every runtime path game-agnostic. Check `vite.config.ts`, `tsconfig.json`, and `src/main.ts` when adding a game composition.

## Documentation builds

```bash
npm run docs:api
npm run docs:build
npm run docs:preview
```

`docs:api` generates TypeDoc output under `docs/api/`; `docs:build` builds the VitePress manual.

## Before packaging

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

For gameplay, renderer, or networking changes, also run the targeted headless checks documented in the repository `AGENTS.md`.

See [Deployment](../deployment/) for platform-specific wrappers.
