/**
 * ExplosionEffect - Procedural cartoon explosion
 *
 * Creates a layered explosion effect entirely in Babylon.js:
 * 1. Spiky fireball mesh (deformed icosphere)
 * 2. Radial rays (stretched cones shooting outward)
 * 3. Shockwave ring (expanding torus)
 * 4. Particle sparks
 * 5. Flash light
 *
 * No external textures needed — fully procedural.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { getPointLightPool } from "./PointLightPool";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ExplosionConfig {
  /** Overall scale multiplier (1.0 = rocket-sized) */
  scale: number;
  /** Duration multiplier (1.0 = ~400ms total) */
  speed: number;
  /** Core color (inner fireball) */
  coreColor: Color3;
  /** Outer color (flame edges) */
  outerColor: Color3;
  /** Smoke color */
  smokeColor: Color3;
  /** Splash damage radius in game units — shockwave expands to this */
  splashRadius: number;
  /** Whether to show the expanding shockwave disc (default: true) */
  showShockwave?: boolean;
  /** Camera shake intensity multiplier (default: 1.0, 0 = no shake) */
  shakeIntensity?: number;
  /** Max distance for camera shake in game units (default: 720) */
  shakeMaxRange?: number;
}

/** Preset for rocket explosions */
export const ROCKET_EXPLOSION: ExplosionConfig = {
  scale: 13.0,
  speed: 0.85,
  coreColor: new Color3(1.0, 0.95, 0.6), // white-hot center
  outerColor: new Color3(1.0, 0.4, 0.05), // deep orange flames
  smokeColor: new Color3(0.3, 0.25, 0.2), // dark smoke
  splashRadius: 125,
  shakeMaxRange: 540, // 25% reduced from 720
};

/** Preset for grenade explosions */
export const GRENADE_EXPLOSION: ExplosionConfig = {
  scale: 9.0,
  speed: 0.95,
  coreColor: new Color3(1.0, 0.9, 0.5), // warm white-yellow core
  outerColor: new Color3(1.0, 0.5, 0.1), // orange flames
  smokeColor: new Color3(0.3, 0.25, 0.2), // dark smoke
  splashRadius: 125,
  shakeMaxRange: 540, // 25% reduced from 720
};

/** Preset for plasma explosions — small, fast, green */
export const PLASMA_EXPLOSION: ExplosionConfig = {
  scale: 3.0,
  speed: 1.5, // fast pop
  coreColor: new Color3(0.8, 1.0, 0.6), // bright white-green core
  outerColor: new Color3(0.1, 0.9, 0.2), // vivid green outer
  smokeColor: new Color3(0.1, 0.2, 0.1), // green-tinted smoke
  splashRadius: 40,
  showShockwave: false, // no shockwave ring for plasma
  shakeIntensity: 0.15, // minimal camera shake
  shakeMaxRange: 360, // half of default (close range only)
};

/** Preset for blade blast explosions — 50% of rocket, red-themed */
export const BLADE_EXPLOSION: ExplosionConfig = {
  scale: 6.5, // 50% of rocket (13)
  speed: 1.1, // slightly faster than rocket
  coreColor: new Color3(1.0, 0.8, 0.5), // white-hot center
  outerColor: new Color3(1.0, 0.15, 0.05), // deep red flames
  smokeColor: new Color3(0.3, 0.1, 0.1), // dark red-tinted smoke
  splashRadius: 90, // matches blade_blast def
  shakeIntensity: 0.5, // 50% of rocket shake
  shakeMaxRange: 270, // 50% of rocket range (540)
};

// ═══════════════════════════════════════════════════════════════════
// ACTIVE EXPLOSION TRACKING
// ═══════════════════════════════════════════════════════════════════

interface ActiveExplosion {
  id: string;
  config: ExplosionConfig;
  position: Vector3;
  normal: Vector3;
  spawnTime: number;

  // Layer meshes
  fireball: Mesh;
  fireballMat: StandardMaterial;
  fireballOrigPositions: Float32Array; // Original deformed vertex positions

  rays: { mesh: Mesh; mat: StandardMaterial; direction: Vector3 }[];

  shockwave: Mesh;
  shockwaveMat: StandardMaterial;

  light: PointLight | null;

  particles: ParticleSystem;

  // Layer 6: Directional sparks
  sparks: ParticleSystem;

  // Layer 7: Debris particles
  debris: ParticleSystem;
}

// ═══════════════════════════════════════════════════════════════════
// EXPLOSION EFFECT MANAGER
// ═══════════════════════════════════════════════════════════════════

export class ExplosionEffect {
  private static instance: ExplosionEffect;
  private scene: Scene | null = null;
  private explosions: ActiveExplosion[] = [];
  private nextId = 0;

  // Procedural particle texture (generated once)
  private particleTexture: Texture | null = null;

  private constructor() {}

  static getInstance(): ExplosionEffect {
    if (!ExplosionEffect.instance) {
      ExplosionEffect.instance = new ExplosionEffect();
    }
    return ExplosionEffect.instance;
  }

  init(scene: Scene): void {
    this.scene = scene;
    this.particleTexture = this.createParticleTexture(scene);
    console.log("[ExplosionEffect] Initialized");
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Spawn an explosion at the given position
   * @param normal - surface hit normal, used to orient the shockwave ring
   */
  spawn(position: Vector3, config: ExplosionConfig = ROCKET_EXPLOSION, normal: Vector3 = Vector3.Up()): void {
    if (!this.scene) return;

    const id = `explosion_${this.nextId++}`;
    const now = performance.now() / 1000;
    const s = config.scale;

    // ─── Layer 1: Spiky Fireball ───────────────────────────
    const { mesh: fireball, material: fireballMat, origPositions } = this.createFireball(id, position, s, config);

    // ─── Layer 2: Radial Rays ──────────────────────────────
    const rays = this.createRays(id, position, s, config);

    // ─── Layer 3: Shockwave Ring (skip for some weapons) ──
    const showShockwave = config.showShockwave !== false;
    const { mesh: shockwave, material: shockwaveMat } = showShockwave
      ? this.createShockwave(id, position, s, config, normal)
      : this.createDummyShockwave(id);

    // ─── Layer 4: Particle Sparks ──────────────────────────
    const particles = this.createParticles(id, position, s, config);

    // ─── Layer 5: Flash Light ──────────────────────────────
    const light = getPointLightPool().acquire(position.clone(), config.outerColor.clone(), 5 * s, 40 * s);

    // ─── Layer 6 & 7: Directional Sparks & Debris (REMOVED) ──
    // These didn't look good and had a first-hit-only rendering bug.
    // Keep empty ParticleSystems to satisfy ActiveExplosion interface cleanup.
    const sparks = new ParticleSystem(`${id}_sparks_noop`, 0, this.scene);
    const debris = new ParticleSystem(`${id}_debris_noop`, 0, this.scene);

    this.explosions.push({
      id,
      config,
      position: position.clone(),
      normal: normal.clone(),
      spawnTime: now,
      fireball,
      fireballMat,
      fireballOrigPositions: origPositions,
      rays,
      shockwave,
      shockwaveMat,
      light,
      particles,
      sparks,
      debris,
    });

    // ─── Camera Shake (distance-based) ──────────────────────
    this.triggerCameraShake(position, config);
  }

  /**
   * Trigger distance-based camera shake from an explosion
   * Uses the splash radius to determine falloff range
   */
  private triggerCameraShake(explosionPos: Vector3, config: ExplosionConfig): void {
    // Use CameraSystem to get the active FPS controller's position (authoritative)
    import("../camera/CameraSystem")
      .then(({ CameraSystem }) => {
        const controller = CameraSystem.getInstance().getController("fps");
        if (!controller || !("shakeCamera" in controller)) return;

        const fpsCtrl = controller as any;
        const playerPos: Vector3 = fpsCtrl.getPlayerPosition();
        const distance = Vector3.Distance(explosionPos, playerPos);

        // Shake range: tuned for Q3/Warsow game unit distances
        const maxShakeRange = config.shakeMaxRange ?? 720;
        const fullShakeRange = maxShakeRange * 0.42; // ~42% of max = full intensity zone

        if (distance >= maxShakeRange) return;

        // Intensity: full within fullShakeRange, then smooth falloff to maxShakeRange
        let intensity: number;
        if (distance <= fullShakeRange) {
          intensity = 1.0;
        } else {
          const t = (distance - fullShakeRange) / (maxShakeRange - fullShakeRange);
          intensity = (1.0 - t) ** 2; // Quadratic falloff
        }

        // Scale by explosion size (rockets shake more than grenades)
        const sizeMultiplier = Math.min(config.scale / 10, 1.5);
        const shakeScale = config.shakeIntensity ?? 1.0;
        const finalIntensity = intensity * sizeMultiplier * shakeScale;

        if (finalIntensity < 0.01) return;

        fpsCtrl.shakeCamera(finalIntensity);
      })
      .catch(() => {
        /* CameraSystem unavailable */
      });
  }

  /**
   * Update all active explosions (call each frame)
   */
  update(_deltaTime: number): void {
    const now = performance.now() / 1000;
    const toRemove: string[] = [];

    for (const exp of this.explosions) {
      const age = (now - exp.spawnTime) * exp.config.speed;
      const totalDuration = 0.9; // ~900ms — cartoonish pace

      if (age >= totalDuration) {
        toRemove.push(exp.id);
        continue;
      }

      // Fireball/rays/shockwave/light use the first ~600ms
      const fireT = Math.min(age / 0.6, 1.0);

      this.updateFireball(exp, fireT);
      this.updateRays(exp, fireT);
      this.updateShockwave(exp, fireT);
      this.updateLight(exp, fireT);
    }

    for (const id of toRemove) {
      this.dispose(id);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER CREATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Layer 1: Spiky fireball — deformed icosphere
   */
  private createFireball(id: string, pos: Vector3, scale: number, config: ExplosionConfig) {
    const mesh = MeshBuilder.CreateIcoSphere(
      `${id}_fireball`,
      {
        radius: 2.5 * scale,
        subdivisions: 3,
        flat: true, // Flat shading for that faceted cartoon look
      },
      this.scene!,
    );

    mesh.position = pos.clone();
    mesh.isPickable = false;

    // Deform vertices to create spiky look
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) {
      const mat = new StandardMaterial(`${id}_fireballMat`, this.scene!);
      return { mesh, material: mat, origPositions: new Float32Array(0) };
    }

    const deformed = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];

      // Distance from center
      const dist = Math.sqrt(x * x + y * y + z * z);
      if (dist === 0) continue;

      // Normalize direction
      const nx = x / dist;
      const ny = y / dist;
      const nz = z / dist;

      // Random spike displacement (seeded by vertex angle for consistency)
      const angle1 = Math.atan2(ny, nx);
      const angle2 = Math.acos(nz / (dist || 1));
      const noise = 0.5 + 0.5 * Math.sin(angle1 * 7.3 + angle2 * 5.1) * Math.cos(angle1 * 3.7 - angle2 * 8.9);
      const spike = 1.0 + noise * 0.8; // Range: 1.0 → 1.8

      deformed[i] = nx * dist * spike;
      deformed[i + 1] = ny * dist * spike;
      deformed[i + 2] = nz * dist * spike;
    }

    mesh.setVerticesData(VertexBuffer.PositionKind, deformed);

    // Store original deformed positions for animation
    const origPositions = new Float32Array(deformed);

    // Material: emissive, no lighting
    const mat = new StandardMaterial(`${id}_fireballMat`, this.scene!);
    mat.emissiveColor = config.coreColor.clone();
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.9;
    mat.maxSimultaneousLights = 4;
    mesh.material = mat;

    // Start small, will animate up
    mesh.scaling.setAll(0.1);

    return { mesh, material: mat, origPositions };
  }

  /**
   * Layer 2: Radial rays — stretched cones shooting outward
   */
  private createRays(id: string, pos: Vector3, scale: number, config: ExplosionConfig) {
    const rays: ActiveExplosion["rays"] = [];
    const rayCount = 8 + Math.floor(Math.random() * 5); // 8-12 rays

    for (let i = 0; i < rayCount; i++) {
      // Random direction on a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dir = new Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));

      // Create stretched cone (thin and long)
      const length = (2 + Math.random() * 3) * scale;
      const mesh = MeshBuilder.CreateCylinder(
        `${id}_ray_${i}`,
        {
          height: length,
          diameterTop: 0,
          diameterBottom: (0.3 + Math.random() * 0.3) * scale,
          tessellation: 6,
        },
        this.scene!,
      );

      mesh.position = pos.clone();
      mesh.isPickable = false;

      // Orient cone along direction
      const up = Vector3.Up();
      const dot = Vector3.Dot(up, dir);
      if (Math.abs(dot) < 0.999) {
        mesh.lookAt(pos.add(dir));
        mesh.rotation.x += Math.PI / 2; // Cone points along +Y by default
      }

      // Material
      const mat = new StandardMaterial(`${id}_rayMat_${i}`, this.scene!);
      // Mix between core and outer color randomly
      const blend = Math.random();
      mat.emissiveColor = Color3.Lerp(config.coreColor, config.outerColor, blend);
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      mat.alpha = 0.8;
      mat.maxSimultaneousLights = 4;
      mesh.material = mat;

      // Start small
      mesh.scaling.setAll(0.1);

      rays.push({ mesh, mat, direction: dir });
    }

    return rays;
  }

  /**
   * Layer 3: Shockwave disc — expanding solid circle
   */
  private createShockwave(
    id: string,
    pos: Vector3,
    scale: number,
    config: ExplosionConfig,
    normal: Vector3 = Vector3.Up(),
  ) {
    const mesh = MeshBuilder.CreateDisc(
      `${id}_shockwave`,
      {
        radius: 0.5 * scale,
        tessellation: 32,
      },
      this.scene!,
    );

    mesh.position = pos.clone();
    mesh.isPickable = false;

    // Orient the ring to align with the hit surface.
    // The torus lies in the XZ plane by default (normal = Y-up).
    // We rotate it so its local Y-axis aligns with the surface normal.
    const up = Vector3.Up();
    const dot = Vector3.Dot(up, normal);
    if (Math.abs(dot) < 0.999) {
      // Build a rotation from Y-up to the surface normal
      const axis = Vector3.Cross(up, normal).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      mesh.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
    }

    const mat = new StandardMaterial(`${id}_shockwaveMat`, this.scene!);
    mat.emissiveColor = config.outerColor.clone();
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.7;
    mat.maxSimultaneousLights = 4;
    mesh.material = mat;

    return { mesh, material: mat };
  }

  /**
   * Create an invisible dummy shockwave mesh (for weapons that skip shockwave)
   */
  private createDummyShockwave(id: string) {
    const mesh = MeshBuilder.CreateDisc(
      `${id}_shockwave_dummy`,
      {
        radius: 0.01,
        tessellation: 4,
      },
      this.scene!,
    );
    mesh.setEnabled(false);
    mesh.isPickable = false;

    const mat = new StandardMaterial(`${id}_shockwaveDummyMat`, this.scene!);
    mat.alpha = 0;
    mesh.material = mat;

    return { mesh, material: mat };
  }

  /**
   * Layer 4: Particle sparks
   */
  private createParticles(id: string, pos: Vector3, scale: number, config: ExplosionConfig): ParticleSystem {
    const ps = new ParticleSystem(`${id}_sparks`, 40, this.scene!);

    // Use procedural texture
    if (this.particleTexture) {
      ps.particleTexture = this.particleTexture;
    }

    ps.emitter = pos.clone();

    // Emission: burst all at once
    ps.emitRate = 0; // Manual burst
    ps.manualEmitCount = Math.floor(30 * scale);

    // Size
    ps.minSize = 0.15 * scale;
    ps.maxSize = 0.4 * scale;

    // Lifetime
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;

    // Speed (outward burst)
    ps.minEmitPower = 15 * scale;
    ps.maxEmitPower = 35 * scale;

    // Direction: sphere emission
    ps.createSphereEmitter(0.5 * scale);

    // Gravity (sparks fall)
    ps.gravity = new Vector3(0, -30, 0);

    // Colors: bright core → outer → fade
    ps.color1 = new Color4(config.coreColor.r, config.coreColor.g, config.coreColor.b, 1.0);
    ps.color2 = new Color4(config.outerColor.r, config.outerColor.g, config.outerColor.b, 1.0);
    ps.colorDead = new Color4(config.smokeColor.r, config.smokeColor.g, config.smokeColor.b, 0.0);

    // Blending
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.start();

    return ps;
  }

  /**
   * Layer 7: Debris particles — chunky pieces thrown outward with gravity
   */
  // @ts-expect-error — kept for potential future use
  private _createDebris(
    id: string,
    pos: Vector3,
    scale: number,
    config: ExplosionConfig,
    normal: Vector3 = Vector3.Up(),
  ): ParticleSystem {
    const ps = new ParticleSystem(`${id}_debris`, 25, this.scene!);

    if (this.particleTexture) {
      ps.particleTexture = this.particleTexture;
    }

    ps.emitter = pos.clone();

    // Burst
    ps.emitRate = 0;
    ps.manualEmitCount = Math.floor(15 * scale);

    // Bigger, chunkier particles
    ps.minSize = 0.4 * scale;
    ps.maxSize = 1.2 * scale;

    // Longer lifetime
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 1.0;

    // Bias along the impact normal
    ps.minEmitPower = 8 * scale;
    ps.maxEmitPower = 20 * scale;

    // Use hemisphere emitter biased along the impact normal
    ps.createHemisphericEmitter(1.0 * scale);
    // Rotate the emitter direction to match the normal
    ps.direction1 = normal.scale(15 * scale).add(new Vector3(-5, -5, -5).scale(scale));
    ps.direction2 = normal.scale(25 * scale).add(new Vector3(5, 5, 5).scale(scale));

    // Heavy gravity for arcing debris
    ps.gravity = new Vector3(0, -60, 0);

    // Size fade: shrink over lifetime
    ps.addSizeGradient(0, 1.0 * scale);
    ps.addSizeGradient(0.5, 0.6 * scale);
    ps.addSizeGradient(1.0, 0.1 * scale);

    // Colors: bright → smoke → gone
    ps.color1 = new Color4(config.outerColor.r, config.outerColor.g, config.outerColor.b, 1.0);
    ps.color2 = new Color4(config.smokeColor.r * 1.5, config.smokeColor.g * 1.5, config.smokeColor.b * 1.5, 0.9);
    ps.colorDead = new Color4(config.smokeColor.r * 0.5, config.smokeColor.g * 0.5, config.smokeColor.b * 0.5, 0.0);

    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    ps.start();

    return ps;
  }

  /**
   * Layer 6: Directional sparks — bright, fast, small particles spraying along the impact normal
   */
  // @ts-expect-error — kept for potential future use
  private _createDirectionalSparks(
    id: string,
    pos: Vector3,
    scale: number,
    _config: ExplosionConfig,
    normal: Vector3,
  ): ParticleSystem {
    const ps = new ParticleSystem(`${id}_sparks`, 40, this.scene!);

    if (this.particleTexture) {
      ps.particleTexture = this.particleTexture;
    }

    ps.emitter = pos.clone();

    // Burst
    ps.emitRate = 0;
    ps.manualEmitCount = Math.floor(20 * scale);

    // Small, bright sparks
    ps.minSize = 0.1 * scale;
    ps.maxSize = 0.35 * scale;

    // Short-lived
    ps.minLifeTime = 0.15;
    ps.maxLifeTime = 0.5;

    // Fast outward along the normal
    ps.minEmitPower = 20 * scale;
    ps.maxEmitPower = 45 * scale;

    // Bias direction strongly along impact normal with some spread
    const spread = 4 * scale;
    ps.direction1 = normal.scale(40 * scale).add(new Vector3(-spread, -spread, -spread));
    ps.direction2 = normal.scale(50 * scale).add(new Vector3(spread, spread, spread));

    ps.createPointEmitter(
      normal.scale(1).add(new Vector3(-0.3, -0.3, -0.3)),
      normal.scale(1).add(new Vector3(0.3, 0.3, 0.3)),
    );

    // Light gravity
    ps.gravity = new Vector3(0, -20, 0);

    // Size: start small, shrink to nothing
    ps.addSizeGradient(0, 0.3 * scale);
    ps.addSizeGradient(1.0, 0.0);

    // Colors: white-hot → orange → gone
    ps.color1 = new Color4(1.0, 0.95, 0.7, 1.0);
    ps.color2 = new Color4(1.0, 0.6, 0.1, 1.0);
    ps.colorDead = new Color4(1.0, 0.3, 0.0, 0.0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.start();

    return ps;
  }

  // ═══════════════════════════════════════════════════════════════
  // ANIMATION UPDATES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fireball: expand, then spread across the hit surface as it fades.
   * Vertices get compressed along the hit normal axis and stretched
   * along the surface plane — fire "slides" across the wall/floor.
   */
  private updateFireball(exp: ActiveExplosion, t: number): void {
    // Scale: expand in sync with the shockwave ring (70% of fire lifetime)
    const expandPhase = Math.min(t / 0.7, 1.0);

    const scaleVal = easeOutQuad(expandPhase);
    exp.fireball.scaling.setAll(scaleVal);

    // Color: 3-stage shift  white-hot → orange → dark red
    // Derive fade color from config (not hardcoded red — plasma fades green)
    const fadeColor = exp.config.outerColor.scale(0.4);
    let emissive: Color3;
    if (t < 0.3) {
      emissive = Color3.Lerp(exp.config.coreColor, exp.config.outerColor, t / 0.3);
    } else if (t < 0.6) {
      emissive = Color3.Lerp(exp.config.outerColor, fadeColor, (t - 0.3) / 0.3);
    } else {
      emissive = Color3.Lerp(fadeColor, exp.config.smokeColor, (t - 0.6) / 0.4);
    }
    exp.fireballMat.emissiveColor = emissive;

    // Alpha: hold, then fade in second half
    exp.fireballMat.alpha = t < 0.4 ? 0.9 : 0.9 * (1.0 - (t - 0.4) / 0.6);

    // Vertex manipulation: spikes + surface spread
    if (exp.fireballOrigPositions.length > 0) {
      const positions = exp.fireball.getVerticesData(VertexBuffer.PositionKind);
      if (positions) {
        const baseR = 2.5 * exp.config.scale;
        const spikeAmp = 1.0 + easeOutQuad(expandPhase) * 1.5;

        // Surface spread (kicks in during fade-out, after t=0.4)
        const fadePhase = t > 0.4 ? (t - 0.4) / 0.6 : 0;
        const spreadAmount = easeOutQuad(fadePhase) * 1.2;
        const n = exp.normal;

        for (let i = 0; i < positions.length; i += 3) {
          const ox = exp.fireballOrigPositions[i];
          const oy = exp.fireballOrigPositions[i + 1];
          const oz = exp.fireballOrigPositions[i + 2];

          const dist = Math.sqrt(ox * ox + oy * oy + oz * oz);
          if (dist === 0) {
            continue;
          }

          const deviation = dist - baseR;
          const newDist = baseR + deviation * spikeAmp;
          const ratio = newDist / dist;

          let vx = ox * ratio;
          let vy = oy * ratio;
          let vz = oz * ratio;

          if (spreadAmount > 0) {
            const dotN = vx * n.x + vy * n.y + vz * n.z;

            const nCompX = dotN * n.x;
            const nCompY = dotN * n.y;
            const nCompZ = dotN * n.z;

            const tCompX = vx - nCompX;
            const tCompY = vy - nCompY;
            const tCompZ = vz - nCompZ;

            const normalCompress = Math.max(0.3, 1.0 - spreadAmount * 0.4);
            const surfaceStretch = 1.0 + spreadAmount * 0.5;

            vx = nCompX * normalCompress + tCompX * surfaceStretch;
            vy = nCompY * normalCompress + tCompY * surfaceStretch;
            vz = nCompZ * normalCompress + tCompZ * surfaceStretch;
          }

          positions[i] = vx;
          positions[i + 1] = vy;
          positions[i + 2] = vz;
        }
        exp.fireball.setVerticesData(VertexBuffer.PositionKind, positions);
      }
    }
  }

  /**
   * Rays: shoot outward from center, fade quickly
   */
  private updateRays(exp: ActiveExplosion, t: number): void {
    for (const ray of exp.rays) {
      // Scale up fast, then hold
      const rayScale = easeOutQuad(Math.min(t / 0.15, 1.0));
      ray.mesh.scaling.setAll(rayScale);

      // Move outward from center
      const outDist = easeOutQuad(Math.min(t / 0.3, 1.0)) * 4 * exp.config.scale;
      ray.mesh.position = exp.position.add(ray.direction.scale(outDist));

      // Fade out after halfway
      ray.mat.alpha = t < 0.25 ? 0.8 : 0.8 * Math.max(0, 1.0 - (t - 0.25) / 0.35);

      // Color shift
      const colorT = Math.min(t * 3, 1.0);
      ray.mat.emissiveColor = Color3.Lerp(exp.config.coreColor, exp.config.outerColor, colorT);
    }
  }

  /**
   * Shockwave: expand to match splashRadius, 50% transparent, thin and fade
   */
  private updateShockwave(exp: ActiveExplosion, t: number): void {
    const ringT = Math.min(t / 0.7, 1.0);
    // Target diameter = splashRadius * 2, torus was created with diameter = 1*scale
    // So expandScale = (splashRadius * 2) / scale
    const targetExpand = (exp.config.splashRadius * 2) / exp.config.scale;
    const expandScale = easeOutQuad(ringT) * targetExpand;

    // Expand outward, thin along normal axis
    exp.shockwave.scaling.set(expandScale, Math.max(0.1, 1.0 - ringT * 0.8), expandScale);

    // Fade from 50% transparent
    exp.shockwaveMat.alpha = 0.5 * (1.0 - ringT);
  }

  /**
   * Flash light: orange glow that fades with the rest of the effect
   */
  private updateLight(exp: ActiveExplosion, t: number): void {
    // Fade over the full effect duration
    if (exp.light) {
      exp.light.intensity = 5 * exp.config.scale * (1.0 - easeInQuad(t));
      exp.light.range = 40 * exp.config.scale * (1.0 - t * 0.5);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════

  private dispose(id: string): void {
    const idx = this.explosions.findIndex((e) => e.id === id);
    if (idx === -1) return;

    const exp = this.explosions[idx];

    exp.fireball.dispose();
    exp.fireballMat.dispose();

    for (const ray of exp.rays) {
      ray.mesh.dispose();
      ray.mat.dispose();
    }

    exp.shockwave.dispose();
    exp.shockwaveMat.dispose();

    getPointLightPool().release(exp.light);

    exp.particles.stop();
    exp.particles.dispose();

    exp.debris.stop();
    exp.debris.dispose();

    exp.sparks.stop();
    exp.sparks.dispose();

    this.explosions.splice(idx, 1);
  }

  /**
   * Clear all active explosions
   */
  clear(): void {
    for (const exp of this.explosions) {
      exp.fireball.dispose();
      exp.fireballMat.dispose();
      for (const ray of exp.rays) {
        ray.mesh.dispose();
        ray.mat.dispose();
      }
      exp.shockwave.dispose();
      exp.shockwaveMat.dispose();
      getPointLightPool().release(exp.light);
      exp.particles.stop();
      exp.particles.dispose();
      exp.debris.stop();
      exp.debris.dispose();
      exp.sparks.stop();
      exp.sparks.dispose();
    }
    this.explosions = [];
  }

  // ═══════════════════════════════════════════════════════════════
  // PROCEDURAL TEXTURE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a soft glowing circle texture procedurally via canvas
   */
  private createParticleTexture(scene: Scene): Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Radial gradient: white center → transparent edge
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.3, "rgba(255, 230, 180, 0.8)");
    gradient.addColorStop(0.7, "rgba(255, 150, 50, 0.3)");
    gradient.addColorStop(1, "rgba(255, 100, 20, 0.0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new Texture(canvas.toDataURL(), scene);
    texture.hasAlpha = true;
    return texture;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EASING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

function easeInQuad(t: number): number {
  return t * t;
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE
// ═══════════════════════════════════════════════════════════════════

export function getExplosionEffect(): ExplosionEffect {
  return ExplosionEffect.getInstance();
}
