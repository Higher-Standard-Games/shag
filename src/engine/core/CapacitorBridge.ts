/**
 * CapacitorBridge - Bridge between web app and native Capacitor functionality
 * 
 * Handles:
 * - Platform detection (web vs native)
 * - App lifecycle (pause/resume)
 * - Android back button
 * - Status bar and splash screen
 * - Safe area insets
 */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { EventBus } from './EventBus';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export class CapacitorBridge {
  private static instance: CapacitorBridge;
  private initialized = false;
  private safeAreaInsets: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };

  private constructor() {}

  public static getInstance(): CapacitorBridge {
    if (!CapacitorBridge.instance) {
      CapacitorBridge.instance = new CapacitorBridge();
    }
    return CapacitorBridge.instance;
  }

  /**
   * Check if running on a native platform (Android/iOS)
   */
  public static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Get the current platform
   */
  public static getPlatform(): 'android' | 'ios' | 'web' {
    return Capacitor.getPlatform() as 'android' | 'ios' | 'web';
  }

  /**
   * Initialize Capacitor bridge - call this early in app startup
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    console.log(`[CapacitorBridge] Platform: ${CapacitorBridge.getPlatform()}, Native: ${CapacitorBridge.isNative()}`);

    if (!CapacitorBridge.isNative()) {
      console.log('[CapacitorBridge] Running in web mode - skipping native setup');
      return;
    }

    try {
      await this.setupStatusBar();
      this.setupAppListeners();
      this.detectSafeAreaInsets();
      console.log('[CapacitorBridge] Native initialization complete');
    } catch (error) {
      console.error('[CapacitorBridge] Initialization error:', error);
    }
  }

  /**
   * Hide the splash screen - call after app is fully loaded
   */
  public async hideSplashScreen(): Promise<void> {
    if (!CapacitorBridge.isNative()) return;

    try {
      await SplashScreen.hide({ fadeOutDuration: 300 });
      console.log('[CapacitorBridge] Splash screen hidden');
    } catch (error) {
      console.error('[CapacitorBridge] Failed to hide splash screen:', error);
    }
  }

  /**
   * Configure status bar appearance
   */
  private async setupStatusBar(): Promise<void> {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
      console.log('[CapacitorBridge] Status bar configured');
    } catch (error) {
      console.error('[CapacitorBridge] Status bar setup error:', error);
    }
  }

  /**
   * Setup app lifecycle and back button listeners
   */
  private setupAppListeners(): void {
    // Handle Android back button
    App.addListener('backButton', ({ canGoBack }) => {
      console.log('[CapacitorBridge] Back button pressed, canGoBack:', canGoBack);
      EventBus.emit('app:back_button', { canGoBack });
    });

    // Handle app state changes (foreground/background)
    App.addListener('appStateChange', ({ isActive }) => {
      console.log('[CapacitorBridge] App state changed, isActive:', isActive);
      EventBus.emit('app:state_change', { isActive });
    });

    // Handle app URL open (deep links)
    App.addListener('appUrlOpen', (data) => {
      console.log('[CapacitorBridge] App URL opened:', data.url);
      EventBus.emit('app:url_open', { url: data.url });
    });

    console.log('[CapacitorBridge] App listeners registered');
  }

  /**
   * Detect safe area insets from CSS environment variables
   */
  private detectSafeAreaInsets(): void {
    // These are set by the WebView based on device notch/cutout
    const computedStyle = getComputedStyle(document.documentElement);
    
    this.safeAreaInsets = {
      top: parseInt(computedStyle.getPropertyValue('--sat') || '0', 10),
      bottom: parseInt(computedStyle.getPropertyValue('--sab') || '0', 10),
      left: parseInt(computedStyle.getPropertyValue('--sal') || '0', 10),
      right: parseInt(computedStyle.getPropertyValue('--sar') || '0', 10),
    };

    // Also set CSS custom properties for use in stylesheets
    document.documentElement.style.setProperty('--safe-area-top', `env(safe-area-inset-top, 0px)`);
    document.documentElement.style.setProperty('--safe-area-bottom', `env(safe-area-inset-bottom, 0px)`);
    document.documentElement.style.setProperty('--safe-area-left', `env(safe-area-inset-left, 0px)`);
    document.documentElement.style.setProperty('--safe-area-right', `env(safe-area-inset-right, 0px)`);

    console.log('[CapacitorBridge] Safe area insets:', this.safeAreaInsets);
  }

  /**
   * Get current safe area insets
   */
  public getSafeAreaInsets(): SafeAreaInsets {
    return { ...this.safeAreaInsets };
  }

  /**
   * Exit the app (Android only)
   */
  public async exitApp(): Promise<void> {
    if (CapacitorBridge.getPlatform() === 'android') {
      await App.exitApp();
    }
  }

  /**
   * Get app info
   */
  public async getAppInfo(): Promise<{ name: string; id: string; build: string; version: string } | null> {
    if (!CapacitorBridge.isNative()) return null;

    try {
      const info = await App.getInfo();
      return info;
    } catch (error) {
      console.error('[CapacitorBridge] Failed to get app info:', error);
      return null;
    }
  }
}
