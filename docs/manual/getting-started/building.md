# Building for Production

How to create optimized production builds.

## Basic Build

```bash
npm run build
```

This creates a production build in `dist/`.

## Build with Texture Optimization

For optimal texture loading with KTX2 compression:

```bash
npm run build:prod
```

This runs texture conversion before building.

## Build Output

```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js      # Main bundle (~3.4 MB)
│   ├── index-[hash].css     # Styles
│   └── vendor-[hash].js     # Vendor chunks
└── stats.html               # Bundle analyzer
```

## Bundle Analysis

After building, open `dist/stats.html` to visualize bundle composition:

```bash
npm run build
# Then open dist/stats.html in browser
```

## Optimizations Applied

| Optimization | Savings |
|--------------|---------|
| Tree-shaking | 8 MB → 3.4 MB |
| Code splitting | Separate vendor chunks |
| Minification | ~40% reduction |
| Gzip | 3.4 MB → 755 KB |

## Environment Variables

Create `.env.production` for production-specific settings:

```env
VITE_API_URL=https://api.yourgame.com
VITE_DEBUG=false
```

## Preview Build

Test the production build locally:

```bash
npm run preview
```

Opens at [http://localhost:4173](http://localhost:4173).

## Deployment

See the [Deployment Guide](../deployment/) for platform-specific instructions:

- [Web Deployment](../deployment/web.md)
- [Mobile (Capacitor)](../deployment/mobile.md)
- [Desktop (Electron)](../deployment/desktop.md)
