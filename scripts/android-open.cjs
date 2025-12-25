#!/usr/bin/env node
/**
 * Cross-platform script to open Android project in Android Studio
 * Works on Windows, macOS, and Linux
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectDir = path.join(__dirname, '..', 'android');

// Common Android Studio installation paths
const studioPathsWindows = [
  'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe',
  'C:\\Program Files (x86)\\Android\\Android Studio\\bin\\studio64.exe',
  process.env.LOCALAPPDATA + '\\Programs\\Android Studio\\bin\\studio64.exe',
];

const studioPathsMac = [
  '/Applications/Android Studio.app/Contents/MacOS/studio',
];

const studioPathsLinux = [
  '/opt/android-studio/bin/studio.sh',
  '/usr/local/android-studio/bin/studio.sh',
  process.env.HOME + '/android-studio/bin/studio.sh',
];

function findAndroidStudio() {
  const platform = process.platform;
  let paths = [];

  if (platform === 'win32') {
    paths = studioPathsWindows;
  } else if (platform === 'darwin') {
    paths = studioPathsMac;
  } else {
    paths = studioPathsLinux;
  }

  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function openAndroidStudio() {
  const studioPath = findAndroidStudio();

  if (!studioPath) {
    console.error('❌ Android Studio not found in common locations.');
    console.error('');
    console.error('Please open Android Studio manually and open the project:');
    console.error(`  ${projectDir}`);
    console.error('');
    console.error('Or add Android Studio to your PATH.');
    process.exit(1);
  }

  console.log(`✓ Found Android Studio: ${studioPath}`);
  console.log(`✓ Opening project: ${projectDir}`);

  // Spawn detached so it doesn't block
  const child = spawn(studioPath, [projectDir], {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  child.unref();
  console.log('✓ Android Studio launched');
}

openAndroidStudio();
