import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDiscVertexData } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateIcoSphereVertexData } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import {
  createExplosionLayerMaterial,
  EXPLOSION_FIRE_TIME,
  EXPLOSION_INSTANCE_ATTRIBUTES,
  type ExplosionLayer,
  SPARK_AGE_PER_SECOND,
} from "./ExplosionBatchMaterial";

/** What one explosion looks like; `ExplosionConfig` supplies it. */
export interface ExplosionLook {
  scale: number;
  speed: number;
  coreColor: Color3;
  outerColor: Color3;
  smokeColor: Color3;
  splashRadius: number;
  showShockwave?: boolean;
  /** Rays per explosion, drawn evenly from [min, max]. */
  rays: { min: number; max: number };
}

/** Explosions alive at once before the oldest is recycled. */
const MAX_EXPLOSIONS = 96;
const MAX_RAYS = 12;
/** The particle system the sparks reproduce held at most 40. */
export const SPARKS_PER_EXPLOSION = 40;
/** How long an explosion lives, in its own time; sparks still alive are cut there. */
export const EXPLOSION_LIFETIME = 0.9;

const FLOATS = EXPLOSION_INSTANCE_ATTRIBUTES.length * 4;

/**
 * One thin-instanced layer. Slots are written once at spawn and never touched
 * again, since the shader animates them; expiry swaps the last slot into the
 * freed index.
 */
class LayerBatch {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly capacity: number;
  private readonly expiry: number[] = [];
  private readonly data: Float32Array[];
  private dirty = false;

  constructor(scene: Scene, layer: ExplosionLayer, shape: VertexData, capacity: number, alphaIndex: number) {
    this.capacity = capacity;
    this.mesh = new Mesh(`explosion_${layer}`, scene);
    shape.applyToMesh(this.mesh, false);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.alphaIndex = alphaIndex;
    this.mesh.metadata = { effectOwned: true, explosionLayer: layer };
    this.material = createExplosionLayerMaterial(layer, scene);
    this.mesh.material = this.material;

    const matrices = new Float32Array(capacity * 16);
    for (let i = 0; i < capacity; i++) {
      matrices[i * 16] = matrices[i * 16 + 5] = matrices[i * 16 + 10] = matrices[i * 16 + 15] = 1;
    }
    this.mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    this.data = EXPLOSION_INSTANCE_ATTRIBUTES.map((name) => {
      const buffer = new Float32Array(capacity * 4);
      this.mesh.thinInstanceSetBuffer(name, buffer, 4, false);
      return buffer;
    });
    this.setCount(0);
  }

  get count(): number {
    return this.expiry.length;
  }

  private setCount(count: number): void {
    this.mesh.thinInstanceCount = count;
    this.mesh.setEnabled(count > 0);
  }

  private removeAt(index: number): void {
    const last = this.expiry.length - 1;
    if (index !== last) {
      this.expiry[index] = this.expiry[last];
      for (const buffer of this.data) buffer.copyWithin(index * 4, last * 4, last * 4 + 4);
    }
    this.expiry.pop();
    this.setCount(this.expiry.length);
    this.dirty = true;
  }

  /** Write one instance from `values` (iA..iE, four floats each). */
  push(values: ArrayLike<number>, expiresAt: number): void {
    if (this.expiry.length >= this.capacity) {
      let soonest = 0;
      for (let i = 1; i < this.expiry.length; i++) if (this.expiry[i] < this.expiry[soonest]) soonest = i;
      this.removeAt(soonest);
    }
    const index = this.expiry.length;
    this.expiry.push(expiresAt);
    for (let a = 0; a < this.data.length; a++) {
      const buffer = this.data[a];
      for (let c = 0; c < 4; c++) buffer[index * 4 + c] = values[a * 4 + c];
    }
    this.setCount(this.expiry.length);
    this.dirty = true;
  }

  update(now: number): void {
    for (let i = this.expiry.length - 1; i >= 0; i--) if (now >= this.expiry[i]) this.removeAt(i);
    this.material.setFloat("uTime", now);
    const imageProcessing = this.mesh.getScene().imageProcessingConfiguration;
    this.material.setFloat("uLinearOutput", imageProcessing.applyByPostProcess ? 1 : 0);
    if (!this.dirty || this.expiry.length === 0) return;
    for (const name of EXPLOSION_INSTANCE_ATTRIBUTES) this.mesh.thinInstanceBufferUpdated(name);
    this.dirty = false;
  }

  async prewarm(): Promise<void> {
    if (this.expiry.length === 0) this.setCount(1);
    try {
      await this.material.forceCompilationAsync(this.mesh, { useInstances: true });
    } finally {
      this.setCount(this.expiry.length);
    }
  }

  clear(): void {
    this.expiry.length = 0;
    this.dirty = false;
    this.setCount(0);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}

/** The fireball's sphere; the shader pushes its spikes out per explosion size. */
function fireballShape(): VertexData {
  const sphere = CreateIcoSphereVertexData({ radius: 2.5, subdivisions: 3, flat: true });
  const shape = new VertexData();
  shape.positions = sphere.positions;
  shape.indices = sphere.indices;
  return shape;
}

function sparkQuad(): VertexData {
  const quad = new VertexData();
  quad.positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]);
  quad.uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  quad.indices = new Uint16Array([0, 1, 2, 2, 1, 3]);
  return quad;
}

function defaultClock(): number {
  return performance.now() / 1000;
}

/**
 * Every live explosion's fireball, rays, shockwave and sparks, drawn as four
 * thin-instanced meshes animated in the vertex shader.
 */
export class ExplosionBatchRenderer {
  readonly scene: Scene;
  private readonly clock: () => number;
  private readonly fireballs: LayerBatch;
  private readonly rays: LayerBatch;
  private readonly shockwaves: LayerBatch;
  private readonly sparks: LayerBatch;
  private readonly values = new Float32Array(FLOATS);
  private readonly rotation = new Quaternion();
  private readonly axis = new Vector3();

  constructor(scene: Scene, clock: () => number = defaultClock) {
    this.scene = scene;
    this.clock = clock;
    this.shockwaves = new LayerBatch(
      scene,
      "shockwave",
      CreateDiscVertexData({ radius: 0.5, tessellation: 32 }),
      MAX_EXPLOSIONS,
      43,
    );
    this.fireballs = new LayerBatch(scene, "fireball", fireballShape(), MAX_EXPLOSIONS, 44);
    this.rays = new LayerBatch(
      scene,
      "ray",
      CreateCylinderVertexData({ height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 6 }),
      MAX_EXPLOSIONS * MAX_RAYS,
      45,
    );
    this.sparks = new LayerBatch(scene, "spark", sparkQuad(), MAX_EXPLOSIONS * SPARKS_PER_EXPLOSION, 46);
  }

  private get layers(): LayerBatch[] {
    return [this.shockwaves, this.fireballs, this.rays, this.sparks];
  }

  /** True when a scene clear has taken the meshes. */
  isDisposed(): boolean {
    return this.layers.some((layer) => layer.mesh.isDisposed());
  }

  spawn(position: Vector3, look: ExplosionLook, normal: Vector3): void {
    const now = this.clock();
    const v = this.values;
    const { scale, speed, coreColor: core, outerColor: outer, smokeColor: smoke } = look;
    const fireEnd = now + EXPLOSION_FIRE_TIME / speed;
    v.fill(0);
    v.set([position.x, position.y, position.z, now], 0);

    v.set([normal.x, normal.y, normal.z, speed], 4);
    v.set([core.r, core.g, core.b, scale], 8);
    v.set([outer.r, outer.g, outer.b, 0], 12);
    v.set([smoke.r, smoke.g, smoke.b, 0], 16);
    this.fireballs.push(v, fireEnd);

    const rayCount = look.rays.min + Math.floor(Math.random() * (look.rays.max - look.rays.min + 1));
    for (let i = 0; i < Math.min(rayCount, MAX_RAYS); i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const length = (2 + Math.random() * 3) * scale;
      const width = (0.3 + Math.random() * 0.3) * scale;
      v.set([Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi), speed], 4);
      v.set([outer.r, outer.g, outer.b, width], 12);
      v.set([length, 0, 0, 0], 16);
      this.rays.push(v, fireEnd);
    }

    if (look.showShockwave !== false) {
      // The disc's +Y turns to the surface normal.
      const dot = Vector3.Dot(Vector3.UpReadOnly, normal);
      if (Math.abs(dot) < 0.999) {
        Vector3.CrossToRef(Vector3.UpReadOnly, normal, this.axis);
        Quaternion.RotationAxisToRef(this.axis.normalize(), Math.acos(Math.max(-1, Math.min(1, dot))), this.rotation);
      } else {
        this.rotation.set(0, 0, 0, 1);
      }
      const q = this.rotation;
      v.set([q.x, q.y, q.z, q.w], 4);
      v.set([outer.r, outer.g, outer.b, scale], 8);
      v.set([speed, look.splashRadius, 0, 0], 12);
      v.set([0, 0, 0, 0], 16);
      this.shockwaves.push(v, fireEnd);
    }

    // Sparks: a burst from inside a sphere, flying out from its centre.
    const radius = 0.5 * scale;
    const sparkCut = now + EXPLOSION_LIFETIME / speed;
    v.set([0, 0, 0, 0], 16);
    for (let i = 0; i < SPARKS_PER_EXPLOSION; i++) {
      const r = radius - Math.random() * radius;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.acos(2 * Math.random() - 1);
      let dx = Math.cos(phi) * Math.sin(theta);
      let dy = Math.cos(theta);
      let dz = Math.sin(phi) * Math.sin(theta);
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= length;
      dy /= length;
      dz /= length;
      const power = (15 + Math.random() * 20) * scale;
      const life = 0.2 + Math.random() * 0.3;
      const size = (0.15 + Math.random() * 0.25) * scale;
      const mix = Math.random();
      v.set([position.x + dx * r, position.y + dy * r, position.z + dz * r, now], 0);
      v.set([dx * power, dy * power, dz * power, life], 4);
      v.set(
        [core.r + (outer.r - core.r) * mix, core.g + (outer.g - core.g) * mix, core.b + (outer.b - core.b) * mix, size],
        8,
      );
      v.set([smoke.r, smoke.g, smoke.b, 0], 12);
      this.sparks.push(v, Math.min(now + life / SPARK_AGE_PER_SECOND, sparkCut));
    }
  }

  update(): void {
    const now = this.clock();
    for (const layer of this.layers) layer.update(now);
  }

  async prewarm(): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.prewarm()));
  }

  clear(): void {
    for (const layer of this.layers) layer.clear();
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
  }

  /** Live instances per layer, for tests and diagnostics. */
  getDebugCounts(): Record<ExplosionLayer, number> {
    return {
      fireball: this.fireballs.count,
      ray: this.rays.count,
      shockwave: this.shockwaves.count,
      spark: this.sparks.count,
    };
  }
}
