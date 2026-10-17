# Capacitor Integration

> Verified against Capacitor 8 configuration and source on 2026-08-06.

The repository contains an Android platform project. Current <code>capacitor.config.ts</code> uses app id <code>com.iwmengine.ganjawars</code>, app name <code>Ganjawars</code>, web directory <code>dist</code>, a dark background, manual splash hiding, and dark status-bar styling. The bridge's native setup would hide the status bar for immersive play.

<code>CapacitorBridge</code> provides:

- native/platform/touch detection;
- body classes for platform and touch CSS;
- mobile CSS injection;
- status-bar and splash handling;
- Android back, app-state, and deep-link EventBus events;
- safe-area CSS variables;
- Android exit and native app info.

The bridge is currently an available API, not active FPS bootstrap wiring: <code>src/main.ts</code> neither initializes it nor calls <code>hideSplashScreen()</code>. This matters because <code>launchAutoHide</code> is disabled in <code>capacitor.config.ts</code>. Before treating the native shell as complete, initialize the bridge early and hide the native splash after the app is ready. Native listeners are installed only on a native platform.

## Scripts

| Script | Action |
|---|---|
| <code>cap:sync</code> | Run generic Capacitor sync |
| <code>android:build</code> | Build web assets and sync Android |
| <code>android:open</code> | Open checked-in project in Android Studio |
| <code>android:run</code> | Run on selected device/emulator |
| <code>android:live</code> | Build, sync, then run with live reload/external access |

<code>android:build</code> does not produce an APK by itself; it prepares the native project. Build/sign the APK or bundle with Android Studio/Gradle.

Node.js 24 or later is required; major version 24 is pinned in <code>.nvmrc</code>. An iOS project is not checked in.
