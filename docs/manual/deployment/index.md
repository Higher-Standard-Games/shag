# Deployment

Deploy your SHAG Engine game to multiple platforms.

## Platforms

| Platform | Technology | Guide |
|----------|------------|-------|
| Web | Vite static build | [Web Deployment](./web.md) |
| Mobile | Capacitor | [Mobile Deployment](./mobile.md) |
| Desktop | Electron | [Desktop Deployment](./desktop.md) |

## Quick Start

### Web

```bash
npm run build
# Upload dist/ to any static host
```

### Mobile

```bash
npm run build
npx cap sync
npx cap open android  # or ios
```

### Desktop

```bash
npm run build
npm run electron:build
```

## Build Sizes

| Platform | Size (gzip) |
|----------|-------------|
| Web | ~755 KB |
| Android APK | ~15 MB |
| iOS IPA | ~18 MB |
| Windows | ~80 MB |
| macOS | ~90 MB |

## Hosting Recommendations

### Web

- **Netlify** - Free tier, easy deployment
- **Vercel** - Free tier, fast CDN
- **GitHub Pages** - Free for public repos
- **Cloudflare Pages** - Free tier, global CDN

### Mobile

- **Google Play Store** - Android distribution
- **Apple App Store** - iOS distribution
- **TestFlight** - iOS beta testing

### Desktop

- **Steam** - Game distribution
- **itch.io** - Indie game platform
- **Direct download** - Self-hosted
