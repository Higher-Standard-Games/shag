# Capacitor Mobile Integration

The engine includes Capacitor.js support for building native Android (and iOS) apps.

## CapacitorBridge

The `CapacitorBridge` class (`src/engine/core/CapacitorBridge.ts`) provides:

| Feature | Description |
|---------|-------------|
| Platform detection | `CapacitorBridge.isNative()`, `CapacitorBridge.getPlatform()` |
| App lifecycle | Pause/resume game when backgrounded |
| Back button | Android hardware back button → `app:back_button` event |
| Safe areas | Detect and expose device notch/cutout insets |
| Status bar | Native status bar styling |
| Mobile CSS | Auto-loads mobile styles on touch devices |

### Usage

```typescript
import { CapacitorBridge } from '@engine/core/CapacitorBridge';

// Initialize early in app startup
await CapacitorBridge.getInstance().init();

// Check platform
if (CapacitorBridge.isNative()) {
  console.log('Running as native app');
}

// Listen for app lifecycle events
EventBus.on('app:state_change', ({ isActive }) => {
  if (!isActive) SaveManager.getInstance().saveGame();
});

EventBus.on('app:back_button', () => {
  MenuSystem.getInstance().showPauseMenu();
});
```

---

## Build Commands

```bash
# Sync web build to native project
npm run cap:sync

# Build and open in Android Studio
npm run android:build
npm run android:open

# Run on connected device/emulator
npm run android:run

# Build APK
npm run android:build-apk
npm run android:build-release
```

---

## Configuration

`capacitor.config.ts`:
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shagengine.ganjawars',
  appName: 'Ganjawars',
  webDir: 'dist',
  android: {
    backgroundColor: '#1a1a2e',
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1a1a2e',
    },
  },
};

export default config;
```

---

## Safe Area CSS

The bridge exposes safe area insets via CSS variables:

```css
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-left: env(safe-area-inset-left, 0px);
  --safe-area-right: env(safe-area-inset-right, 0px);
}

.hud-container {
  padding: var(--safe-area-top) var(--safe-area-right) 
           var(--safe-area-bottom) var(--safe-area-left);
}
```

---

## Prerequisites

- **Android Studio** with SDK 33+
- **Java 17+** for Gradle
- **Node.js 18+**

See also: [ANDROID_BUILD_GUIDE.md](./ANDROID_BUILD_GUIDE.md)
