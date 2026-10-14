# Android with Capacitor

The repository includes a Capacitor 8 Android project under `android/`. It does not include an iOS project.

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

`src/main.ts` initializes the bridge before anything draws and calls `hideSplashScreen()` as soon as the engine's own loading screen is up — `launchAutoHide: false` means the native splash waits for the app, and holding it to the end of the boot would hide the loading screen's progress behind a still image. Both calls do nothing in a browser. **This has not been verified on a device**; that is the remaining check before the native startup path can be called complete.

## Configuration

The app is `net.washoi.game`, "Washiki Washoi!" — reverse-DNS on a domain the
studio owns, with the studio name (Higher Standard Games) belonging in the Play
listing's developer field rather than in the package id.

The id lives in four files and must stay consistent across all of them:
`capacitor.config.ts` (`appId`), `android/app/build.gradle` (`namespace` and
`applicationId`), `android/app/src/main/res/values/strings.xml`
(`package_name`, `custom_url_scheme`), and the `package` line of
`MainActivity.java` — whose **directory path** has to match the namespace, so
changing the id is a move, not a find-and-replace. The manifest refers to the
activity relatively as `.MainActivity` and follows automatically.

An application ID is permanent once the app is published: it is the store's
identity for it, and it is tied to signing. Change it before the first upload
or not at all.

The Android project is already present. Do not run `cap add android` as a routine setup step. If iOS support is desired, add and maintain it explicitly on macOS rather than implying that it is already supported by this checkout.

## Release verification

- test pause/resume and Android back-button events;
- test touch controls and safe areas on multiple aspect ratios;
- verify the splash always hides after successful and failed loading;
- inspect WebView logs for missing PK3, WASM, or compressed-texture assets;
- configure signing outside source control.
