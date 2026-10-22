# Web deployment

## Build and preview

```bash
npm run build
npm run preview
```

Deploy the contents of `dist/` to a static HTTPS host. Vite copies files from `public/`, so any game data under `public/data/` becomes part of the output unless the deployment process separates it. The exception is `public/ui-proto/`, the static UI mockups: the dev server serves them, and the `drop-dev-only-pages` plugin in `vite.config.ts` removes them from release builds.

## Link previews

`index.html` carries the `description`, Open Graph (`og:*`) and `twitter:card` (`summary_large_image`) tags that chat apps and social sites read for a link preview. `og:image` must be an absolute URL; it points at `https://washoi.net/og-image.png` (1200×630). A deployment under another name or with another card image edits these tags in `index.html`.

## Hosting requirements

- serve `index.html` and hashed assets with the correct MIME types;
- provide an SPA fallback to `index.html` for client-side routes;
- use HTTPS for browser APIs and production networking;
- serve `.wasm`, `.pk3` and compressed textures with suitable cache headers;
- do not deploy source maps: the build emits hidden maps and then moves them out of `dist/` into `sourcemaps/`, which is for symbolicating reports, not for serving;
- avoid caching `index.html` indefinitely while using long immutable caching for hashed assets.

Large PK3 files may be more practical on a CDN: build with `VITE_PK3_MIRROR_URL` and the client downloads packages from that mirror when it has an up-to-date copy, falling back to this origin otherwise. See [PK3 filesystem](../guides/pk3-filesystem.md#http-mirror). Loose assets resolve through `GamePaths`, `PK3Index` and the generated manifests.

## Server processes

The static build is only the client. Multiplayer needs three Node 24 processes
beside it:

| Process | Start (production) | Start (development) |
| --- | --- | --- |
| Lobby (spawns one match server per match) | `npm run lobby:server` | `npm run lobby:server:dev` |
| Bot server | `npm run bot:server` | `npm run bot:server:dev` |
| Match server (normally spawned by the lobby) | `npm run net:server` | `npm run net:server:dev` |

The production scripts build `dist-server/` (`npm run build:server`) and run
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
  working tree. Run `npm run build:server` after updating the source; it builds
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
