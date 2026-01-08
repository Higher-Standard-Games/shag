# Android Build Guide

This guide explains how to build and run the game on Android using Capacitor.

## Prerequisites

### Required Software

1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Android Studio** - [Download](https://developer.android.com/studio)
   - During installation, ensure you install:
     - Android SDK (API 33 or higher)
     - Android SDK Build-Tools
     - Android Emulator (optional, for testing without device)
3. **Java 17+** - Usually bundled with Android Studio

### Environment Setup

After installing Android Studio:

1. Open Android Studio → Settings → Languages & Frameworks → Android SDK
2. Note the **Android SDK Location** (e.g., `C:\Users\YourName\AppData\Local\Android\Sdk`)
3. Add to your system environment variables:
   ```
   ANDROID_HOME = C:\Users\YourName\AppData\Local\Android\Sdk
   ```
4. Add to PATH:
   ```
   %ANDROID_HOME%\platform-tools
   %ANDROID_HOME%\emulator
   ```

### Verify Setup

```bash
# Check Android SDK is accessible
adb --version

# Check Java version (should be 17+)
java -version
```

---

## Quick Start

### First Time Setup

```bash
# Install dependencies (if not already done)
npm install

# Build web app and sync to Android
npm run android:build

# Open in Android Studio (first time only - to configure SDK)
npm run android:open
```

### Daily Development

```bash
# Build and run on connected device/emulator
npm run android:run

# Or with live reload (requires device on same network)
npm run android:live
```

---

## NPM Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run android:build` | Build web app + sync to Android project |
| `npm run android:open` | Open Android project in Android Studio |
| `npm run android:run` | Build and run on device/emulator |
| `npm run android:live` | Run with live reload (hot reload from dev server) |
| `npm run cap:sync` | Sync web assets to native projects |

---

## Running on Physical Device

### Enable Developer Mode on Android

1. Go to **Settings → About Phone**
2. Tap **Build Number** 7 times
3. Go back to **Settings → Developer Options**
4. Enable **USB Debugging**

### Connect Device

1. Connect device via USB
2. Accept the debugging prompt on your phone
3. Verify connection:
   ```bash
   adb devices
   ```
   Should show your device listed.

### Run the App

```bash
npm run android:run
```

---

## Running on Emulator

### Create Emulator in Android Studio

1. Open Android Studio
2. Go to **Tools → Device Manager**
3. Click **Create Device**
4. Select a phone (e.g., Pixel 6)
5. Select a system image (API 33+ recommended)
6. Finish setup

### Start Emulator and Run

```bash
# Start emulator from command line (optional)
emulator -avd Pixel_6_API_33

# Run the app
npm run android:run
```

---

## Building APK for Distribution

### Debug APK (for testing)

```bash
# Build web + sync
npm run android:build

# Build debug APK
cd android
./gradlew assembleDebug
```

APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (for distribution)

1. Create a signing key (one-time):
   ```bash
   keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-key-alias
   ```

2. Configure signing in `android/app/build.gradle`:
   ```gradle
   android {
       signingConfigs {
           release {
               storeFile file('my-release-key.jks')
               storePassword 'your-store-password'
               keyAlias 'my-key-alias'
               keyPassword 'your-key-password'
           }
       }
       buildTypes {
           release {
               signingConfig signingConfigs.release
           }
       }
   }
   ```

3. Build release APK:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

APK location: `android/app/build/outputs/apk/release/app-release.apk`

---

## Live Reload Development

For faster development iteration:

```bash
npm run android:live
```

This:
1. Builds the web app
2. Syncs to Android
3. Runs on device with live reload enabled
4. Changes to web code auto-refresh on device

**Note:** Device must be on the same network as your development machine.

---

## Troubleshooting

### "SDK location not found"

Create `android/local.properties`:
```
sdk.dir=C:\\Users\\YourName\\AppData\\Local\\Android\\Sdk
```

### "JAVA_HOME is not set"

Add to environment variables:
```
JAVA_HOME = C:\Program Files\Android\Android Studio\jbr
```

### App crashes on startup

1. Check logcat for errors:
   ```bash
   adb logcat | grep -i "error\|exception"
   ```
2. Ensure all assets are in `dist/` before syncing
3. Run `npm run android:build` to rebuild

### White screen on app launch

1. Check browser console in Chrome DevTools:
   - Open `chrome://inspect` in Chrome
   - Find your device and click "inspect"
2. Look for JavaScript errors

### Device not detected

```bash
# Restart ADB server
adb kill-server
adb start-server
adb devices
```

---

## Project Structure

```
android/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── assets/
│   │       │   └── public/     # Web app files (synced from dist/)
│   │       ├── java/           # Native Android code
│   │       └── res/            # Android resources (icons, splash)
│   └── build.gradle            # App-level build config
├── build.gradle                # Project-level build config
└── local.properties            # SDK location (gitignored)
```

---

## Customizing Android App

### App Icon

Replace files in `android/app/src/main/res/`:
- `mipmap-hdpi/ic_launcher.png` (72x72)
- `mipmap-mdpi/ic_launcher.png` (48x48)
- `mipmap-xhdpi/ic_launcher.png` (96x96)
- `mipmap-xxhdpi/ic_launcher.png` (144x144)
- `mipmap-xxxhdpi/ic_launcher.png` (192x192)

### Splash Screen

Configure in `capacitor.config.ts`:
```typescript
plugins: {
  SplashScreen: {
    launchShowDuration: 2000,
    backgroundColor: '#1a1a2e',
    androidScaleType: 'CENTER_CROP',
    showSpinner: false,
  },
}
```

### App Name

Edit `android/app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">Ganjawars</string>
```

---

## See Also

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Android Developer Guide](https://developer.android.com/guide)
- [CAPACITOR_ROADMAP.md](./CAPACITOR_ROADMAP.md) - Technical implementation details
