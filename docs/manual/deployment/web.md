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
- serve `.wasm`, `.pk3`, compressed textures, and source maps with suitable cache headers;
- avoid caching `index.html` indefinitely while using long immutable caching for hashed assets.

Large PK3 files may be more practical on a CDN. The current loaders resolve assets through `GamePaths`, `PK3Index`, and generated manifests; there is no `PK3Loader.setBasePath` API. Configure the public paths rather than documenting a nonexistent loader setter.

## Verification

Test the deployed origin, not just the Vite preview:

1. open browser developer tools and check for 404 or MIME errors;
2. confirm the PK3 index and a representative map resolve;
3. load `wdm2` through the normal gameplay flow;
4. test WebSocket/WebTransport endpoints through the production proxy;
5. confirm cache invalidation with a second deployment.

## Related configuration

- `vite.config.ts`
- `public/engine.json`
- `src/engine/core/GamePaths.ts`
- `src/engine/loader/pk3/PK3Index.ts`
