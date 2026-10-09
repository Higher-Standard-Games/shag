import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createStreakTracerMaterial } from "./StreakTracerMaterial";

const START_DIRTY = 1 << 0;
const END_DIRTY = 1 << 1;
const COLOR_DIRTY = 1 << 2;
const PARAMS_DIRTY = 1 << 3;
const ALL_DIRTY = START_DIRTY | END_DIRTY | COLOR_DIRTY | PARAMS_DIRTY;

/** How fast a streak travels. Fast enough to read as a bullet, slow enough to be seen. */
export const STREAK_SPEED = 12000;
/** Streak length in world units, shortened on short shots so it never outruns its own path. */
const STREAK_LENGTH = 110;
/** Half-width of the glow in world units; the shader keeps at least a pixel and a half. */
const STREAK_HALF_WIDTH = 1.1;

function defaultClock(): number {
  return performance.now() / 1000;
}

/** One shot's streak. */
export interface StreakTracerShot {
  /** Where it starts: the muzzle. */
  start: Vector3;
  /** Where it ends: the hit, or the end of the weapon's range. */
  end: Vector3;
  color: Color3;
  /** Brightness, matching the weapon's muzzle flash intensity. Default 18. */
  intensity?: number;
}

interface StreakSlot {
  spawnTime: number;
  /** Seconds until the tail reaches the end. */
  duration: number;
}

/**
 * Pooled bullet streaks, drawn as thin instances of one quad.
 *
 * Each shot is one instance holding its start, end, spawn time and speed; the
 * vertex shader works out where the streak is, so the whole pool is one draw
 * call with no per-frame CPU work per streak. The machinery is the impact
 * sparks': index-addressed slots, swap-removed on expiry, the oldest recycled
 * when the pool is full.
 */
export class StreakTracerRenderer {
  private readonly scene: Scene;
  private readonly clock: () => number;
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  private readonly capacity: number;
  private readonly slots: StreakSlot[] = [];
  private readonly matrices: Float32Array;
  private readonly startSpawn: Float32Array;
  private readonly endSpeed: Float32Array;
  private readonly colorLength: Float32Array;
  private readonly params: Float32Array;
  private readonly viewport = new Vector2(1, 1);
  private dirtyMask = 0;

  constructor(scene: Scene, clock: () => number = defaultClock, capacity = 128) {
    this.scene = scene;
    this.clock = clock;
    this.capacity = capacity;

    // Named tracer_* so hitscan picking skips it.
    this.mesh = new Mesh("tracer_streak", scene);
    const vertexData = new VertexData();
    // uv in [-1,1]: x runs tail to head along the shot, y across its width.
    vertexData.positions = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
    vertexData.uvs = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    vertexData.indices = new Uint16Array([0, 1, 2, 2, 1, 3]);
    vertexData.applyToMesh(this.mesh, false);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.alphaIndex = 41;
    this.mesh.metadata = { effectOwned: true, streakTracer: true };
    this.material = createStreakTracerMaterial("tracer_streak_material", scene);
    this.mesh.material = this.material;

    this.matrices = new Float32Array(capacity * 16);
    this.startSpawn = new Float32Array(capacity * 4);
    this.endSpeed = new Float32Array(capacity * 4);
    this.colorLength = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) {
      const o = i * 16;
      this.matrices[o] = 1;
      this.matrices[o + 5] = 1;
      this.matrices[o + 10] = 1;
      this.matrices[o + 15] = 1;
    }

    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, true);
    this.mesh.thinInstanceSetBuffer("iStartSpawn", this.startSpawn, 4, false);
    this.mesh.thinInstanceSetBuffer("iEndSpeed", this.endSpeed, 4, false);
    this.mesh.thinInstanceSetBuffer("iColorLength", this.colorLength, 4, false);
    this.mesh.thinInstanceSetBuffer("iParams", this.params, 4, false);
    this.setRenderCount(0);
  }

  private setRenderCount(count: number): void {
    this.mesh.thinInstanceCount = count;
    this.mesh.setEnabled(count > 0);
  }

  private copySlot(buffer: Float32Array, from: number, to: number): void {
    buffer.copyWithin(to * 4, from * 4, from * 4 + 4);
  }

  private removeAt(index: number): void {
    const lastIndex = this.slots.length - 1;
    if (index !== lastIndex) {
      this.slots[index] = this.slots[lastIndex];
      this.copySlot(this.startSpawn, lastIndex, index);
      this.copySlot(this.endSpeed, lastIndex, index);
      this.copySlot(this.colorLength, lastIndex, index);
      this.copySlot(this.params, lastIndex, index);
    }
    this.slots.pop();
    this.setRenderCount(this.slots.length);
    this.dirtyMask |= ALL_DIRTY;
  }

  private oldestIndex(): number {
    let oldest = 0;
    for (let i = 1; i < this.slots.length; i++) {
      if (this.slots[i].spawnTime < this.slots[oldest].spawnTime) oldest = i;
    }
    return oldest;
  }

  /**
   * Fire one streak. Returns the seconds until its head reaches the end, when
   * the impact should play.
   */
  fire(shot: StreakTracerShot): number {
    const now = this.clock();
    const dx = shot.end.x - shot.start.x;
    const dy = shot.end.y - shot.start.y;
    const dz = shot.end.z - shot.start.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const length = Math.min(STREAK_LENGTH, Math.max(8, distance * 0.6));

    if (this.slots.length >= this.capacity) this.removeAt(this.oldestIndex());
    const index = this.slots.length;
    this.slots.push({ spawnTime: now, duration: (distance + length) / STREAK_SPEED });

    const o = index * 4;
    this.startSpawn[o] = shot.start.x;
    this.startSpawn[o + 1] = shot.start.y;
    this.startSpawn[o + 2] = shot.start.z;
    this.startSpawn[o + 3] = now;
    this.endSpeed[o] = shot.end.x;
    this.endSpeed[o + 1] = shot.end.y;
    this.endSpeed[o + 2] = shot.end.z;
    this.endSpeed[o + 3] = STREAK_SPEED;
    this.colorLength[o] = shot.color.r;
    this.colorLength[o + 1] = shot.color.g;
    this.colorLength[o + 2] = shot.color.b;
    this.colorLength[o + 3] = length;
    this.params[o] = STREAK_HALF_WIDTH;
    this.params[o + 1] = shot.intensity ?? 18;
    this.params[o + 2] = 0;
    this.params[o + 3] = 0;

    this.setRenderCount(this.slots.length);
    this.dirtyMask |= ALL_DIRTY;
    return distance / STREAK_SPEED;
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

    if (this.dirtyMask & START_DIRTY) this.mesh.thinInstanceBufferUpdated("iStartSpawn");
    if (this.dirtyMask & END_DIRTY) this.mesh.thinInstanceBufferUpdated("iEndSpeed");
    if (this.dirtyMask & COLOR_DIRTY) this.mesh.thinInstanceBufferUpdated("iColorLength");
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
