/**
 * SkyLightSystem - Dynamic day/night lighting
 *
 * Features:
 * - Sun light that moves across the sky
 * - Moon light for nighttime
 * - Beautiful sunrise/sunset color transitions
 * - Ambient light changes
 * - Scene clear color (sky) changes
 */

import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { GameClock, type TimeOfDay } from "../core/GameClock";
import { BspManager } from "../loader/bsp/BspManager";
import { RenderVars } from "../rendering/RenderVars";
import { SpriteBuildingManager } from "../sprites/SpriteBuilding";

// ==================== Types ====================

export interface SkyLightConfig {
  sunIntensity?: number; // Max sun intensity (default: 1.0)
  moonIntensity?: number; // Max moon intensity (default: 0.3)
  ambientIntensity?: number; // Base ambient intensity (default: 0.4)
  enableShadows?: boolean; // Enable shadow casting (default: true)
}

interface ColorStop {
  time: number; // 0-24 hour
  sky: Color4;
  sun: Color3;
  ambient: Color3;
  intensity: number;
}

// ==================== Color Presets ====================

// Beautiful color transitions throughout the day
// Note: intensity values are kept low (0-0.5) for soft directional lighting
const COLOR_STOPS: ColorStop[] = [
  // Midnight - deep blue night
  {
    time: 0,
    sky: new Color4(0.02, 0.02, 0.08, 1),
    sun: new Color3(0.1, 0.1, 0.2),
    ambient: new Color3(0.15, 0.2, 0.5), // VERY strong blue tint
    intensity: 0.05,
  },
  // Pre-dawn - slightly lighter
  {
    time: 5,
    sky: new Color4(0.05, 0.05, 0.15, 1),
    sun: new Color3(0.1, 0.1, 0.2),
    ambient: new Color3(0.12, 0.14, 0.28), // Blue tint
    intensity: 0.08,
  },
  // Dawn start - purple/pink horizon
  {
    time: 5.5,
    sky: new Color4(0.15, 0.08, 0.2, 1),
    sun: new Color3(0.4, 0.2, 0.3),
    ambient: new Color3(0.15, 0.1, 0.2),
    intensity: 0.1,
  },
  // Sunrise - orange/pink
  {
    time: 6,
    sky: new Color4(0.7, 0.45, 0.35, 1),
    sun: new Color3(1.0, 0.7, 0.4),
    ambient: new Color3(0.25, 0.2, 0.18),
    intensity: 0.15,
  },
  // Early morning - golden
  {
    time: 7,
    sky: new Color4(0.55, 0.65, 0.85, 1),
    sun: new Color3(1.0, 0.95, 0.8),
    ambient: new Color3(0.5, 0.5, 0.45),
    intensity: 0.5,
  },
  // Morning - bright, slightly warm
  {
    time: 9,
    sky: new Color4(0.45, 0.6, 0.9, 1),
    sun: new Color3(1.0, 0.98, 0.95),
    ambient: new Color3(0.7, 0.65, 0.55), // Warm yellow tint
    intensity: 0.7,
  },
  // Noon - brightest, warm white
  {
    time: 12,
    sky: new Color4(0.4, 0.55, 0.9, 1),
    sun: new Color3(1.0, 1.0, 0.98),
    ambient: new Color3(0.8, 0.75, 0.65), // Warm daylight
    intensity: 0.8,
  },
  // Afternoon
  {
    time: 15,
    sky: new Color4(0.45, 0.6, 0.9, 1),
    sun: new Color3(1.0, 0.98, 0.92),
    ambient: new Color3(0.65, 0.65, 0.6),
    intensity: 0.75,
  },
  // Late afternoon - warm
  {
    time: 17,
    sky: new Color4(0.55, 0.6, 0.8, 1),
    sun: new Color3(1.0, 0.9, 0.75),
    ambient: new Color3(0.5, 0.48, 0.45),
    intensity: 0.6,
  },
  // Sunset - orange/red
  {
    time: 18,
    sky: new Color4(0.8, 0.45, 0.25, 1),
    sun: new Color3(1.0, 0.6, 0.3),
    ambient: new Color3(0.28, 0.22, 0.2),
    intensity: 0.2,
  },
  // Dusk - purple/pink
  {
    time: 18.5,
    sky: new Color4(0.35, 0.2, 0.35, 1),
    sun: new Color3(0.6, 0.35, 0.4),
    ambient: new Color3(0.2, 0.18, 0.3), // Purple tint
    intensity: 0.15,
  },
  // Twilight - deep blue
  {
    time: 19,
    sky: new Color4(0.1, 0.1, 0.22, 1),
    sun: new Color3(0.2, 0.2, 0.3),
    ambient: new Color3(0.12, 0.14, 0.25), // Blue tint
    intensity: 0.08,
  },
  // Night - blue moonlight
  {
    time: 20,
    sky: new Color4(0.02, 0.02, 0.08, 1),
    sun: new Color3(0.1, 0.1, 0.2),
    ambient: new Color3(0.15, 0.2, 0.5), // VERY strong blue tint
    intensity: 0.05,
  },
  // Late night (wraps to midnight)
  {
    time: 24,
    sky: new Color4(0.02, 0.02, 0.08, 1),
    sun: new Color3(0.1, 0.1, 0.2),
    ambient: new Color3(0.15, 0.2, 0.5), // VERY strong blue tint
    intensity: 0.05,
  },
];

// Moon color - cool blue
const MOON_COLOR = new Color3(0.4, 0.45, 0.6);

// ==================== SkyLightSystem Class ====================

export class SkyLightSystem {
  private static instance: SkyLightSystem;

  /** Clear the cached singleton so ServiceLocator re-inits a fresh one (QA-WO13). */
  static resetInstance(): void {
    SkyLightSystem.instance = null as unknown as SkyLightSystem;
  }

  private scene: Scene | null = null;
  private sunLight: DirectionalLight | null = null;
  private moonLight: DirectionalLight | null = null;
  private ambientLight: HemisphericLight | null = null;
  private shadowGenerator: ShadowGenerator | null = null;

  private config: Required<SkyLightConfig> = {
    sunIntensity: 1.0, // Full sun intensity
    moonIntensity: 0.4, // Increased for visible blue moonlight
    ambientIntensity: 0.5, // Increased for better visibility
    enableShadows: true,
  };

  private constructor() {}

  public static getInstance(): SkyLightSystem {
    if (!SkyLightSystem.instance) {
      SkyLightSystem.instance = new SkyLightSystem();
    }
    return SkyLightSystem.instance;
  }

  /**
   * Check if the system is initialized
   */
  public isInitialized(): boolean {
    return this.scene !== null && this.sunLight !== null;
  }

  /**
   * Initialize the sky light system
   */
  /**
   * Initialize the sky light system
   */
  public init(scene: Scene, config?: SkyLightConfig): void {
    // The same scene with its lights alive keeps them. Recreating them puts new
    // lights at the end of the scene's list, which shifts the light slots of
    // every material that outlives a map change, such as the view weapon. For
    // a frame those still draw with their old layout, and on WebGPU a light
    // bound into a slot of another size fails validation and the frame is lost.
    const alive = (light: { isDisposed(): boolean } | null) => !!light && !light.isDisposed();
    const keep = this.scene === scene && alive(this.sunLight) && alive(this.moonLight) && alive(this.ambientLight);
    if (!keep && (this.scene || this.sunLight)) {
      console.log("[SkyLightSystem] Re-initializing lights for scene...");
      this.reinitLights();
    }

    this.scene = scene;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Ensure we start fresh if reinitLights didn't catch everything or if this is the first run
    // Create sun light (directional) - softer specular for less harsh highlights
    if (!this.sunLight || this.sunLight.isDisposed()) {
      this.sunLight = new DirectionalLight("sunLight", new Vector3(-0.5, -1, -0.5).normalize(), scene);
      this.sunLight.position = new Vector3(500, 500, 500);
      this.sunLight.intensity = 0;
      this.sunLight.diffuse = new Color3(1, 1, 1);
      this.sunLight.specular = new Color3(0.2, 0.2, 0.2); // Reduced specular
    }

    // Disable shadows - they cause the "half dark" issue on large maps
    this.config.enableShadows = false;

    // Create moon light (directional, opposite direction)
    if (!this.moonLight || this.moonLight.isDisposed()) {
      this.moonLight = new DirectionalLight("moonLight", new Vector3(0.5, -1, 0.5).normalize(), scene);
      this.moonLight.intensity = 0;
      this.moonLight.diffuse = MOON_COLOR;
      this.moonLight.specular = new Color3(0.05, 0.05, 0.08); // Very soft specular
    }

    // Create ambient/hemisphere light - provides base illumination
    if (!this.ambientLight || this.ambientLight.isDisposed()) {
      this.ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), scene);
      this.ambientLight.intensity = this.config.ambientIntensity;
      this.ambientLight.diffuse = new Color3(0.5, 0.5, 0.55); // Slightly blue-ish
      this.ambientLight.groundColor = new Color3(0.2, 0.2, 0.25); // Darker ground bounce
      this.ambientLight.specular = Color3.Black(); // No specular from ambient
    }

    // Subscribe to clock updates
    const clock = GameClock.getInstance();
    // Remove existing listener to avoid duplicates if re-init
    // (Note: GameClock.on doesn't easily support removal without function ref,
    // but assuming single listener per system instance is fine if instance is singleton)

    // Initial update
    this.updateLighting(clock.getTimeOfDay());
  }

  // ==================== BSP Mode ====================

  private bspMode: boolean = false;

  /**
   * Enable/disable BSP mode
   * In BSP mode, the day/night cycle is paused, and lighting is optimized for BSP maps:
   * - Sun light is fixed (for normal maps)
   * - Ambient light is neutral (for lightmaps)
   */
  public setBspMode(enabled: boolean): void {
    this.bspMode = enabled;

    if (this.scene && enabled) {
      // Force an immediate update to set the fixed BSP lighting state
      // We use noon (time=12) as a reference for bright, neutral lighting
      // But we manually override the specific light properties below
      const noon: TimeOfDay = {
        hour: 12,
        minute: 0,
        totalMinutes: 720,
        normalized: 0.5,
        // biome-ignore lint/suspicious/noExplicitAny: Babylon light/scene internals
        period: "PM" as any,
        periodProgress: 0,
      };
      this.updateLighting(noon);

      console.log("[SkyLightSystem] BSP Mode enabled: Lighting locked for BSP map");
    } else {
      console.log("[SkyLightSystem] BSP Mode disabled: Resuming day/night cycle");
    }
  }

  /**
   * Reinitialize lights after scene clear
   * Call this when lights have been disposed but scene still exists
   */
  public reinitLights(): void {
    if (!this.scene) {
      console.warn("[SkyLightSystem] Cannot reinit lights: no scene");
      return;
    }

    // Dispose existing lights if they still exist
    if (this.sunLight && !this.sunLight.isDisposed()) {
      this.sunLight.dispose();
    }
    if (this.moonLight && !this.moonLight.isDisposed()) {
      this.moonLight.dispose();
    }
    if (this.ambientLight && !this.ambientLight.isDisposed()) {
      this.ambientLight.dispose();
    }
    if (this.shadowGenerator) {
      this.shadowGenerator.dispose();
      this.shadowGenerator = null;
    }

    // Recreate sun light
    this.sunLight = new DirectionalLight("sunLight", new Vector3(-0.5, -1, -0.5).normalize(), this.scene);
    this.sunLight.intensity = 0;
    this.sunLight.diffuse = new Color3(1, 1, 1);
    this.sunLight.specular = new Color3(0.2, 0.2, 0.2);
    this.sunLight.position = new Vector3(500, 500, 500);

    // Recreate moon light
    this.moonLight = new DirectionalLight("moonLight", new Vector3(0.5, -1, 0.5).normalize(), this.scene);
    this.moonLight.intensity = 0;
    this.moonLight.diffuse = MOON_COLOR;
    this.moonLight.specular = new Color3(0.05, 0.05, 0.08);

    // Recreate ambient light
    this.ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), this.scene);
    this.ambientLight.intensity = this.config.ambientIntensity;
    this.ambientLight.diffuse = new Color3(0.5, 0.5, 0.55);
    this.ambientLight.groundColor = new Color3(0.2, 0.2, 0.25);
    this.ambientLight.specular = Color3.Black();

    // Update lighting for current time
    const clock = GameClock.getInstance();
    this.updateLighting(clock.getTimeOfDay());

    console.log("[SkyLightSystem] Lights reinitialized");
  }

  /**
  /**
   * Update lighting based on time of day
   */
  public updateLighting(time: TimeOfDay): void {
    if (!this.scene || !this.sunLight || !this.moonLight || !this.ambientLight) {
      return;
    }

    // BSP Mode: Lock lighting state
    if (this.bspMode) {
      const bspPbrEnabled = (RenderVars.getInstance().get("r_bsp_pbr") ?? 0) >= 0.5;

      // 1. Sun Light: Needs to be active and directional for Normal Maps to work
      // But not too strong to wash out lightmaps
      this.sunLight.intensity = bspPbrEnabled ? 1.15 : 1.0;
      this.sunLight.diffuse = new Color3(1, 1, 1);
      this.sunLight.specular = bspPbrEnabled ? new Color3(0.16, 0.16, 0.16) : new Color3(0.1, 0.1, 0.1);
      // Fixed direction (noon-ish but angled) for good normal map relief
      this.sunLight.direction = new Vector3(-0.5, -1, -0.2).normalize();

      // 2. Moon Light: Off or very subtle fill
      this.moonLight.intensity = 0;

      // 3. Ambient Light: Neutral base for lightmapped geometry
      // Lightmaps multiply with this, so (0.5, 0.5, 0.5) might darken everything by half?
      // StandardMaterial logic: lightmap * ambient? Or lightmap * diffuse?
      // If we want "pure" lightmap look, we want neutral ambient.
      // Let's stick to a clean white light so colours aren't tinted.
      this.ambientLight.intensity = bspPbrEnabled ? 0.35 : 0.8;
      this.ambientLight.diffuse = new Color3(1, 1, 1);
      this.ambientLight.groundColor = bspPbrEnabled ? new Color3(0.18, 0.18, 0.18) : new Color3(0.5, 0.5, 0.5);
      this.ambientLight.specular = Color3.Black();

      return;
    }

    const hour = time.hour + time.minute / 60;

    // Find the two color stops to interpolate between
    let prevStop = COLOR_STOPS[COLOR_STOPS.length - 2];
    let nextStop = COLOR_STOPS[0];

    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      if (hour >= COLOR_STOPS[i].time && hour < COLOR_STOPS[i + 1].time) {
        prevStop = COLOR_STOPS[i];
        nextStop = COLOR_STOPS[i + 1];
        break;
      }
    }

    // Calculate interpolation factor
    const range = nextStop.time - prevStop.time;
    const t = range > 0 ? (hour - prevStop.time) / range : 0;

    // Interpolate colors
    const skyColor = this.lerpColor4(prevStop.sky, nextStop.sky, t);
    const sunColor = this.lerpColor3(prevStop.sun, nextStop.sun, t);
    const ambientColor = this.lerpColor3(prevStop.ambient, nextStop.ambient, t);
    const sunIntensity = this.lerp(prevStop.intensity, nextStop.intensity, t);

    // Apply sky color
    this.scene.clearColor = skyColor;

    // Apply sun light
    this.sunLight.diffuse = sunColor;
    this.sunLight.intensity = sunIntensity * this.config.sunIntensity;

    // Update sun direction based on time (arc across sky)
    const sunPosition = this.calculateSunPosition(hour);
    this.sunLight.direction = sunPosition.scale(-1);

    // Apply moon light (inverse of sun)
    const moonIntensity = Math.max(0, 1 - sunIntensity * 2) * this.config.moonIntensity;
    this.moonLight.intensity = moonIntensity;

    // Moon position (opposite of sun)
    const moonPosition = this.calculateMoonPosition(hour);
    this.moonLight.direction = moonPosition.scale(-1);

    // Apply ambient light
    this.ambientLight.diffuse = ambientColor;
    this.ambientLight.groundColor = ambientColor.scale(0.6);

    // Adjust ambient intensity based on time
    // Higher base (0.6) ensures good visibility at night with blue tint
    const ambientMultiplier = 0.6 + sunIntensity * 0.8;
    this.ambientLight.intensity = this.config.ambientIntensity * ambientMultiplier * 2.5;

    // Update sprite buildings with ambient tint for day/night effect
    SpriteBuildingManager.getInstance().updateAmbientTint(ambientColor);
  }

  /**
   * Calculate sun position in sky based on hour
   */
  private calculateSunPosition(hour: number): Vector3 {
    // Sun rises at 6, peaks at 12, sets at 18
    if (hour < 6 || hour >= 18) {
      // Below horizon
      return new Vector3(0, -1, 0);
    }

    // Map 6-18 to 0-PI (sunrise to sunset arc)
    const sunProgress = (hour - 6) / 12;
    const angle = sunProgress * Math.PI;

    // Sun arcs from east (-X) to west (+X), peaking at noon
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    const z = -0.3; // Slight tilt for more interesting shadows

    return new Vector3(x, y, z).normalize();
  }

  /**
   * Calculate moon position in sky based on hour
   */
  private calculateMoonPosition(hour: number): Vector3 {
    // Moon rises at 18, peaks at midnight, sets at 6
    let moonHour = hour;
    if (hour >= 18) {
      moonHour = hour - 18;
    } else if (hour < 6) {
      moonHour = hour + 6;
    } else {
      // Below horizon during day
      return new Vector3(0, -1, 0);
    }

    // Map 0-12 to 0-PI (moonrise to moonset arc)
    const moonProgress = moonHour / 12;
    const angle = moonProgress * Math.PI;

    // Moon arcs opposite to sun
    const x = -Math.cos(angle);
    const y = Math.sin(angle);
    const z = 0.3;

    return new Vector3(x, y, z).normalize();
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Interpolate Color3
   */
  private lerpColor3(a: Color3, b: Color3, t: number): Color3 {
    return new Color3(this.lerp(a.r, b.r, t), this.lerp(a.g, b.g, t), this.lerp(a.b, b.b, t));
  }

  /**
   * Interpolate Color4
   */
  private lerpColor4(a: Color4, b: Color4, t: number): Color4 {
    return new Color4(this.lerp(a.r, b.r, t), this.lerp(a.g, b.g, t), this.lerp(a.b, b.b, t), this.lerp(a.a, b.a, t));
  }

  /**
   * Get current sun light
   */
  public getSunLight(): DirectionalLight | null {
    return this.sunLight;
  }

  /**
   * Get current moon light
   */
  public getMoonLight(): DirectionalLight | null {
    return this.moonLight;
  }

  /**
   * Get ambient light
   */
  public getAmbientLight(): HemisphericLight | null {
    return this.ambientLight;
  }

  /**
   * Get shadow generator
   */
  public getShadowGenerator(): ShadowGenerator | null {
    return this.shadowGenerator;
  }

  /**
   * Add a mesh as a shadow caster
   */
  public addShadowCaster(mesh: AbstractMesh, includeDescendants: boolean = true): void {
    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(mesh, includeDescendants);
    }
  }

  /**
   * Enable shadow receiving on a mesh
   */
  public enableShadowReceiver(mesh: AbstractMesh): void {
    mesh.receiveShadows = true;
  }

  /**
   * Set sun intensity multiplier
   */
  public setSunIntensity(intensity: number): void {
    this.config.sunIntensity = intensity;
  }

  /**
   * Set moon intensity multiplier
   */
  public setMoonIntensity(intensity: number): void {
    this.config.moonIntensity = intensity;
  }

  /**
   * Get the current sky color as a CSS hex string
   */
  public getCurrentSkyColorHex(): string {
    if (!this.scene) return "#000000";
    const c = this.scene.clearColor;
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // ==================== BSP Day/Night (Direct API) ====================

  private _bspTimeOfDay: number = 0.5; // 0=midnight, 0.5=noon, 1=midnight
  private _bspDayNightEnabled: boolean = false;
  private _bspAnimating: boolean = false;
  private _bspCycleLength: number = 10; // Full cycle in minutes (default 10 min)
  private _lastStreetLampState: boolean = false;
  private _worldspawnLoaded: boolean = false; // Track if settings loaded from worldspawn

  /**
   * Enable/disable BSP day/night cycle
   */
  public setBspDayNightEnabled(enabled: boolean): void {
    this._bspDayNightEnabled = enabled;
    if (enabled) {
      this.applyBspLightmaps();
    }
  }

  /**
   * Set BSP time of day directly (0=midnight, 0.5=noon, 1=midnight)
   */
  public setBspTimeOfDay(time: number): void {
    this._bspTimeOfDay = Math.max(0, Math.min(1, time));
    if (this._bspDayNightEnabled) {
      this.applyBspLightmaps();
    }
  }

  /**
   * Get current BSP time of day
   */
  public getBspTimeOfDay(): number {
    return this._bspTimeOfDay;
  }

  /**
   * Start/stop BSP day/night animation
   */
  public setBspAnimating(animating: boolean): void {
    this._bspAnimating = animating;
  }

  /**
   * Set cycle length in minutes
   */
  public setBspCycleLength(minutes: number): void {
    this._bspCycleLength = Math.max(1, minutes);
  }

  /**
   * Get cycle length in minutes
   */
  public getBspCycleLength(): number {
    return this._bspCycleLength;
  }

  /**
   * Load day/night settings from BSP worldspawn entity
   * Only loads once per map - subsequent calls are ignored unless reset
   *
   * Supported worldspawn keys:
   *   daynight_enabled: "1" or "0"
   *   daynight_time: "0.0" to "1.0" (0=midnight, 0.5=noon)
   *   daynight_cycle: minutes for full cycle
   *   daynight_animate: "1" to auto-start animation
   */
  public loadFromWorldspawn(): boolean {
    // Skip if already loaded from worldspawn
    if (this._worldspawnLoaded) {
      return false;
    }

    try {
      const bsp = BspManager.getInstance();
      if (!bsp.isLoaded()) return false;

      let loaded = false;

      // Check for daynight_enabled
      const enabled = bsp.getWorldspawnProperty("daynight_enabled");
      if (enabled === "1") {
        this._bspDayNightEnabled = true;
        loaded = true;
      }

      // Check for daynight_time (starting time)
      const time = bsp.getWorldspawnProperty("daynight_time");
      if (time) {
        const t = parseFloat(time);
        if (!Number.isNaN(t)) {
          this._bspTimeOfDay = Math.max(0, Math.min(1, t));
          loaded = true;
        }
      }

      // Check for daynight_cycle (cycle length in minutes)
      const cycle = bsp.getWorldspawnProperty("daynight_cycle");
      if (cycle) {
        const c = parseFloat(cycle);
        if (!Number.isNaN(c) && c > 0) {
          this._bspCycleLength = c;
          loaded = true;
        }
      }

      // Check for daynight_animate (auto-start animation)
      const animate = bsp.getWorldspawnProperty("daynight_animate");
      if (animate === "1") {
        this._bspAnimating = true;
        loaded = true;
      }

      if (loaded) {
        this._worldspawnLoaded = true;
        console.log(
          `[SkyLightSystem] Loaded day/night from worldspawn: enabled=${this._bspDayNightEnabled}, time=${this._bspTimeOfDay}, cycle=${this._bspCycleLength}min, animate=${this._bspAnimating}`,
        );
        if (this._bspDayNightEnabled) {
          this.applyBspLightmaps();
        }
      }

      return loaded;
    } catch {
      return false;
    }
  }

  /**
   * Reset worldspawn loaded flag (call when loading new map)
   */
  public resetWorldspawn(): void {
    this._worldspawnLoaded = false;
  }

  /**
   * Check if settings were loaded from worldspawn
   */
  public isWorldspawnLoaded(): boolean {
    return this._worldspawnLoaded;
  }

  /**
   * Apply lightmap intensity and skybox tint based on current time
   */
  private applyBspLightmaps(): void {
    const sunFactor = Math.sin(this._bspTimeOfDay * Math.PI);
    const clampedSun = Math.max(0, sunFactor);

    // min=0.1 at midnight, max=1.5 at noon
    const lmIntensity = 0.1 + 1.4 * clampedSun;

    // Apply to BSP world
    try {
      const bsp = BspManager.getInstance();
      if (bsp.isLoaded()) {
        bsp.setLightmapIntensity(lmIntensity);

        // Also tint the skybox
        this.applySkyboxTint(clampedSun);

        // Apply to all other meshes in scene (spawned models, etc.)
        this.applyToSceneMeshes(bsp.getScene(), lmIntensity);

        // Control street lamps based on time (on at night: 0-0.2 and 0.8-1)
        const isNight = this._bspTimeOfDay < 0.2 || this._bspTimeOfDay > 0.8;
        if (isNight !== this._lastStreetLampState) {
          this._lastStreetLampState = isNight;
          this.setStreetLampsEnabled(isNight);
        }
      }
    } catch {
      // BspManager not available
    }
  }

  /**
   * Turn all street lamps on or off
   */
  private setStreetLampsEnabled(enabled: boolean): void {
    try {
      const { StreetLampSystem } = require("./StreetLampSystem");
      const lampSystem = StreetLampSystem.getInstance();
      if (lampSystem.isInitialized()) {
        for (const [id] of lampSystem.getLamps()) {
          if (enabled) {
            lampSystem.turnOn(id);
          } else {
            lampSystem.turnOff(id);
          }
        }
      }
    } catch {
      // StreetLampSystem not available
    }
  }

  /**
   * Apply day/night tint to all non-BSP meshes in the scene
   */
  private applyToSceneMeshes(scene: import("@babylonjs/core/scene").Scene | null, intensity: number): void {
    if (!scene) return;

    for (const mesh of scene.meshes) {
      // Skip BSP world meshes (already handled)
      if (mesh.name.startsWith("bsp_") || mesh.name === "bsp_world") continue;
      // Skip skybox
      if (mesh.name.includes("sky") || mesh.name.includes("Sky")) continue;
      // Skip meshes without materials
      if (!mesh.material) continue;

      // biome-ignore lint/suspicious/noExplicitAny: Babylon light/scene internals
      const mat = mesh.material as any;

      // Store original colors on first call
      if (mat._origDiffuse === undefined && mat.diffuseColor) {
        mat._origDiffuse = mat.diffuseColor.clone();
      }
      if (mat._origAlbedo === undefined && mat.albedoColor) {
        mat._origAlbedo = mat.albedoColor.clone();
      }

      // Modulate diffuse color (StandardMaterial)
      if (mat._origDiffuse) {
        mat.diffuseColor.r = mat._origDiffuse.r * intensity;
        mat.diffuseColor.g = mat._origDiffuse.g * intensity;
        mat.diffuseColor.b = mat._origDiffuse.b * intensity;
      }

      // Modulate albedo color (PBRMaterial)
      if (mat._origAlbedo) {
        mat.albedoColor.r = mat._origAlbedo.r * intensity;
        mat.albedoColor.g = mat._origAlbedo.g * intensity;
        mat.albedoColor.b = mat._origAlbedo.b * intensity;
      }
    }
  }

  /**
   * Apply tint to skybox based on sun factor (0=night, 1=noon)
   */
  private applySkyboxTint(sunFactor: number): void {
    try {
      const bsp = BspManager.getInstance();
      const scene = bsp.getScene();
      if (!scene) return;

      // Find skybox mesh (could be named various things)
      const skybox =
        scene.getMeshByName("skyBox") ||
        scene.getMeshByName("skybox") ||
        scene.getMeshByName("skySphere") ||
        scene.getMeshByName("q3_skybox");

      if (!skybox || !skybox.material) return;

      // biome-ignore lint/suspicious/noExplicitAny: Babylon light/scene internals
      const mat = skybox.material as any;

      // Calculate tint: bright white at noon, dark blue at midnight
      const nightR = 0.15,
        nightG = 0.15,
        nightB = 0.25;
      const dayR = 1.0,
        dayG = 1.0,
        dayB = 1.0;

      const r = nightR + (dayR - nightR) * sunFactor;
      const g = nightG + (dayG - nightG) * sunFactor;
      const b = nightB + (dayB - nightB) * sunFactor;

      // Apply to emissive color (used by sky sphere)
      if (mat.emissiveColor) {
        mat.emissiveColor.r = r;
        mat.emissiveColor.g = g;
        mat.emissiveColor.b = b;
      }

      // For reflection-based skybox, adjust diffuse as tint
      if (mat.reflectionTexture && mat.diffuseColor) {
        mat.diffuseColor.r = r;
        mat.diffuseColor.g = g;
        mat.diffuseColor.b = b;
      }
    } catch {
      // Scene not available
    }
  }

  // ==================== CVar-Driven Day/Night ====================

  private lastCvarTime: number = -1;

  /**
   * Update day/night cycle (call every frame)
   * @param deltaTime Time since last frame in milliseconds
   */
  public update(deltaTime: number): void {
    // Handle BSP animation
    if (this._bspDayNightEnabled && this._bspAnimating) {
      // Animate: full cycle based on _bspCycleLength (in minutes)
      const cycleMs = this._bspCycleLength * 60 * 1000;
      this._bspTimeOfDay += deltaTime / cycleMs;
      if (this._bspTimeOfDay > 1) this._bspTimeOfDay -= 1;
      this.applyBspLightmaps();
    }

    // Check if cvar-driven day/night system is enabled
    const enabled = Number(Cvar.get("r_daynight") ?? 0);

    if (enabled < 0.5) {
      return;
    }

    // Animate time if enabled
    const animate = Number(Cvar.get("r_daynight_animate") ?? 0);
    if (animate >= 0.5) {
      const cycleLength = Number(Cvar.get("r_daynight_length") ?? 1440);
      const speed = Number(Cvar.get("r_daynight_speed") ?? 1.0);

      let time = Number(Cvar.get("r_daynight_time") ?? 0.5);
      // deltaTime is in ms, convert to seconds
      time += (deltaTime / 1000 / cycleLength) * speed;
      time = time % 1.0;
      if (time < 0) time += 1.0;

      Cvar.set("r_daynight_time", time);
    }

    // Get current time from cvar
    const normalizedTime = Number(Cvar.get("r_daynight_time") ?? 0.5);

    // Only update lighting if time changed significantly
    const timeDiff = Math.abs(normalizedTime - this.lastCvarTime);
    if (timeDiff >= 0.001) {
      this.lastCvarTime = normalizedTime;
    }

    // Convert normalized time to TimeOfDay and update lighting (only if initialized)
    if (this.isInitialized()) {
      const timeOfDay = this.normalizedToTimeOfDay(normalizedTime);
      this.updateLighting(timeOfDay);
    }

    // BSP lightmaps are now controlled via direct API (setBspTimeOfDay)
    // The cvar-based updateBspLightmaps is disabled to avoid conflicts
  }

  /**
   * Convert normalized time (0-1) to TimeOfDay object
   */
  private normalizedToTimeOfDay(normalized: number): TimeOfDay {
    const totalMinutes = Math.floor(normalized * 1440);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;

    // Determine period
    let period: "night" | "dawn" | "morning" | "afternoon" | "dusk" | "evening" = "night";
    let periodProgress = 0;

    if (hour >= 0 && hour < 5) {
      period = "night";
      periodProgress = hour / 5;
    } else if (hour >= 5 && hour < 7) {
      period = "dawn";
      periodProgress = (hour - 5) / 2;
    } else if (hour >= 7 && hour < 12) {
      period = "morning";
      periodProgress = (hour - 7) / 5;
    } else if (hour >= 12 && hour < 17) {
      period = "afternoon";
      periodProgress = (hour - 12) / 5;
    } else if (hour >= 17 && hour < 19) {
      period = "dusk";
      periodProgress = (hour - 17) / 2;
    } else {
      period = "evening";
      periodProgress = (hour - 19) / 5;
    }

    return {
      hour,
      minute,
      totalMinutes,
      normalized,
      period,
      periodProgress,
    };
  }

  /**
   * Dispose of lights
   */
  public dispose(): void {
    this.shadowGenerator?.dispose();
    this.sunLight?.dispose();
    this.moonLight?.dispose();
    this.ambientLight?.dispose();
    this.shadowGenerator = null;
    this.sunLight = null;
    this.moonLight = null;
    this.ambientLight = null;
    this.scene = null;
  }
}
