/**
 * Electron Builder Configuration
 * 
 * Configures how the app is packaged for Windows, Linux, and macOS.
 * Run: npm run electron:build
 * 
 * Reads metadata for the selected game, the same way vite.config.ts picks it:
 * the GAME environment variable, else engine.json's defaultGame.
 */

const engineConfig = require('./public/engine.json');
const selectedGame = process.env.GAME || engineConfig.defaultGame || 'fps';
const gameConfig = require(`./src/games/${selectedGame}/game.json`);

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
