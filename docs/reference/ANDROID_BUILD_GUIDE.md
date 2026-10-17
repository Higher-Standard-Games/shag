# Android Build Guide

> Verified against the checked-in Capacitor 8 project on 2026-08-06.

## Prerequisites

- Node.js 24 or later;
- Android Studio with SDK/platform tools;
- a compatible JDK configured for the installed Android Gradle plugin;
- device USB debugging or an Android emulator.

## Daily Workflow

    npm install
    npm run android:build
    npm run android:open

<code>android:build</code> runs the web build and <code>cap sync android</code>. It does not compile an APK. Use <code>npm run android:run</code> for a connected target or <code>npm run android:live</code> for live reload on the same network.

## APK or Bundle

Open <code>android/</code> in Android Studio and use Build/Generate Signed Bundle or APK for release output. For a local debug APK:

    cd android
    .\gradlew.bat assembleDebug

The usual output is under <code>android/app/build/outputs/apk/debug</code>. Release artifacts must be signed; never commit keystores or passwords.

## Troubleshooting

- SDK not found: configure Android Studio or local <code>android/local.properties</code>.
- Device missing: verify <code>adb devices</code>, USB authorization, and emulator state.
- White screen: inspect WebView logs and confirm <code>dist</code> was rebuilt/synced.
- Stale native plugins/assets: run <code>npm run android:build</code> again.
- Live reload failure: confirm host/device reachability and cleartext/network policy.

Current native identity is <code>com.iwmengine.ganjawars</code> / <code>Ganjawars</code>. Changing it requires coordinated Capacitor and Android resource/package updates.

See [Capacitor Integration](./capacitor.md) and [Mobile Deployment](../manual/deployment/mobile.md).
