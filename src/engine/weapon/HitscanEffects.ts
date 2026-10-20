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
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { generateSpreadDirections, mulberry32, yawPitchFromDirection } from "../../shared/SpreadUtils";
import { devLog } from "../core/DevLog";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import { ImpactSparkRenderer } from "./impact/ImpactSparkRenderer";
import { MuzzleFlashRenderer, type MuzzleFlashSpawn } from "./muzzle/MuzzleFlashRenderer";
import { getPointLightPool, type PooledLightOwner } from "./PointLightPool";
import { RailEffectRenderer } from "./rail/RailEffectRenderer";
import type { RailEffectSample } from "./rail/RailProfiles";
import { StreakTracerRenderer } from "./tracer/StreakTracerRenderer";
import { VoltaicEffectRenderer, type VoltaicRemoteStartResolver } from "./voltaic/VoltaicEffectRenderer";
import type { VoltaicImpactKind } from "./voltaic/VoltaicProfiles";

const TRACER_IMPACT_LIGHT_INTENSITY = 0.25;

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

/**
 * Bullet tracer (machinegun): a streak that travels from the muzzle to where the
 * shot went. `origin` and `direction` are the shot's own ray, the one the
 * server judged; `start` is where the streak is drawn from.
 */
export interface TracerConfig extends HitscanFireConfig {
  /** Where the streak starts (the muzzle). Default `origin`. */
  start?: Vector3;
  /** Brightness, matching the weapon's muzzle flash. Default 18. */
  intensity?: number;
}

/** Continuous beam (lightning-gun-style held beam) */
export interface BeamConfig extends HitscanFireConfig {
  /** Diameter at the barrel (start). Default 0.8 */
  diameterStart?: number;
  /** Diameter at the endpoint (end). Default 0.2 */
  diameterEnd?: number;
  /** Damage-ray origin when the visible beam begins at a cosmetic muzzle. */
  traceOrigin?: Vector3;
}

/** Compact authoritative truth replicated only for the continuous Voltaic beam. */
export interface VoltaicBeamTruthConfig extends HitscanFireConfig {
  endpoint: Vector3;
  impactKind: VoltaicImpactKind;
  impactNormal?: Vector3;
}

/** Largest server-side Voltaic wander that reconciliation may legitimately add. */
export const VOLTAIC_TRUTH_MAX_ANGLE_DEG = 8;

/**
 * Reject a recent server endpoint after the player has already turned away.
 * Without this gate, a 20 Hz truth sample can connect the current muzzle to an
 * endpoint from the previous aim direction and make the whole beam bend sideways.
 */
export function isVoltaicTruthAligned(currentDirection: Vector3, truthDirection: Vector3): boolean {
  const currentLengthSquared = currentDirection.lengthSquared();
  const truthLengthSquared = truthDirection.lengthSquared();
  if (currentLengthSquared < 0.000001 || truthLengthSquared < 0.000001) return false;
  const inverseLengths = 1 / Math.sqrt(currentLengthSquared * truthLengthSquared);
  const dot = Vector3.Dot(currentDirection, truthDirection) * inverseLengths;
  return dot >= Math.cos((VOLTAIC_TRUTH_MAX_ANGLE_DEG * Math.PI) / 180);
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
  /**
   * The server's pellets, exactly (built from the shot's seed with
   * `generateSpreadDirections`). When given they replace the cone, and their
   * number replaces `pelletCount`.
   */
  directions?: readonly Vector3[];
  /** Where the visible tracers start (the muzzle). Default `origin`. */
  start?: Vector3;
}

/**
 * The pellets the server fired, rebuilt from a `weapon_fire` event's direction,
 * seed and cone: the same call the server makes, so every pellet drawn is one
 * that was judged.
 */
export function serverPelletDirections(direction: Vector3, seed: number, count: number, spreadDeg: number): Vector3[] {
  const { yaw, pitch } = yawPitchFromDirection(direction);
  return generateSpreadDirections(seed, count, spreadDeg, yaw, pitch).map((d) => new Vector3(d.x, d.y, d.z));
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

// ── Impact spark budgets ─────────────────────────────────────────────

/**
 * Embers per contact, per weapon class. These fire on every shot, so the
 * rapid-fire weapons stay deliberately thin: a machinegun landing eight sparks
 * per bullet is not detail, it is noise. The star is reserved for weapons that
 * hit once and hard, which is the same reason CartoonHitEffect gates its sprite
 * on damage rather than playing for every tick of chip damage.
 */
const TRACER_SPARKS = 6;
/** Per pellet — a full riotgun blast is this times the pellet count. */
const PELLET_SPARKS = 3;
const BOLT_SPARKS = 14;
const RAIL_SPARKS = 16;

// ── Active effect tracking ───────────────────────────────────────────

interface ActiveEffect {
  id: string;
  meshes: Mesh[];
  materials: StandardMaterial[];
  light: PointLight | null;
  spawnTime: number;
  duration: number;
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
  /** Its own per-frame tick: tracers and beams fade for a spectator, who has no view weapon */
  private tickObserver: Observer<Scene> | null = null;
  private effects: ActiveEffect[] = [];
  private travelingPellets: TravelingPellet[] = [];
  private nextId = 0;

  private static readonly LOCAL_TRUTH_TIMEOUT = 0.1; // seconds

  /** Procedural GPU Voltaic renderer (hero, remote, impacts, and chain arcs). */
  private voltaicRenderer: VoltaicEffectRenderer | null = null;
  /** Procedural GPU Electrobolt rail renderer (one-shot analytic helix rails). */
  private railRenderer: RailEffectRenderer | null = null;
  /** Procedural GPU muzzle flashes (shared base, per-weapon style). */
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  /** Procedural GPU impact sparks (ember scatter, plus a hit star on heavy contacts). */
  private impactSparkRenderer: ImpactSparkRenderer | null = null;
  /** Procedural GPU bullet streaks (machinegun tracers). */
  private streakRenderer: StreakTracerRenderer | null = null;
  /** Impacts waiting for their streak to arrive, by the time it does. */
  private pendingImpacts: { due: number; play: () => void }[] = [];
  private muzzleAnchorResolver: (() => Vector3 | null) | null = null;
  private remoteVoltaicStartResolver: VoltaicRemoteStartResolver | null = null;
  private readonly localVoltaicEndpoint = new Vector3();
  private readonly localVoltaicNormal = new Vector3();
  private readonly localVoltaicDirection = new Vector3();
  /** Scratch for the rail's travel direction; burst() copies out before returning. */
  private readonly railImpactDirection = new Vector3();
  private localVoltaicImpactKind: VoltaicImpactKind = "none";
  private localVoltaicHasNormal = false;
  private localVoltaicHasDirection = false;
  private localVoltaicTruthAt = -Infinity;

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
    if (this.tickObserver) this.scene?.onBeforeRenderObservable.remove(this.tickObserver);
    this.tickObserver = scene.onBeforeRenderObservable.add(() => this.update(scene.getEngine().getDeltaTime() / 1000));
    if (this.scene !== scene) {
      this.voltaicRenderer?.dispose();
      this.voltaicRenderer = new VoltaicEffectRenderer(scene);
      this.voltaicRenderer.setRemoteStartResolver(this.remoteVoltaicStartResolver);
      void this.voltaicRenderer.prewarm().catch((error) => {
        console.warn("[HitscanEffects] Voltaic shader prewarm failed; first use will retry compilation", error);
      });

      this.railRenderer?.dispose();
      this.railRenderer = new RailEffectRenderer(scene);
      void this.railRenderer.prewarm().catch((error) => {
        console.warn("[HitscanEffects] Rail shader prewarm failed; first use will retry compilation", error);
      });

      this.muzzleFlashRenderer?.dispose();
      this.muzzleFlashRenderer = new MuzzleFlashRenderer(scene);
      this.muzzleFlashRenderer.setAnchorResolver(this.muzzleAnchorResolver);
      void this.muzzleFlashRenderer.prewarm().catch((error) => {
        console.warn("[HitscanEffects] Muzzle flash shader prewarm failed; first use will retry compilation", error);
      });

      this.impactSparkRenderer?.dispose();
      this.impactSparkRenderer = new ImpactSparkRenderer(scene);
      void this.impactSparkRenderer.prewarm().catch((error) => {
        console.warn("[HitscanEffects] Impact spark shader prewarm failed; first use will retry compilation", error);
      });

      this.streakRenderer?.dispose();
      this.streakRenderer = new StreakTracerRenderer(scene);
      void this.streakRenderer.prewarm().catch((error) => {
        console.warn("[HitscanEffects] Tracer shader prewarm failed; first use will retry compilation", error);
      });
      this.pendingImpacts = [];
    }
    this.scene = scene;
    devLog("[HitscanEffects] Initialized");
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Bullet tracer  (machinegun, generic hitscan)
   * A streak from the muzzle to where the shot's ray hits; the wall mark, sparks
   * and impact flash play when the streak gets there.
   */
  fireTracer(cfg: TracerConfig): Vector3 | null {
    if (!this.scene) return null;
    const range = cfg.maxRange ?? 8192;
    const color = cfg.color ?? new Color3(1.0, 0.85, 0.3); // warm yellow

    const hit = this.traceRay(cfg.origin, cfg.direction, range);
    const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));
    const travel =
      this.streakRenderer?.fire({ start: cfg.start ?? cfg.origin, end: endpoint, color, intensity: cfg.intensity }) ??
      0;

    if (hit) {
      const direction = cfg.direction.clone();
      this.afterDelay(travel, () => {
        const effect: ActiveEffect = {
          id: `tracer_flash_${this.nextId++}`,
          meshes: [],
          materials: [],
          light: null,
          spawnTime: performance.now() / 1000,
          duration: 0.16,
        };
        effect.light = this.spawnImpactFlash(hit.point, color, hit.normal, effect, TRACER_IMPACT_LIGHT_INTENSITY);
        this.effects.push(effect);
        this.spawnWallMark(hit.point, hit.normal, color, 0.3);
        this.spawnImpactSparks(hit.point, hit.normal, direction, color, TRACER_SPARKS, false);
      });
    }

    return hit?.point ?? null;
  }

  /** Run `play` once `seconds` have passed, from the per-frame update; at once when 0. */
  private afterDelay(seconds: number, play: () => void): void {
    if (seconds <= 0) {
      play();
      return;
    }
    this.pendingImpacts.push({ due: performance.now() / 1000 + seconds, play });
  }

  // ── Procedural continuous Voltaic beam ───────────────────────────

  /** Procedural local hero beam. Call every frame while Voltaic is firing. */
  updateLightningBeam(cfg: BeamConfig): Vector3 | null {
    if (!this.scene || !this.voltaicRenderer) return null;
    const range = cfg.maxRange ?? 850;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1);
    const now = performance.now() / 1000;
    const hasFreshTruth =
      this.localVoltaicHasDirection &&
      now - this.localVoltaicTruthAt <= HitscanEffects.LOCAL_TRUTH_TIMEOUT &&
      isVoltaicTruthAligned(cfg.direction, this.localVoltaicDirection);
    const traceOrigin = cfg.traceOrigin ?? cfg.origin;
    const hit = hasFreshTruth ? null : this.traceRay(traceOrigin, cfg.direction, range);
    const endpoint = hasFreshTruth
      ? this.localVoltaicEndpoint
      : (hit?.point ?? traceOrigin.add(cfg.direction.scale(range)));
    const impactKind = hasFreshTruth ? this.localVoltaicImpactKind : hit ? "world" : "none";
    const impactNormal = hasFreshTruth
      ? this.localVoltaicHasNormal
        ? this.localVoltaicNormal
        : undefined
      : hit?.normal;
    this.voltaicRenderer.updateHero({
      start: cfg.origin,
      end: endpoint,
      color,
      impactKind,
      impactNormal,
    });
    return impactKind === "none" ? null : endpoint;
  }

  /** Starts a new local activation without inheriting a late packet from the previous beam. */
  beginLightning(): void {
    this.localVoltaicTruthAt = -Infinity;
    this.localVoltaicImpactKind = "none";
    this.localVoltaicHasNormal = false;
    this.localVoltaicHasDirection = false;
  }

  /** Reconcile the hero beam to the exact server damage ray/contact. */
  updateLocalLightningTruth(cfg: VoltaicBeamTruthConfig): void {
    this.localVoltaicEndpoint.copyFrom(cfg.endpoint);
    this.localVoltaicDirection.copyFrom(cfg.direction);
    const directionLengthSquared = this.localVoltaicDirection.lengthSquared();
    this.localVoltaicHasDirection = directionLengthSquared > 0.000001;
    if (this.localVoltaicHasDirection) this.localVoltaicDirection.scaleInPlace(1 / Math.sqrt(directionLengthSquared));
    this.localVoltaicImpactKind = cfg.impactKind;
    this.localVoltaicHasNormal = !!cfg.impactNormal;
    if (cfg.impactNormal) this.localVoltaicNormal.copyFrom(cfg.impactNormal);
    this.localVoltaicTruthAt = performance.now() / 1000;
  }

  /** Stop the local player's lightning beam. */
  stopLightning(): void {
    this.voltaicRenderer?.stopHero();
    this.localVoltaicTruthAt = -Infinity;
    this.localVoltaicImpactKind = "none";
    this.localVoltaicHasNormal = false;
    this.localVoltaicHasDirection = false;
  }

  /** One-shot procedural arc between actual chain-lightning points. */
  fireLightningArc(from: Vector3, to: Vector3, color?: Color3, duration = 0.14): void {
    if (!this.scene || !this.voltaicRenderer) return;
    const col = color ?? new Color3(1.0, 0.7, 0.1);
    this.voltaicRenderer.fireChainArc(
      {
        start: from,
        end: to,
        color: col,
        impactKind: "player",
        intensity: 1.12,
      },
      duration,
    );
  }

  /** Simplified remote presentation driven by authoritative endpoint truth. */
  updateRemoteLightningBeam(entityId: string | number, cfg: VoltaicBeamTruthConfig): void {
    if (!this.voltaicRenderer) return;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1);
    this.voltaicRenderer.updateRemote(
      String(entityId),
      {
        start: cfg.origin,
        end: cfg.endpoint,
        color,
        impactKind: cfg.impactKind,
        impactNormal: cfg.impactNormal,
      },
      cfg.direction,
    );
  }

  /** One-trace fallback for legacy demos or a missing authoritative truth event. */
  updateRemoteLightningFallback(entityId: string | number, cfg: BeamConfig): void {
    if (!this.scene || !this.voltaicRenderer) return;
    const range = cfg.maxRange ?? 850;
    const color = cfg.color ?? new Color3(1.0, 0.7, 0.1);
    const rayOrigin = cfg.traceOrigin ?? cfg.origin;
    const hit = this.traceRay(rayOrigin, cfg.direction, range);
    const endpoint = hit?.point ?? rayOrigin.add(cfg.direction.scale(range));
    this.voltaicRenderer.updateRemote(
      String(entityId),
      {
        start: cfg.origin,
        end: endpoint,
        color,
        impactKind: hit ? "world" : "none",
        impactNormal: hit?.normal,
      },
      cfg.direction,
    );
  }

  setRemoteLightningMuzzleResolver(resolver: VoltaicRemoteStartResolver): void {
    this.remoteVoltaicStartResolver = resolver;
    this.voltaicRenderer?.setRemoteStartResolver(resolver);
  }

  clearRemoteLightningMuzzleResolver(resolver: VoltaicRemoteStartResolver): void {
    if (this.remoteVoltaicStartResolver !== resolver) return;
    this.remoteVoltaicStartResolver = null;
    this.voltaicRenderer?.setRemoteStartResolver(null);
  }

  /**
   * Pellet spread  (riotgun / shotgun)
   * Fires N rays in a cone with deterministic or random spread.
   * Shows a subset as "traveling" thick tracers and spawns impact sparks for all hits.
   */
  firePellets(cfg: PelletConfig): Vector3[] {
    if (!this.scene) return [];
    const count = cfg.directions?.length ?? cfg.pelletCount ?? 20;
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

    const start = cfg.start ?? cfg.origin;
    for (let i = 0; i < count; i++) {
      // The server's pellet when given; otherwise one drawn from the cone
      const dir = cfg.directions?.[i] ?? this.spreadDirectionSeeded(cfg.direction, spreadRad, rng);
      const hit = this.traceRay(cfg.origin, dir, range);
      const endpoint = hit?.point ?? cfg.origin.add(dir.scale(range));

      if (hit?.point) hitPoints.push(hit.point);

      // Every pellet marks and sparks; only the consolidated flash below is
      // shared, because lights are the expensive part, not instances.
      if (hit?.point) {
        this.spawnWallMark(hit.point, hit.normal, color, 2.0);
        this.spawnImpactSparks(hit.point, hit.normal, dir, color, PELLET_SPARKS, false);
      }

      // Traveling tracer only for selected representative pellets (no per-pellet lights)
      if (tracerIndices.has(i)) {
        this.spawnTravelingPellet(start, endpoint, color, duration, now);
      }
    }

    // Single consolidated impact light at the centroid of all hit points.
    // Much cheaper than N separate PointLights — all pellets land in
    // roughly the same area anyway. Boosted intensity + range to compensate.
    if (hitPoints.length > 0) {
      const centroid = hitPoints
        .reduce((acc, p) => acc.addInPlace(p), Vector3.Zero())
        .scaleInPlace(1 / hitPoints.length);
      // Tracked for cleanup via a lightweight effect entry
      const flash: ActiveEffect = {
        id: `pellet_flash_${this.nextId++}`,
        meshes: [],
        materials: [],
        light: null,
        spawnTime: now,
        duration: duration * 2,
      };
      const impactLight = this.spawnImpactFlash(centroid, color, undefined, flash);
      if (impactLight) {
        impactLight.intensity = 40; // boosted (was 25 per pellet)
        impactLight.range = 80; // wider to cover spread area
        flash.light = impactLight;
        this.effects.push(flash);
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
    applySafeMaxSimultaneousLights(mat);
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
    applySafeMaxSimultaneousLights(coreMat);
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
    applySafeMaxSimultaneousLights(glowMat);
    glow.material = glowMat;
    this.orientCylinder(glow, cfg.origin, endpoint);
    meshes.push(glow);

    const effect: ActiveEffect = {
      id,
      meshes,
      materials: [coreMat, glowMat],
      light: null,
      spawnTime: performance.now() / 1000,
      duration,
    };
    // Bright impact flash
    effect.light = this.spawnImpactFlash(endpoint, color, hit?.normal, effect);
    this.effects.push(effect);

    // Leave a scorch mark at impact
    if (hit) {
      this.spawnWallMark(hit.point, hit.normal, color, 1.0);
      this.spawnImpactSparks(hit.point, hit.normal, cfg.direction, color, BOLT_SPARKS, true);
    }

    return hit?.point ?? null;
  }

  /**
   * Fire a one-shot Electrobolt rail from `sample.start` (muzzle) to
   * `sample.end` (authoritative impact). Presentation-only; the endpoint/normal
   * come from the server `electro_rail` event so the visual can never diverge
   * from the damage trace. `sample` fields are copied synchronously — callers
   * may reuse scratch vectors. Leaves a scorch mark on a world contact.
   */
  fireRail(sample: RailEffectSample): void {
    if (!this.scene || !this.railRenderer) return;
    this.railRenderer.fireRail(sample);
    if (sample.impactKind === "world" && sample.impactNormal) {
      this.spawnWallMark(sample.end, sample.impactNormal, sample.color, 1.0);
      sample.end.subtractToRef(sample.start, this.railImpactDirection);
      this.spawnImpactSparks(
        sample.end,
        sample.impactNormal,
        this.railImpactDirection,
        sample.color,
        RAIL_SPARKS,
        true,
      );
    }
  }

  /**
   * Spawn a procedural muzzle flash at a world position (the gun muzzle). One
   * shared effect skinned per weapon by `style`; `spawn` fields are copied
   * synchronously so callers may reuse scratch vectors.
   */
  fireMuzzleFlash(spawn: MuzzleFlashSpawn): void {
    if (!this.scene || !this.muzzleFlashRenderer) return;
    this.muzzleFlashRenderer.spawn(spawn);
  }

  /**
   * Register a resolver for the live local muzzle world position. Muzzle flashes
   * re-track it every frame so they ride the barrel instead of floating where the
   * gun was at fire time (matters for fast-firing guns while strafing).
   */
  setMuzzleAnchorResolver(resolver: (() => Vector3 | null) | null): void {
    this.muzzleAnchorResolver = resolver;
    this.muzzleFlashRenderer?.setAnchorResolver(resolver);
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

    // Impacts whose streak has arrived
    if (this.pendingImpacts.length > 0) {
      const due = this.pendingImpacts.filter((impact) => impact.due <= now);
      if (due.length > 0) {
        this.pendingImpacts = this.pendingImpacts.filter((impact) => impact.due > now);
        for (const impact of due) impact.play();
      }
    }

    this.voltaicRenderer?.update(_deltaTime);
    this.railRenderer?.update(_deltaTime);
    this.muzzleFlashRenderer?.update(_deltaTime);
    this.impactSparkRenderer?.update(_deltaTime);
    this.streakRenderer?.update(_deltaTime);
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
    // Bullet holes belong to the map and moment they were made; the shared
    // material stays for the next ones.
    for (const mark of this.wallMarks) mark.mesh.dispose();
    this.wallMarks = [];
    this.stopLightning();
    this.voltaicRenderer?.clear();
    this.railRenderer?.clear();
    this.muzzleFlashRenderer?.clear();
    this.impactSparkRenderer?.clear();
    this.streakRenderer?.clear();
    this.pendingImpacts = [];
  }

  /**
   * Sparks for one contact. Paired with every wall mark: the mark is what the
   * shot left behind, this is the shot arriving.
   */
  private spawnImpactSparks(
    position: Vector3,
    normal: Vector3,
    incoming: Vector3,
    color: Color3,
    count: number,
    heavy: boolean,
  ): void {
    this.impactSparkRenderer?.burst({ position, normal, incoming, color, count, heavy });
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

  /** Spawn a small impact flash light for `owner`, which releases it. */
  private spawnImpactFlash(
    pos: Vector3,
    color: Color3,
    normal: Vector3 | undefined,
    owner: PooledLightOwner,
    intensity = 25,
  ): PointLight | null {
    if (!this.scene) return null;

    // Offset slightly along normal to prevent Z-fighting
    const offset = normal ? normal.scale(0.05) : Vector3.Zero();

    const light = getPointLightPool().acquire(pos.add(offset), color, intensity, 60, owner);

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
      applySafeMaxSimultaneousLights(this.wallMarkMaterial);
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
    applySafeMaxSimultaneousLights(mat);
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
