# Web deployment

## Build and preview

```bash
npm run build
npm run preview
```

Deploy the contents of `dist/` to a static HTTPS host. Vite copies files from `public/`, so any game data under `public/data/` becomes part of the output unless the deployment process separates it.

## Hosting requirements

- serve `index.html` and hashed assets with the correct MIME types;
- provide an SPA fallback to `index.html` for client-side routes;
- use HTTPS for browser APIs and production networking;
- serve `.wasm`, `.pk3` and compressed textures with suitable cache headers;
- do not deploy source maps: the build emits hidden maps and then moves them out of `dist/` into `sourcemaps/`, which is for symbolicating reports, not for serving;
- avoid caching `index.html` indefinitely while using long immutable caching for hashed assets.

Large PK3 files may be more practical on a CDN: build with `VITE_PK3_MIRROR_URL` and the client downloads packages from that mirror when it has an up-to-date copy, falling back to this origin otherwise. See [PK3 filesystem](../guides/pk3-filesystem.md#http-mirror). Loose assets resolve through `GamePaths`, `PK3Index` and the generated manifests.

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
