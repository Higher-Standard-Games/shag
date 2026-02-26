/**
 * LoadingScreen - Engine-level loading and ready screen
 * 
 * Handles:
 * 1. Asset loading progress display
 * 2. "Tap to start" ready screen (unlocks browser audio)
 * 
 * This is an engine component - game-agnostic.
 */

import type { LoadProgress } from '../AssetLoader';
import { AudioManager } from '../AudioManager';
import { EngineVersion } from '../core/EngineVersion';
import { UIStyles } from './UIStyles';
import { LoadingAnimation } from './LoadingAnimation';
import { SHAG_PALETTE } from './LoadingPalettes';

export class LoadingScreen {
  private static instance: LoadingScreen | null = null;

  private container: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressFill: HTMLDivElement;
  private progressText: HTMLDivElement;
  private statusText: HTMLDivElement;

  // For force-dismiss from console
  private readyResolver: (() => void) | null = null;
  private colorInterval: ReturnType<typeof setInterval> | null = null;

  // Smoke animation (shared component)
  private smokeAnimation: LoadingAnimation | null = null;

  constructor() {
    // Ensure styles are injected
    UIStyles.injectBase();

    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.className = "ui-loading-screen";

    // Engine logo - centered
    const logo = document.createElement("img");
    logo.src = "engine.png";
    logo.alt = "SHAG Engine";
    logo.className = "ui-loading-logo";
    this.container.appendChild(logo);

    // Progress bar container
    this.progressBar = document.createElement("div");
    this.progressBar.className = "ui-loading-progress";

    // Progress bar fill
    this.progressFill = document.createElement("div");
    this.progressFill.className = "ui-loading-progress__fill";
    this.progressBar.appendChild(this.progressFill);
    this.container.appendChild(this.progressBar);

    // Hidden progress text (API compatibility)
    this.progressText = document.createElement("div");
    this.progressText.style.display = "none";
    this.container.appendChild(this.progressText);

    // Status text - bottom left corner (shows what's being loaded)
    this.statusText = document.createElement("div");
    this.statusText.className = "ui-loading-status";
    this.statusText.textContent = "Initializing...";
    this.container.appendChild(this.statusText);

    // Engine branding - bottom right corner
    this.createBranding();
  }

  private createBranding(): void {
    const engineBranding = document.createElement("div");
    engineBranding.className = "ui-loading-branding";

    const engineName = document.createElement("div");
    engineName.textContent = EngineVersion.getInstance().getEngineName();
    engineName.className = "ui-loading-branding__name";
    engineBranding.appendChild(engineName);

    const tagline = document.createElement("div");
    tagline.textContent = EngineVersion.getInstance().getEngineTagline();
    tagline.className = "ui-loading-branding__tagline";
    engineBranding.appendChild(tagline);

    const version = document.createElement("div");
    version.textContent = EngineVersion.getInstance().getVersionString();
    version.className = "ui-loading-branding__version";
    engineBranding.appendChild(version);

    this.container.appendChild(engineBranding);
  }

  public show(): void {
    LoadingScreen.instance = this;
    document.body.appendChild(this.container);
  }

  /**
   * Check if loading screen is currently waiting for ready
   */
  public static isWaitingForReady(): boolean {
    return LoadingScreen.instance?.readyResolver !== null;
  }

  /**
   * Force dismiss the loading screen (e.g., when console opens)
   * This unlocks audio and resolves the waitForReady promise
   */
  public static forceDismiss(): void {
    const instance = LoadingScreen.instance;
    if (!instance || !instance.readyResolver) return;

    // Clean up
    if (instance.colorInterval) {
      clearInterval(instance.colorInterval);
      instance.colorInterval = null;
    }
    if (instance.smokeAnimation) {
      instance.smokeAnimation.destroy();
      instance.smokeAnimation = null;
    }

    // Unlock browser audio context
    AudioManager.getInstance().unlockAudio();
    AudioManager.getInstance().loadPlaylist("data/menu.playlist.json");

    // Resolve the promise
    const resolver = instance.readyResolver;
    instance.readyResolver = null;
    resolver();

    console.log('[LoadingScreen] Force dismissed by console');
  }

  public updateProgress(progress: LoadProgress): void {
    const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    this.progressFill.style.width = `${percent}%`;
    this.progressText.textContent = progress.currentAsset || "Initializing...";
  }

  /**
   * Update the status text shown on the loading screen
   * @param status - Status message to display (e.g., "Indexing packages...", "Loading textures...")
   */
  public setStatus(status: string): void {
    this.statusText.textContent = status;
  }

  /**
   * Static method to update status from anywhere
   */
  public static setStatus(status: string): void {
    if (LoadingScreen.instance) {
      LoadingScreen.instance.setStatus(status);
    }
  }

  /**
   * Show "tap to start" overlay and wait for user interaction.
   * This unlocks browser audio context.
   */
  public waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      // Store resolver for force-dismiss capability
      this.readyResolver = resolve;

      // Hide progress bar, show ready state
      this.progressBar.style.display = 'none';
      this.container.classList.add('ui-loading-screen--ready');

      // Show "ready" status and fade it out after 2 seconds
      this.statusText.textContent = 'ready';
      this.statusText.classList.add('ui-loading-status--ready');
      setTimeout(() => {
        this.statusText.classList.add('ui-loading-status--fade');
      }, 2000);

      // Smoke effect - colored puffs rising and fading (using shared component)
      this.smokeAnimation = new LoadingAnimation();
      this.smokeAnimation.create(this.container, {
        colors: SHAG_PALETTE,
        puffCount: 30,
      });

      // Ripple container - universal "tap here" indicator
      const rippleContainer = document.createElement("div");
      rippleContainer.className = "ui-loading-ripple-container";

      // Central pulsing dot with color rotation (uses logo palette)
      const centerDot = document.createElement("div");
      centerDot.className = "ui-loading-center-dot";
      // Dynamic colors must be inline
      centerDot.style.background = SHAG_PALETTE[0].bg;
      centerDot.style.boxShadow = `0 0 20px ${SHAG_PALETTE[0].glow}`;
      rippleContainer.appendChild(centerDot);

      // Random color rotation interval using logo palette
      this.colorInterval = setInterval(() => {
        const colorIndex = Math.floor(Math.random() * SHAG_PALETTE.length);
        const color = SHAG_PALETTE[colorIndex];
        centerDot.style.background = color.bg;
        centerDot.style.boxShadow = `0 0 25px ${color.glow}`;
      }, 800 + Math.random() * 400);

      // Create 3 ripple rings with staggered animations (using logo palette)
      const rippleColors = [
        SHAG_PALETTE[0].glow,  // Orange
        SHAG_PALETTE[1].glow,  // Yellow
        SHAG_PALETTE[2].glow,  // Teal
      ];

      for (let i = 0; i < 3; i++) {
        const ripple = document.createElement("div");
        ripple.className = "ui-loading-ripple";
        // Dynamic color and delay must be inline
        ripple.style.borderColor = rippleColors[i];
        ripple.style.animationDelay = `${i * 0.8}s`;
        rippleContainer.appendChild(ripple);
      }

      this.container.appendChild(rippleContainer);

      // On click, unlock audio and resolve
      const handleClick = () => {
        if (this.colorInterval) {
          clearInterval(this.colorInterval);
          this.colorInterval = null;
        }

        // Unlock browser audio context
        AudioManager.getInstance().unlockAudio();
        AudioManager.getInstance().loadPlaylist("data/menu.playlist.json");

        // Clear resolver and resolve
        this.readyResolver = null;
        resolve();
      };

      this.container.addEventListener("click", handleClick, { once: true });
    });
  }

  public hide(): void {
    // Clean up animation
    if (this.smokeAnimation) {
      this.smokeAnimation.destroy();
      this.smokeAnimation = null;
    }

    this.container.classList.add('ui-loading-screen--hiding');
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }
}
