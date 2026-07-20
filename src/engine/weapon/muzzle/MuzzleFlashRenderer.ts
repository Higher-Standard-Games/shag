import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { MuzzleFlashStyle } from "../../../shared/entities/WeaponDef";
import { createMuzzleFlashMaterial } from "./MuzzleFlashMaterial";

const CENTER_SEED_DIRTY = 1 << 0;
const COLOR_SPAWN_DIRTY = 1 << 1;
const PARAMS_DIRTY = 1 << 2;
const ALL_DIRTY = CENTER_SEED_DIRTY | COLOR_SPAWN_DIRTY | PARAMS_DIRTY;

/** Base world size of a flash before the per-weapon scale multiplier. */
const BASE_FLASH_SIZE = 8.5;

const STYLE_TO_FLOAT: Record<MuzzleFlashStyle, number> = { burst: 0, plume: 1, arcs: 2 };

interface FlashSlot {
  spawnTime: number;
  duration: number;
}

function defaultClock(): number {
  return performance.now() / 1000;
}

/** Options for one muzzle flash. */
export interface MuzzleFlashSpawn {
  position: Vector3;
  color: Color3;
  style?: MuzzleFlashStyle;
  /** Per-weapon size multiplier. */
  scale?: number;
  /** Light intensity from the weapon def — drives flash brightness. */
  intensity?: number;
  /** Lifetime in seconds. */
  duration?: number;
}

/**
 * Pool of one-shot procedural muzzle flashes, rendered as thin instances of a
 * single camera-facing quad. Each fired shot occupies one slot until it fades
 * (age ≥ duration); at capacity the oldest is recycled. Mirrors the rail
 * renderer's buffer/dirty-mask machinery — index-addressed only (a flash is
 * never updated after spawn), removal swaps the last slot into the freed index.
 */
export class MuzzleFlashRenderer {
  private readonly scene: Scene;
  private readonly clock: () => number;
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  private readonly capacity: number;
  private readonly slots: FlashSlot[] = [];
  private readonly matrices: Float32Array;
  private readonly centerSeed: Float32Array;
  private readonly colorSpawn: Float32Array;
  private readonly params: Float32Array;
  private readonly viewport = new Vector2(1, 1);
  private dirtyMask = 0;
  private seedCounter = 0;
  /** When set, live flashes re-track this position every frame (the live muzzle). */
  private anchorResolver: (() => Vector3 | null) | null = null;

  constructor(scene: Scene, clock: () => number = defaultClock, capacity = 24) {
    this.scene = scene;
    this.clock = clock;
    this.capacity = capacity;

    this.mesh = new Mesh("muzzle_flash", scene);
    const vertexData = new VertexData();
    // One quad, uv in [-1,1] so the fragment can work in centered polar coords.
    vertexData.positions = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
    vertexData.uvs = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    vertexData.indices = new Uint16Array([0, 1, 2, 2, 1, 3]);
    vertexData.applyToMesh(this.mesh, false);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.alphaIndex = 42;
    this.mesh.metadata = { effectOwned: true, muzzleFlash: true };
    this.material = createMuzzleFlashMaterial("muzzle_flash_material", scene);
    this.mesh.material = this.material;

    this.matrices = new Float32Array(capacity * 16);
    this.centerSeed = new Float32Array(capacity * 4);
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
    this.mesh.thinInstanceSetBuffer("iCenterSeed", this.centerSeed, 4, false);
    this.mesh.thinInstanceSetBuffer("iColorSpawn", this.colorSpawn, 4, false);
    this.mesh.thinInstanceSetBuffer("iParams", this.params, 4, false);
    this.setRenderCount(0);
  }

  private setRenderCount(count: number): void {
    this.mesh.thinInstanceCount = count;
    this.mesh.setEnabled(count > 0);
  }

  /**
   * Set a resolver for the live muzzle world position. While set, every active
   * flash re-tracks it each frame so flashes ride the barrel instead of freezing
   * where the gun was at fire time. Pass null to leave flashes world-fixed.
   */
  setAnchorResolver(resolver: (() => Vector3 | null) | null): void {
    this.anchorResolver = resolver;
  }

  private copyVector4Slot(buffer: Float32Array, from: number, to: number): void {
    buffer.copyWithin(to * 4, from * 4, from * 4 + 4);
  }

  private removeAt(index: number): void {
    const lastIndex = this.slots.length - 1;
    if (index !== lastIndex) {
      this.slots[index] = this.slots[lastIndex];
      this.copyVector4Slot(this.centerSeed, lastIndex, index);
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

  /** Spawn a one-shot muzzle flash at a world position. */
  spawn(flash: MuzzleFlashSpawn): void {
    const now = this.clock();
    if (this.slots.length >= this.capacity) this.removeAt(this.oldestIndex());

    const index = this.slots.length;
    const duration = flash.duration ?? 0.06;
    this.slots.push({ spawnTime: now, duration });

    this.seedCounter = (this.seedCounter + 1) % 8191;
    const seed = this.seedCounter + 1;
    const size = BASE_FLASH_SIZE * (flash.scale ?? 1);
    const styleFloat = STYLE_TO_FLOAT[flash.style ?? "burst"];

    const o = index * 4;
    this.centerSeed[o] = flash.position.x;
    this.centerSeed[o + 1] = flash.position.y;
    this.centerSeed[o + 2] = flash.position.z;
    this.centerSeed[o + 3] = seed;
    this.colorSpawn[o] = flash.color.r;
    this.colorSpawn[o + 1] = flash.color.g;
    this.colorSpawn[o + 2] = flash.color.b;
    this.colorSpawn[o + 3] = now;
    this.params[o] = size;
    this.params[o + 1] = flash.intensity ?? 20;
    this.params[o + 2] = duration;
    this.params[o + 3] = styleFloat;

    this.setRenderCount(this.slots.length);
    this.dirtyMask |= ALL_DIRTY;
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

    // Re-anchor live flashes to the current muzzle so they ride the barrel.
    if (this.anchorResolver) {
      const anchor = this.anchorResolver();
      if (anchor) {
        for (let i = 0; i < this.slots.length; i++) {
          const o = i * 4;
          this.centerSeed[o] = anchor.x;
          this.centerSeed[o + 1] = anchor.y;
          this.centerSeed[o + 2] = anchor.z;
        }
        this.dirtyMask |= CENTER_SEED_DIRTY;
      }
    }

    if (this.dirtyMask & CENTER_SEED_DIRTY) this.mesh.thinInstanceBufferUpdated("iCenterSeed");
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
