# Web deployment

## Build and preview

For the engine example, run at the SHAG root:

```bash
npm run build
npm run preview
```

For Washoi, check out the game at `src/games/fps`, install dependencies once at
the SHAG root, and select the game through its package commands:

```bash
npm --prefix src/games/fps run build
npm --prefix src/games/fps run preview
```

Inside `src/games/fps`, `npm run build` and `npm run preview` are equivalent.
The launcher selects the game with `SHAG_APP` and runs at the SHAG root; web
output goes to the root's `dist/`, server output to `dist-server/`, and media
stays under `public/data/`. Generic root commands follow `SHAG_APP` or the local
`.shag-application.json` selection, falling back to the engine example.

Deploy the contents of `dist/` to a static HTTPS host. Vite copies files from `public/`, so any game data under `public/data/` becomes part of the output unless the deployment process separates it. The exception is `public/ui-proto/`, the static UI mockups: the dev server serves them, and the `drop-dev-only-pages` plugin in `vite.config.ts` removes them from release builds.

## Preserve persistent media during checkout changes

`public/data/` is persistent, gitignored data. Changing the engine/game checkout
layout must preserve its contents and, when it is a symlink or junction, its
target. This applies to local development and production. A fresh Git checkout
does not restore these assets.

Before a cutover, record the existing path and link target and verify a backup
or snapshot of the actual data. Keep the existing data attached to the assembled
SHAG root. Exclude persistent media and its target from checkout cleanup,
deployment deletion and empty-directory replacement. After switching code,
verify the link, installed packages and representative map/model/sound requests
before declaring the migration complete. Rollback must preserve the same data.

## Updating media

Deployment builds from `public/data` but never writes to it, so rebuilt media
(a package from `tools:weapon-models` or `tools:map-media`, or a regenerated
`ktx2cache/`) reaches production only when it is copied there. Washoi's
regions keep it at `/srv/washoi/assets/data`. A deploy copies the built `data/`
into the served release without deleting files, skipping demos and the
unpublished master texture bank, and regenerates `pk3_index.json` while
building. Upload changed media first, then publish the code that needs it; the
next deploy serves both together.

Upload only files whose checksum differs from production, never the generated
index or manifest. Keep a copy of each replaced file, write to a temporary name
and rename into place, and keep the existing owner and mode. After the deploy,
check that the changed files return 200 with their new size and that maps and
weapons load. The `merge-and-release` skill in the repository has the exact
commands.

## Link previews

The selected application's HTML template supplies link-preview metadata. Washoi's
template is `src/games/fps/index.html`, selected by its `browser.json`; it carries
the description, Open Graph and Twitter card tags. Edit that template for a
Washoi deployment under another name or with another card image. The root
`index.html` is the neutral engine template.

## Hosting requirements

- serve `index.html` and hashed assets with the correct MIME types;
- provide an SPA fallback to `index.html` for client-side routes;
- use HTTPS for browser APIs and production networking;
- serve `.wasm`, `.pk3` and compressed textures with suitable cache headers;
- do not deploy source maps: the build emits hidden maps and then moves them out of `dist/` into `sourcemaps/`, which is for symbolicating reports, not for serving;
- avoid caching `index.html` indefinitely while using long immutable caching for hashed assets.

Large PK3 files may be more practical on a CDN: build with `VITE_PK3_MIRROR_URL` and the client downloads packages from that mirror when it has an up-to-date copy, falling back to this origin otherwise. See [PK3 filesystem](../guides/pk3-filesystem.md#http-mirror). Loose assets resolve through `GamePaths`, `PK3Index` and the generated manifests.

## Server processes

Washoi's EU and US deployment operators fetch the engine and game independently.
`/srv/washoi/release-pair.json` records both exact commit IDs. Deploy timers
follow engine `main` and its recorded game revision by default; `mode: pinned`
holds an explicitly selected pair for rollback. Publishing engine `main` after
the matching game commit automatically selects, builds and activates that pair.
Connected players do not defer the backend restart. Pushing a feature branch
alone does not change that selection. The
[game-owned production runbook](https://github.com/Higher-Standard-Games/wash-fps/blob/main/scripts/deployment/README.md)
describes the regional scripts, automatic activation and rollback. Updating this
operator configuration does not itself publish a new application release.

The static build is only the client. Multiplayer needs three Node 24 processes
beside it:

The table below uses Washoi's package commands from the SHAG root. For normal
lobby play, start the lobby and bot service in separate terminals; the lobby
starts match servers as needed. Use the standalone match command for direct
connections. Give lobby and bot commands the same `-- --data-dir <path>` when
overriding storage; relative paths resolve at the SHAG root.

| Process | Start (production) | Start (development) |
| --- | --- | --- |
| Lobby (spawns one match server per match) | `npm --prefix src/games/fps run lobby:server` | `npm --prefix src/games/fps run lobby:server:dev` |
| Bot server | `npm --prefix src/games/fps run bot:server` | `npm --prefix src/games/fps run bot:server:dev` |
| Match server (normally spawned by the lobby) | `npm --prefix src/games/fps run net:server` | `npm --prefix src/games/fps run net:server:dev` |

The production scripts build `dist-server/` (`npm --prefix src/games/fps run build:server`) and run
the bundles with plain Node. The development scripts run the TypeScript
sources through `vite-node`, which transpiles them at every start. Match
servers inherit the lobby's mode: a bundled lobby spawns bundled matches.

Run bundles in production. Measured on `washoi_dm2`:

| Match server | Ready for connections | Memory 5 s after start |
| --- | --- | --- |
| `vite-node` | 1.1–1.2 s | 264–272 MB |
| Bundle | 0.26 s | 122–123 MB |

Every match pays the start-up time while its players wait, and the memory
for as long as it runs.

What a deployment has to do with bundles:

- **Rebuild on server changes.** Bundled processes run what was built, not the
  working tree. Run `npm --prefix src/games/fps run build:server` after updating the source; it builds
  into a staging directory and swaps it in only when complete, so a match the
  lobby spawns during the build still gets a whole bundle.
- **Match servers** pick up a rebuild at their next spawn; running matches keep
  the code they started with.
- **The lobby and bot server** pick it up on restart. Restarting the lobby ends
  its live rooms (matches are its child processes), so restart when idle.
- Keep `node_modules` installed: the bundles leave `ws` and TensorFlow.js
  external.

## Verification

Test the deployed origin, not just the Vite preview:

1. open browser developer tools and check for 404 or MIME errors;
2. confirm the PK3 index and a representative map resolve;
3. load `washoi_dm2` through the normal gameplay flow;
4. test the lobby and game-server WebSocket (`wss://`) endpoints through the production proxy;
5. confirm cache invalidation with a second deployment.

## Related configuration

- `vite.config.ts`
- `public/engine.json`
- `src/engine/core/GamePaths.ts`
- `src/engine/loader/pk3/PK3Index.ts`
