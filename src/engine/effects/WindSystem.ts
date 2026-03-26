/**
 * WindSystem - Global wind state manager
 *
 * Provides a centralized wind state that other effects can subscribe to:
 * - PrecipitationEffect (rain/snow drift)
 * - DebrisEffect (flying leaves, trash, dust)
 * - Future: tree sway, grass movement, cloth physics
 *
 * Wind can vary over time with gusts and direction changes.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

export interface WindState {
  direction: Vector3; // Normalized wind direction (XZ plane)
  strength: number; // Current wind strength (0-1)
  baseStrength: number; // Base strength before gusts
  gustStrength: number; // Additional gust strength (0-1)
  angle: number; // Wind angle in radians (0 = +Z, PI/2 = +X)
}

export interface WindSettings {
  baseStrength: number; // Base wind strength (0-1)
  gustFrequency: number; // How often gusts occur (0-1, higher = more frequent)
  gustIntensity: number; // How strong gusts are (0-1)
  variability: number; // How much direction varies (0-1)
  angle: number; // Base wind angle in radians
}

export type WindListener = (state: WindState) => void;

const DEFAULT_WIND_SETTINGS: WindSettings = {
  baseStrength: 0.3,
  gustFrequency: 0.3,
  gustIntensity: 0.5,
  variability: 0.1,
  angle: Math.PI * 0.25, // Default: blowing diagonally
};

export class WindSystem {
  private static instance: WindSystem | null = null;

  private scene: Scene;
  private settings: WindSettings = { ...DEFAULT_WIND_SETTINGS };
  private state: WindState;
  private isActive: boolean = false;
  private renderObserver: Observer<Scene> | null = null;
  private listeners: Set<WindListener> = new Set();
  private currentGust: number = 0;
  private targetGust: number = 0;
  private gustLerpSpeed: number = 2;

  // Direction variation
  private angleOffset: number = 0;
  private targetAngleOffset: number = 0;

  private constructor(scene: Scene) {
    this.scene = scene;
    this.state = this.createInitialState();
  }

  public static getInstance(scene?: Scene): WindSystem {
    if (!WindSystem.instance) {
      if (!scene) {
        throw new Error("[WindSystem] Scene required for first initialization");
      }
      WindSystem.instance = new WindSystem(scene);
    }
    return WindSystem.instance;
  }

  public static hasInstance(): boolean {
    return WindSystem.instance !== null;
  }

  private createInitialState(): WindState {
    const angle = this.settings.angle;
    return {
      direction: new Vector3(Math.sin(angle), 0, Math.cos(angle)),
      strength: 0,
      baseStrength: this.settings.baseStrength,
      gustStrength: 0,
      angle: angle,
    };
  }

  /**
   * Start the wind system
   */
  public start(settings?: Partial<WindSettings>): void {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }

    if (this.isActive) {
      this.updateSettings(settings || {});
      return;
    }

    this.state = this.createInitialState();
    this.state.baseStrength = this.settings.baseStrength;
    this.state.strength = this.settings.baseStrength;

    // Start update loop
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.update();
    });

    this.isActive = true;
    console.log("[WindSystem] Started with strength:", this.settings.baseStrength);
  }

  /**
   * Stop the wind system
   */
  public stop(): void {
    if (!this.isActive) return;

    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    // Notify listeners of zero wind
    this.state.strength = 0;
    this.state.gustStrength = 0;
    this.notifyListeners();

    this.isActive = false;
    console.log("[WindSystem] Stopped");
  }

  /**
   * Update wind settings
   */
  public updateSettings(settings: Partial<WindSettings>): void {
    this.settings = { ...this.settings, ...settings };

    if (settings.baseStrength !== undefined) {
      this.state.baseStrength = settings.baseStrength;
    }
    if (settings.angle !== undefined) {
      this.state.angle = settings.angle;
      this.updateDirection();
    }
  }

  /**
   * Subscribe to wind state changes
   */
  public addListener(listener: WindListener): void {
    this.listeners.add(listener);
    // Immediately notify with current state
    if (this.isActive) {
      listener(this.state);
    }
  }

  /**
   * Unsubscribe from wind state changes
   */
  public removeListener(listener: WindListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Get current wind state (read-only snapshot)
   */
  public getState(): Readonly<WindState> {
    return this.state;
  }

  /**
   * Get current settings
   */
  public getSettings(): Readonly<WindSettings> {
    return this.settings;
  }

  /**
   * Check if wind is active
   */
  public isWindy(): boolean {
    return this.isActive && this.state.strength > 0.05;
  }

  /**
   * Set wind strength directly (0-1)
   */
  public setStrength(strength: number): void {
    this.updateSettings({ baseStrength: Math.max(0, Math.min(1, strength)) });
  }

  /**
   * Set wind angle in radians
   */
  public setAngle(angle: number): void {
    this.updateSettings({ angle });
  }

  /**
   * Trigger a manual gust
   */
  public triggerGust(intensity: number = 1): void {
    this.targetGust = Math.min(1, this.settings.gustIntensity * intensity);
    console.log("[WindSystem] Gust triggered:", this.targetGust.toFixed(2));
  }

  /**
   * Main update loop - called each frame
   */
  private update(): void {
    const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

    // Update gust simulation
    this.updateGusts(deltaTime);

    // Update direction variation
    this.updateDirectionVariation(deltaTime);

    // Calculate final strength
    this.state.gustStrength = this.currentGust;
    this.state.strength = Math.min(1, this.state.baseStrength + this.currentGust);

    // Update direction vector
    this.updateDirection();

    // Notify all listeners
    this.notifyListeners();
  }

  /**
   * Simulate wind gusts
   */
  private updateGusts(deltaTime: number): void {
    this.gustTimer += deltaTime;

    // Random gust triggering based on frequency
    const gustChance = this.settings.gustFrequency * deltaTime * 0.5;
    if (Math.random() < gustChance && this.targetGust < 0.1) {
      // Start a new gust
      this.targetGust = this.settings.gustIntensity * (0.5 + Math.random() * 0.5);
    }

    // Lerp current gust toward target
    if (this.currentGust < this.targetGust) {
      // Gusts ramp up quickly
      this.currentGust += deltaTime * this.gustLerpSpeed * 2;
      if (this.currentGust >= this.targetGust) {
        this.currentGust = this.targetGust;
        // Start decay
        this.targetGust = 0;
      }
    } else {
      // Gusts decay slowly
      this.currentGust -= deltaTime * this.gustLerpSpeed * 0.5;
      if (this.currentGust < 0) {
        this.currentGust = 0;
      }
    }
  }

  /**
   * Add subtle direction variation
   */
  private updateDirectionVariation(deltaTime: number): void {
    // Occasionally change target angle offset
    if (Math.random() < deltaTime * 0.2) {
      const maxOffset = this.settings.variability * Math.PI * 0.25;
      this.targetAngleOffset = (Math.random() - 0.5) * 2 * maxOffset;
    }

    // Lerp toward target
    this.angleOffset += (this.targetAngleOffset - this.angleOffset) * deltaTime * 0.5;
  }

  /**
   * Update direction vector from angle
   */
  private updateDirection(): void {
    const finalAngle = this.state.angle + this.angleOffset;
    this.state.direction.x = Math.sin(finalAngle);
    this.state.direction.z = Math.cos(finalAngle);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Preset: Calm breeze
   */
  public calmBreeze(): void {
    this.start({
      baseStrength: 0.15,
      gustFrequency: 0.1,
      gustIntensity: 0.2,
      variability: 0.05,
    });
  }

  /**
   * Preset: Moderate wind
   */
  public moderateWind(): void {
    this.start({
      baseStrength: 0.4,
      gustFrequency: 0.3,
      gustIntensity: 0.4,
      variability: 0.15,
    });
  }

  /**
   * Preset: Strong wind / storm
   */
  public stormWind(): void {
    this.start({
      baseStrength: 0.7,
      gustFrequency: 0.5,
      gustIntensity: 0.8,
      variability: 0.25,
    });
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.stop();
    this.listeners.clear();
    WindSystem.instance = null;
  }
}
