import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { mulberry32 } from "../../../shared/SpreadUtils";
import { createImpactSparkMaterial } from "./ImpactSparkMaterial";

const ORIGIN_SEED_DIRTY = 1 << 0;
const VELOCITY_KIND_DIRTY = 1 << 1;
const COLOR_SPAWN_DIRTY = 1 << 2;
const PARAMS_DIRTY = 1 << 3;
const ALL_DIRTY = ORIGIN_SEED_DIRTY | VELOCITY_KIND_DIRTY | COLOR_SPAWN_DIRTY | PARAMS_DIRTY;

/** Quake gravity, so sparks fall at the same rate as everything else in the map. */
const SPARK_GRAVITY = 800;
/** Ember launch speed before the per-burst multiplier and per-spark variation. */
const BASE_SPARK_SPEED = 265;
const BASE_SPARK_SIZE = 3.4;
const SPARK_MIN_DURATION = 0.16;
const SPARK_MAX_DURATION = 0.34;
const STAR_SIZE = 15;
const STAR_DURATION = 0.17;

/**
 * How far the scatter is pulled off the mirror direction toward the surface
 * normal. Pure reflection sends sparks along the wall at a grazing hit, where
 * they clip through it; leaning toward the normal keeps the burst in the room.
 */
const NORMAL_BIAS = 0.36;
/** Half-angle of the scatter cone around the biased direction, in radians. */
const SCATTER_CONE = 0.62;
/**
 * Smallest component every ember must keep along the surface normal. The cone
 * is wide enough that a grazing hit would otherwise scatter some sparks *into*
 * the wall, where they are drawn for a frame and then vanish inside it.
 */
const MIN_NORMAL_COMPONENT = 0.15;

interface SparkSlot {
  spawnTime: number;
  duration: number;
}

function defaultClock(): number {
  return performance.now() / 1000;
}

/** One impact's worth of sparks. */
export interface ImpactSparkBurst {
  /** Contact point in world space. */
  position: Vector3;
  /** Surface normal at the contact. */
  normal: Vector3;
  /** Direction the shot was travelling — the scatter mirrors about the normal. */
  incoming: Vector3;
  color: Color3;
  /** Ember count. Default 8. */
  count?: number;
  /** Adds the posterized hit star. Reserve it for heavy weapons. Default false. */
  heavy?: boolean;
  /** Launch-speed multiplier. Default 1. */
  speed?: number;
  /** Brightness, matching the weapon def's light intensity. Default 20. */
  intensity?: number;
}

/**
 * Pooled procedural impact sparks, drawn as thin instances of one quad.
 *
 * Every contact used to leave a fading triangle and nothing else, so no shot
 * read as touching the surface it hit. Each ember here is an instance carrying
 * its own launch velocity; the vertex shader integrates the arc, which keeps
 * the whole system at one draw call and no per-frame CPU work regardless of how
 * many are alive.
 *
 * Slots are index-addressed and never updated after spawn, so expiry swaps the
 * last slot into the freed index — the same machinery the muzzle flash uses.
 */
export class ImpactSparkRenderer {
  private readonly scene: Scene;
  private readonly clock: () => number;
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  private readonly capacity: number;
  private readonly slots: SparkSlot[] = [];
  private readonly matrices: Float32Array;
  private readonly originSeed: Float32Array;
  private readonly velocityKind: Float32Array;
  private readonly colorSpawn: Float32Array;
  private readonly params: Float32Array;
  private readonly viewport = new Vector2(1, 1);
  private dirtyMask = 0;
  private seedCounter = 0;
  /** Seeded so a test can assert an exact scatter; bursts need no cross-client agreement. */
  private random: () => number;

  constructor(scene: Scene, clock: () => number = defaultClock, capacity = 768, seed = 0x5eed) {
    this.scene = scene;
    this.clock = clock;
    this.capacity = capacity;
    this.random = mulberry32(seed);

    this.mesh = new Mesh("impact_spark", scene);
    const vertexData = new VertexData();
    // uv in [-1,1]: x runs tail to head along the streak, y across its width.
    vertexData.positions = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
    vertexData.uvs = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    vertexData.indices = new Uint16Array([0, 1, 2, 2, 1, 3]);
    vertexData.applyToMesh(this.mesh, false);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.alphaIndex = 42;
    this.mesh.metadata = { effectOwned: true, impactSpark: true };
    this.material = createImpactSparkMaterial("impact_spark_material", scene);
    this.mesh.material = this.material;

    this.matrices = new Float32Array(capacity * 16);
    this.originSeed = new Float32Array(capacity * 4);
    this.velocityKind = new Float32Array(capacity * 4);
    this.colorSpawn = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) {
      const o = i * 16;
      this.matrices[o] = 1;
      this.matrices[o + 5] = 1;
      this.matrices[o + 10] = 1;
      this.matrices[o + 15] = 1;
    }

    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, true);
    this.mesh.thinInstanceSetBuffer("iOriginSeed", this.originSeed, 4, false);
    this.mesh.thinInstanceSetBuffer("iVelocityKind", this.velocityKind, 4, false);
    this.mesh.thinInstanceSetBuffer("iColorSpawn", this.colorSpawn, 4, false);
    this.mesh.thinInstanceSetBuffer("iParams", this.params, 4, false);
    this.setRenderCount(0);
  }

  private setRenderCount(count: number): void {
    this.mesh.thinInstanceCount = count;
    this.mesh.setEnabled(count > 0);
  }

  private copyVector4Slot(buffer: Float32Array, from: number, to: number): void {
    buffer.copyWithin(to * 4, from * 4, from * 4 + 4);
  }

  private removeAt(index: number): void {
    const lastIndex = this.slots.length - 1;
    if (index !== lastIndex) {
      this.slots[index] = this.slots[lastIndex];
      this.copyVector4Slot(this.originSeed, lastIndex, index);
      this.copyVector4Slot(this.velocityKind, lastIndex, index);
      this.copyVector4Slot(this.colorSpawn, lastIndex, index);
      this.copyVector4Slot(this.params, lastIndex, index);
    }
    this.slots.pop();
    this.setRenderCount(this.slots.length);
    this.dirtyMask |= ALL_DIRTY;
  }

  private oldestIndex(): number {
    let oldest = 0;
    let oldestTime = this.slots[0]?.spawnTime ?? 0;
    for (let i = 1; i < this.slots.length; i++) {
      if (this.slots[i].spawnTime < oldestTime) {
        oldest = i;
        oldestTime = this.slots[i].spawnTime;
      }
    }
    return oldest;
  }

  /** Write one instance, recycling the oldest slot when the pool is full. */
  private push(
    position: Vector3,
    velocityX: number,
    velocityY: number,
    velocityZ: number,
    kind: number,
    color: Color3,
    size: number,
    duration: number,
    gravity: number,
    intensity: number,
    now: number,
  ): void {
    if (this.slots.length >= this.capacity) this.removeAt(this.oldestIndex());

    const index = this.slots.length;
    this.slots.push({ spawnTime: now, duration });
    this.seedCounter = (this.seedCounter + 1) % 8191;

    const o = index * 4;
    this.originSeed[o] = position.x;
    this.originSeed[o + 1] = position.y;
    this.originSeed[o + 2] = position.z;
    this.originSeed[o + 3] = this.seedCounter + 1;
    this.velocityKind[o] = velocityX;
    this.velocityKind[o + 1] = velocityY;
    this.velocityKind[o + 2] = velocityZ;
    this.velocityKind[o + 3] = kind;
    this.colorSpawn[o] = color.r;
    this.colorSpawn[o + 1] = color.g;
    this.colorSpawn[o + 2] = color.b;
    this.colorSpawn[o + 3] = now;
    this.params[o] = size;
    this.params[o + 1] = duration;
    this.params[o + 2] = gravity;
    this.params[o + 3] = intensity;

    this.setRenderCount(this.slots.length);
    this.dirtyMask |= ALL_DIRTY;
  }

  /** Spawn one impact's embers, plus the hit star when the burst is heavy. */
  burst(burst: ImpactSparkBurst): void {
    const now = this.clock();
    const count = Math.max(0, Math.floor(burst.count ?? 8));
    const intensity = burst.intensity ?? 20;

    const nx = burst.normal.x;
    const ny = burst.normal.y;
    const nz = burst.normal.z;
    const normalLengthSquared = nx * nx + ny * ny + nz * nz;
    // A degenerate normal cannot define a scatter; a straight-up burst still
    // reads as an impact, where NaN velocities would silently kill the buffer.
    const inverseNormal = normalLengthSquared > 1e-6 ? 1 / Math.sqrt(normalLengthSquared) : 0;
    const unitNx = inverseNormal ? nx * inverseNormal : 0;
    const unitNy = inverseNormal ? ny * inverseNormal : 1;
    const unitNz = inverseNormal ? nz * inverseNormal : 0;

    const ix = burst.incoming.x;
    const iy = burst.incoming.y;
    const iz = burst.incoming.z;
    const incomingLengthSquared = ix * ix + iy * iy + iz * iz;
    const inverseIncoming = incomingLengthSquared > 1e-6 ? 1 / Math.sqrt(incomingLengthSquared) : 0;
    const unitIx = ix * inverseIncoming;
    const unitIy = iy * inverseIncoming;
    const unitIz = iz * inverseIncoming;

    // Mirror the shot about the surface, then lean it back toward the normal.
    const dot = unitIx * unitNx + unitIy * unitNy + unitIz * unitNz;
    let baseX = unitIx - 2 * dot * unitNx;
    let baseY = unitIy - 2 * dot * unitNy;
    let baseZ = unitIz - 2 * dot * unitNz;
    baseX += (unitNx - baseX) * NORMAL_BIAS;
    baseY += (unitNy - baseY) * NORMAL_BIAS;
    baseZ += (unitNz - baseZ) * NORMAL_BIAS;
    const baseLengthSquared = baseX * baseX + baseY * baseY + baseZ * baseZ;
    if (baseLengthSquared > 1e-6) {
      const inverseBase = 1 / Math.sqrt(baseLengthSquared);
      baseX *= inverseBase;
      baseY *= inverseBase;
      baseZ *= inverseBase;
    } else {
      baseX = unitNx;
      baseY = unitNy;
      baseZ = unitNz;
    }

    // Orthonormal frame around the scatter axis.
    const axisFallback = Math.abs(baseY) < 0.999;
    let rightX = axisFallback ? -baseZ : 0;
    let rightY = 0;
    let rightZ = axisFallback ? baseX : 1;
    const rightLengthSquared = rightX * rightX + rightY * rightY + rightZ * rightZ;
    if (rightLengthSquared > 1e-6) {
      const inverseRight = 1 / Math.sqrt(rightLengthSquared);
      rightX *= inverseRight;
      rightY *= inverseRight;
      rightZ *= inverseRight;
    }
    const upX = baseY * rightZ - baseZ * rightY;
    const upY = baseZ * rightX - baseX * rightZ;
    const upZ = baseX * rightY - baseY * rightX;

    const speedScale = burst.speed ?? 1;
    for (let i = 0; i < count; i++) {
      const radius = Math.sqrt(this.random()) * Math.tan(SCATTER_CONE);
      const theta = this.random() * Math.PI * 2;
      const offsetRight = radius * Math.cos(theta);
      const offsetUp = radius * Math.sin(theta);

      let dirX = baseX + rightX * offsetRight + upX * offsetUp;
      let dirY = baseY + rightY * offsetRight + upY * offsetUp;
      let dirZ = baseZ + rightZ * offsetRight + upZ * offsetUp;
      let dirLengthSquared = dirX * dirX + dirY * dirY + dirZ * dirZ;
      let inverseDir = dirLengthSquared > 1e-6 ? 1 / Math.sqrt(dirLengthSquared) : 0;
      dirX *= inverseDir;
      dirY *= inverseDir;
      dirZ *= inverseDir;

      // Lift anything aimed at or below the surface back out of it.
      const alongNormal = dirX * unitNx + dirY * unitNy + dirZ * unitNz;
      if (alongNormal < MIN_NORMAL_COMPONENT) {
        const lift = MIN_NORMAL_COMPONENT - alongNormal;
        dirX += unitNx * lift;
        dirY += unitNy * lift;
        dirZ += unitNz * lift;
        dirLengthSquared = dirX * dirX + dirY * dirY + dirZ * dirZ;
        inverseDir = dirLengthSquared > 1e-6 ? 1 / Math.sqrt(dirLengthSquared) : 0;
        dirX *= inverseDir;
        dirY *= inverseDir;
        dirZ *= inverseDir;
      }

      // Vary speed and lifetime per spark so the burst has depth rather than
      // expanding as one clean shell.
      const speed = BASE_SPARK_SPEED * speedScale * (0.45 + 0.75 * this.random());
      const duration = SPARK_MIN_DURATION + (SPARK_MAX_DURATION - SPARK_MIN_DURATION) * this.random();
      const size = BASE_SPARK_SIZE * (0.75 + 0.5 * this.random());
      this.push(
        burst.position,
        dirX * speed,
        dirY * speed,
        dirZ * speed,
        0,
        burst.color,
        size,
        duration,
        SPARK_GRAVITY,
        intensity,
        now,
      );
    }

    if (burst.heavy) {
      // The star holds its place on the surface: no velocity, no gravity.
      this.push(burst.position, 0, 0, 0, 1, burst.color, STAR_SIZE, STAR_DURATION, 0, intensity, now);
    }
  }

  update(_deltaTime: number): void {
    const now = this.clock();
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (now - this.slots[i].spawnTime >= this.slots[i].duration) this.removeAt(i);
    }

    const engine = this.scene.getEngine();
    this.viewport.set(Math.max(1, engine.getRenderWidth()), Math.max(1, engine.getRenderHeight()));
    this.material.setFloat("uTime", now);
    this.material.setVector2("uViewport", this.viewport);

    if (this.slots.length === 0) {
      this.dirtyMask = 0;
      return;
    }

    if (this.dirtyMask & ORIGIN_SEED_DIRTY) this.mesh.thinInstanceBufferUpdated("iOriginSeed");
    if (this.dirtyMask & VELOCITY_KIND_DIRTY) this.mesh.thinInstanceBufferUpdated("iVelocityKind");
    if (this.dirtyMask & COLOR_SPAWN_DIRTY) this.mesh.thinInstanceBufferUpdated("iColorSpawn");
    if (this.dirtyMask & PARAMS_DIRTY) this.mesh.thinInstanceBufferUpdated("iParams");
    this.dirtyMask = 0;
  }

  async prewarm(): Promise<void> {
    if (this.slots.length === 0) this.setRenderCount(1);
    try {
      await this.material.forceCompilationAsync(this.mesh, { useInstances: true });
    } finally {
      this.setRenderCount(this.slots.length);
    }
  }

  clear(): void {
    this.slots.length = 0;
    this.dirtyMask = 0;
    this.setRenderCount(0);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }

  getDebugCount(): number {
    return this.slots.length;
  }
}
