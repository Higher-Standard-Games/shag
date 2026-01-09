# Web Deployment

Deploy SHAG Engine games as static web applications.

## Build for Production

```bash
npm run build
```

This creates an optimized build in `dist/`.

## Output Structure

```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js    # Main bundle
│   └── index-[hash].css   # Styles
└── game/                  # PK3 assets (if included)
```

## Static Hosting

The `dist/` folder can be deployed to any static host.

### Netlify

1. Connect GitHub repository
2. Set build command: `npm run build`
3. Set publish directory: `dist`

Or use CLI:

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

### Vercel

```bash
npm install -g vercel
vercel --prod
```

### GitHub Pages

Add to `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## Asset Hosting

PK3 files are large. Consider:

### Option 1: Include in Build

Place in `public/games/default/`, included in `dist/`.

**Pros:** Simple, works offline  
**Cons:** Large initial download

### Option 2: CDN

Host assets separately:

```typescript
PK3Loader.setBasePath('https://cdn.example.com/game/');
```

**Pros:** Cached separately, smaller app bundle  
**Cons:** Requires CDN setup

## Compression

Ensure server sends gzip/brotli:

| File | Uncompressed | Gzip |
|------|-------------|------|
| Main JS | 3.4 MB | 755 KB |

Most hosts handle this automatically.

## CORS

If hosting assets on CDN, configure CORS headers:

```
Access-Control-Allow-Origin: *
```

## Cache Headers

Recommended cache policy:

| File | Cache |
|------|-------|
| `index.html` | No cache |
| `assets/*` | 1 year (hashed) |
| `game/*.pk3` | 1 year |
