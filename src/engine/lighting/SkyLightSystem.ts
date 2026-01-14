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

import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { GameClock, type TimeOfDay } from "../core/GameClock";
import { SpriteBuildingManager } from "../sprites/SpriteBuilding";
import { Cvar } from "../core/Cvar";
import { BspManager } from "../loader/bsp/BspManager";

// ==================== Types ====================

export interface SkyLightConfig {
  sunIntensity?: number;      // Max sun intensity (default: 1.0)
  moonIntensity?: number;     // Max moon intensity (default: 0.3)
  ambientIntensity?: number;  // Base ambient intensity (default: 0.4)
  enableShadows?: boolean;    // Enable shadow casting (default: true)
}

interface ColorStop {
  time: number;  // 0-24 hour
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

  private scene: Scene | null = null;
  private sunLight: DirectionalLight | null = null;
  private moonLight: DirectionalLight | null = null;
  private ambientLight: HemisphericLight | null = null;
  private shadowGenerator: ShadowGenerator | null = null;

  private config: Required<SkyLightConfig> = {
    sunIntensity: 1.0,      // Full sun intensity
    moonIntensity: 0.4,     // Increased for visible blue moonlight
    ambientIntensity: 0.5,  // Increased for better visibility
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
  public init(scene: Scene, config?: SkyLightConfig): void {
    this.scene = scene;
    
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Create sun light (directional) - softer specular for less harsh highlights
    // Position light very high and far to cover entire map uniformly
    this.sunLight = new DirectionalLight(
      "sunLight",
      new Vector3(-0.5, -1, -0.5).normalize(),
      scene
    );
    this.sunLight.intensity = 0;
    this.sunLight.diffuse = new Color3(1, 1, 1);
    this.sunLight.specular = new Color3(0.2, 0.2, 0.2); // Reduced specular
    
    // Position the light source far away so it covers the whole map uniformly
    this.sunLight.position = new Vector3(500, 500, 500);

    // Disable shadows - they cause the "half dark" issue on large maps
    // The day/night effect is achieved through ambient lighting instead
    // If shadows are needed later, use a much larger shadow map (4096+) 
    // and configure autoCalcShadowZBounds for the camera frustum
    this.config.enableShadows = false;

    // Create moon light (directional, opposite direction)
    this.moonLight = new DirectionalLight(
      "moonLight",
      new Vector3(0.5, -1, 0.5).normalize(),
      scene
    );
    this.moonLight.intensity = 0;
    this.moonLight.diffuse = MOON_COLOR;
    this.moonLight.specular = new Color3(0.05, 0.05, 0.08); // Very soft specular

    // Create ambient/hemisphere light - provides base illumination
    this.ambientLight = new HemisphericLight(
      "ambientLight",
      new Vector3(0, 1, 0),
      scene
    );
    this.ambientLight.intensity = this.config.ambientIntensity;
    this.ambientLight.diffuse = new Color3(0.5, 0.5, 0.55);  // Slightly blue-ish
    this.ambientLight.groundColor = new Color3(0.2, 0.2, 0.25); // Darker ground bounce
    this.ambientLight.specular = Color3.Black(); // No specular from ambient

    // Subscribe to clock updates
    const clock = GameClock.getInstance();
    clock.on((event, data) => {
      if (event === "time_update") {
        this.updateLighting(data as TimeOfDay);
      }
    });

    // Initial update
    this.updateLighting(clock.getTimeOfDay());

  }

  /**
   * Update lighting based on time of day
   */
  public updateLighting(time: TimeOfDay): void {
    if (!this.scene || !this.sunLight || !this.moonLight || !this.ambientLight) {
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
    return new Color3(
      this.lerp(a.r, b.r, t),
      this.lerp(a.g, b.g, t),
      this.lerp(a.b, b.b, t)
    );
  }

  /**
   * Interpolate Color4
   */
  private lerpColor4(a: Color4, b: Color4, t: number): Color4 {
    return new Color4(
      this.lerp(a.r, b.r, t),
      this.lerp(a.g, b.g, t),
      this.lerp(a.b, b.b, t),
      this.lerp(a.a, b.a, t)
    );
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
   * Apply lightmap intensity based on current time
   */
  private applyBspLightmaps(): void {
    const sunFactor = Math.sin(this._bspTimeOfDay * Math.PI);
    const clampedSun = Math.max(0, sunFactor);
    
    // min=0.1 at midnight, max=1.5 at noon
    const lmIntensity = 0.1 + 1.4 * clampedSun;
    
    try {
      const bsp = BspManager.getInstance();
      if (bsp.isLoaded()) {
        bsp.setLightmapIntensity(lmIntensity);
        console.log(`[SkyLightSystem] BSP lightmap: time=${this._bspTimeOfDay.toFixed(2)}, intensity=${lmIntensity.toFixed(2)}`);
      }
    } catch {
      // BspManager not available
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
      // Animate: full cycle in 60 seconds
      this._bspTimeOfDay += deltaTime / 60000;
      if (this._bspTimeOfDay > 1) this._bspTimeOfDay -= 1;
      this.applyBspLightmaps();
    }

    // Check if cvar-driven day/night system is enabled
    const enabled = Number(Cvar.get('r_daynight') ?? 0);
    
    if (enabled < 0.5) {
      return;
    }

    // Animate time if enabled
    const animate = Number(Cvar.get('r_daynight_animate') ?? 0);
    if (animate >= 0.5) {
      const cycleLength = Number(Cvar.get('r_daynight_length') ?? 1440);
      const speed = Number(Cvar.get('r_daynight_speed') ?? 1.0);
      
      let time = Number(Cvar.get('r_daynight_time') ?? 0.5);
      // deltaTime is in ms, convert to seconds
      time += (deltaTime / 1000 / cycleLength) * speed;
      time = time % 1.0;
      if (time < 0) time += 1.0;
      
      Cvar.set('r_daynight_time', time);
    }

    // Get current time from cvar
    const normalizedTime = Number(Cvar.get('r_daynight_time') ?? 0.5);
    
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
    let period: 'night' | 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'evening' = 'night';
    let periodProgress = 0;
    
    if (hour >= 0 && hour < 5) {
      period = 'night';
      periodProgress = hour / 5;
    } else if (hour >= 5 && hour < 7) {
      period = 'dawn';
      periodProgress = (hour - 5) / 2;
    } else if (hour >= 7 && hour < 12) {
      period = 'morning';
      periodProgress = (hour - 7) / 5;
    } else if (hour >= 12 && hour < 17) {
      period = 'afternoon';
      periodProgress = (hour - 12) / 5;
    } else if (hour >= 17 && hour < 19) {
      period = 'dusk';
      periodProgress = (hour - 17) / 2;
    } else {
      period = 'evening';
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
