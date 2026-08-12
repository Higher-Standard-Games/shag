# Android with Capacitor

The repository currently includes a Capacitor 8 Android project under `android/`. It does not include an iOS project.

## Build and open

```bash
npm install
npm run android:build
npm run android:open
```

`android:build` runs the web build and `cap sync android`. `android:open` opens the existing project in Android Studio. A connected-device path is also available:

```bash
npm run android:run
```

For live reload:

```bash
npm run android:live
```

Live reload exposes a development server to the device. Use it only on a trusted network and verify the host address and cleartext policy before debugging.

## Native bridge status

`src/engine/core/CapacitorBridge.ts` contains platform detection, mobile CSS, safe-area setup, status-bar handling, splash-screen control, and app lifecycle events.

At the time of this audit, `src/main.ts` does not initialize that bridge or call `hideSplashScreen()`. Meanwhile `capacitor.config.ts` sets `launchAutoHide: false`. Wire both calls into the application lifecycle and test on a device before treating the native startup path as complete.

## Configuration

The committed values in `capacitor.config.ts` currently identify the Ganjawars application. Change the app ID/name deliberately before publishing; changing an Android application ID affects package identity and signing.

The Android project is already present. Do not run `cap add android` as a routine setup step. If iOS support is desired, add and maintain it explicitly on macOS rather than implying that it is already supported by this checkout.

## Release verification

- test pause/resume and Android back-button events;
- test touch controls and safe areas on multiple aspect ratios;
- verify the splash always hides after successful and failed loading;
- inspect WebView logs for missing PK3, WASM, or compressed-texture assets;
- configure signing outside source control.
