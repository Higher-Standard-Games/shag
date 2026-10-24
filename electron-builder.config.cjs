/**
 * Electron Builder Configuration
 * 
 * Configures how the app is packaged for Windows, Linux, and macOS.
 * Run: npm run electron:build
 * 
 * Reads optional application metadata selected with SHAG_APP or the local
 * browser application file. A plain checkout packages the engine example.
 */

const fs = require('node:fs');
const path = require('node:path');
const local = path.join(__dirname, '.shag-application.json');
const selection = process.env.SHAG_APP ?? (fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8').replace(/^\uFEFF/, '')).application : 'engine');
if (typeof selection !== 'string' || !selection.trim()) throw new Error('Invalid desktop application selection');
const gameConfig = selection === 'engine' ? { name: 'SHAG Engine', desktop: { appId: 'com.shagengine.app' } }
  : JSON.parse(fs.readFileSync(path.resolve(__dirname, selection, 'game.json'), 'utf8'));

module.exports = {
  appId: gameConfig.desktop?.appId || 'com.shagengine.game',
  productName: gameConfig.displayName || gameConfig.display?.title || gameConfig.name || 'SHAG Engine Game',
  
  // Directories
  directories: {
    output: 'release/${version}',
    buildResources: 'build-resources',
  },
  
  // Files to include
  files: [
    'dist/**/*',           // Built web app
    'dist-electron/**/*',  // Built electron files
  ],
  
  // Windows configuration
  win: {
    target: [
      {
        target: 'nsis',      // Installer
        arch: ['x64'],       // 64-bit only
      },
      {
        target: 'portable',  // Portable exe (no install)
        arch: ['x64'],
      },
    ],
    icon: 'build-resources/icon.ico',
  },
  
  // NSIS installer options (Windows)
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build-resources/icon.ico',
    uninstallerIcon: 'build-resources/icon.ico',
    installerHeaderIcon: 'build-resources/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: gameConfig.displayName || gameConfig.display?.title || gameConfig.name || 'Game',
  },
  
  // Linux configuration
  linux: {
    target: [
      {
        target: 'AppImage',  // Universal Linux format
        arch: ['x64'],
      },
      {
        target: 'deb',       // Debian/Ubuntu
        arch: ['x64'],
      },
    ],
    icon: 'build-resources/icons',
    category: 'Game',
    synopsis: gameConfig.description || 'A game built with SHAG Engine',
    description: `${gameConfig.displayName || gameConfig.display?.title || gameConfig.name || 'Game'} - Built with SHAG Engine`,
  },
  
  // macOS configuration (if needed later)
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
    ],
    icon: 'build-resources/icon.icns',
    category: 'public.app-category.games',
  },
  
  // Auto-update configuration (optional, for future use)
  // publish: {
  //   provider: 'github',
  //   owner: 'yourusername',
  //   repo: 'ganjawars',
  // },
};
