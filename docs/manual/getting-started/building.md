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

## Hosted build (itch.io)

```bash
npm run build:itch           # writes dist-itch/
npm run build:itch-staging   # writes dist-itch-staging/, with a "Local" region
```

A hosted build runs on a site we don't own, so it differs from the web build
in three ways, all set by `VITE_HOSTED` in `.env.itch`:

- **Region.** It opens on a region picker, before anything loads. The list is
  `https://washoi.net/regions.json`, with a built-in copy when that can't be
  fetched. The picked region's `lobbyUrl` is the lobby, and its `dataUrl`
  serves `/data/`. A reload in the same tab keeps the region.
- **Files.** It loads relative to its `index.html` (`base: './'`) and carries
  every public folder except `data/`, and no source maps or bundle report.
  At runtime `/data/...` and `data/...` go to the region's host and other root
  paths stay in the build (`src/engine/core/PublicUrls.ts`).
- **Account.** Every itch.io game runs on the same origin and could read its
  storage, so the key stays in memory and a login token is stored per region
  instead (see [Lobby server](../guides/lobby-server.md#hosted-builds-login-tokens)).
  The key is shown once, in the welcome guide's last step and in Profile,
  during the session that made or pasted it. Other stored data is not
  trusted: the account's synced settings win on login, and the package index
  is kept in memory.
- **Rooms.** The room shows a code (`eu:3fa9c2d1`, with a private room's
  invite after a second `:`) and Copy code, not a link. Join lobby via invite, at the foot of the Play
  page, takes a code or any region's room link, and chat messages that name a
  room get a Join key; a room in another region switches region first. Links
  to other sites open in a new tab.

The staging build (`VITE_LOCAL_REGION=1` in `.env.itch-staging`) also offers
"Local" when it is served from this machine (`npx vite preview --mode
itch-staging`): the lobby on `ws://localhost:9000` and data from the dev server
on `http://localhost:3000`. On an itch.io page it offers EU and US only:
browsers do not let a page there reach `localhost` (itch.io's frame does not
grant local network access). A region's host
must send CORS headers for `https://html-classic.itch.zone` on `/data/` before
the build can play there.

## Texture conversion

```bash
npm run tools:textures:audit
npm run build:prod
```

`build:prod` converts eligible textures before the ordinary web build. Texture conversion mutates generated asset outputs, so review its audit before using it on a new data set.

## Game selection

Vite selects the browser application through `SHAG_APP`, then the ignored
`.shag-application.json` file, defaulting to the engine example. To build Washoi
from the assembled checkout:

```powershell
npm --prefix src/games/fps run build
```

The game command sets `SHAG_APP` to its own directory. For the engine example,
set `$env:SHAG_APP = 'engine'` before `npm run build`. A custom application uses
a directory containing `browser.json`; see [Configuration](../guides/configuration.md#browser-application-selection).

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
