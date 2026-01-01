# Electron Desktop Build

Native Windows and Linux builds using Electron.

## Quick Start

```bash
# Install dependencies (includes Electron)
npm install

# Development (hot reload)
npm run electron:dev

# Preview production build locally
npm run electron:preview

# Build installers
npm run electron:build
```

## Scripts

| Script | Description |
|--------|-------------|
| `electron:dev` | Run in development with hot reload |
| `electron:preview` | Build and run locally (no installer) |
| `electron:build` | Create distributable installers |
| `electron:compile` | Compile Electron TypeScript only |

## Architecture

```
src/electron/
├── main.ts      # Main process - window creation, menus
├── preload.ts   # Preload script - secure bridge to renderer
└── README.md    # This file

dist-electron/   # Compiled Electron files (gitignored)
release/         # Built installers (gitignored)
build-resources/ # Icons and installer assets
```

## Main Process (`main.ts`)

- Creates the BrowserWindow
- Loads Vite dev server (dev) or built files (prod)
- Handles native menus
- Single instance lock (prevents multiple windows)

## Preload Script (`preload.ts`)

Exposes limited APIs to the renderer via `window.electronAPI`:

```typescript
// Check if running in Electron
if (window.electronAPI?.isElectron) {
  console.log('Running in Electron on', window.electronAPI.platform);
}

// Window controls
window.electronAPI?.window.setFullscreen(true);
```

## Build Outputs

After running `npm run electron:build`:

```
release/
└── {version}/
    ├── Ganja Wars Setup.exe     # Windows installer
    ├── Ganja Wars.exe           # Windows portable
    ├── Ganja Wars.AppImage      # Linux universal
    └── ganja-wars.deb           # Debian/Ubuntu
```

## Adding Icons

Place icons in `build-resources/`:
- Windows: `icon.ico` (256x256 multi-res)
- Linux: `icons/` folder with PNG sizes (16-512px)
- macOS: `icon.icns` (optional)

## Platform Detection in Game

```typescript
// In your game code
const isElectron = !!window.electronAPI?.isElectron;
const isAndroid = typeof (window as any).Capacitor !== 'undefined';
const isWeb = !isElectron && !isAndroid;

// Platform-specific behavior
if (isElectron) {
  // Desktop-specific features
} else if (isAndroid) {
  // Mobile-specific features  
}
```

## Troubleshooting

### "Cannot find module 'electron'"
Run `npm install` to install Electron dependencies.

### White screen on start
Check the console (View > Toggle Developer Tools) for errors.
Ensure Vite dev server is running for `electron:dev`.

### Build fails on Linux
Install required packages:
```bash
sudo apt-get install rpm fakeroot
```
