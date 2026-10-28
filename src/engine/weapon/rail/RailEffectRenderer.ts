import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { buildRailBeamTemplate, buildRailImpactTemplate, type RailTemplateData } from "./RailBeamGeometry";
import {
  impactKindToFloat,
  makeRailSeed,
  RAIL_DURATION,
  RAIL_HELIX_RADIUS,
  type RailEffectSample,
} from "./RailProfiles";
import { createRailBeamMaterial, createRailImpactMaterial } from "./RailShaderMaterial";

const START_SEED_DIRTY = 1 << 0;
const END_IMPACT_DIRTY = 1 << 1;
const COLOR_LIFE_DIRTY = 1 << 2;
const PARAMS_DIRTY = 1 << 3;
const NORMAL_DIRTY = 1 << 4;
const BEAM_DIRTY = START_SEED_DIRTY | END_IMPACT_DIRTY | COLOR_LIFE_DIRTY | PARAMS_DIRTY;
const IMPACT_DIRTY = BEAM_DIRTY | NORMAL_DIRTY;

interface RailSlot {
  seed: number;
  spawnTime: number;
  duration: number;
}

function defaultClock(): number {
  return performance.now() / 1000;
}

function createTemplateMesh(name: string, scene: Scene, data: RailTemplateData, alphaIndex: number): Mesh {
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = data.positions;
  vertexData.uvs = data.uvs;
  vertexData.indices = data.indices;
  vertexData.applyToMesh(mesh, false);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.alphaIndex = alphaIndex;
  mesh.metadata = { effectOwned: true, railEffect: true };
  return mesh;
}

/**
 * A pool of one-shot rail effects rendered as thin instances of a single beam
 * mesh + a single impact mesh. Each fired shot occupies one slot until it fades
 * out (age ≥ duration); at capacity the oldest slot is recycled.
 *
 * Slots are index-addressed only — a rail is never updated after it spawns, so
 * there is no key→slot map. Removal swaps the last slot into the freed index
 * (matching the beam/impact instance buffers with copyWithin) to keep the live
 * range packed at [0, count).
 */
export class RailEffectRenderer {
  private readonly scene: Scene;
  private readonly clock: () => number;
  private readonly beamMesh: Mesh;
  private readonly impactMesh: Mesh;
  private readonly beamMaterial: ShaderMaterial;
  private readonly impactMaterial: ShaderMaterial;

  private readonly capacity: number;
  private readonly slots: RailSlot[] = [];
  private readonly matrices: Float32Array;
  private readonly startSeed: Float32Array;
  private readonly endImpact: Float32Array;
  private readonly colorLife: Float32Array;
  private readonly params: Float32Array;
  private readonly normals: Float32Array;
  private readonly viewport = new Vector2(1, 1);
  private beamDirtyMask = 0;
  private impactDirtyMask = 0;
  private activationCounter = 0;

  constructor(scene: Scene, clock: () => number = defaultClock, capacity = 24) {
    this.scene = scene;
    this.clock = clock;
    this.capacity = capacity;

    this.beamMesh = createTemplateMesh("rail_beam", scene, buildRailBeamTemplate(), 40);
    this.impactMesh = createTemplateMesh("rail_impact", scene, buildRailImpactTemplate(), 41);
    this.beamMaterial = createRailBeamMaterial("rail_beam_material", scene);
    this.impactMaterial = createRailImpactMaterial("rail_impact_material", scene);
    this.beamMesh.material = this.beamMaterial;
    this.impactMesh.material = this.impactMaterial;

    this.matrices = new Float32Array(capacity * 16);
    this.startSeed = new Float32Array(capacity * 4);
    this.endImpact = new Float32Array(capacity * 4);
    this.colorLife = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 4);
    this.normals = new Float32Array(capacity * 4);

    for (let instance = 0; instance < capacity; instance++) {
      const offset = instance * 16;
      this.matrices[offset] = 1;
      this.matrices[offset + 5] = 1;
      this.matrices[offset + 10] = 1;
      this.matrices[offset + 15] = 1;
    }

    this.attachBuffers(this.beamMesh, false);
    this.attachBuffers(this.impactMesh, true);
    this.setRenderCount(0);
  }

  private attachBuffers(mesh: Mesh, includeNormal: boolean): void {
    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, true);
    mesh.thinInstanceSetBuffer("iStartSeed", this.startSeed, 4, false);
    mesh.thinInstanceSetBuffer("iEndImpact", this.endImpact, 4, false);
    mesh.thinInstanceSetBuffer("iColorLife", this.colorLife, 4, false);
    mesh.thinInstanceSetBuffer("iParams", this.params, 4, false);
    if (includeNormal) mesh.thinInstanceSetBuffer("iNormal", this.normals, 4, false);
  }

  private setRenderCount(count: number): void {
    this.beamMesh.thinInstanceCount = count;
    this.impactMesh.thinInstanceCount = count;
    const active = count > 0;
    this.beamMesh.setEnabled(active);
    this.impactMesh.setEnabled(active);
  }

  private writeVector4(buffer: Float32Array, index: number, x: number, y: number, z: number, w: number): void {
    const offset = index * 4;
    buffer[offset] = x;
    buffer[offset + 1] = y;
    buffer[offset + 2] = z;
    buffer[offset + 3] = w;
  }

  private copyVector4Slot(buffer: Float32Array, from: number, to: number): void {
    const fromOffset = from * 4;
    buffer.copyWithin(to * 4, fromOffset, fromOffset + 4);
  }

  private removeAt(index: number): void {
    const lastIndex = this.slots.length - 1;
    if (index !== lastIndex) {
      this.slots[index] = this.slots[lastIndex];
      this.copyVector4Slot(this.startSeed, lastIndex, index);
      this.copyVector4Slot(this.endImpact, lastIndex, index);
      this.copyVector4Slot(this.colorLife, lastIndex, index);
      this.copyVector4Slot(this.params, lastIndex, index);
      this.copyVector4Slot(this.normals, lastIndex, index);
    }
    this.slots.pop();
    this.setRenderCount(this.slots.length);
    this.beamDirtyMask |= BEAM_DIRTY;
    this.impactDirtyMask |= IMPACT_DIRTY;
  }

  private oldestIndex(): number {
    let oldest = 0;
    let oldestTime = this.slots[0]?.spawnTime ?? 0;
    for (let index = 1; index < this.slots.length; index++) {
      if (this.slots[index].spawnTime < oldestTime) {
        oldest = index;
        oldestTime = this.slots[index].spawnTime;
      }
    }
    return oldest;
  }

  /** Spawn one instantaneous rail from muzzle (start) to impact (end). */
  fireRail(sample: RailEffectSample, duration = RAIL_DURATION): void {
    const now = this.clock();
    if (this.slots.length >= this.capacity) this.removeAt(this.oldestIndex());

    const index = this.slots.length;
    const seed = makeRailSeed("rail", ++this.activationCounter);
    this.slots.push({ seed, spawnTime: now, duration });

    const normal = sample.impactNormal;
    const fallbackX = sample.start.x - sample.end.x;
    const fallbackY = sample.start.y - sample.end.y;
    const fallbackZ = sample.start.z - sample.end.z;
    const fallbackLength = Math.sqrt(fallbackX * fallbackX + fallbackY * fallbackY + fallbackZ * fallbackZ) || 1;

    this.writeVector4(this.startSeed, index, sample.start.x, sample.start.y, sample.start.z, seed);
    this.writeVector4(
      this.endImpact,
      index,
      sample.end.x,
      sample.end.y,
      sample.end.z,
      impactKindToFloat(sample.impactKind),
    );
    this.writeVector4(this.colorLife, index, sample.color.r, sample.color.g, sample.color.b, now);
    this.writeVector4(this.params, index, sample.intensity ?? 1, RAIL_HELIX_RADIUS, 1, duration);
    this.writeVector4(
      this.normals,
      index,
      normal?.x ?? fallbackX / fallbackLength,
      normal?.y ?? fallbackY / fallbackLength,
      normal?.z ?? fallbackZ / fallbackLength,
      0,
    );

    this.setRenderCount(this.slots.length);
    this.beamDirtyMask |= BEAM_DIRTY;
    this.impactDirtyMask |= IMPACT_DIRTY;
  }

  update(_deltaTime: number): void {
    const now = this.clock();
    for (let index = this.slots.length - 1; index >= 0; index--) {
      const slot = this.slots[index];
      if (now - slot.spawnTime >= slot.duration) this.removeAt(index);
    }

    const engine = this.scene.getEngine();
    this.viewport.set(Math.max(1, engine.getRenderWidth()), Math.max(1, engine.getRenderHeight()));
    this.beamMaterial.setFloat("uTime", now);
    this.beamMaterial.setVector2("uViewport", this.viewport);
    this.impactMaterial.setFloat("uTime", now);
    this.impactMaterial.setVector2("uViewport", this.viewport);

    if (this.slots.length === 0) {
      this.beamDirtyMask = 0;
      this.impactDirtyMask = 0;
      return;
    }
    if (this.beamDirtyMask) {
      if (this.beamDirtyMask & START_SEED_DIRTY) this.beamMesh.thinInstanceBufferUpdated("iStartSeed");
      if (this.beamDirtyMask & END_IMPACT_DIRTY) this.beamMesh.thinInstanceBufferUpdated("iEndImpact");
      if (this.beamDirtyMask & COLOR_LIFE_DIRTY) this.beamMesh.thinInstanceBufferUpdated("iColorLife");
      if (this.beamDirtyMask & PARAMS_DIRTY) this.beamMesh.thinInstanceBufferUpdated("iParams");
      this.beamDirtyMask = 0;
    }
    if (this.impactDirtyMask) {
      if (this.impactDirtyMask & START_SEED_DIRTY) this.impactMesh.thinInstanceBufferUpdated("iStartSeed");
      if (this.impactDirtyMask & END_IMPACT_DIRTY) this.impactMesh.thinInstanceBufferUpdated("iEndImpact");
      if (this.impactDirtyMask & COLOR_LIFE_DIRTY) this.impactMesh.thinInstanceBufferUpdated("iColorLife");
      if (this.impactDirtyMask & PARAMS_DIRTY) this.impactMesh.thinInstanceBufferUpdated("iParams");
      if (this.impactDirtyMask & NORMAL_DIRTY) this.impactMesh.thinInstanceBufferUpdated("iNormal");
      this.impactDirtyMask = 0;
    }
  }

  async prewarm(): Promise<void> {
    // Thin-instance shaders compile a THIN_INSTANCES variant; a temporary count
    // makes Babylon compile the exact live batch program instead of a template.
    if (this.slots.length === 0) this.setRenderCount(1);
    try {
      await Promise.all([
        this.beamMaterial.forceCompilationAsync(this.beamMesh, { useInstances: true }),
        this.impactMaterial.forceCompilationAsync(this.impactMesh, { useInstances: true }),
      ]);
    } finally {
      this.setRenderCount(this.slots.length);
    }
  }

  clear(): void {
    this.slots.length = 0;
    this.beamDirtyMask = 0;
    this.impactDirtyMask = 0;
    this.setRenderCount(0);
  }

  dispose(): void {
    this.beamMesh.dispose();
    this.impactMesh.dispose();
    this.beamMaterial.dispose();
    this.impactMaterial.dispose();
  }

  getDebugCount(): number {
    return this.slots.length;
  }
}
