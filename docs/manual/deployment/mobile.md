# Mobile Deployment (Capacitor)

Deploy SHAG Engine games to iOS and Android.

## Prerequisites

- Node.js 22 (pinned in `.nvmrc`)
- For iOS: macOS with Xcode
- For Android: Android Studio

## Setup Capacitor

### Install

```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android @capacitor/ios
```

### Initialize

```bash
npx cap init "My Game" com.example.mygame
```

### Add Platforms

```bash
npx cap add android
npx cap add ios
```

## Build and Deploy

### 1. Build Web App

```bash
npm run build
# or, for Android in one step: npm run android:build
```

### 2. Sync to Native Projects

```bash
npx cap sync
```

### 3. Open in IDE

```bash
npx cap open android  # Opens Android Studio
npx cap open ios      # Opens Xcode
```

### 4. Run on Device

From Android Studio or Xcode, build and run on device/emulator.

## Configuration

### capacitor.config.ts

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.mygame',
  appName: 'My Game',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#000000'
    }
  }
};

export default config;
```

## Mobile Optimizations

### Performance Settings

```typescript
// Detect mobile
const isMobile = Capacitor.isNativePlatform();

if (isMobile) {
  // Lower rendering resolution
  engine.setHardwareScalingLevel(2);
  
  // Reduce quality
  RenderVars.getInstance().set('r_bloom', 0);
  RenderVars.getInstance().set('r_anisotropy', 1);
  RenderVars.getInstance().set('r_normalmap', 0);
}
```

### Touch Controls

```typescript
// Touch input for mobile
scene.onPointerObservable.add((pointerInfo) => {
  if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
    // Handle touch
  }
});
```

### Virtual Joystick

```typescript
import { VirtualJoystick } from '@babylonjs/gui/2D/controls/virtualJoystick';

const leftJoystick = new VirtualJoystick(true);  // Movement
const rightJoystick = new VirtualJoystick(false); // Look
```

## Asset Loading

Large PK3 files may cause memory issues on mobile. Consider:

1. **Reduce asset size** - Lower resolution textures
2. **Lazy loading** - Load assets on demand
3. **Streaming** - Load from remote server

```typescript
// Load assets from CDN on mobile
if (Capacitor.isNativePlatform()) {
  PK3Loader.setBasePath('https://cdn.example.com/game/');
}
```

## Splash Screen

### Hide After Load

```typescript
import { SplashScreen } from '@capacitor/splash-screen';

// After game is ready
await SplashScreen.hide();
```

## App Icons

Place icons in:
- Android: `android/app/src/main/res/`
- iOS: `ios/App/App/Assets.xcassets/`

## Building for Release

### Android

1. Open Android Studio
2. Build > Generate Signed Bundle/APK
3. Follow signing wizard

### iOS

1. Open Xcode
2. Product > Archive
3. Distribute App

## Testing

### Android Emulator

```bash
npx cap run android
```

### iOS Simulator

```bash
npx cap run ios
```

## Troubleshooting

### WebGL not working

Ensure `android:hardwareAccelerated="true"` in AndroidManifest.xml.

### Large bundle size

Use tree-shaking and consider lazy loading large assets.

### Touch not responding

Check pointer event handling and canvas touch settings.

## Related

- [Web Deployment](./web.md)
- [Desktop Deployment](./desktop.md)
- [Performance Optimization](../tutorials/advanced/performance.md)
