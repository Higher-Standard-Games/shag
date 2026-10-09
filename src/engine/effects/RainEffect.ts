/**
 * PrecipitationEffect - Particle-based rain/snow system
 *
 * Creates rain drops or snowflakes that fall from above the camera down to the ground.
 * Uses Babylon.js GPUParticleSystem so particle simulation and rendering run on
 * the GPU: transform feedback on WebGL2, compute shaders on WebGPU.
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { GetClass } from "@babylonjs/core/Misc/typeStore";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/webgl2ParticleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { type WindState, WindSystem } from "./WindSystem";

export type PrecipitationType = "rain" | "snow";

export interface PrecipitationSettings {
  type: PrecipitationType; // Rain or snow
  intensity: number; // 0-1, affects particle count
  speed: number; // Fall speed multiplier
  windAngle: number; // Wind direction in radians (0 = no wind)
  windStrength: number; // How much wind affects precipitation (0-1)
  particleSize: number; // Size of particles
  opacity: number; // Visibility (0-1)
}

// Legacy alias for backwards compatibility
export type RainSettings = PrecipitationSettings;

/**
 * GPU simulation needs transform feedback on WebGL2, or compute shaders plus
 * the compute particle platform that the WebGPU backend loader registers.
 */
export function supportsGpuPrecipitation(engine: AbstractEngine): boolean {
  const caps = engine.getCaps();
  if (engine.isWebGPU) return !!caps.supportComputeShaders && !!GetClass("BABYLON.ComputeShaderParticleSystem");
  return !!caps.supportTransformFeedbacks;
}

const DEFAULT_RAIN_SETTINGS: PrecipitationSettings = {
  type: "rain",
  intensity: 0.5,
  speed: 9.0, // Tuned for natural look
  windAngle: 0,
  windStrength: 0,
  particleSize: 1.5,
  opacity: 0.7,
};

const DEFAULT_SNOW_SETTINGS: PrecipitationSettings = {
  type: "snow",
  intensity: 0.6,
  speed: 1.5, // Snow falls slower
  windAngle: 0,
  windStrength: 0.2, // Light drift
  particleSize: 1.0,
  opacity: 0.9,
};

export class PrecipitationEffect {
  private scene: Scene;
  private particleSystem: ParticleSystem | GPUParticleSystem | null = null;
  private emitter: AbstractMesh | null = null;
  private settings: PrecipitationSettings = { ...DEFAULT_RAIN_SETTINGS };
  private isActive: boolean = false;
  private renderObserver: Observer<Scene> | null = null;
  private currentType: PrecipitationType = "rain";

  // Precipitation area dimensions - dynamically calculated based on camera view
  private emitWidth: number = 200;
  private emitDepth: number = 200;
  private readonly EMIT_HEIGHT = 100; // Height above camera target where precipitation spawns
  private readonly COVERAGE = 0.9; // Cover 90% of visible area

  // Ambient sounds
  private rainSound: HTMLAudioElement | null = null;
  private readonly RAIN_FADE_DURATION = 1000; // ms to fade in/out

  // Wind integration
  private windListener: ((state: WindState) => void) | null = null;
  private useGlobalWind: boolean = true; // Auto-sync with WindSystem

  constructor(scene: Scene) {
    this.scene = scene;
    this.loadSounds();
  }

  /**
   * Load ambient weather sounds
   */
  private loadSounds(): void {
    this.rainSound = new Audio("/sounds/rain.mp3");
    this.rainSound.loop = true;
    this.rainSound.volume = 0; // Start silent, fade in
  }

  /**
   * Start rain effect
   */
  public startRain(settings?: Partial<PrecipitationSettings>): void {
    this.start({ ...DEFAULT_RAIN_SETTINGS, ...settings, type: "rain" });
  }

  /**
   * Start snow effect
   */
  public startSnow(settings?: Partial<PrecipitationSettings>): void {
    this.start({ ...DEFAULT_SNOW_SETTINGS, ...settings, type: "snow" });
  }

  /**
   * Start the precipitation effect
   */
  public start(settings?: Partial<PrecipitationSettings>): void {
    // If switching types, stop and restart
    if (this.isActive && settings?.type && settings.type !== this.currentType) {
      this.stop();
      setTimeout(() => this.start(settings), 100);
      return;
    }

    if (this.isActive) {
      this.updateSettings(settings || {});
      return;
    }

    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }

    this.currentType = this.settings.type;
    this.createParticleSystem();
    this.isActive = true;

    // Subscribe to global wind if enabled
    if (this.useGlobalWind) {
      this.subscribeToWind();
    }

    // Start rain ambient sound (only for rain, not snow)
    if (this.currentType === "rain") {
      this.fadeInRainSound();
    }

    console.log(`[PrecipitationEffect] Started ${this.currentType} with intensity:`, this.settings.intensity);
  }

  /**
   * Subscribe to WindSystem for automatic wind sync
   */
  private subscribeToWind(): void {
    if (!WindSystem.hasInstance()) return;

    const windSystem = WindSystem.getInstance();
    this.windListener = (state: WindState) => {
      // Apply wind to precipitation settings
      this.settings.windAngle = state.angle;
      this.settings.windStrength = state.strength * 0.5; // Scale down for precipitation
      if (this.particleSystem) {
        this.applySettings();
      }
    };
    windSystem.addListener(this.windListener);
  }

  /**
   * Unsubscribe from WindSystem
   */
  private unsubscribeFromWind(): void {
    if (this.windListener && WindSystem.hasInstance()) {
      WindSystem.getInstance().removeListener(this.windListener);
      this.windListener = null;
    }
  }

  /**
   * Stop the precipitation effect
   * @param immediate - If true, dispose particles immediately (for map transitions)
   */
  public stop(immediate: boolean = false): void {
    if (!this.isActive) return;

    // Unsubscribe from wind
    this.unsubscribeFromWind();

    // Fade out rain sound
    this.fadeOutRainSound();

    // Remove render observer
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    const stoppedSystem = this.particleSystem;
    const stoppedEmitter = this.emitter;
    this.particleSystem = null;
    this.emitter = null;

    if (stoppedSystem) {
      stoppedSystem.stop();

      if (immediate) {
        // Immediate disposal for map transitions
        stoppedSystem.dispose();
        stoppedEmitter?.dispose();
      } else {
        // Let existing particles finish falling
        setTimeout(() => {
          stoppedSystem.dispose();
          stoppedEmitter?.dispose();
        }, 3000);
      }
    }

    this.isActive = false;
    console.log(`[PrecipitationEffect] Stopped ${this.currentType}${immediate ? " (immediate)" : ""}`);
  }

  /**
   * Fade in rain ambient sound
   */
  private fadeInRainSound(): void {
    if (!this.rainSound) return;

    this.rainSound.currentTime = 0;
    this.rainSound.volume = 0;
    this.rainSound.play().catch((err) => {
      console.warn("[PrecipitationEffect] Could not play rain sound:", err.message);
    });

    // Fade in over duration
    const targetVolume = 0.4;
    const steps = 20;
    const stepTime = this.RAIN_FADE_DURATION / steps;
    const volumeStep = targetVolume / steps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      if (this.rainSound) {
        this.rainSound.volume = Math.min(targetVolume, volumeStep * currentStep);
      }
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
      }
    }, stepTime);
  }

  /**
   * Fade out rain ambient sound
   */
  private fadeOutRainSound(): void {
    if (!this.rainSound || this.rainSound.paused) return;

    const startVolume = this.rainSound.volume;
    const steps = 20;
    const stepTime = this.RAIN_FADE_DURATION / steps;
    const volumeStep = startVolume / steps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      if (this.rainSound) {
        this.rainSound.volume = Math.max(0, startVolume - volumeStep * currentStep);
      }
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        this.rainSound?.pause();
      }
    }, stepTime);
  }

  /**
   * Update rain settings while running
   */
  public updateSettings(settings: Partial<RainSettings>): void {
    this.settings = { ...this.settings, ...settings };

    if (this.particleSystem) {
      this.applySettings();
    }
  }

  /**
   * Create the particle system for precipitation
   */
  private createParticleSystem(): void {
    // Create invisible emitter mesh that will follow camera
    this.emitter = MeshBuilder.CreateBox("precipEmitter", { size: 1 }, this.scene);
    this.emitter.isVisible = false;

    // Initial position at camera target
    this.updateEmitterPosition();

    // GPU simulation where the active engine supports it. The CPU fallback
    // keeps weather working on WebGL1 and on WebGPU adapters without compute.
    const capacity = Math.floor(2000 * this.settings.intensity);
    const engine = this.scene.getEngine();
    if (supportsGpuPrecipitation(engine)) {
      this.particleSystem = new GPUParticleSystem(
        "precipitation",
        {
          capacity,
          emitRateControl: true,
          randomTextureSize: 4096,
        },
        this.scene,
      );
      console.log(`[PrecipitationEffect] GPU particle backend (${capacity} capacity)`);
    } else {
      this.particleSystem = new ParticleSystem("precipitation", capacity, this.scene);
      console.warn("[PrecipitationEffect] GPU particles unavailable; using CPU compatibility backend");
    }

    // Use appropriate texture based on type
    this.particleSystem.particleTexture =
      this.currentType === "snow" ? this.createSnowTexture() : this.createRainTexture();

    // Emitter configuration - box emitter for area around camera
    this.particleSystem.emitter = this.emitter;

    // Calculate initial emit area based on viewport
    this.calculateEmitArea();
    this.updateEmitBox();

    // Apply all settings
    this.applySettings();

    // Register render observer to follow camera and update area
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.updateEmitterPosition();
    });

    // Start emitting
    this.particleSystem.start();
  }

  /**
   * Update emitter position to follow camera target
   */
  private updateEmitterPosition(): void {
    if (!this.emitter || !this.scene.activeCamera) return;

    const camera = this.scene.activeCamera;

    // For ArcRotateCamera, use the target position
    // For other cameras, use camera position
    let targetPos: Vector3;
    if ("target" in camera && camera.target instanceof Vector3) {
      targetPos = camera.target;
    } else {
      targetPos = camera.position;
    }

    // Position emitter above the camera's target/focus point
    this.emitter.position.x = targetPos.x;
    this.emitter.position.y = targetPos.y + this.EMIT_HEIGHT;
    this.emitter.position.z = targetPos.z;
  }

  /**
   * Calculate emit area based on camera's visible ground area
   */
  private calculateEmitArea(): void {
    const camera = this.scene.activeCamera;
    if (!camera) return;

    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) return;

    // Get viewport dimensions
    const viewportWidth = canvas.width;
    const viewportHeight = canvas.height;

    // For isometric/ortho cameras, calculate visible ground area
    // Based on camera height and angle, estimate ground coverage
    let groundWidth: number;
    let groundDepth: number;

    if ("orthoTop" in camera && camera.orthoTop !== null) {
      // Orthographic camera - use ortho bounds directly
      const orthoHeight = (camera.orthoTop as number) - (camera.orthoBottom as number);
      const orthoWidth = (camera.orthoRight as number) - (camera.orthoLeft as number);
      groundWidth = orthoWidth * this.COVERAGE;
      groundDepth = orthoHeight * this.COVERAGE;
    } else if ("radius" in camera) {
      // ArcRotateCamera - estimate based on radius and viewport
      const radius = (camera as { radius: number }).radius;
      const fov = (camera as { fov?: number }).fov || 0.8;
      const aspectRatio = viewportWidth / viewportHeight;

      // Approximate visible ground area based on camera distance
      groundWidth = radius * Math.tan(fov / 2) * 2 * aspectRatio * this.COVERAGE;
      groundDepth = radius * Math.tan(fov / 2) * 2 * this.COVERAGE;
    } else {
      // Fallback - use viewport-based estimate
      groundWidth = viewportWidth * 0.5;
      groundDepth = viewportHeight * 0.5;
    }

    // Clamp to reasonable values
    this.emitWidth = Math.max(100, Math.min(800, groundWidth));
    this.emitDepth = Math.max(100, Math.min(800, groundDepth));

    console.log(`[RainEffect] Emit area: ${this.emitWidth.toFixed(0)} x ${this.emitDepth.toFixed(0)}`);
  }

  /**
   * Update particle system emit box dimensions
   */
  private updateEmitBox(): void {
    if (!this.particleSystem) return;

    this.particleSystem.minEmitBox = new Vector3(-this.emitWidth / 2, 0, -this.emitDepth / 2);
    this.particleSystem.maxEmitBox = new Vector3(this.emitWidth / 2, 0, this.emitDepth / 2);
  }

  /**
   * Apply current settings to particle system
   */
  private applySettings(): void {
    if (!this.particleSystem) return;

    const s = this.settings;
    const isSnow = this.currentType === "snow";
    const baseSpeed = 80 * s.speed;

    // Emission rate based on intensity
    this.particleSystem.emitRate = Math.floor(500 * s.intensity);

    // Particle lifetime (time to fall from emit height to ground)
    const fallDistance = this.EMIT_HEIGHT;
    const lifetime = fallDistance / baseSpeed;
    this.particleSystem.minLifeTime = lifetime * 0.9;
    this.particleSystem.maxLifeTime = lifetime * 1.1;

    // Size
    this.particleSystem.minSize = s.particleSize * 0.8;
    this.particleSystem.maxSize = s.particleSize * 1.2;

    if (isSnow) {
      // Snow: round flakes, no elongation
      this.particleSystem.minScaleX = 0.8;
      this.particleSystem.maxScaleX = 1.2;
      this.particleSystem.minScaleY = 0.8;
      this.particleSystem.maxScaleY = 1.2;
      // Add some rotation for snow
      this.particleSystem.minAngularSpeed = -2;
      this.particleSystem.maxAngularSpeed = 2;
    } else {
      // Rain: elongated drops
      this.particleSystem.minScaleX = 0.3;
      this.particleSystem.maxScaleX = 0.5;
      this.particleSystem.minScaleY = 3.0;
      this.particleSystem.maxScaleY = 5.0;
      this.particleSystem.minAngularSpeed = 0;
      this.particleSystem.maxAngularSpeed = 0;
    }

    // Direction - mostly down with optional wind
    const windX = Math.sin(s.windAngle) * s.windStrength * 20;
    const windZ = Math.cos(s.windAngle) * s.windStrength * 20;

    this.particleSystem.direction1 = new Vector3(windX - 2, -baseSpeed, windZ - 2);
    this.particleSystem.direction2 = new Vector3(windX + 2, -baseSpeed, windZ + 2);

    // Snow has some gravity wobble, rain falls straight
    if (isSnow) {
      this.particleSystem.gravity = new Vector3(windX * 0.5, -5, windZ * 0.5);
    } else {
      this.particleSystem.gravity = new Vector3(0, 0, 0);
    }

    // Color
    const alpha = s.opacity;
    if (isSnow) {
      // Snow: pure white
      this.particleSystem.color1 = new Color4(1.0, 1.0, 1.0, alpha);
      this.particleSystem.color2 = new Color4(0.95, 0.95, 1.0, alpha * 0.9);
      this.particleSystem.colorDead = new Color4(1.0, 1.0, 1.0, 0);
    } else {
      // Rain: light blue/white
      this.particleSystem.color1 = new Color4(0.7, 0.8, 1.0, alpha);
      this.particleSystem.color2 = new Color4(0.8, 0.9, 1.0, alpha * 0.8);
      this.particleSystem.colorDead = new Color4(0.7, 0.8, 1.0, 0);
    }

    // Blend mode
    this.particleSystem.blendMode = ParticleSystem.BLENDMODE_ADD;

    // Update speed (how fast particles update)
    this.particleSystem.updateSpeed = 0.01;
  }

  /**
   * Create a simple rain drop texture procedurally
   */
  private createRainTexture(): Texture {
    // Create a simple white gradient texture for rain drops
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Create vertical gradient (bright center, fading edges)
    const gradient = ctx.createLinearGradient(size / 2, 0, size / 2, size);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.8)");
    gradient.addColorStop(0.5, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.8)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Create texture from canvas
    const texture = new Texture(canvas.toDataURL(), this.scene, false, false);
    texture.hasAlpha = true;
    return texture;
  }

  /**
   * Create a snowflake texture procedurally
   */
  private createSnowTexture(): Texture {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Create radial gradient for soft round snowflake
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.9)");
    gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.3)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new Texture(canvas.toDataURL(), this.scene, false, false);
    texture.hasAlpha = true;
    return texture;
  }

  /**
   * Check if precipitation is currently active
   */
  public isActive_(): boolean {
    return this.isActive;
  }

  /**
   * Check if rain is currently active
   */
  public isRaining(): boolean {
    return this.isActive && this.currentType === "rain";
  }

  /**
   * Check if snow is currently active
   */
  public isSnowing(): boolean {
    return this.isActive && this.currentType === "snow";
  }

  /** Where the running precipitation simulates, or null when stopped. */
  public getSimulationBackend(): "gpu" | "cpu" | null {
    if (!this.particleSystem) return null;
    return this.particleSystem instanceof GPUParticleSystem ? "gpu" : "cpu";
  }

  /** The running particle system, for renderer QA fixtures. */
  public getParticleSystem(): ParticleSystem | GPUParticleSystem | null {
    return this.particleSystem;
  }

  /**
   * Get current precipitation type
   */
  public getType(): PrecipitationType | null {
    return this.isActive ? this.currentType : null;
  }

  /**
   * Get current settings
   */
  public getSettings(): Readonly<RainSettings> {
    return this.settings;
  }

  /**
   * Set rain intensity (0-1)
   */
  public setIntensity(intensity: number): void {
    this.updateSettings({ intensity: Math.max(0, Math.min(1, intensity)) });
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.stop(true);
    if (this.particleSystem) {
      this.particleSystem.dispose();
      this.particleSystem = null;
    }
    if (this.emitter) {
      this.emitter.dispose();
      this.emitter = null;
    }
  }
}
