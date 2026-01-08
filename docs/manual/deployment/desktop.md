# Desktop Deployment (Electron)

Package SHAG Engine games as desktop applications.

## Prerequisites

- Node.js 18+
- npm or yarn

## Setup Electron

### Install

```bash
npm install electron --save-dev
npm install electron-builder --save-dev
```

### Create Main Process

```javascript
// electron/main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    fullscreen: false,
    autoHideMenuBar: true
  });

  // Load built app
  win.loadFile(path.join(__dirname, '../dist/index.html'));
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### Package.json Scripts

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "npm run build && electron .",
    "electron:build": "npm run build && electron-builder"
  }
}
```

## Electron Builder Config

### electron-builder.json

```json
{
  "appId": "com.example.mygame",
  "productName": "My Game",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "electron/**/*"
  ],
  "win": {
    "target": ["nsis", "portable"],
    "icon": "assets/icon.ico"
  },
  "mac": {
    "target": ["dmg", "zip"],
    "icon": "assets/icon.icns",
    "category": "public.app-category.games"
  },
  "linux": {
    "target": ["AppImage", "deb"],
    "icon": "assets/icon.png",
    "category": "Game"
  }
}
```

## Build for Platforms

### Windows

```bash
npm run electron:build -- --win
```

Outputs:
- `release/My Game Setup.exe` (installer)
- `release/My Game.exe` (portable)

### macOS

```bash
npm run electron:build -- --mac
```

Outputs:
- `release/My Game.dmg`
- `release/My Game.app`

### Linux

```bash
npm run electron:build -- --linux
```

Outputs:
- `release/My Game.AppImage`
- `release/my-game.deb`

## Fullscreen Mode

```javascript
// Toggle fullscreen
win.setFullScreen(!win.isFullScreen());

// Start fullscreen
const win = new BrowserWindow({
  fullscreen: true,
  // ...
});
```

In game:

```typescript
// Request fullscreen via Electron IPC or browser API
document.documentElement.requestFullscreen();
```

## Native Menus

```javascript
const { Menu } = require('electron');

const template = [
  {
    label: 'Game',
    submenu: [
      { label: 'New Game', accelerator: 'CmdOrCtrl+N' },
      { label: 'Load Game', accelerator: 'CmdOrCtrl+O' },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { label: 'Fullscreen', accelerator: 'F11', role: 'togglefullscreen' },
      { label: 'DevTools', accelerator: 'F12', role: 'toggleDevTools' }
    ]
  }
];

Menu.setApplicationMenu(Menu.buildFromTemplate(template));
```

## File System Access

For save games, use Electron's Node.js integration:

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveGame: (data) => ipcRenderer.invoke('save-game', data),
  loadGame: () => ipcRenderer.invoke('load-game')
});
```

```javascript
// main.js
const fs = require('fs');
const path = require('path');

ipcMain.handle('save-game', async (event, data) => {
  const savePath = path.join(app.getPath('userData'), 'save.json');
  fs.writeFileSync(savePath, JSON.stringify(data));
});
```

## Auto-Updates

```bash
npm install electron-updater
```

```javascript
const { autoUpdater } = require('electron-updater');

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});
```

## Code Signing

### Windows

Use a code signing certificate (.pfx):

```json
{
  "win": {
    "certificateFile": "./cert.pfx",
    "certificatePassword": "password"
  }
}
```

### macOS

Requires Apple Developer account and certificates.

## Distribution

- **Steam** - Use Steamworks SDK
- **itch.io** - Upload directly
- **Direct download** - Host on your website
- **Microsoft Store** - Package as MSIX

## Related

- [Web Deployment](./web.md)
- [Mobile Deployment](./mobile.md)
