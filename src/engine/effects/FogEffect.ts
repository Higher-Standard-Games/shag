/**
 * FogEffect - Atmospheric fog system
 *
 * Creates fog using Babylon.js built-in fog modes:
 * - Linear fog (distance-based)
 * - Exponential fog (density-based)
 *
 * Can be combined with other weather effects.
 */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";
import { WorldFogController } from "../rendering/WorldFogController";

export type FogMode = "none" | "linear" | "exp" | "exp2";

export interface FogSettings {
  mode: FogMode; // Fog calculation mode
  density: number; // For exponential fog (0-1)
  start: number; // For linear fog - where fog starts
  end: number; // For linear fog - where fog is fully opaque
  color: { r: number; g: number; b: number }; // Fog color
}

const DEFAULT_FOG_SETTINGS: FogSettings = {
  mode: "exp",
  density: 0.01,
  start: 50,
  end: 300,
  color: { r: 0.8, g: 0.85, b: 0.9 }, // Light gray-blue
};

export class FogEffect {
  private scene: Scene;
  private settings: FogSettings = { ...DEFAULT_FOG_SETTINGS };
  private isActive: boolean = false;
  private originalFogMode: number = 0;
  private originalFogDensity: number = 0;
  private originalFogStart: number = 0;
  private originalFogEnd: number = 0;
  private originalFogColor: Color3 | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.storeOriginalSettings();
  }

  /**
   * Store original fog settings for restoration
   */
  private storeOriginalSettings(): void {
    this.originalFogMode = this.scene.fogMode;
    this.originalFogDensity = this.scene.fogDensity;
    this.originalFogStart = this.scene.fogStart;
    this.originalFogEnd = this.scene.fogEnd;
    this.originalFogColor = this.scene.fogColor.clone();
  }

  /**
   * Start fog effect
   */
  public start(settings?: Partial<FogSettings>): void {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }
    // Weather fog borrows the scene fog from the map's world fog
    if (!this.isActive) WorldFogController.getInstance().suspend("weather");

    this.applyFog();
    this.isActive = true;
    devLog(`[FogEffect] Started with mode: ${this.settings.mode}, density: ${this.settings.density}`);
  }

  /**
   * Stop fog effect and restore original settings
   */
  public stop(): void {
    if (!this.isActive) return;

    this.scene.fogMode = this.originalFogMode;
    this.scene.fogDensity = this.originalFogDensity;
    this.scene.fogStart = this.originalFogStart;
    this.scene.fogEnd = this.originalFogEnd;
    if (this.originalFogColor) {
      this.scene.fogColor = this.originalFogColor;
    }

    this.isActive = false;
    WorldFogController.getInstance().resume("weather");
    devLog("[FogEffect] Stopped");
  }

  /**
   * Update fog settings while active
   */
  public updateSettings(settings: Partial<FogSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (this.isActive) {
      this.applyFog();
    }
  }

  /**
   * Apply fog settings to scene
   */
  private applyFog(): void {
    const s = this.settings;

    // Set fog mode
    switch (s.mode) {
      case "none":
        this.scene.fogMode = Scene.FOGMODE_NONE;
        break;
      case "linear":
        this.scene.fogMode = Scene.FOGMODE_LINEAR;
        break;
      case "exp":
        this.scene.fogMode = Scene.FOGMODE_EXP;
        break;
      case "exp2":
        this.scene.fogMode = Scene.FOGMODE_EXP2;
        break;
    }

    // Set fog parameters
    this.scene.fogDensity = s.density;
    this.scene.fogStart = s.start;
    this.scene.fogEnd = s.end;
    this.scene.fogColor = new Color3(s.color.r, s.color.g, s.color.b);
  }

  /**
   * Set fog density (for exponential modes)
   */
  public setDensity(density: number): void {
    this.updateSettings({ density: Math.max(0, Math.min(1, density)) });
  }

  /**
   * Set fog color
   */
  public setColor(r: number, g: number, b: number): void {
    this.updateSettings({ color: { r, g, b } });
  }

  /**
   * Set fog mode
   */
  public setMode(mode: FogMode): void {
    this.updateSettings({ mode });
  }

  /**
   * Preset: Light mist
   */
  public lightMist(): void {
    this.start({
      mode: "exp",
      density: 0.005,
      color: { r: 0.9, g: 0.92, b: 0.95 },
    });
  }

  /**
   * Preset: Heavy fog
   */
  public heavyFog(): void {
    this.start({
      mode: "exp2",
      density: 0.02,
      color: { r: 0.7, g: 0.75, b: 0.8 },
    });
  }

  /**
   * Preset: Morning fog (warm tint)
   */
  public morningFog(): void {
    this.start({
      mode: "exp",
      density: 0.008,
      color: { r: 0.95, g: 0.9, b: 0.85 },
    });
  }

  /**
   * Preset: Spooky fog (dark)
   */
  public spookyFog(): void {
    this.start({
      mode: "exp2",
      density: 0.025,
      color: { r: 0.3, g: 0.35, b: 0.4 },
    });
  }

  /**
   * Check if fog is active
   */
  public isFoggy(): boolean {
    return this.isActive;
  }

  /**
   * Get current settings
   */
  public getSettings(): Readonly<FogSettings> {
    return this.settings;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.stop();
  }
}
