/**
 * HitscanEffects — Generic visual effects for hitscan (instant-hit) weapons
 *
 * Provides configurable tracer lines, beams, pellet spreads, and bolt trails.
 * Each effect raycasts against the scene to find the actual hit point,
 * then spawns a short-lived visual + optional impact flash.
 *
 * Usage:
 *   HitscanEffects.getInstance().init(scene);
 *   HitscanEffects.getInstance().fireTracer({ origin, direction, ... });
 */

import { Ray } from "@babylonjs/core/Culling/ray";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { mulberry32 } from "../../shared/SpreadUtils";
import { getPointLightPool } from "./PointLightPool";

// ── Config types ─────────────────────────────────────────────────────

/** Shared config for all hitscan fire calls */
export interface HitscanFireConfig {
  /** World-space origin (camera/muzzle position) */
  origin: Vector3;
  /** Normalized forward direction */
  direction: Vector3;
  /** Maximum range (Quake units). Default 8192 */
  maxRange?: number;
  /** Color of the tracer/beam.  Default white */
  color?: Color3;
}

/** Bullet tracer (machinegun-style thin line that fades fast) */
export interface TracerConfig extends HitscanFireConfig {
  /** Line width factor (1 = thin tracer, 3 = thick).  Default 1 */
  width?: number;
  /** How long the tracer stays visible (seconds). Default 0.08 */
  duration?: number;
}

/** Continuous beam (lightning-gun-style held beam) */
export interface BeamConfig extends HitscanFireConfig {
  /** Diameter at the barrel (start). Default 0.8 */
  diameterStart?: number;
  /** Diameter at the endpoint (end). Default 0.2 */
  diameterEnd?: number;
}

/** Pellet spread (riotgun-style multi-ray) */
export interface PelletConfig extends HitscanFireConfig {
  /** Number of pellets. Default 20 */
  pelletCount?: number;
  /** Spread angle in degrees. Default 12 */
  spreadAngle?: number;
  /** Per-pellet tracer duration. Default 0.08 */
  duration?: number;
  /** Deterministic PRNG seed (from SpreadUtils.computeSpreadSeed). If omitted, uses Math.random(). */
  seed?: number;
  /** Number of visible traveling tracers (subset of pellets). Default 5 */
  visibleTracers?: number;
}

/** Bolt / rail trail (electrobolt/instagun-style thick beam) */
export interface BoltConfig extends HitscanFireConfig {
  /** Width of the bolt beam. Default 0.35 */
  width?: number;
  /** Duration. Default 0.4 */
  duration?: number;
  /** If true, add spiral ring decoration. Default false */
  spiral?: boolean;
}

// ── Active effect tracking ───────────────────────────────────────────

interface ActiveEffect {
  id: string;
  meshes: Mesh[];
  materials: StandardMaterial[];
  light: PointLight | null;
  spawnTime: number;
  duration: number;
}

/**
 * Jagged lightning beam (voltaic) — a chain of thin emissive cylinder segments
 * following a jittered path, re-jittered each frame for crackle. Core + glow layers.
 */
interface LightningBeam {
  coreSegs: Mesh[];
  glowSegs: Mesh[];
  coreMat: StandardMaterial;
  glowMat: StandardMaterial;
  light: PointLight | null;
}

/** Remote-player lightning beam — cached endpoints so update() can re-jitter it. */
interface RemoteLightning extends LightningBeam {
  origin: Vector3;
  endpoint: Vector3;
  color: Color3;
  lastUpdate: number;
}

/** A traveling pellet tracer — short segment that slides along a ray */
interface TravelingPellet {
  id: string;
  mesh: Mesh;
  material: StandardMaterial;
  origin: Vector3;
  endpoint: Vector3;
  rayLength: number;
  spawnTime: number;
  duration: number;
  /** Fraction of ray length that the segment covers (0..1) */
  segmentFraction: number;
}

// ── Singleton ────────────────────────────────────────────────────────

export class HitscanEffects {
  private static instance: HitscanEffects;
  private scene: Scene | null = null;
  private effects: ActiveEffect[] = [];
  private travelingPellets: TravelingPellet[] = [];
  private nextId = 0;

  /** Reusable beam meshes for local player (updated every frame, not created/destroyed) */
  private activeBeamCore: Mesh | null = null;
  private activeBeamGlow: Mesh | null = null;
  private activeBeamCoreMat: StandardMaterial | null = null;
  private activeBeamGlowMat: StandardMaterial | null = null;
  private activeBeamLight: PointLight | null = null;

  /** Remote player beams — keyed by entity ID */
  private remoteBeams: Map<
    number,
    {
      core: Mesh;
      glow: Mesh;
      coreMat: StandardMaterial;
      glowMat: StandardMaterial;
      light: PointLight | null;
      lastUpdate: number;
    }
  > = new Map();
  private static readonly REMOTE_BEAM_TIMEOUT = 0.15; // seconds

  /** Local player's lightning beam (voltaic) — re-jittered each frame while firing */
  private activeLightning: LightningBeam | null = null;
  /** Remote players' lightning beams, keyed by entity id */
  private remoteLightning: Map<number, RemoteLightning> = new Map();
  /** Segments per bolt (more = smoother jag, more meshes) */
  private static readonly LIGHTNING_SEGMENTS = 9;

  /** Pooled wall marks (bullet holes / scorch marks) */
  private wallMarks: { mesh: Mesh; spawnTime: number }[] = [];
  private wallMarkMaterial: StandardMaterial | null = null; // Shared material for all wall marks
  private static readonly MAX_WALL_MARKS = 50;
  private static readonly WALL_MARK_DURATION = 3.0; // seconds to full fade

  private constructor() {}
  static getInstance(): HitscanEffects {
    if (!HitscanEffects.instance) HitscanEffects.instance = new HitscanEffects();
    return HitscanEffects.instance;
  }

  init(scene: Scene): void {
    this.scene = scene;
    console.log("[HitscanEffects] Initialized");
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Instant bullet tracer  (machinegun, generic hitscan)
   * Thin line from origin → hit point, fades over `duration`.
   */
  fireTracer(cfg: TracerConfig): Vector3 | null {
    if (!this.scene) return null;
    const range = cfg.maxRange ?? 8192;
    const color = cfg.color ?? new Color3(1.0, 0.85, 0.3); // warm yellow
    const duration = cfg.duration ?? 0.08;
    const width = cfg.width ?? 1;

    const hit = this.traceRay(cfg.origin, cfg.direction, range);
    const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

    // Create thin line mesh
    const id = `tracer_${this.nextId++}`;
    const line = MeshBuilder.CreateLines(
      id,
      {
        points: [cfg.origin.clone(), endpoint.clone()],
        colors: [new Color4(color.r, color.g, color.b, 1), new Color4(color.r, color.g, color.b, 0.3)],
      },
      this.scene,
    );
    line.isPickable = false;
    if (width > 1) {
      line.enableEdgesRendering();
      line.edgesWidth = width;
      line.edgesColor = new Color4(color.r, color.g, color.b, 0.6);
    }

    // Small impact flash at endpoint
    const impactLight = this.spawnImpactFlash(endpoint, color, hit?.normal, duration * 2);

    this.effects.push({
      id,
      meshes: [line],
      materials: [],
      light: impactLight,
      spawnTime: performance.now() / 1000,
      duration,
    });

    // Leave a wall mark at hit point
    if (hit) {
      this.spawnWallMark(hit.point, hit.normal, color, 0.3);
    }

    return hit?.point ?? null;
  }

  /**
   * Continuous beam  (lightning-gun style, held-down)
   * Dual tapered beam: wider at barrel, thinner at distance.
   * Update every frame while firing. Call `stopBeam()` when fire ends.
   */
  updateBeam(cfg: BeamConfig): Vector3 | null {
    if (!this.scene) return null;
    const range = cfg.maxRange ?? 850;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1); // orange/yellow
    const dStart = cfg.diameterStart ?? 0.4;
    const dEnd = cfg.diameterEnd ?? 0.15;

    const hit = this.traceRay(cfg.origin, cfg.direction, range);
    const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

    // Create or update core beam (tapered cylinder)
    if (!this.activeBeamCore) {
      const id = `beam_${this.nextId++}`;
      this.activeBeamCore = MeshBuilder.CreateCylinder(
        `${id}_core`,
        {
          height: 1,
          diameterTop: dEnd, // thin at endpoint
          diameterBottom: dStart, // wide at barrel
          tessellation: 8,
        },
        this.scene,
      );
      this.activeBeamCore.isPickable = false;

      this.activeBeamCoreMat = new StandardMaterial(`${id}_core_mat`, this.scene);
      this.activeBeamCoreMat.emissiveColor = color;
      this.activeBeamCoreMat.disableLighting = true;
      this.activeBeamCoreMat.alpha = 0.75;
      this.activeBeamCoreMat.backFaceCulling = false;
      this.activeBeamCoreMat.maxSimultaneousLights = 4;
      this.activeBeamCore.material = this.activeBeamCoreMat;

      // Outer glow beam (wider, semi-transparent)
      this.activeBeamGlow = MeshBuilder.CreateCylinder(
        `${id}_glow`,
        {
          height: 1,
          diameterTop: dEnd * 2.5,
          diameterBottom: dStart * 2.5,
          tessellation: 8,
        },
        this.scene,
      );
      this.activeBeamGlow.isPickable = false;

      this.activeBeamGlowMat = new StandardMaterial(`${id}_glow_mat`, this.scene);
      this.activeBeamGlowMat.emissiveColor = new Color3(
        Math.min(1, color.r * 1.3),
        Math.min(1, color.g * 1.3),
        Math.min(1, color.b * 1.3),
      );
      this.activeBeamGlowMat.disableLighting = true;
      this.activeBeamGlowMat.alpha = 0.2;
      this.activeBeamGlowMat.backFaceCulling = false;
      this.activeBeamGlowMat.maxSimultaneousLights = 4;
      this.activeBeamGlow.material = this.activeBeamGlowMat;
    } else {
      if (this.activeBeamCoreMat) this.activeBeamCoreMat.emissiveColor = color;
      if (this.activeBeamGlowMat) {
        this.activeBeamGlowMat.emissiveColor = new Color3(
          Math.min(1, color.r * 1.3),
          Math.min(1, color.g * 1.3),
          Math.min(1, color.b * 1.3),
        );
      }
    }

    // Orient both beams between origin and endpoint
    this.orientCylinder(this.activeBeamCore!, cfg.origin, endpoint);
    this.orientCylinder(this.activeBeamGlow!, cfg.origin, endpoint);

    // Endpoint glow light
    if (!this.activeBeamLight) {
      this.activeBeamLight = getPointLightPool().acquire(endpoint, color, 8, 15);
    } else {
      this.activeBeamLight.position = endpoint;
      this.activeBeamLight.diffuse = color;
    }

    return hit?.point ?? null;
  }

  /** Stop the local player's continuous beam effect */
  stopBeam(): void {
    this.activeBeamCore?.dispose();
    this.activeBeamCore = null;
    this.activeBeamGlow?.dispose();
    this.activeBeamGlow = null;
    this.activeBeamCoreMat?.dispose();
    this.activeBeamCoreMat = null;
    this.activeBeamGlowMat?.dispose();
    this.activeBeamGlowMat = null;
    getPointLightPool().release(this.activeBeamLight);
    this.activeBeamLight = null;
  }

  // ── Lightning beam (voltaic chain lightning) ─────────────────────

  /**
   * Local player's jagged lightning beam. Call every frame while firing (like
   * updateBeam); it re-jitters the bolt each call for crackle. `stopLightning()`
   * when fire ends.
   */
  updateLightningBeam(cfg: BeamConfig): Vector3 | null {
    if (!this.scene) return null;
    const range = cfg.maxRange ?? 850;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1);
    const hit = this.traceRay(cfg.origin, cfg.direction, range);
    const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

    if (!this.activeLightning) this.activeLightning = this.createLightningBeam(color, endpoint);
    this.orientLightning(this.activeLightning, cfg.origin, endpoint, color);
    return hit?.point ?? null;
  }

  /** Stop the local player's lightning beam. */
  stopLightning(): void {
    if (this.activeLightning) this.disposeLightning(this.activeLightning);
    this.activeLightning = null;
  }

  /**
   * Remote player's lightning beam. Driven by per-shot fire events; update() then
   * re-jitters it each frame and auto-cleans it after REMOTE_BEAM_TIMEOUT.
   */
  updateRemoteLightningBeam(entityId: number, cfg: BeamConfig): void {
    if (!this.scene) return;
    const range = cfg.maxRange ?? 850;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1);
    const endpoint = cfg.origin.add(cfg.direction.scale(range)); // no raytrace for remote
    const now = performance.now() / 1000;

    let beam = this.remoteLightning.get(entityId);
    if (!beam) {
      beam = {
        ...this.createLightningBeam(color, endpoint),
        origin: cfg.origin.clone(),
        endpoint: endpoint.clone(),
        color,
        lastUpdate: now,
      };
      this.remoteLightning.set(entityId, beam);
    } else {
      beam.origin = cfg.origin.clone();
      beam.endpoint = endpoint.clone();
      beam.color = color;
      beam.lastUpdate = now;
    }
    this.orientLightning(beam, beam.origin, beam.endpoint, color);
  }

  private stopRemoteLightning(entityId: number): void {
    const beam = this.remoteLightning.get(entityId);
    if (beam) {
      this.disposeLightning(beam);
      this.remoteLightning.delete(entityId);
    }
  }

  /** Build the segment meshes + materials + endpoint light for a lightning bolt. */
  private createLightningBeam(color: Color3, endpoint: Vector3): LightningBeam {
    const n = HitscanEffects.LIGHTNING_SEGMENTS;
    const id = `lightning_${this.nextId++}`;

    const coreMat = new StandardMaterial(`${id}_core_mat`, this.scene!);
    coreMat.emissiveColor = this.brighten(color);
    coreMat.disableLighting = true;
    coreMat.alpha = 0.9;
    coreMat.backFaceCulling = false;
    coreMat.maxSimultaneousLights = 4;

    const glowMat = new StandardMaterial(`${id}_glow_mat`, this.scene!);
    glowMat.emissiveColor = color;
    glowMat.disableLighting = true;
    glowMat.alpha = 0.28;
    glowMat.backFaceCulling = false;
    glowMat.maxSimultaneousLights = 4;

    const coreSegs: Mesh[] = [];
    const glowSegs: Mesh[] = [];
    for (let i = 0; i < n; i++) {
      const core = MeshBuilder.CreateCylinder(`${id}_c${i}`, { height: 1, diameter: 0.18, tessellation: 5 }, this.scene!);
      core.isPickable = false;
      core.material = coreMat;
      coreSegs.push(core);

      const glow = MeshBuilder.CreateCylinder(`${id}_g${i}`, { height: 1, diameter: 0.5, tessellation: 5 }, this.scene!);
      glow.isPickable = false;
      glow.material = glowMat;
      glowSegs.push(glow);
    }

    const light = getPointLightPool().acquire(endpoint, color, 7, 14);
    return { coreSegs, glowSegs, coreMat, glowMat, light };
  }

  /** Re-jitter + orient a lightning bolt's segments between origin and endpoint. */
  private orientLightning(beam: LightningBeam, origin: Vector3, endpoint: Vector3, color: Color3): void {
    const path = this.lightningPath(origin, endpoint);
    const n = beam.coreSegs.length;
    for (let i = 0; i < n; i++) {
      const a = path[i];
      const b = path[i + 1];
      this.orientCylinder(beam.coreSegs[i], a, b);
      this.orientCylinder(beam.glowSegs[i], a, b);
    }
    beam.coreMat.emissiveColor = this.brighten(color);
    beam.glowMat.emissiveColor = color;
    if (beam.light) {
      beam.light.position = endpoint;
      beam.light.diffuse = color;
    }
  }

  /**
   * Build a jagged path from origin→endpoint with pinned endpoints and jitter that
   * tapers to zero at both ends (so the bolt actually connects muzzle→target).
   * Returns LIGHTNING_SEGMENTS+1 points.
   */
  private lightningPath(origin: Vector3, endpoint: Vector3): Vector3[] {
    const n = HitscanEffects.LIGHTNING_SEGMENTS;
    const diff = endpoint.subtract(origin);
    const len = diff.length();
    const points: Vector3[] = [origin.clone()];
    if (len < 0.001) {
      for (let i = 1; i <= n; i++) points.push(endpoint.clone());
      return points;
    }
    const dir = diff.scale(1 / len);
    let right = Vector3.Cross(dir, Vector3.Up());
    if (right.lengthSquared() < 0.001) right = Vector3.Cross(dir, Vector3.Forward());
    right.normalize();
    const up = Vector3.Cross(right, dir).normalize();

    const jitterAmp = Math.min(len * 0.06, 15); // fast random crackle
    const bowAmp = Math.min(len * 0.11, 26); // smooth coherent bow (the "bending")
    // Slowly rotate the bow plane over time so the whole bolt sways/whips.
    const phase = (performance.now() / 1000) * 3.2;
    const bowX = Math.cos(phase);
    const bowY = Math.sin(phase);

    for (let i = 1; i < n; i++) {
      const t = i / n;
      const taper = Math.sin(t * Math.PI); // 0 at both ends
      // Coherent bow (arc + sway) gives the bending look; jitter adds crackle.
      const bow = bowAmp * taper;
      const ox = bowX * bow + (Math.random() * 2 - 1) * jitterAmp * taper;
      const oy = bowY * bow + (Math.random() * 2 - 1) * jitterAmp * taper;
      points.push(origin.add(diff.scale(t)).add(right.scale(ox)).add(up.scale(oy)));
    }
    points.push(endpoint.clone());
    return points;
  }

  /** Brighten a color toward white for the hot bolt core. */
  private brighten(color: Color3): Color3 {
    return new Color3(Math.min(1, color.r + 0.3), Math.min(1, color.g + 0.3), Math.min(1, color.b + 0.3));
  }

  private disposeLightning(beam: LightningBeam): void {
    for (const m of beam.coreSegs) m.dispose();
    for (const m of beam.glowSegs) m.dispose();
    beam.coreMat.dispose();
    beam.glowMat.dispose();
    getPointLightPool().release(beam.light);
  }

  /**
   * Update a remote (third-person) player's beam.
   * Called from Game when a fire event arrives for a beam weapon.
   * Automatically cleaned up after REMOTE_BEAM_TIMEOUT if no updates arrive.
   */
  updateRemoteBeam(entityId: number, cfg: BeamConfig): void {
    if (!this.scene) return;
    const range = cfg.maxRange ?? 850;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1);
    const dStart = cfg.diameterStart ?? 0.6;
    const dEnd = cfg.diameterEnd ?? 0.15;
    const endpoint = cfg.origin.add(cfg.direction.scale(range));
    // Note: no raytrace for remote beams (origin+dir from server is enough)

    let beam = this.remoteBeams.get(entityId);
    if (!beam) {
      const id = `rbeam_${entityId}_${this.nextId++}`;
      const core = MeshBuilder.CreateCylinder(
        `${id}_core`,
        {
          height: 1,
          diameterTop: dEnd,
          diameterBottom: dStart,
          tessellation: 8,
        },
        this.scene,
      );
      core.isPickable = false;
      const coreMat = new StandardMaterial(`${id}_core_mat`, this.scene);
      coreMat.emissiveColor = color;
      coreMat.disableLighting = true;
      coreMat.alpha = 0.7;
      coreMat.backFaceCulling = false;
      coreMat.maxSimultaneousLights = 4;
      core.material = coreMat;

      const glow = MeshBuilder.CreateCylinder(
        `${id}_glow`,
        {
          height: 1,
          diameterTop: dEnd * 2.5,
          diameterBottom: dStart * 2.5,
          tessellation: 8,
        },
        this.scene,
      );
      glow.isPickable = false;
      const glowMat = new StandardMaterial(`${id}_glow_mat`, this.scene);
      glowMat.emissiveColor = new Color3(
        Math.min(1, color.r * 1.3),
        Math.min(1, color.g * 1.3),
        Math.min(1, color.b * 1.3),
      );
      glowMat.disableLighting = true;
      glowMat.alpha = 0.15;
      glowMat.backFaceCulling = false;
      glowMat.maxSimultaneousLights = 4;
      glow.material = glowMat;

      const light = getPointLightPool().acquire(endpoint, color, 6, 12);

      beam = { core, glow, coreMat, glowMat, light, lastUpdate: performance.now() / 1000 };
      this.remoteBeams.set(entityId, beam);
    } else {
      beam.coreMat.emissiveColor = color;
      if (beam.light) beam.light.diffuse = color;
      beam.lastUpdate = performance.now() / 1000;
    }

    this.orientCylinder(beam!.core, cfg.origin, endpoint);
    this.orientCylinder(beam!.glow, cfg.origin, endpoint);
    if (beam!.light) beam!.light.position = endpoint;
  }

  /** Stop a specific remote player's beam */
  stopRemoteBeam(entityId: number): void {
    const beam = this.remoteBeams.get(entityId);
    if (beam) {
      beam.core.dispose();
      beam.glow.dispose();
      beam.coreMat.dispose();
      beam.glowMat.dispose();
      getPointLightPool().release(beam.light);
      this.remoteBeams.delete(entityId);
    }
  }

  /** Stop all remote beams */
  stopAllRemoteBeams(): void {
    // Collect IDs first to avoid mutating Map during iteration
    const ids = [...this.remoteBeams.keys()];
    for (const id of ids) this.stopRemoteBeam(id);
  }

  /**
   * Pellet spread  (riotgun / shotgun)
   * Fires N rays in a cone with deterministic or random spread.
   * Shows a subset as "traveling" thick tracers and spawns impact sparks for all hits.
   */
  firePellets(cfg: PelletConfig): Vector3[] {
    if (!this.scene) return [];
    const count = cfg.pelletCount ?? 20;
    const spreadDeg = cfg.spreadAngle ?? 12;
    const duration = cfg.duration ?? 0.25;
    const color = cfg.color ?? new Color3(1.0, 0.9, 0.4); // warm yellow
    const range = cfg.maxRange ?? 8192;
    const visibleCount = cfg.visibleTracers ?? 5;
    const spreadRad = (spreadDeg * Math.PI) / 180;

    // Build PRNG: seeded if seed provided, otherwise Math.random fallback
    const rng = cfg.seed != null ? mulberry32(cfg.seed) : Math.random;

    const hitPoints: Vector3[] = [];
    const now = performance.now() / 1000;

    // Determine which pellet indices get visible tracers
    // Evenly spaced across the pellet array for good cone coverage
    const tracerStride = Math.max(1, Math.floor(count / visibleCount));
    const tracerIndices = new Set<number>();
    for (let t = 0; t < visibleCount; t++) {
      tracerIndices.add(t * tracerStride);
    }

    for (let i = 0; i < count; i++) {
      // Deterministic spread direction using seeded RNG
      const dir = this.spreadDirectionSeeded(cfg.direction, spreadRad, rng);
      const hit = this.traceRay(cfg.origin, dir, range);
      const endpoint = hit?.point ?? cfg.origin.add(dir.scale(range));

      if (hit?.point) hitPoints.push(hit.point);

      // Impact sparks for ALL pellets (wall marks only — lights are expensive)
      if (hit?.point) {
        this.spawnWallMark(hit.point, hit.normal, color, 2.0);
      }

      // Traveling tracer only for selected representative pellets (no per-pellet lights)
      if (tracerIndices.has(i)) {
        this.spawnTravelingPellet(cfg.origin, endpoint, color, duration, now);
      }
    }

    // Single consolidated impact light at the centroid of all hit points.
    // Much cheaper than N separate PointLights — all pellets land in
    // roughly the same area anyway. Boosted intensity + range to compensate.
    if (hitPoints.length > 0) {
      const centroid = hitPoints
        .reduce((acc, p) => acc.addInPlace(p), Vector3.Zero())
        .scaleInPlace(1 / hitPoints.length);
      const impactLight = this.spawnImpactFlash(centroid, color, undefined, duration * 2);
      if (impactLight) {
        impactLight.intensity = 40; // boosted (was 25 per pellet)
        impactLight.range = 80; // wider to cover spread area

        // Track for cleanup via a lightweight effect entry
        this.effects.push({
          id: `pellet_flash_${this.nextId++}`,
          meshes: [],
          materials: [],
          light: impactLight,
          spawnTime: now,
          duration: duration * 2,
        });
      }
    }

    return hitPoints;
  }

  /**
   * Spawn a traveling pellet tracer — a short thick segment that slides
   * from origin to endpoint over `duration` seconds.
   */
  private spawnTravelingPellet(origin: Vector3, endpoint: Vector3, color: Color3, duration: number, now: number): void {
    if (!this.scene) return;

    const id = `pellet_${this.nextId++}`;
    const segFrac = 0.15; // segment covers 15% of total ray length

    // Create a cone-shaped tracer (wide head, narrow tail) for dynamic shotgun blast feel
    const mesh = MeshBuilder.CreateCylinder(
      id,
      {
        height: 1,
        diameterTop: 2.5, // wide head (leading edge)
        diameterBottom: 0.3, // narrow tail
        tessellation: 6,
      },
      this.scene,
    );
    mesh.isPickable = false;

    const mat = new StandardMaterial(`${id}_mat`, this.scene);
    mat.emissiveColor = color;
    mat.disableLighting = true;
    mat.alpha = 0.85;
    mat.backFaceCulling = false;
    mat.maxSimultaneousLights = 4;
    mesh.material = mat;

    const rayLength = endpoint.subtract(origin).length();

    // Initially position at the start
    const segLen = rayLength * segFrac;
    const segStart = origin.clone();
    const segEnd = origin.add(endpoint.subtract(origin).normalize().scale(segLen));
    this.orientCylinder(mesh, segStart, segEnd);

    this.travelingPellets.push({
      id,
      mesh,
      material: mat,
      origin: origin.clone(),
      endpoint: endpoint.clone(),
      rayLength,
      spawnTime: now,
      duration,
      segmentFraction: segFrac,
    });
  }

  /**
   * Bolt / rail trail  (electrobolt, instagun)
   * Thick persistent beam with optional spiral decoration.
   */
  fireBolt(cfg: BoltConfig): Vector3 | null {
    if (!this.scene) return null;
    const range = cfg.maxRange ?? 8192;
    const color = cfg.color ?? new Color3(0.3, 0.6, 1.0); // electric blue
    const duration = cfg.duration ?? 0.4;
    const width = cfg.width ?? 0.35;

    const hit = this.traceRay(cfg.origin, cfg.direction, range);
    const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

    const id = `bolt_${this.nextId++}`;
    const meshes: Mesh[] = [];

    // Core beam (thick cylinder)
    const core = MeshBuilder.CreateCylinder(
      `${id}_core`,
      {
        height: 1,
        diameterTop: width,
        diameterBottom: width,
        tessellation: 8,
      },
      this.scene,
    );
    core.isPickable = false;
    const coreMat = new StandardMaterial(`${id}_core_mat`, this.scene);
    coreMat.emissiveColor = color;
    coreMat.disableLighting = true;
    coreMat.alpha = 0.9;
    coreMat.backFaceCulling = false;
    coreMat.maxSimultaneousLights = 4;
    core.material = coreMat;
    this.orientCylinder(core, cfg.origin, endpoint);
    meshes.push(core);

    // Outer glow (wider, more transparent)
    const glow = MeshBuilder.CreateCylinder(
      `${id}_glow`,
      {
        height: 1,
        diameterTop: width * 3,
        diameterBottom: width * 3,
        tessellation: 8,
      },
      this.scene,
    );
    glow.isPickable = false;
    const glowMat = new StandardMaterial(`${id}_glow_mat`, this.scene);
    glowMat.emissiveColor = color;
    glowMat.disableLighting = true;
    glowMat.alpha = 0.25;
    glowMat.backFaceCulling = false;
    glowMat.maxSimultaneousLights = 4;
    glow.material = glowMat;
    this.orientCylinder(glow, cfg.origin, endpoint);
    meshes.push(glow);

    // Bright impact flash
    const impactLight = this.spawnImpactFlash(endpoint, color, hit?.normal, duration);

    this.effects.push({
      id,
      meshes,
      materials: [coreMat, glowMat],
      light: impactLight,
      spawnTime: performance.now() / 1000,
      duration,
    });

    // Leave a scorch mark at impact
    if (hit) {
      this.spawnWallMark(hit.point, hit.normal, color, 1.0);
    }

    return hit?.point ?? null;
  }

  // ── Update (call every frame) ────────────────────────────────────

  update(_deltaTime: number): void {
    const now = performance.now() / 1000;
    const toRemove: string[] = [];

    for (const fx of this.effects) {
      const age = now - fx.spawnTime;
      const t = Math.min(1, age / fx.duration);

      if (t >= 1) {
        toRemove.push(fx.id);
        continue;
      }

      // Fade out
      const fade = 1 - t;
      for (const mat of fx.materials) {
        mat.alpha = fade * 0.9;
      }
      // Lines can't have their alpha changed easily — just remove at expiry
      if (fx.light) {
        fx.light.intensity *= 0.85; // exponential decay
      }
    }

    // Animate traveling pellet tracers
    for (let i = this.travelingPellets.length - 1; i >= 0; i--) {
      const tp = this.travelingPellets[i];
      const age = now - tp.spawnTime;
      const t = Math.min(1, age / tp.duration);

      if (t >= 1) {
        // Done traveling — dispose
        tp.mesh.dispose();
        tp.material.dispose();
        this.travelingPellets.splice(i, 1);
        continue;
      }

      // Slide segment along the ray: head moves from 0→1, tail follows
      // Start with a minimum length to avoid zero-length cylinder
      const headT = Math.max(0.02, t); // head position along ray (0..1)
      const tailT = Math.max(0, headT - tp.segmentFraction);

      const rayDir = tp.endpoint.subtract(tp.origin);
      const segStart = tp.origin.add(rayDir.scale(tailT));
      const segEnd = tp.origin.add(rayDir.scale(headT));

      this.orientCylinder(tp.mesh, segStart, segEnd);

      // Fade out over the last 30% of travel
      const fadeStart = 0.7;
      if (t > fadeStart) {
        tp.material.alpha = 0.85 * (1 - (t - fadeStart) / (1 - fadeStart));
      }
    }

    // Fade wall marks
    for (let i = this.wallMarks.length - 1; i >= 0; i--) {
      const wm = this.wallMarks[i];
      const age = now - wm.spawnTime;
      if (age >= HitscanEffects.WALL_MARK_DURATION) {
        wm.mesh.dispose();
        this.wallMarks.splice(i, 1);
      } else {
        wm.mesh.visibility = 1 - age / HitscanEffects.WALL_MARK_DURATION;
      }
    }

    // Remove expired effects (backwards swap-remove: O(n) instead of O(n²) findIndex+splice)
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (toRemove.includes(this.effects[i].id)) {
        const fx = this.effects[i];
        for (const m of fx.meshes) m.dispose();
        for (const mat of fx.materials) mat.dispose();
        getPointLightPool().release(fx.light);
        // Swap with last element and pop (O(1) removal)
        this.effects[i] = this.effects[this.effects.length - 1];
        this.effects.pop();
      }
    }

    // Auto-cleanup remote beams that haven't received updates
    for (const [entityId, beam] of this.remoteBeams) {
      if (now - beam.lastUpdate > HitscanEffects.REMOTE_BEAM_TIMEOUT) {
        this.stopRemoteBeam(entityId);
      }
    }

    // Remote lightning: re-jitter each frame for crackle, or time out.
    for (const [entityId, beam] of this.remoteLightning) {
      if (now - beam.lastUpdate > HitscanEffects.REMOTE_BEAM_TIMEOUT) {
        this.stopRemoteLightning(entityId);
      } else {
        this.orientLightning(beam, beam.origin, beam.endpoint, beam.color);
      }
    }
  }

  /** Cleanup everything */
  clear(): void {
    for (const fx of this.effects) {
      for (const m of fx.meshes) m.dispose();
      for (const mat of fx.materials) mat.dispose();
      getPointLightPool().release(fx.light ?? null);
    }
    this.effects = [];
    for (const tp of this.travelingPellets) {
      tp.mesh.dispose();
      tp.material.dispose();
    }
    this.travelingPellets = [];
    this.stopBeam();
    this.stopAllRemoteBeams();
    this.stopLightning();
    for (const id of [...this.remoteLightning.keys()]) this.stopRemoteLightning(id);
  }

  // ── Private helpers ──────────────────────────────────────────────

  /** Raycast and return hit info (point + normal), or null */
  private traceRay(origin: Vector3, dir: Vector3, maxDist: number): { point: Vector3; normal: Vector3 } | null {
    if (!this.scene) return null;

    const ray = new Ray(origin, dir, maxDist);
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      if (!mesh.isPickable) return false;
      if (mesh.name.startsWith("tracer_")) return false;
      if (mesh.name.startsWith("pellet_")) return false;
      if (mesh.name.startsWith("bolt_")) return false;
      if (mesh.name.startsWith("beam_")) return false;
      if (mesh.name.startsWith("rbeam_")) return false;
      if (mesh.name.startsWith("proj_")) return false;
      if (mesh.name.startsWith("impact_")) return false;
      if (mesh.name.startsWith("wallmark_")) return false;

      // Skip non-solid meshes (light halos, flares, billboards, effects)
      const name = mesh.name.toLowerCase();
      if (
        name.includes("flare") ||
        name.includes("halo") ||
        name.includes("glow") ||
        name.includes("billboard") ||
        name.includes("sprite") ||
        name.includes("particle") ||
        name.includes("effect") ||
        name.includes("light_")
      ) {
        return false;
      }

      // Skip by texture name patterns
      const textureName = (mesh.metadata?.textureName || "").toLowerCase();
      if (
        textureName.includes("flare") ||
        textureName.includes("halo") ||
        textureName.includes("glow") ||
        textureName.includes("flareshader") ||
        textureName.includes("lights/") ||
        textureName.includes("sfx/")
      ) {
        return false;
      }

      // Skip meshes with additive blending (light effects)
      const material = mesh.material;
      if (material) {
        if ((material as any).alphaMode === 1 || (material as any).alphaMode === 2) return false;
        if ((material as any).alpha !== undefined && (material as any).alpha < 0.5) return false;
      }

      // Skip billboard faces (faceType 4 in BSP)
      if (mesh.metadata?.faceType === 4) return false;

      return true;
    });

    if (hit?.hit && hit.pickedPoint) {
      const normal = hit.getNormal(true) ?? dir.scale(-1);
      return { point: hit.pickedPoint, normal };
    }
    return null;
  }

  /** Orient a unit-height cylinder between two points */
  private orientCylinder(cyl: Mesh, start: Vector3, end: Vector3): void {
    const diff = end.subtract(start);
    const dist = diff.length();
    const mid = start.add(diff.scale(0.5));

    cyl.position = mid;
    cyl.scaling.y = dist;

    // BJS cylinder extends along local Y — rotate so Y aligns with diff
    const dir = diff.normalize();
    const up = Vector3.Up();
    const dot = Vector3.Dot(up, dir);

    if (dot > 0.9999) {
      // Already aligned with Y-up
      cyl.rotationQuaternion = Quaternion.Identity();
    } else if (dot < -0.9999) {
      // Opposite to Y-up — rotate 180° around Z
      cyl.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI);
    } else {
      const cross = Vector3.Cross(up, dir).normalize();
      const angle = Math.acos(dot);
      cyl.rotationQuaternion = Quaternion.RotationAxis(cross, angle);
    }
  }

  /** Create a random direction within a cone using a provided RNG function */
  private spreadDirectionSeeded(dir: Vector3, spreadRad: number, rng: () => number): Vector3 {
    // Random point in unit disk using provided RNG
    const r = Math.sqrt(rng()) * Math.tan(spreadRad);
    const theta = rng() * Math.PI * 2;
    const offsetX = r * Math.cos(theta);
    const offsetY = r * Math.sin(theta);

    // Build a coordinate frame around dir
    const forward = dir.normalize();
    let right: Vector3;
    if (Math.abs(forward.y) < 0.999) {
      right = Vector3.Cross(Vector3.Up(), forward).normalize();
    } else {
      right = Vector3.Cross(new Vector3(1, 0, 0), forward).normalize();
    }
    const up = Vector3.Cross(forward, right).normalize();

    return forward.add(right.scale(offsetX)).add(up.scale(offsetY)).normalize();
  }

  /** Spawn a small impact flash light + point, auto-cleaned up */
  private spawnImpactFlash(
    pos: Vector3,
    color: Color3,
    normal: Vector3 | undefined,
    _duration: number,
  ): PointLight | null {
    if (!this.scene) return null;

    // Offset slightly along normal to prevent Z-fighting
    const offset = normal ? normal.scale(0.05) : Vector3.Zero();

    const light = getPointLightPool().acquire(pos.add(offset), color, 25, 60);

    // Impact light is cleaned up by the effect that owns it
    return light;
  }

  /**
   * Spawn a persistent wall mark (bullet hole / scorch) at a hit point.
   * Flat plane oriented to the wall normal, fades out over WALL_MARK_DURATION.
   */
  private spawnWallMark(position: Vector3, normal: Vector3, color: Color3, size: number): void {
    if (!this.scene) return;

    // Enforce pool limit — remove oldest
    while (this.wallMarks.length >= HitscanEffects.MAX_WALL_MARKS) {
      const oldest = this.wallMarks.shift()!;
      oldest.mesh.dispose();
    }

    const id = `wallmark_${this.nextId++}`;
    const mesh = MeshBuilder.CreateDisc(id, { radius: size, tessellation: 3 }, this.scene);
    mesh.isPickable = false;

    // Position slightly off the wall to avoid z-fighting
    mesh.position = position.add(normal.scale(0.05));

    // Orient plane to face along the wall normal
    const target = position.add(normal);
    mesh.lookAt(target);

    // Shared wall mark material — created once, reused by all marks
    // Individual marks control fade via mesh.visibility instead of material.alpha
    if (!this.wallMarkMaterial) {
      this.wallMarkMaterial = new StandardMaterial("wallmark_shared_mat", this.scene);
      this.wallMarkMaterial.emissiveColor = new Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
      this.wallMarkMaterial.diffuseColor = Color3.Black();
      this.wallMarkMaterial.alpha = 0.7;
      this.wallMarkMaterial.disableLighting = true;
      this.wallMarkMaterial.backFaceCulling = false;
      this.wallMarkMaterial.maxSimultaneousLights = 4;
    }
    mesh.material = this.wallMarkMaterial;

    this.wallMarks.push({
      mesh,
      spawnTime: performance.now() / 1000,
    });
  }
  /**
   * Third-person slash arc — ribbon at a remote player's fire position.
   * Creates a fan-shaped sweep using the fire origin + direction.
   */
  fireSlash(cfg: HitscanFireConfig): void {
    if (!this.scene) return;

    const origin = cfg.origin;
    const dir = cfg.direction.normalize();
    const color = cfg.color ?? new Color3(1.0, 0.15, 0.05); // Red

    // Build coordinate frame from fire direction
    let right = Vector3.Cross(dir, Vector3.Up());
    if (right.lengthSquared() < 0.001) {
      right = Vector3.Cross(dir, Vector3.Forward());
    }
    right.normalize();
    const up = Vector3.Cross(right, dir).normalize();

    // Generate arc keyframes — blade sweeps ~120° in the up/right plane
    const arcSteps = 12;
    const tipDistance = 15; // How far the tip is from origin
    const handleDistance = 3; // How far the handle is from origin
    const arcAngle = Math.PI * 0.65; // ~117° sweep
    const startAngle = -arcAngle / 2;

    const tipPoints: Vector3[] = [];
    const handlePoints: Vector3[] = [];

    for (let i = 0; i <= arcSteps; i++) {
      const t = i / arcSteps;
      const angle = startAngle + t * arcAngle;

      // Sweep direction in the up/right plane, projected forward
      const sweepDir = up.scale(Math.sin(angle)).add(right.scale(Math.cos(angle)));

      // Tip traces the outer arc
      const tipPos = origin
        .clone()
        .addInPlace(dir.scale(5)) // slightly forward
        .addInPlace(sweepDir.scale(tipDistance));

      // Handle traces a much tighter arc near the origin
      const handlePos = origin.clone().addInPlace(dir.scale(3)).addInPlace(sweepDir.scale(handleDistance));

      tipPoints.push(tipPos);
      handlePoints.push(handlePos);
    }

    if (tipPoints.length < 2) return;

    // Create ribbon mesh
    const id = `slash_${this.nextId++}`;
    const mesh = MeshBuilder.CreateRibbon(
      id,
      {
        pathArray: [tipPoints, handlePoints],
        updatable: false,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this.scene,
    );
    mesh.isPickable = false;

    const mat = new StandardMaterial(`${id}_mat`, this.scene);
    mat.emissiveColor = color;
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.7;
    mat.maxSimultaneousLights = 4;
    mesh.material = mat;

    // Register as active effect — fades automatically via update()
    this.effects.push({
      id,
      meshes: [mesh],
      materials: [mat],
      light: null,
      spawnTime: performance.now() / 1000,
      duration: 0.8, // Same as first-person trail fade
    });
  }
}

// Convenience export
export function getHitscanEffects(): HitscanEffects {
  return HitscanEffects.getInstance();
}
