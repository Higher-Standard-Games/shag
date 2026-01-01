/**
 * Electron Main Process
 * 
 * Creates the native window and loads the SHAG Engine game.
 * Handles native desktop features like window controls, menus, etc.
 */

import { app, BrowserWindow, Menu, shell } from 'electron';
import * as path from 'path';

// Load game configuration
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gameConfig = require(path.join(__dirname, '..', 'src', 'game', 'game.json'));

// Handle creating/removing shortcuts on Windows when installing/uninstalling
// This module is only available when installed via Squirrel installer
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // Module not available in development
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null;

// Determine if we're in development or production
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Create the main application window
 */
function createWindow(): void {
  const desktopConfig = gameConfig.desktop || {};
  
  mainWindow = new BrowserWindow({
    width: desktopConfig.width || 1280,
    height: desktopConfig.height || 720,
    minWidth: desktopConfig.minWidth || 800,
    minHeight: desktopConfig.minHeight || 600,
    title: desktopConfig.windowTitle || gameConfig.display?.title || gameConfig.name || 'Game',
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    // Start with frame, can be made frameless for custom title bar
    frame: true,
    // Enable hardware acceleration for BabylonJS
    backgroundColor: '#000000',
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

/**
 * Create the application menu
 */
function createMenu(): void {
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    {
      label: 'Game',
      submenu: [
        {
          label: 'Fullscreen',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SHAG Engine',
          click: () => {
            // Could show an about dialog
            shell.openExternal('https://github.com/yourusername/shag-engine');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle second instance (single instance lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
