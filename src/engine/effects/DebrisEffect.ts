/**
 * DebrisEffect - Wind-driven particle debris system
 * 
 * Creates flying debris particles that respond to the global WindSystem:
 * - Leaves (autumn colors, tumbling motion)
 * - Trash/paper (white/gray, fluttering)
 * - Dust (small particles, swirling)
 * 
 * Optimized for mobile/isometric view with configurable density.
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
import { WindSystem, WindState } from "./WindSystem";

export type DebrisType = 'leaves' | 'trash' | 'dust' | 'mixed';

export interface DebrisSettings {
  type: DebrisType;
  density: number;         // Particle count multiplier (0-1)
  size: number;            // Base particle size
  height: number;          // Height range for debris
  spread: number;          // Horizontal spread area
  windInfluence: number;   // How much wind affects particles (0-1)
  turbulence: number;      // Random motion amount (0-1)
  opacity: number;         // Particle opacity (0-1)
}

const DEFAULT_DEBRIS_SETTINGS: DebrisSettings = {
  type: 'leaves',
  density: 0.5,
  size: 1.5,
  height: 15,
  spread: 150,
  windInfluence: 0.8,
  turbulence: 0.4,
  opacity: 0.9,
};

const LEAVES_COLORS = [
  new Color4(0.8, 0.5, 0.2, 1),   // Orange
  new Color4(0.7, 0.3, 0.1, 1),   // Brown
  new Color4(0.9, 0.7, 0.2, 1),   // Yellow
  new Color4(0.6, 0.2, 0.1, 1),   // Dark red
  new Color4(0.4, 0.5, 0.2, 1),   // Green-brown
];

const TRASH_COLORS = [
  new Color4(0.9, 0.9, 0.9, 1),   // White paper
  new Color4(0.7, 0.7, 0.7, 1),   // Gray
  new Color4(0.8, 0.75, 0.7, 1), // Tan/cardboard
];

const DUST_COLORS = [
  new Color4(0.7, 0.65, 0.55, 1), // Tan dust
  new Color4(0.6, 0.55, 0.5, 1),  // Brown dust
];

export class DebrisEffect {
  private scene: Scene;
  private particleSystem: ParticleSystem | null = null;
  private emitter: AbstractMesh | null = null;
  private settings: DebrisSettings = { ...DEFAULT_DEBRIS_SETTINGS };
  private isActive: boolean = false;
  private renderObserver: Observer<Scene> | null = null;
  private windListener: ((state: WindState) => void) | null = null;
  private currentWindState: WindState | null = null;
  
  // Emit area follows camera
  private emitWidth: number = 150;
  
  constructor(scene: Scene) {
    this.scene = scene;
  }
  
  /**
   * Start debris effect with leaves
   */
  public startLeaves(settings?: Partial<DebrisSettings>): void {
    this.start({ ...settings, type: 'leaves' });
  }
  
  /**
   * Start debris effect with trash/paper
   */
  public startTrash(settings?: Partial<DebrisSettings>): void {
    this.start({ ...settings, type: 'trash' });
  }
  
  /**
   * Start debris effect with dust particles
   */
  public startDust(settings?: Partial<DebrisSettings>): void {
    this.start({ ...settings, type: 'dust', size: 0.5, opacity: 0.6 });
  }
  
  /**
   * Start mixed debris (leaves + trash + dust)
   */
  public startMixed(settings?: Partial<DebrisSettings>): void {
    this.start({ ...settings, type: 'mixed' });
  }
  
  /**
   * Start the debris effect
   */
  public start(settings?: Partial<DebrisSettings>): void {
    if (this.isActive) {
      this.updateSettings(settings || {});
      return;
    }
    
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }
    
    // Subscribe to wind system
    this.subscribeToWind();
    
    // Create particle system
    this.createParticleSystem();
    
    this.isActive = true;
    console.log(`[DebrisEffect] Started ${this.settings.type} debris`);
  }
  
  /**
   * Stop the debris effect
   */
  public stop(immediate: boolean = false): void {
    if (!this.isActive) return;
    
    // Unsubscribe from wind
    this.unsubscribeFromWind();
    
    // Remove render observer
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    
    if (this.particleSystem) {
      this.particleSystem.stop();
      
      if (immediate) {
        this.particleSystem.dispose();
        this.particleSystem = null;
        this.emitter?.dispose();
        this.emitter = null;
      } else {
        // Let particles fade out
        setTimeout(() => {
          this.particleSystem?.dispose();
          this.particleSystem = null;
          this.emitter?.dispose();
          this.emitter = null;
        }, 3000);
      }
    }
    
    this.isActive = false;
    console.log("[DebrisEffect] Stopped");
  }
  
  /**
   * Subscribe to WindSystem updates
   */
  private subscribeToWind(): void {
    if (!WindSystem.hasInstance()) {
      console.warn("[DebrisEffect] WindSystem not initialized - debris won't respond to wind");
      return;
    }
    
    const windSystem = WindSystem.getInstance();
    this.windListener = (state: WindState) => {
      this.currentWindState = state;
      this.applyWindToParticles();
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
   * Update settings while running
   */
  public updateSettings(settings: Partial<DebrisSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (this.particleSystem) {
      this.applySettings();
    }
  }
  
  /**
   * Create the particle system
   */
  private createParticleSystem(): void {
    // Create invisible emitter that follows camera
    this.emitter = MeshBuilder.CreateBox("debrisEmitter", { size: 1 }, this.scene);
    this.emitter.isVisible = false;
    
    this.updateEmitterPosition();
    
    // Calculate capacity based on density
    const capacity = Math.floor(300 * this.settings.density);
    this.particleSystem = new ParticleSystem("debris", capacity, this.scene);
    
    // Create texture based on type
    this.particleSystem.particleTexture = this.createDebrisTexture();
    
    // Emitter configuration
    this.particleSystem.emitter = this.emitter;
    this.updateEmitBox();
    
    // Apply all settings
    this.applySettings();
    
    // Register render observer
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.updateEmitterPosition();
    });
    
    this.particleSystem.start();
  }
  
  /**
   * Update emitter position to follow camera
   */
  private updateEmitterPosition(): void {
    if (!this.emitter || !this.scene.activeCamera) return;
    
    const camera = this.scene.activeCamera;
    let targetPos: Vector3;
    
    if ('target' in camera && camera.target instanceof Vector3) {
      targetPos = camera.target;
    } else {
      targetPos = camera.position;
    }
    
    // Position emitter at camera target, offset by wind direction
    const windOffset = this.currentWindState 
      ? this.currentWindState.direction.scale(-this.emitWidth * 0.3)
      : Vector3.Zero();
    
    this.emitter.position.x = targetPos.x + windOffset.x;
    this.emitter.position.y = targetPos.y + this.settings.height * 0.5;
    this.emitter.position.z = targetPos.z + windOffset.z;
  }
  
  /**
   * Update emit box dimensions
   */
  private updateEmitBox(): void {
    if (!this.particleSystem) return;
    
    const spread = this.settings.spread;
    const height = this.settings.height;
    
    this.particleSystem.minEmitBox = new Vector3(-spread / 2, -height / 2, -spread / 2);
    this.particleSystem.maxEmitBox = new Vector3(spread / 2, height / 2, spread / 2);
  }
  
  /**
   * Apply current settings to particle system
   */
  private applySettings(): void {
    if (!this.particleSystem) return;
    
    const s = this.settings;
    const isDust = s.type === 'dust';
    
    // Emission rate
    this.particleSystem.emitRate = Math.floor(50 * s.density);
    
    // Lifetime - debris floats around longer
    this.particleSystem.minLifeTime = 4;
    this.particleSystem.maxLifeTime = 8;
    
    // Size
    const baseSize = s.size;
    if (isDust) {
      this.particleSystem.minSize = baseSize * 0.3;
      this.particleSystem.maxSize = baseSize * 0.6;
    } else {
      this.particleSystem.minSize = baseSize * 0.6;
      this.particleSystem.maxSize = baseSize * 1.4;
    }
    
    // Rotation for tumbling effect
    this.particleSystem.minAngularSpeed = -3;
    this.particleSystem.maxAngularSpeed = 3;
    
    // Initial direction - mostly horizontal with some vertical
    this.particleSystem.direction1 = new Vector3(-2, -1, -2);
    this.particleSystem.direction2 = new Vector3(2, 1, 2);
    
    // Gravity - slight downward pull
    this.particleSystem.gravity = new Vector3(0, -2, 0);
    
    // Colors based on type
    this.applyColors();
    
    // Blend mode
    this.particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    
    // Apply wind if available
    this.applyWindToParticles();
  }
  
  /**
   * Apply colors based on debris type
   */
  private applyColors(): void {
    if (!this.particleSystem) return;
    
    const alpha = this.settings.opacity;
    let colors: Color4[];
    
    switch (this.settings.type) {
      case 'leaves':
        colors = LEAVES_COLORS;
        break;
      case 'trash':
        colors = TRASH_COLORS;
        break;
      case 'dust':
        colors = DUST_COLORS;
        break;
      case 'mixed':
        colors = [...LEAVES_COLORS, ...TRASH_COLORS];
        break;
      default:
        colors = LEAVES_COLORS;
    }
    
    // Pick two random colors for gradient
    const c1 = colors[Math.floor(Math.random() * colors.length)];
    const c2 = colors[Math.floor(Math.random() * colors.length)];
    
    this.particleSystem.color1 = new Color4(c1.r, c1.g, c1.b, alpha);
    this.particleSystem.color2 = new Color4(c2.r, c2.g, c2.b, alpha);
    this.particleSystem.colorDead = new Color4(c1.r, c1.g, c1.b, 0);
  }
  
  /**
   * Apply wind state to particle directions
   */
  private applyWindToParticles(): void {
    if (!this.particleSystem || !this.currentWindState) return;
    
    const wind = this.currentWindState;
    const influence = this.settings.windInfluence;
    const turbulence = this.settings.turbulence;
    
    // Calculate wind force
    const windForce = wind.strength * influence * 30;
    const windX = wind.direction.x * windForce;
    const windZ = wind.direction.z * windForce;
    
    // Add turbulence
    const turbX = turbulence * 5;
    const turbZ = turbulence * 5;
    const turbY = turbulence * 3;
    
    // Update particle directions
    this.particleSystem.direction1 = new Vector3(
      windX - turbX,
      -turbY,
      windZ - turbZ
    );
    this.particleSystem.direction2 = new Vector3(
      windX + turbX,
      turbY,
      windZ + turbZ
    );
    
    // Update gravity with wind influence
    this.particleSystem.gravity = new Vector3(
      windX * 0.3,
      -2 + wind.gustStrength * 2,  // Gusts lift particles
      windZ * 0.3
    );
    
    // Adjust emission rate based on wind strength
    const baseRate = 50 * this.settings.density;
    this.particleSystem.emitRate = Math.floor(baseRate * (0.5 + wind.strength * 0.5));
  }
  
  /**
   * Create debris texture procedurally
   */
  private createDebrisTexture(): Texture {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    
    // Clear
    ctx.clearRect(0, 0, size, size);
    
    switch (this.settings.type) {
      case 'leaves':
        this.drawLeafShape(ctx, size);
        break;
      case 'trash':
        this.drawTrashShape(ctx, size);
        break;
      case 'dust':
        this.drawDustShape(ctx, size);
        break;
      case 'mixed':
        // Random shape
        const shapes = [this.drawLeafShape, this.drawTrashShape, this.drawDustShape];
        shapes[Math.floor(Math.random() * shapes.length)].call(this, ctx, size);
        break;
    }
    
    const texture = new Texture(canvas.toDataURL(), this.scene, false, false);
    texture.hasAlpha = true;
    return texture;
  }
  
  /**
   * Draw a leaf-like shape
   */
  private drawLeafShape(ctx: CanvasRenderingContext2D, size: number): void {
    const cx = size / 2;
    const cy = size / 2;
    
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.4, size * 0.25, Math.PI * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    
    // Add slight gradient for depth
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.4);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.8)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.3)");
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  
  /**
   * Draw a paper/trash-like shape
   */
  private drawTrashShape(ctx: CanvasRenderingContext2D, size: number): void {
    const margin = size * 0.15;
    
    // Irregular rectangle
    ctx.beginPath();
    ctx.moveTo(margin, margin + Math.random() * 3);
    ctx.lineTo(size - margin, margin);
    ctx.lineTo(size - margin - Math.random() * 3, size - margin);
    ctx.lineTo(margin, size - margin - Math.random() * 2);
    ctx.closePath();
    
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.7)");
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  
  /**
   * Draw a dust particle shape
   */
  private drawDustShape(ctx: CanvasRenderingContext2D, size: number): void {
    const cx = size / 2;
    const cy = size / 2;
    
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.6)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  
  /**
   * Check if debris is active
   */
  public isDebrisActive(): boolean {
    return this.isActive;
  }
  
  /**
   * Get current debris type
   */
  public getType(): DebrisType | null {
    return this.isActive ? this.settings.type : null;
  }
  
  /**
   * Get current settings
   */
  public getSettings(): Readonly<DebrisSettings> {
    return this.settings;
  }
  
  /**
   * Set debris density (0-1)
   */
  public setDensity(density: number): void {
    this.updateSettings({ density: Math.max(0, Math.min(1, density)) });
  }
  
  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.stop(true);
  }
}
