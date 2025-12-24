/**
 * RainEffect - Particle-based rain system
 * 
 * Creates rain drops that fall from above the camera down to the ground.
 * Uses Babylon.js ParticleSystem for efficient GPU-accelerated rendering.
 */

import {
  Scene,
  ParticleSystem,
  Texture,
  Vector3,
  Color4,
  AbstractMesh,
  MeshBuilder,
  Observer,
} from "babylonjs";

export interface RainSettings {
  intensity: number;      // 0-1, affects particle count
  speed: number;          // Fall speed multiplier
  windAngle: number;      // Wind direction in radians (0 = no wind)
  windStrength: number;   // How much wind affects rain (0-1)
  dropSize: number;       // Size of rain drops
  opacity: number;        // Rain visibility (0-1)
}

const DEFAULT_RAIN_SETTINGS: RainSettings = {
  intensity: 0.5,
  speed: 9.0,         // Tuned for natural look
  windAngle: 0,
  windStrength: 0,
  dropSize: 1.5,
  opacity: 0.7,
};

export class RainEffect {
  private scene: Scene;
  private particleSystem: ParticleSystem | null = null;
  private emitter: AbstractMesh | null = null;
  private settings: RainSettings = { ...DEFAULT_RAIN_SETTINGS };
  private isActive: boolean = false;
  private renderObserver: Observer<Scene> | null = null;
  
  // Rain area dimensions - dynamically calculated based on camera view
  private emitWidth: number = 200;
  private emitDepth: number = 200;
  private readonly EMIT_HEIGHT = 100;  // Height above camera target where rain spawns
  private readonly COVERAGE = 0.9;     // Cover 90% of visible area

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Start the rain effect
   */
  public start(settings?: Partial<RainSettings>): void {
    if (this.isActive) {
      this.updateSettings(settings || {});
      return;
    }

    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }

    this.createParticleSystem();
    this.isActive = true;
    console.log("[RainEffect] Started with intensity:", this.settings.intensity);
  }

  /**
   * Stop the rain effect
   */
  public stop(): void {
    if (!this.isActive) return;

    // Remove render observer
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    if (this.particleSystem) {
      this.particleSystem.stop();
      // Let existing particles finish falling
      setTimeout(() => {
        this.particleSystem?.dispose();
        this.particleSystem = null;
        this.emitter?.dispose();
        this.emitter = null;
      }, 3000);
    }

    this.isActive = false;
    console.log("[RainEffect] Stopped");
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
   * Create the particle system for rain
   */
  private createParticleSystem(): void {
    // Create invisible emitter mesh that will follow camera
    this.emitter = MeshBuilder.CreateBox("rainEmitter", { size: 1 }, this.scene);
    this.emitter.isVisible = false;
    
    // Initial position at camera target
    this.updateEmitterPosition();

    // Create particle system
    const capacity = Math.floor(2000 * this.settings.intensity);
    this.particleSystem = new ParticleSystem("rain", capacity, this.scene);

    // Use a simple texture or procedural
    // For rain, we'll use a stretched white texture
    this.particleSystem.particleTexture = this.createRainTexture();

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
    if ('target' in camera && camera.target instanceof Vector3) {
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
    
    if ('orthoTop' in camera && camera.orthoTop !== null) {
      // Orthographic camera - use ortho bounds directly
      const orthoHeight = (camera.orthoTop as number) - (camera.orthoBottom as number);
      const orthoWidth = (camera.orthoRight as number) - (camera.orthoLeft as number);
      groundWidth = orthoWidth * this.COVERAGE;
      groundDepth = orthoHeight * this.COVERAGE;
    } else if ('radius' in camera) {
      // ArcRotateCamera - estimate based on radius and viewport
      const radius = (camera as any).radius as number;
      const fov = (camera as any).fov || 0.8;
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
    
    this.particleSystem.minEmitBox = new Vector3(
      -this.emitWidth / 2,
      0,
      -this.emitDepth / 2
    );
    this.particleSystem.maxEmitBox = new Vector3(
      this.emitWidth / 2,
      0,
      this.emitDepth / 2
    );
  }

  /**
   * Apply current settings to particle system
   */
  private applySettings(): void {
    if (!this.particleSystem) return;

    const s = this.settings;
    const baseSpeed = 80 * s.speed;

    // Emission rate based on intensity
    this.particleSystem.emitRate = Math.floor(500 * s.intensity);

    // Particle lifetime (time to fall from emit height to ground)
    const fallDistance = this.EMIT_HEIGHT;
    const lifetime = fallDistance / baseSpeed;
    this.particleSystem.minLifeTime = lifetime * 0.9;
    this.particleSystem.maxLifeTime = lifetime * 1.1;

    // Size - rain drops scaled for isometric view
    this.particleSystem.minSize = s.dropSize * 0.8;
    this.particleSystem.maxSize = s.dropSize * 1.2;
    
    // Scale to make drops look elongated (stretched by speed)
    this.particleSystem.minScaleX = 0.3;
    this.particleSystem.maxScaleX = 0.5;
    this.particleSystem.minScaleY = 3.0;
    this.particleSystem.maxScaleY = 5.0;

    // Direction - mostly down with optional wind
    const windX = Math.sin(s.windAngle) * s.windStrength * 20;
    const windZ = Math.cos(s.windAngle) * s.windStrength * 20;
    
    this.particleSystem.direction1 = new Vector3(windX - 2, -baseSpeed, windZ - 2);
    this.particleSystem.direction2 = new Vector3(windX + 2, -baseSpeed, windZ + 2);

    // No gravity needed - direction handles the fall
    this.particleSystem.gravity = new Vector3(0, 0, 0);

    // Color - light blue/white with transparency
    const alpha = s.opacity;
    this.particleSystem.color1 = new Color4(0.7, 0.8, 1.0, alpha);
    this.particleSystem.color2 = new Color4(0.8, 0.9, 1.0, alpha * 0.8);
    this.particleSystem.colorDead = new Color4(0.7, 0.8, 1.0, 0);

    // Blend mode for rain
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
   * Check if rain is currently active
   */
  public isRaining(): boolean {
    return this.isActive;
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
    this.stop();
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
