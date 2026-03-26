/**
 * LocalDebrisEffect - Position-based debris particle spawner
 *
 * Unlike the global DebrisEffect that follows the camera, this spawns
 * debris in a fixed area defined by map entities (info_debris_zone).
 */

import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { type WindState, WindSystem } from "./WindSystem";

export type LocalDebrisType = "leaves" | "trash" | "dust" | "mixed";

export interface LocalDebrisConfig {
  position: Vector3;
  radius: number;
  height: number;
  type: LocalDebrisType;
  density: number;
  windInfluence: number;
}

const LEAVES_COLORS = [
  new Color4(0.8, 0.5, 0.2, 1), // Orange
  new Color4(0.7, 0.3, 0.1, 1), // Brown
  new Color4(0.9, 0.7, 0.2, 1), // Yellow
  new Color4(0.6, 0.2, 0.1, 1), // Dark red
  new Color4(0.4, 0.5, 0.2, 1), // Green-brown
];

const TRASH_COLORS = [
  new Color4(0.9, 0.9, 0.9, 1), // White paper
  new Color4(0.3, 0.3, 0.3, 1), // Dark wrapper
  new Color4(0.8, 0.7, 0.5, 1), // Cardboard
  new Color4(0.2, 0.5, 0.8, 1), // Blue plastic
];

const DUST_COLORS = [new Color4(0.7, 0.6, 0.5, 0.6), new Color4(0.6, 0.5, 0.4, 0.5), new Color4(0.8, 0.7, 0.6, 0.4)];

export class LocalDebrisEffect {
  private scene: Scene;
  private config: LocalDebrisConfig;
  private particleSystem: ParticleSystem | null = null;
  private emitter: Mesh | null = null;
  private windListener: ((state: WindState) => void) | null = null;
  private currentWindState: WindState | null = null;
  private isActive: boolean = false;
  private id: string;

  constructor(scene: Scene, id: string, config: LocalDebrisConfig) {
    this.scene = scene;
    this.id = id;
    this.config = config;
  }

  public start(): void {
    if (this.isActive) return;

    this.subscribeToWind();
    this.createParticleSystem();
    this.isActive = true;
    console.log(`[LocalDebrisEffect] Started ${this.config.type} debris zone: ${this.id}`);
  }

  public stop(): void {
    if (!this.isActive) return;

    this.unsubscribeFromWind();

    if (this.particleSystem) {
      this.particleSystem.stop();
      this.particleSystem.dispose();
      this.particleSystem = null;
    }

    if (this.emitter) {
      this.emitter.dispose();
      this.emitter = null;
    }

    this.isActive = false;
  }

  public dispose(): void {
    this.stop();
  }

  public isActive_(): boolean {
    return this.isActive;
  }

  private subscribeToWind(): void {
    if (!WindSystem.hasInstance()) return;

    const windSystem = WindSystem.getInstance();
    this.windListener = (state: WindState) => {
      this.currentWindState = state;
      this.applyWindToParticles();
    };
    windSystem.addListener(this.windListener);
  }

  private unsubscribeFromWind(): void {
    if (this.windListener && WindSystem.hasInstance()) {
      WindSystem.getInstance().removeListener(this.windListener);
      this.windListener = null;
    }
  }

  private createParticleSystem(): void {
    const { position, radius, height, type: _type, density } = this.config;

    // Create emitter at zone center
    this.emitter = MeshBuilder.CreateBox(`debrisEmitter_${this.id}`, { size: 1 }, this.scene);
    this.emitter.position = position.clone();
    this.emitter.position.y += height / 2; // Center vertically
    this.emitter.isVisible = false;

    // Capacity based on density and area
    const areaFactor = (radius / 128) * (radius / 128);
    const capacity = Math.floor(150 * density * areaFactor);

    this.particleSystem = new ParticleSystem(`debris_${this.id}`, capacity, this.scene);
    this.particleSystem.particleTexture = this.createDebrisTexture();
    this.particleSystem.emitter = this.emitter;

    // Box emitter covering the zone
    this.particleSystem.createBoxEmitter(
      new Vector3(-1, -0.5, -1), // direction1
      new Vector3(1, 0.5, 1), // direction2
      new Vector3(-radius, -height / 2, -radius), // minEmitBox
      new Vector3(radius, height / 2, radius), // maxEmitBox
    );

    this.applySettings();
    this.particleSystem.start();
  }

  private applySettings(): void {
    if (!this.particleSystem) return;

    const { type, density } = this.config;
    const isDust = type === "dust";

    // Emission rate - sparse for natural look
    this.particleSystem.emitRate = Math.floor(15 * density);

    // Lifetime
    this.particleSystem.minLifeTime = 6;
    this.particleSystem.maxLifeTime = 12;

    // Size
    const baseSize = isDust ? 4 : 8;
    this.particleSystem.minSize = baseSize * 0.6;
    this.particleSystem.maxSize = baseSize * 1.4;

    // Rotation
    this.particleSystem.minAngularSpeed = -2;
    this.particleSystem.maxAngularSpeed = 2;

    // Initial motion - gentle drift
    this.particleSystem.minEmitPower = 1;
    this.particleSystem.maxEmitPower = 3;
    this.particleSystem.updateSpeed = 0.01;

    // Gravity
    this.particleSystem.gravity = new Vector3(0, -3, 0);

    // Colors
    this.applyColors();

    // Blend mode
    this.particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Apply wind if available
    this.applyWindToParticles();
  }

  private applyColors(): void {
    if (!this.particleSystem) return;

    const { type } = this.config;
    let colors: Color4[];

    switch (type) {
      case "leaves":
        colors = LEAVES_COLORS;
        break;
      case "trash":
        colors = TRASH_COLORS;
        break;
      case "dust":
        colors = DUST_COLORS;
        break;
      case "mixed":
        colors = [...LEAVES_COLORS, ...TRASH_COLORS];
        break;
      default:
        colors = LEAVES_COLORS;
    }

    // Pick random colors
    const c1 = colors[Math.floor(Math.random() * colors.length)];
    const c2 = colors[Math.floor(Math.random() * colors.length)];

    // Modulate by scene ambient light
    const ambient = this.scene.ambientColor;
    const lightMult = (ambient.r + ambient.g + ambient.b) / 3 + 0.3;

    this.particleSystem.color1 = new Color4(c1.r * lightMult, c1.g * lightMult, c1.b * lightMult, 0.9);
    this.particleSystem.color2 = new Color4(c2.r * lightMult, c2.g * lightMult, c2.b * lightMult, 0.9);
    this.particleSystem.colorDead = new Color4(c1.r * lightMult, c1.g * lightMult, c1.b * lightMult, 0);
  }

  private applyWindToParticles(): void {
    if (!this.particleSystem) return;

    const { windInfluence, density } = this.config;

    if (!this.currentWindState) {
      this.particleSystem.direction1 = new Vector3(-3, -1, -3);
      this.particleSystem.direction2 = new Vector3(3, 1, 3);
      this.particleSystem.gravity = new Vector3(0, -3, 0);
      this.particleSystem.minEmitPower = 1;
      this.particleSystem.maxEmitPower = 3;
      return;
    }

    const wind = this.currentWindState;
    const windForce = wind.strength * windInfluence * 15;
    const windX = wind.direction.x * windForce;
    const windZ = wind.direction.z * windForce;

    // Turbulence
    const turb = 5;

    this.particleSystem.direction1 = new Vector3(windX - turb, -2, windZ - turb);
    this.particleSystem.direction2 = new Vector3(windX + turb, 2, windZ + turb);

    this.particleSystem.gravity = new Vector3(windX * 0.3, -3 + wind.gustStrength * 1.5, windZ * 0.3);

    this.particleSystem.minEmitPower = 1 + wind.strength * 2;
    this.particleSystem.maxEmitPower = 3 + wind.strength * 4;

    // Adjust rate with wind
    this.particleSystem.emitRate = Math.floor(15 * density * (0.8 + wind.strength * 0.4));
  }

  private createDebrisTexture(): Texture {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, size, size);

    const { type } = this.config;

    if (type === "dust") {
      // Soft circular dust particle
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
      gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.5)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    } else {
      // Leaf/debris shape
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.ellipse(size / 2, size / 2, size / 2 - 2, size / 3 - 1, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new Texture(canvas.toDataURL(), this.scene, false, true);
    texture.hasAlpha = true;
    return texture;
  }

  /**
   * Update lighting for day/night cycle
   */
  public updateLighting(): void {
    if (this.isActive && this.particleSystem) {
      this.applyColors();
    }
  }
}

/**
 * Manager for all local debris zones in a map
 */
export class LocalDebrisManager {
  private static instance: LocalDebrisManager | null = null;
  private zones: Map<string, LocalDebrisEffect> = new Map();
  private scene: Scene | null = null;

  private constructor() {}

  public static getInstance(): LocalDebrisManager {
    if (!LocalDebrisManager.instance) {
      LocalDebrisManager.instance = new LocalDebrisManager();
    }
    return LocalDebrisManager.instance;
  }

  public init(scene: Scene): void {
    this.scene = scene;
  }

  public createZone(id: string, config: LocalDebrisConfig): LocalDebrisEffect | null {
    if (!this.scene) {
      console.warn("[LocalDebrisManager] Not initialized");
      return null;
    }

    // Remove existing zone with same ID
    if (this.zones.has(id)) {
      this.zones.get(id)!.dispose();
    }

    const zone = new LocalDebrisEffect(this.scene, id, config);
    zone.start();
    this.zones.set(id, zone);
    return zone;
  }

  public removeZone(id: string): void {
    const zone = this.zones.get(id);
    if (zone) {
      zone.dispose();
      this.zones.delete(id);
    }
  }

  public clear(): void {
    for (const zone of this.zones.values()) {
      zone.dispose();
    }
    this.zones.clear();
  }

  public updateLighting(): void {
    for (const zone of this.zones.values()) {
      zone.updateLighting();
    }
  }

  public getZoneCount(): number {
    return this.zones.size;
  }
}
