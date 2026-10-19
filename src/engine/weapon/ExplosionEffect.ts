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
import { CreateIcoSphereVertexData } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import { atmFogFactorAt } from "../rendering/AtmosphericFogShader";
import { updateEffectPositions } from "./EffectGeometry";
import { getPointLightPool } from "./PointLightPool";

// Flash gain is independent of the procedural fireball's world-unit size.
const FLASH_LIGHT_GAIN = 0.1;

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

/** Preset for blade blast explosions — 50% of rocket, teal-themed */
export const BLADE_EXPLOSION: ExplosionConfig = {
  scale: 6.5, // 50% of rocket (13)
  speed: 1.1, // slightly faster than rocket
  coreColor: new Color3(0.7, 1.0, 0.95),
  outerColor: new Color3(0.05, 1.0, 0.9),
  smokeColor: new Color3(0.08, 0.2, 0.18),
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

  /** `size` is the ray's base width (X, Z) and length (Y); the animation scales it. */
  rays: { mesh: Mesh; mat: StandardMaterial; direction: Vector3; size: Vector3 }[];

  shockwave: Mesh | null;
  shockwaveMat: StandardMaterial | null;

  light: PointLight | null;

  particles: ParticleSystem;
}

// ═══════════════════════════════════════════════════════════════════
// EXPLOSION EFFECT MANAGER
// ═══════════════════════════════════════════════════════════════════

export class ExplosionEffect {
  private static instance: ExplosionEffect;
  private scene: Scene | null = null;
  private explosions: ActiveExplosion[] = [];
  private nextId = 0;
  /** Idle materials only; active explosions never have their materials stolen. */
  private readonly rayMaterials: StandardMaterial[] = [];
  private rayPoolScene: Scene | null = null;
  private rayPoolObserver: Observer<Scene> | null = null;
  private static readonly MAX_IDLE_RAY_MATERIALS = 128;

  // Procedural particle texture (generated once)
  private particleTexture: Texture | null = null;

  /**
   * Shapes every explosion is built from, made once per scene: a deformed
   * fireball per scale, a unit ray cone and a shockwave disc per scale. Building
   * the icosphere, deforming it and building eight to twelve cylinders was most
   * of what spawning an explosion cost. Templates stay disabled; rays and discs
   * share their geometry, and each fireball copies its own, because it animates
   * its vertices.
   */
  private shapes: {
    scene: Scene;
    rayCone: Mesh;
    discs: Map<number, Mesh>;
    fireballs: Map<number, { template: VertexData; deformed: Float32Array }>;
  } | null = null;
  private readonly fadeColor = new Color3();
  private readonly rayOffset = new Vector3();

  private constructor() {}

  static getInstance(): ExplosionEffect {
    if (!ExplosionEffect.instance) {
      ExplosionEffect.instance = new ExplosionEffect();
    }
    return ExplosionEffect.instance;
  }

  init(scene: Scene): void {
    this.clear();
    this.scene = scene;
    // Every explosion's sparks share this one texture, so only a re-init lets it go.
    this.particleTexture?.dispose();
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
    if (!this.scene || this.scene.isDisposed) return;

    const id = `explosion_${this.nextId++}`;
    const now = performance.now() / 1000;
    const s = config.scale;

    // ─── Layer 1: Spiky Fireball ───────────────────────────
    const { mesh: fireball, material: fireballMat, origPositions } = this.createFireball(id, position, s, config);

    // ─── Layer 2: Radial Rays ──────────────────────────────
    const rays = this.createRays(id, position, s, config);

    // ─── Layer 3: Shockwave Ring (skip for some weapons) ──
    const showShockwave = config.showShockwave !== false;
    const ring = showShockwave ? this.createShockwave(id, position, s, config, normal) : null;

    // ─── Layer 4: Particle Sparks ──────────────────────────
    const particles = this.createParticles(id, position, s, config);

    const explosion: ActiveExplosion = {
      id,
      config,
      position: position.clone(),
      normal: normal.clone(),
      spawnTime: now,
      fireball,
      fireballMat,
      fireballOrigPositions: origPositions,
      rays,
      shockwave: ring?.mesh ?? null,
      shockwaveMat: ring?.material ?? null,
      light: null,
      particles,
    };
    // ─── Layer 5: Flash Light ──────────────────────────────
    explosion.light = getPointLightPool().acquire(
      position.clone(),
      config.outerColor.clone(),
      FLASH_LIGHT_GAIN * s,
      40 * s,
      explosion,
    );
    this.explosions.push(explosion);

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
    const scene = this.scene!;
    const shape = this.fireballShape(scene, scale);
    const mesh = new Mesh(`${id}_fireball`, scene);
    const data = new VertexData();
    data.positions = new Float32Array(shape.deformed);
    data.normals = shape.template.normals;
    data.uvs = shape.template.uvs;
    data.indices = shape.template.indices;
    data.applyToMesh(mesh, true);

    mesh.position = pos.clone();
    mesh.isPickable = false;

    // Every frame rewrites the vertices from these; nothing writes to them.
    const origPositions = shape.deformed;

    // Material: emissive, no lighting
    const mat = new StandardMaterial(`${id}_fireballMat`, this.scene!);
    // Each dirty-enabling setter otherwise scans every submesh in the scene.
    mat.atomicMaterialsUpdate(() => {
      mat.emissiveColor = config.coreColor.clone();
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = 0.9;
      applySafeMaxSimultaneousLights(mat);
    });
    mesh.material = mat;

    // Start small, will animate up
    mesh.scaling.setAll(0.1);

    return { mesh, material: mat, origPositions };
  }

  /** The spiky fireball for one scale: an icosphere pushed out by a fixed noise. */
  private fireballShape(scene: Scene, scale: number): { template: VertexData; deformed: Float32Array } {
    const shapes = this.shapesFor(scene);
    const cached = shapes.fireballs.get(scale);
    if (cached) return cached;
    const template = CreateIcoSphereVertexData({
      radius: 2.5 * scale,
      subdivisions: 3,
      flat: true, // Flat shading for that faceted cartoon look
    });
    const positions = template.positions ?? [];
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
    const shape = { template, deformed };
    shapes.fireballs.set(scale, shape);
    return shape;
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
      const width = (0.3 + Math.random() * 0.3) * scale;
      const size = new Vector3(width, length, width);
      const mesh = this.meshFrom(this.shapesFor(this.scene!).rayCone, `${id}_ray_${i}`, this.scene!);

      mesh.position = pos.clone();

      // Orient cone along direction
      const up = Vector3.Up();
      const dot = Vector3.Dot(up, dir);
      if (Math.abs(dot) < 0.999) {
        mesh.lookAt(pos.add(dir));
        mesh.rotation.x += Math.PI / 2; // Cone points along +Y by default
      }

      // Material
      // Mix between core and outer color randomly
      const blend = Math.random();
      const mat = this.acquireRayMaterial(`${id}_rayMat_${i}`);
      Color3.LerpToRef(config.coreColor, config.outerColor, blend, mat.emissiveColor);
      // Alpha remains below 1 throughout its lifetime, so reuse is a uniform
      // change, not an opaque/translucent define transition or another batch.
      mat.alpha = 0.8;
      mesh.material = mat;

      // Start small
      size.scaleToRef(0.1, mesh.scaling);

      rays.push({ mesh, mat, direction: dir, size });
    }

    return rays;
  }

  private acquireRayMaterial(name: string): StandardMaterial {
    const scene = this.scene!;
    if (this.rayPoolScene !== scene) {
      this.disposeRayMaterialPool();
      this.rayPoolScene = scene;
      this.rayPoolObserver = scene.onDisposeObservable.addOnce(() => this.disposeRayMaterialPool());
    }
    while (this.rayMaterials.length) {
      const material = this.rayMaterials.pop()!;
      // A map clear can dispose scene materials before the effect is re-init'd.
      if (scene.materials.includes(material)) {
        material.name = name;
        if (material.isFrozen) material.unfreeze();
        return material;
      }
    }
    const material = new StandardMaterial(name, scene);
    material.atomicMaterialsUpdate(() => {
      material.diffuseColor = Color3.Black();
      material.disableLighting = true;
      material.alpha = 0.8;
      applySafeMaxSimultaneousLights(material);
    });
    return material;
  }

  private releaseRayMaterial(material: StandardMaterial): void {
    // Babylon leaves undefined meshMap entries after Mesh.dispose. Retained
    // materials must not accumulate one dead binding key per reused ray.
    const bindings = material.meshMap;
    if (bindings) for (const id of Object.keys(bindings)) if (bindings[id] === undefined) delete bindings[id];
    const scene = this.rayPoolScene;
    if (
      scene &&
      !scene.isDisposed &&
      material.getScene() === scene &&
      scene.materials.includes(material) &&
      this.rayMaterials.length < ExplosionEffect.MAX_IDLE_RAY_MATERIALS
    )
      this.rayMaterials.push(material);
    else material.dispose();
  }

  private disposeRayMaterialPool(): void {
    for (const material of this.rayMaterials) material.dispose();
    this.rayMaterials.length = 0;
    if (this.rayPoolObserver) this.rayPoolScene?.onDisposeObservable.remove(this.rayPoolObserver);
    this.rayPoolObserver = null;
    this.rayPoolScene = null;
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
    const shapes = this.shapesFor(this.scene!);
    let disc = shapes.discs.get(scale);
    if (!disc) {
      disc = MeshBuilder.CreateDisc("explosion_template_disc", { radius: 0.5 * scale, tessellation: 32 }, this.scene!);
      disc.setEnabled(false);
      disc.isPickable = false;
      shapes.discs.set(scale, disc);
    }
    const mesh = this.meshFrom(disc, `${id}_shockwave`, this.scene!);

    mesh.position = pos.clone();

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
    mat.atomicMaterialsUpdate(() => {
      mat.emissiveColor = config.outerColor.clone();
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = 0.7;
      applySafeMaxSimultaneousLights(mat);
    });
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

    // World fog: an additive burst fades with the fog where it goes off, as
    // Warfork's additive passes do (all its sparks are emitted here, at once)
    const fogFade = 1 - atmFogFactorAt(pos, this.scene!.activeCamera?.globalPosition);
    if (fogFade < 1) {
      ps.color1.scaleInPlace(fogFade);
      ps.color2.scaleInPlace(fogFade);
    }

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
    if (exp.fireballMat.isFrozen) exp.fireballMat.unfreeze();
    // Scale: expand in sync with the shockwave ring (70% of fire lifetime)
    const expandPhase = Math.min(t / 0.7, 1.0);

    const scaleVal = easeOutQuad(expandPhase);
    exp.fireball.scaling.setAll(scaleVal);

    // Color: 3-stage shift  white-hot → orange → dark red
    // Derive fade color from config (not hardcoded red — plasma fades green)
    const fadeColor = exp.config.outerColor.scaleToRef(0.4, this.fadeColor);
    const emissive = exp.fireballMat.emissiveColor;
    if (t < 0.3) {
      Color3.LerpToRef(exp.config.coreColor, exp.config.outerColor, t / 0.3, emissive);
    } else if (t < 0.6) {
      Color3.LerpToRef(exp.config.outerColor, fadeColor, (t - 0.3) / 0.3, emissive);
    } else {
      Color3.LerpToRef(fadeColor, exp.config.smokeColor, (t - 0.6) / 0.4, emissive);
    }

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
        updateEffectPositions(exp.fireball, positions);
      }
    }
  }

  /**
   * Rays: shoot outward from center, fade quickly
   */
  private updateRays(exp: ActiveExplosion, t: number): void {
    for (const ray of exp.rays) {
      if (ray.mat.isFrozen) ray.mat.unfreeze();
      // Scale up fast, then hold
      const rayScale = easeOutQuad(Math.min(t / 0.15, 1.0));
      ray.size.scaleToRef(rayScale, ray.mesh.scaling);

      // Move outward from center
      const outDist = easeOutQuad(Math.min(t / 0.3, 1.0)) * 4 * exp.config.scale;
      exp.position.addToRef(ray.direction.scaleToRef(outDist, this.rayOffset), ray.mesh.position);

      // Fade out after halfway
      ray.mat.alpha = t < 0.25 ? 0.8 : 0.8 * Math.max(0, 1.0 - (t - 0.25) / 0.35);
      ray.mesh.isVisible = ray.mat.alpha > 0;

      // Color shift
      const colorT = Math.min(t * 3, 1.0);
      Color3.LerpToRef(exp.config.coreColor, exp.config.outerColor, colorT, ray.mat.emissiveColor);
    }
  }

  /**
   * Shockwave: expand to match splashRadius, 50% transparent, thin and fade
   */
  private updateShockwave(exp: ActiveExplosion, t: number): void {
    if (!exp.shockwave || !exp.shockwaveMat) return;
    if (exp.shockwaveMat.isFrozen) exp.shockwaveMat.unfreeze();
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
      exp.light.intensity = FLASH_LIGHT_GAIN * exp.config.scale * (1.0 - easeInQuad(t));
      exp.light.range = 40 * exp.config.scale * (1.0 - t * 0.5);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════

  private dispose(id: string): void {
    const idx = this.explosions.findIndex((e) => e.id === id);
    if (idx === -1) return;

    disposeExplosion(this.explosions[idx], (material) => this.releaseRayMaterial(material));
    this.explosions.splice(idx, 1);
  }

  /**
   * Clear all active explosions
   */
  clear(): void {
    for (const exp of this.explosions) disposeExplosion(exp, (material) => this.releaseRayMaterial(material));
    this.explosions = [];
    this.disposeRayMaterialPool();
    this.disposeShapes();
  }

  private shapesFor(scene: Scene): NonNullable<ExplosionEffect["shapes"]> {
    // A map unload can dispose every scene mesh, templates included.
    if (!this.shapes || this.shapes.scene !== scene || this.shapes.rayCone.isDisposed()) {
      this.disposeShapes();
      const rayCone = MeshBuilder.CreateCylinder(
        "explosion_template_rayCone",
        { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 6 },
        scene,
      );
      rayCone.setEnabled(false);
      rayCone.isPickable = false;
      this.shapes = { scene, rayCone, discs: new Map(), fireballs: new Map() };
    }
    return this.shapes;
  }

  private disposeShapes(): void {
    if (!this.shapes) return;
    this.shapes.rayCone.dispose();
    for (const disc of this.shapes.discs.values()) disc.dispose();
    this.shapes = null;
  }

  /** A new mesh drawing `template`'s geometry, which it shares rather than copies. */
  private meshFrom(template: Mesh, name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    template.geometry?.applyToMesh(mesh);
    mesh.isPickable = false;
    return mesh;
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

/**
 * Everything one explosion owns, and nothing it shares. The sparks' texture is
 * shared by every explosion, and Babylon's `dispose()` takes the texture with it
 * by default, so the first explosion to finish left the rest without sparks.
 */
function disposeExplosion(exp: ActiveExplosion, releaseRay: (material: StandardMaterial) => void): void {
  exp.fireball.dispose();
  exp.fireballMat.dispose();
  for (const ray of exp.rays) {
    ray.mesh.dispose();
    releaseRay(ray.mat);
  }
  exp.shockwave?.dispose();
  exp.shockwaveMat?.dispose();
  getPointLightPool().release(exp.light);
  exp.particles.stop();
  exp.particles.dispose(false);
}

export function getExplosionEffect(): ExplosionEffect {
  return ExplosionEffect.getInstance();
}
