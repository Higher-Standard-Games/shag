# Capacitor.js Android Build Pipeline Roadmap

## Overview

This document outlines the plan to add Capacitor.js support to the SHAG Engine, enabling Android (and iOS) builds from our Vite + TypeScript + Babylon.js web game.

## Current Stack Analysis

### ✅ Already Compatible
- **Vite build system** - Capacitor works perfectly with Vite
- **TypeScript** - No changes needed
- **Babylon.js** - WebGL works in Capacitor's WebView
- **HTML5 Canvas** - Native WebView support
- **localStorage** - Works in Capacitor WebView (53 usages across 16 files)
- **Mobile viewport meta tags** - Already configured in `index.html`
- **Touch-friendly UI** - RTS camera already has touch support

### ⚠️ Needs Attention
- **Window resize handling** - May need Capacitor-specific handling
- **Safe area insets** - Need to respect device notches/cutouts
- **Back button handling** - Android hardware back button
- **App lifecycle** - Pause/resume game when app backgrounded
- **Performance** - May need WebGL optimizations for mobile GPUs

### 📦 Storage Considerations
- Currently using `localStorage` via `PersistenceManager`
- Capacitor Preferences plugin provides native storage (optional upgrade)
- Current approach will work, but native storage is more reliable

---

## Phase 1: Capacitor Setup (Foundation)

### 1.1 Install Capacitor Core
```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Ganjawars" "com.shagengine.ganjawars"
```

### 1.2 Configure Capacitor
Create `capacitor.config.ts`:
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shagengine.ganjawars',
  appName: 'Ganjawars',
  webDir: 'dist',
  server: {
    // For development - live reload from dev server
    // url: 'http://YOUR_LOCAL_IP:3000',
    // cleartext: true
  },
  android: {
    // Android-specific config
    backgroundColor: '#1a1a2e',
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1a1a2e',
    },
  },
};

export default config;
```

### 1.3 Add Android Platform
```bash
npm install @capacitor/android
npx cap add android
```

### 1.4 Update package.json Scripts
```json
{
  "scripts": {
    "build:android": "npm run build && npx cap sync android",
    "open:android": "npx cap open android",
    "run:android": "npx cap run android",
    "dev:android": "npm run build && npx cap sync android && npx cap run android"
  }
}
```

---

## Phase 2: Essential Plugins

### 2.1 Core Plugins
```bash
npm install @capacitor/app @capacitor/status-bar @capacitor/splash-screen
```

### 2.2 App Lifecycle Integration
Create `src/engine/core/CapacitorBridge.ts`:
```typescript
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Capacitor } from '@capacitor/core';

export class CapacitorBridge {
  private static instance: CapacitorBridge;
  
  public static getInstance(): CapacitorBridge {
    if (!CapacitorBridge.instance) {
      CapacitorBridge.instance = new CapacitorBridge();
    }
    return CapacitorBridge.instance;
  }
  
  public static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }
  
  public async init(): Promise<void> {
    if (!CapacitorBridge.isNative()) return;
    
    // Hide splash screen after app is ready
    await SplashScreen.hide();
    
    // Configure status bar
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
    
    // Handle back button
    App.addListener('backButton', ({ canGoBack }) => {
      // Emit event for game to handle (show pause menu, etc.)
      EventBus.emit('app:back_button', { canGoBack });
    });
    
    // Handle app state changes
    App.addListener('appStateChange', ({ isActive }) => {
      EventBus.emit('app:state_change', { isActive });
      // Pause/resume game engine
    });
  }
}
```

---

## Phase 3: Game Engine Adaptations

### 3.1 Pause/Resume on Background
In `GameScene.ts`, add app lifecycle handling:
```typescript
// Listen for app state changes
EventBus.on('app:state_change', ({ isActive }) => {
  if (isActive) {
    this.engine.runRenderLoop(() => this.scene.render());
  } else {
    this.engine.stopRenderLoop();
    // Trigger autosave
    SaveManager.getInstance().saveGame();
  }
});
```

### 3.2 Back Button Handling
```typescript
EventBus.on('app:back_button', () => {
  if (MenuSystem.getInstance().isInGame()) {
    // Show pause menu
    MenuSystem.getInstance().showPauseMenu();
  } else {
    // Exit app confirmation
    App.exitApp();
  }
});
```

### 3.3 Safe Area Handling
Update CSS to respect safe areas:
```css
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-left: env(safe-area-inset-left, 0px);
  --safe-area-right: env(safe-area-inset-right, 0px);
}

#renderCanvas {
  padding-top: var(--safe-area-top);
  padding-bottom: var(--safe-area-bottom);
}

.hud-container {
  padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);
}
```

---

## Phase 4: Performance Optimizations

### 4.1 Mobile GPU Detection
```typescript
public detectMobileGPU(): 'low' | 'medium' | 'high' {
  const gl = this.engine.getRenderingCanvas()?.getContext('webgl2');
  if (!gl) return 'low';
  
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugInfo) {
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    // Detect Adreno, Mali, PowerVR, etc.
  }
  return 'medium';
}
```

### 4.2 Quality Presets
```typescript
interface MobileQualityPreset {
  shadowsEnabled: boolean;
  particleCount: number;
  textureQuality: 'low' | 'medium' | 'high';
  antialiasing: boolean;
  maxFPS: number;
}

const MOBILE_PRESETS: Record<string, MobileQualityPreset> = {
  low: { shadowsEnabled: false, particleCount: 50, textureQuality: 'low', antialiasing: false, maxFPS: 30 },
  medium: { shadowsEnabled: true, particleCount: 100, textureQuality: 'medium', antialiasing: false, maxFPS: 30 },
  high: { shadowsEnabled: true, particleCount: 200, textureQuality: 'high', antialiasing: true, maxFPS: 60 },
};
```

---

## Phase 5: Build Pipeline

### 5.1 Vite Configuration for Capacitor
Update `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Ensure assets are properly bundled
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['babylonjs', 'babylonjs-loaders'],
        },
      },
    },
  },
});
```

### 5.2 Android Build Scripts
Add to `package.json`:
```json
{
  "scripts": {
    "cap:sync": "npx cap sync",
    "android:build": "npm run build && npx cap sync android",
    "android:open": "npx cap open android",
    "android:run": "npx cap run android",
    "android:build-apk": "npm run android:build && cd android && ./gradlew assembleDebug",
    "android:build-release": "npm run android:build && cd android && ./gradlew assembleRelease"
  }
}
```

### 5.3 CI/CD Integration (Optional)
GitHub Actions workflow for Android builds:
```yaml
name: Android Build
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - run: npm ci
      - run: npm run android:build
      - run: cd android && ./gradlew assembleRelease
      - uses: actions/upload-artifact@v4
        with:
          name: app-release.apk
          path: android/app/build/outputs/apk/release/app-release.apk
```

---

## Implementation Order

| Phase | Task | Priority | Effort |
|-------|------|----------|--------|
| 1.1 | Install Capacitor core | High | 5 min |
| 1.2 | Create capacitor.config.ts | High | 10 min |
| 1.3 | Add Android platform | High | 5 min |
| 1.4 | Add npm scripts | High | 5 min |
| 2.1 | Install essential plugins | High | 5 min |
| 2.2 | Create CapacitorBridge | High | 30 min |
| 3.1 | Pause/resume handling | Medium | 20 min |
| 3.2 | Back button handling | Medium | 15 min |
| 3.3 | Safe area CSS | Medium | 15 min |
| 4.1 | Mobile GPU detection | Low | 30 min |
| 4.2 | Quality presets | Low | 45 min |
| 5.1 | Vite config updates | High | 10 min |
| 5.2 | Build scripts | High | 10 min |
| 5.3 | CI/CD (optional) | Low | 1 hour |

**Estimated Total: 3-4 hours for core functionality**

---

## Testing Checklist

- [ ] App builds and runs on Android emulator
- [ ] App builds and runs on physical Android device
- [ ] Touch controls work correctly
- [ ] Game saves persist between app restarts
- [ ] App pauses when backgrounded
- [ ] App resumes correctly when foregrounded
- [ ] Back button shows pause menu / exits app
- [ ] Status bar styled correctly
- [ ] Safe areas respected on notched devices
- [ ] Performance acceptable on mid-range devices

---

## Future Enhancements

1. **iOS Support** - Add `@capacitor/ios` platform
2. **Native Storage** - Migrate to `@capacitor/preferences` for more reliable saves
3. **Push Notifications** - For game events
4. **In-App Purchases** - Monetization
5. **Google Play Games** - Achievements and leaderboards
6. **Haptic Feedback** - `@capacitor/haptics` for tactile response

---

## Prerequisites

- **Android Studio** installed with SDK 33+
- **Java 17+** for Gradle builds
- **Node.js 18+**
- **Physical device or emulator** for testing
