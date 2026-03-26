/**
 * ThunderEffect - Lightning flash and ambient darkening
 *
 * Creates dramatic thunder/lightning effects with:
 * - Random lightning flashes (screen flash)
 * - Ambient color shift to darker blue
 * - Self-fading after duration
 *
 * Designed to be triggered on top of rain for storm weather.
 */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { UIStyles } from "../ui/UIStyles";
import { PostProcessingManager } from "./PostProcessingManager";

export interface ThunderSettings {
  duration: number; // How long the storm effect lasts (ms)
  flashInterval: number; // Min time between flashes (ms)
  flashVariance: number; // Random variance for flash timing (ms)
  ambientDarkness: number; // How much to darken ambient (0-1)
  flashIntensity: number; // Brightness of lightning flash (0-1)
}

const DEFAULT_THUNDER_SETTINGS: ThunderSettings = {
  duration: 3000, // 3 seconds
  flashInterval: 400, // Flash every 400ms minimum
  flashVariance: 600, // Up to 1000ms between flashes
  ambientDarkness: 0.4, // 40% darker
  flashIntensity: 0.8, // 80% flash brightness
};

export class ThunderEffect {
  private scene: Scene;
  private settings: ThunderSettings = { ...DEFAULT_THUNDER_SETTINGS };
  private isActive: boolean = false;
  private flashTimeout: number | null = null;
  private endTimeout: number | null = null;
  private originalAmbient: Color3 | null = null;
  private stormAmbient: Color3 | null = null; // Darkened ambient during storm
  private flashOverlay: HTMLDivElement | null = null;
  private thunderSound: HTMLAudioElement | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.createFlashOverlay();
    this.loadThunderSound();
  }

  /**
   * Load the thunderstorm sound effect
   */
  private loadThunderSound(): void {
    this.thunderSound = new Audio("/sounds/thunderstorm.mp3");
    this.thunderSound.volume = 0.6;
  }

  /**
   * Play the thunder sound once
   */
  private playThunderSound(): void {
    if (!this.thunderSound) return;

    // Reset to start and play
    this.thunderSound.currentTime = 0;
    this.thunderSound.play().catch((err) => {
      console.warn("[ThunderEffect] Could not play sound:", err.message);
    });
  }

  /**
   * Create the screen flash overlay element
   * Uses a subtle blue-white tint instead of pure white for eye safety
   */
  private createFlashOverlay(): void {
    UIStyles.injectBase();

    this.flashOverlay = document.createElement("div");
    this.flashOverlay.id = "thunder-flash-overlay";
    this.flashOverlay.className = "ui-thunder-flash";
    document.body.appendChild(this.flashOverlay);
  }

  /**
   * Trigger a thunder/storm effect
   * Self-fades after duration
   */
  public trigger(settings?: Partial<ThunderSettings>): void {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }

    // If already active, just extend/restart
    if (this.isActive) {
      this.clearTimeouts();
    }

    this.isActive = true;
    console.log("[ThunderEffect] Storm triggered for", this.settings.duration, "ms");

    // Play thunder sound once
    this.playThunderSound();

    // Darken the ambient
    this.applyAmbientDarkness();

    // Start random flashes
    this.scheduleNextFlash();

    // Schedule end
    this.endTimeout = window.setTimeout(() => {
      this.fadeOut();
    }, this.settings.duration);
  }

  /**
   * Apply ambient darkness for stormy atmosphere
   */
  private applyAmbientDarkness(): void {
    // Store original ambient if not already stored
    if (!this.originalAmbient) {
      this.originalAmbient = this.scene.ambientColor.clone();
    }

    // Darken the scene ambient
    const darkness = this.settings.ambientDarkness;
    this.stormAmbient = new Color3(
      this.originalAmbient.r * (1 - darkness) * 0.7, // Slight blue tint
      this.originalAmbient.g * (1 - darkness) * 0.75,
      this.originalAmbient.b * (1 - darkness),
    );
    this.scene.ambientColor = this.stormAmbient;

    // Also adjust post-processing for darker mood
    const pp = PostProcessingManager.getInstance();
    if (pp.isInitialized()) {
      // Could add contrast/exposure adjustments here
    }
  }

  /**
   * Brighten ambient light temporarily for lightning flash
   */
  private brightenAmbient(intensity: number): void {
    if (!this.originalAmbient) return;

    // Flash brightens toward white/blue-white
    const flashColor = new Color3(
      Math.min(1, this.originalAmbient.r + intensity * 0.8),
      Math.min(1, this.originalAmbient.g + intensity * 0.85),
      Math.min(1, this.originalAmbient.b + intensity * 0.9),
    );
    this.scene.ambientColor = flashColor;
  }

  /**
   * Restore ambient to storm level after flash
   */
  private restoreAmbientFromFlash(): void {
    if (this.stormAmbient) {
      this.scene.ambientColor = this.stormAmbient;
    }
  }

  /**
   * Schedule the next lightning flash
   */
  private scheduleNextFlash(): void {
    if (!this.isActive) return;

    const delay = this.settings.flashInterval + Math.random() * this.settings.flashVariance;

    this.flashTimeout = window.setTimeout(() => {
      this.doFlash();
      this.scheduleNextFlash();
    }, delay);
  }

  /**
   * Execute a lightning flash
   * Brightens scene ambient + subtle overlay instead of harsh white flash
   */
  private doFlash(): void {
    if (!this.isActive) return;

    // Random flash intensity variation
    const intensity = this.settings.flashIntensity * (0.6 + Math.random() * 0.4);

    // Brighten scene ambient light for realistic lightning effect
    this.brightenAmbient(intensity);

    // Subtle overlay flash (much softer than before)
    if (this.flashOverlay) {
      this.flashOverlay.style.opacity = String(Math.min(intensity * 0.5, 0.4));
    }

    // Flash off after short delay (with possible double-flash)
    const doDoubleFlash = Math.random() > 0.7;

    setTimeout(
      () => {
        this.restoreAmbientFromFlash();
        if (this.flashOverlay) {
          this.flashOverlay.style.opacity = "0";
        }

        if (doDoubleFlash && this.isActive) {
          // Second flash after brief pause (weaker)
          setTimeout(() => {
            if (!this.isActive) return;
            this.brightenAmbient(intensity * 0.5);
            if (this.flashOverlay) {
              this.flashOverlay.style.opacity = String(Math.min(intensity * 0.3, 0.25));
            }
            setTimeout(() => {
              this.restoreAmbientFromFlash();
              if (this.flashOverlay) {
                this.flashOverlay.style.opacity = "0";
              }
            }, 60);
          }, 80);
        }
      },
      50 + Math.random() * 50,
    );
  }

  /**
   * Fade out the storm effect
   */
  private fadeOut(): void {
    this.clearTimeouts();

    // Restore original ambient gradually
    if (this.originalAmbient) {
      const startAmbient = this.scene.ambientColor.clone();
      const targetAmbient = this.originalAmbient;
      const fadeDuration = 1000;
      const startTime = Date.now();

      const fadeStep = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / fadeDuration);

        this.scene.ambientColor = Color3.Lerp(startAmbient, targetAmbient, t);

        if (t < 1) {
          requestAnimationFrame(fadeStep);
        } else {
          this.originalAmbient = null;
          this.isActive = false;
          console.log("[ThunderEffect] Storm ended");
        }
      };

      fadeStep();
    } else {
      this.isActive = false;
    }
  }

  /**
   * Stop the effect immediately
   */
  public stop(): void {
    this.clearTimeouts();

    if (this.flashOverlay) {
      this.flashOverlay.style.opacity = "0";
    }

    if (this.originalAmbient) {
      this.scene.ambientColor = this.originalAmbient;
      this.originalAmbient = null;
    }

    this.isActive = false;
    console.log("[ThunderEffect] Stopped");
  }

  /**
   * Clear all pending timeouts
   */
  private clearTimeouts(): void {
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
    if (this.endTimeout) {
      clearTimeout(this.endTimeout);
      this.endTimeout = null;
    }
  }

  /**
   * Check if thunder is active
   */
  public isStorming(): boolean {
    return this.isActive;
  }

  /**
   * Get current settings
   */
  public getSettings(): Readonly<ThunderSettings> {
    return this.settings;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.stop();
    if (this.flashOverlay?.parentNode) {
      this.flashOverlay.parentNode.removeChild(this.flashOverlay);
      this.flashOverlay = null;
    }
  }
}
