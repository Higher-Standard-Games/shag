import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { DirtySlotRange } from "../../rendering/data/DirtySlotRange";
import {
  buildVoltaicBeamTemplate,
  buildVoltaicImpactTemplate,
  type VoltaicBeamProfile,
  type VoltaicTemplateData,
} from "./VoltaicBeamGeometry";
import {
  impactKindToFloat,
  makeVoltaicSeed,
  VOLTAIC_HERO_RELEASE_TIME,
  VOLTAIC_REMOTE_REMOVE_TIME,
  type VoltaicEffectSample,
} from "./VoltaicProfiles";
import { createVoltaicBeamMaterial, createVoltaicImpactMaterial } from "./VoltaicShaderMaterial";

/** Resolves an animated third-person muzzle without coupling the engine renderer to FPS entities. */
export type VoltaicRemoteStartResolver = (entityId: string, direction: Vector3, result: Vector3) => boolean;

interface BatchSlot {
  key: string;
  seed: number;
  touchedAt: number;
  duration: number;
  mode: 0 | 1;
  directionX: number;
  directionY: number;
  directionZ: number;
  dynamicStart: boolean;
}

const BATCH_ATTRIBUTES = ["iStartSeed", "iEndImpact", "iColorLife", "iParams", "iNormal"] as const;
const POSITION_EPSILON_SQUARED = 0.0001;

function quantizeArcCoordinate(value: number): number {
  return Math.round(value * 0.125);
}

function defaultClock(): number {
  return performance.now() / 1000;
}

function createTemplateMesh(name: string, scene: Scene, data: VoltaicTemplateData, alphaIndex: number): Mesh {
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = data.positions;
  vertexData.uvs = data.uvs;
  vertexData.indices = data.indices;
  vertexData.applyToMesh(mesh, false);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.alphaIndex = alphaIndex;
  mesh.metadata = { effectOwned: true, voltaicEffect: true };
  return mesh;
}

function createBeamMesh(name: string, scene: Scene, profile: VoltaicBeamProfile): Mesh {
  return createTemplateMesh(name, scene, buildVoltaicBeamTemplate(profile), 40);
}

class VoltaicInstanceBatch {
  readonly beamMesh: Mesh;
  readonly impactMesh: Mesh;
  readonly beamMaterial: ShaderMaterial;
  readonly impactMaterial: ShaderMaterial;

  private readonly capacity: number;
  private readonly slots: BatchSlot[] = [];
  private readonly slotByKey = new Map<string, number>();
  private readonly matrices: Float32Array;
  private readonly startSeed: Float32Array;
  private readonly endImpact: Float32Array;
  private readonly colorLife: Float32Array;
  private readonly params: Float32Array;
  private readonly normals: Float32Array;
  private readonly scratchDirection = new Vector3();
  private readonly scratchStart = new Vector3();
  private readonly beamDirty = Array.from({ length: 4 }, () => new DirtySlotRange());
  private readonly impactDirty = Array.from({ length: 5 }, () => new DirtySlotRange());
  private readonly restoreObserver;
  private readonly sceneDisposeObserver;
  private activationCounter = 0;

  constructor(name: string, scene: Scene, profile: "world" | "chain", capacity: number) {
    this.capacity = capacity;
    this.beamMesh = createBeamMesh(`${name}_beam`, scene, profile);
    this.impactMesh = createTemplateMesh(`${name}_impact`, scene, buildVoltaicImpactTemplate(), 41);
    this.beamMaterial = createVoltaicBeamMaterial(`${name}_beam_material`, scene, true);
    this.impactMaterial = createVoltaicImpactMaterial(`${name}_impact_material`, scene, true);
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

    this.attachBeamBuffers();
    this.attachImpactBuffers();
    this.syncCount();
    this.restoreObserver = scene.getEngine().onContextRestoredObservable.add(() => {
      // Partial Babylon buffer writes may discard or shorten their rebuild copy.
      // Recreate full capacity from our authoritative arrays after restoration.
      this.attachBeamBuffers();
      this.attachImpactBuffers();
      this.syncCount();
      this.clearDirty();
    });
    this.sceneDisposeObserver = scene.onDisposeObservable.addOnce(() => {
      scene.getEngine().onContextRestoredObservable.remove(this.restoreObserver);
    });
  }

  private attachCommonBuffers(mesh: Mesh): void {
    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, true);
    mesh.thinInstanceSetBuffer("iStartSeed", this.startSeed, 4, false);
    mesh.thinInstanceSetBuffer("iEndImpact", this.endImpact, 4, false);
    mesh.thinInstanceSetBuffer("iColorLife", this.colorLife, 4, false);
    mesh.thinInstanceSetBuffer("iParams", this.params, 4, false);
  }

  private attachBeamBuffers(): void {
    this.attachCommonBuffers(this.beamMesh);
  }

  private attachImpactBuffers(): void {
    this.attachCommonBuffers(this.impactMesh);
    this.impactMesh.thinInstanceSetBuffer("iNormal", this.normals, 4, false);
  }

  private setRenderCount(count: number): void {
    this.beamMesh.thinInstanceCount = count;
    this.impactMesh.thinInstanceCount = count;
    const active = count > 0;
    this.beamMesh.setEnabled(active);
    this.impactMesh.setEnabled(active);
  }

  private syncCount(): void {
    this.setRenderCount(this.slots.length);
  }

  private markAllDirty(slot: number): void {
    for (const dirty of this.beamDirty) dirty.mark(slot);
    for (const dirty of this.impactDirty) dirty.mark(slot);
  }

  private clearDirty(): void {
    for (const dirty of this.beamDirty) dirty.clear();
    for (const dirty of this.impactDirty) dirty.clear();
  }

  private flushMeshBuffers(mesh: Mesh, ranges: readonly DirtySlotRange[]): void {
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const end = Math.min(range.end, this.slots.length);
      if (end > range.first) mesh.thinInstancePartialBufferUpdate(BATCH_ATTRIBUTES[i], end - range.first, range.first);
    }
  }

  flush(): void {
    if (this.slots.length === 0) {
      this.clearDirty();
      return;
    }
    this.flushMeshBuffers(this.beamMesh, this.beamDirty);
    this.flushMeshBuffers(this.impactMesh, this.impactDirty);
    this.clearDirty();
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
    const toOffset = to * 4;
    buffer.copyWithin(toOffset, fromOffset, fromOffset + 4);
  }

  private copySlot(from: number, to: number): void {
    this.copyVector4Slot(this.startSeed, from, to);
    this.copyVector4Slot(this.endImpact, from, to);
    this.copyVector4Slot(this.colorLife, from, to);
    this.copyVector4Slot(this.params, from, to);
    this.copyVector4Slot(this.normals, from, to);
  }

  private removeAt(index: number): void {
    const removed = this.slots[index];
    const lastIndex = this.slots.length - 1;
    this.slotByKey.delete(removed.key);

    if (index !== lastIndex) {
      const moved = this.slots[lastIndex];
      this.slots[index] = moved;
      this.slotByKey.set(moved.key, index);
      this.copySlot(lastIndex, index);
      this.markAllDirty(index);
    }

    this.slots.pop();
    this.syncCount();
  }

  private findLeastRecentlyTouchedIndex(): number {
    let oldestIndex = 0;
    let oldestTime = this.slots[0]?.touchedAt ?? 0;
    for (let index = 1; index < this.slots.length; index++) {
      if (this.slots[index].touchedAt < oldestTime) {
        oldestIndex = index;
        oldestTime = this.slots[index].touchedAt;
      }
    }
    return oldestIndex;
  }

  upsert(
    key: string,
    sample: VoltaicEffectSample,
    mode: 0 | 1,
    duration: number,
    now: number,
    anchorDirection?: Vector3,
  ): void {
    let index = this.slotByKey.get(key);

    if (index === undefined) {
      if (this.slots.length >= this.capacity) this.removeAt(this.findLeastRecentlyTouchedIndex());
      index = this.slots.length;
      const slot: BatchSlot = {
        key,
        seed: makeVoltaicSeed(key, ++this.activationCounter),
        touchedAt: now,
        duration,
        mode,
        directionX: 0,
        directionY: 0,
        directionZ: 1,
        dynamicStart: false,
      };
      this.slots.push(slot);
      this.slotByKey.set(key, index);
    }

    const slot = this.slots[index];
    slot.touchedAt = now;
    slot.duration = duration;
    slot.mode = mode;
    if (anchorDirection) {
      const directionLength = Math.sqrt(anchorDirection.lengthSquared());
      if (directionLength > 0.0001) {
        slot.directionX = anchorDirection.x / directionLength;
        slot.directionY = anchorDirection.y / directionLength;
        slot.directionZ = anchorDirection.z / directionLength;
      }
      slot.dynamicStart = true;
    } else {
      slot.dynamicStart = false;
    }

    const normal = sample.impactNormal;
    const fallbackX = sample.start.x - sample.end.x;
    const fallbackY = sample.start.y - sample.end.y;
    const fallbackZ = sample.start.z - sample.end.z;
    const fallbackLength = Math.sqrt(fallbackX * fallbackX + fallbackY * fallbackY + fallbackZ * fallbackZ) || 1;
    const amplitude = mode === 1 ? 13 : 8;

    this.writeVector4(this.startSeed, index, sample.start.x, sample.start.y, sample.start.z, slot.seed);
    this.writeVector4(
      this.endImpact,
      index,
      sample.end.x,
      sample.end.y,
      sample.end.z,
      impactKindToFloat(sample.impactKind),
    );
    this.writeVector4(this.colorLife, index, sample.color.r, sample.color.g, sample.color.b, now);
    this.writeVector4(this.params, index, sample.intensity ?? 1, amplitude, mode, duration);
    this.writeVector4(
      this.normals,
      index,
      normal?.x ?? fallbackX / fallbackLength,
      normal?.y ?? fallbackY / fallbackLength,
      normal?.z ?? fallbackZ / fallbackLength,
      0,
    );
    this.syncCount();
    this.markAllDirty(index);
  }

  refreshStarts(resolver: VoltaicRemoteStartResolver): void {
    for (let index = 0; index < this.slots.length; index++) {
      const slot = this.slots[index];
      if (!slot.dynamicStart) continue;
      this.scratchDirection.set(slot.directionX, slot.directionY, slot.directionZ);
      if (!resolver(slot.key, this.scratchDirection, this.scratchStart)) continue;
      if (!Number.isFinite(this.scratchStart.x + this.scratchStart.y + this.scratchStart.z)) continue;

      const offset = index * 4;
      const dx = this.startSeed[offset] - this.scratchStart.x;
      const dy = this.startSeed[offset + 1] - this.scratchStart.y;
      const dz = this.startSeed[offset + 2] - this.scratchStart.z;
      if (dx * dx + dy * dy + dz * dz <= POSITION_EPSILON_SQUARED) continue;
      this.startSeed[offset] = this.scratchStart.x;
      this.startSeed[offset + 1] = this.scratchStart.y;
      this.startSeed[offset + 2] = this.scratchStart.z;
      this.beamDirty[0].mark(index);
    }
    // The impact shader reads only startSeed.w (the seed), which does not change
    // during anchor refreshes. Upload only the beam's start buffer each frame.
  }

  remove(key: string): void {
    const index = this.slotByKey.get(key);
    if (index !== undefined) this.removeAt(index);
  }

  update(now: number): void {
    for (let index = this.slots.length - 1; index >= 0; index--) {
      const slot = this.slots[index];
      const lifetime = slot.mode === 1 ? slot.duration : VOLTAIC_REMOTE_REMOVE_TIME;
      if (now - slot.touchedAt >= lifetime) this.removeAt(index);
    }
  }

  setFrame(time: number, viewport: Vector2): void {
    this.beamMaterial.setFloat("uTime", time);
    this.beamMaterial.setVector2("uViewport", viewport);
    this.impactMaterial.setFloat("uTime", time);
    this.impactMaterial.setVector2("uViewport", viewport);
  }

  async prewarm(): Promise<void> {
    // Thin-instance shaders require THIN_INSTANCES, not merely INSTANCES. A
    // temporary count makes Babylon compile the exact live batch variant.
    if (this.slots.length === 0) this.setRenderCount(1);
    try {
      await Promise.all([
        this.beamMaterial.forceCompilationAsync(this.beamMesh, { useInstances: true }),
        this.impactMaterial.forceCompilationAsync(this.impactMesh, { useInstances: true }),
      ]);
    } finally {
      this.syncCount();
    }
  }

  clear(): void {
    this.slots.length = 0;
    this.slotByKey.clear();
    this.clearDirty();
    this.syncCount();
  }

  dispose(): void {
    this.beamMesh.getEngine().onContextRestoredObservable.remove(this.restoreObserver);
    this.beamMesh.getScene().onDisposeObservable.remove(this.sceneDisposeObserver);
    this.beamMesh.dispose();
    this.impactMesh.dispose();
    this.beamMaterial.dispose();
    this.impactMaterial.dispose();
  }

  get activeCount(): number {
    return this.slots.length;
  }

  get activeKeys(): string[] {
    return this.slots.map((slot) => slot.key);
  }

  getStart(key: string): Vector3 | null {
    const index = this.slotByKey.get(key);
    if (index === undefined) return null;
    const offset = index * 4;
    return new Vector3(this.startSeed[offset], this.startSeed[offset + 1], this.startSeed[offset + 2]);
  }
}

export class VoltaicEffectRenderer {
  private readonly scene: Scene;
  private readonly clock: () => number;
  private readonly heroBeam: Mesh;
  private readonly heroImpact: Mesh;
  private readonly heroBeamMaterial: ShaderMaterial;
  private readonly heroImpactMaterial: ShaderMaterial;
  private readonly remoteBatch: VoltaicInstanceBatch;
  private readonly chainBatch: VoltaicInstanceBatch;
  private readonly viewport = new Vector2(1, 1);
  private readonly startSeed = new Vector4();
  private readonly endImpact = new Vector4();
  private readonly colorLife = new Vector4();
  private readonly params = new Vector4();
  private readonly normal = new Vector4();
  private readonly heroMaterials: ShaderMaterial[];
  private remoteStartResolver: VoltaicRemoteStartResolver | null = null;
  private readonly startObserver: Observer<Camera>;
  private heroFiring = false;
  private heroVisible = false;
  private heroReleaseStarted = 0;
  private heroActivation = 0;

  constructor(scene: Scene, clock: () => number = defaultClock) {
    this.scene = scene;
    this.clock = clock;
    this.heroBeam = createBeamMesh("voltaic_hero_beam", scene, "hero");
    this.heroImpact = createTemplateMesh("voltaic_hero_impact", scene, buildVoltaicImpactTemplate(), 41);
    this.heroBeamMaterial = createVoltaicBeamMaterial("voltaic_hero_beam_material", scene, false);
    this.heroImpactMaterial = createVoltaicImpactMaterial("voltaic_hero_impact_material", scene, false);
    this.heroBeam.material = this.heroBeamMaterial;
    this.heroImpact.material = this.heroImpactMaterial;
    this.heroMaterials = [this.heroBeamMaterial, this.heroImpactMaterial];
    this.heroBeam.setEnabled(false);
    this.heroImpact.setEnabled(false);

    this.remoteBatch = new VoltaicInstanceBatch("voltaic_world", scene, "world", 32);
    this.chainBatch = new VoltaicInstanceBatch("voltaic_chain", scene, "chain", 24);

    // A beam leaves a muzzle that moves with its camera: the watched player's
    // gun on screen moves with the spectator camera, which a before-render
    // observer registered after ours may place. Just before the world camera
    // renders, every observer has run, so the beam leaves this frame's barrel.
    this.startObserver = scene.onBeforeCameraRenderObservable.add((camera) => {
      if (camera !== (scene.activeCameras?.[0] ?? scene.activeCamera) || !this.remoteStartResolver) return;
      this.remoteBatch.refreshStarts(this.remoteStartResolver);
      this.remoteBatch.flush();
    });
  }

  private now(): number {
    return this.clock();
  }

  private bindHeroSample(sample: VoltaicEffectSample, life: number): void {
    const fallbackX = sample.start.x - sample.end.x;
    const fallbackY = sample.start.y - sample.end.y;
    const fallbackZ = sample.start.z - sample.end.z;
    const fallbackLength = Math.sqrt(fallbackX * fallbackX + fallbackY * fallbackY + fallbackZ * fallbackZ) || 1;
    const normal = sample.impactNormal;

    this.startSeed.set(sample.start.x, sample.start.y, sample.start.z, this.startSeed.w);
    this.endImpact.set(sample.end.x, sample.end.y, sample.end.z, impactKindToFloat(sample.impactKind));
    this.colorLife.set(sample.color.r, sample.color.g, sample.color.b, life);
    // Hero-only field scale: the local weapon gets a broad electrical envelope
    // while the remote batch remains compact and combat-readable.
    this.params.set(sample.intensity ?? 1, 23, 2, VOLTAIC_HERO_RELEASE_TIME);
    this.normal.set(
      normal?.x ?? fallbackX / fallbackLength,
      normal?.y ?? fallbackY / fallbackLength,
      normal?.z ?? fallbackZ / fallbackLength,
      0,
    );

    for (const material of this.heroMaterials) {
      material.setVector4("uStartSeed", this.startSeed);
      material.setVector4("uEndImpact", this.endImpact);
      material.setVector4("uColorLife", this.colorLife);
      material.setVector4("uParams", this.params);
    }
    this.heroImpactMaterial.setVector4("uNormal", this.normal);
  }

  updateHero(sample: VoltaicEffectSample): void {
    if (!this.heroFiring) {
      this.startSeed.w = makeVoltaicSeed("hero", ++this.heroActivation);
      this.heroBeam.setEnabled(true);
      this.heroVisible = true;
    }
    this.heroFiring = true;
    // The hero impact draw also contains the always-live procedural muzzle
    // corona. Endpoint parts independently disappear in the shader on a miss.
    this.heroImpact.setEnabled(true);
    this.bindHeroSample(sample, 1);
  }

  stopHero(): void {
    if (!this.heroFiring) return;
    this.heroFiring = false;
    this.heroReleaseStarted = this.now();
  }

  updateRemote(key: string, sample: VoltaicEffectSample, direction: Vector3): void {
    this.remoteBatch.upsert(key, sample, 0, 0, this.now(), direction);
  }

  removeRemote(key: string): void {
    this.remoteBatch.remove(key);
  }

  setRemoteStartResolver(resolver: VoltaicRemoteStartResolver | null): void {
    this.remoteStartResolver = resolver;
  }

  fireChainArc(sample: VoltaicEffectSample, duration: number): void {
    const key =
      `chain:${quantizeArcCoordinate(sample.start.x)},${quantizeArcCoordinate(sample.start.y)},` +
      `${quantizeArcCoordinate(sample.start.z)}:${quantizeArcCoordinate(sample.end.x)},` +
      `${quantizeArcCoordinate(sample.end.y)},${quantizeArcCoordinate(sample.end.z)}`;
    this.chainBatch.upsert(key, sample, 1, duration, this.now());
  }

  update(_deltaTime: number): void {
    const now = this.now();
    const engine = this.scene.getEngine();
    this.viewport.set(Math.max(1, engine.getRenderWidth()), Math.max(1, engine.getRenderHeight()));

    for (const material of this.heroMaterials) {
      material.setFloat("uTime", now);
      material.setVector2("uViewport", this.viewport);
    }
    this.remoteBatch.setFrame(now, this.viewport);
    this.chainBatch.setFrame(now, this.viewport);
    this.remoteBatch.update(now);
    this.chainBatch.update(now);
    this.remoteBatch.flush();
    this.chainBatch.flush();

    if (!this.heroFiring && this.heroVisible) {
      const releaseAge = now - this.heroReleaseStarted;
      const life = Math.max(0, 1 - releaseAge / VOLTAIC_HERO_RELEASE_TIME);
      this.colorLife.w = life;
      for (const material of this.heroMaterials) material.setVector4("uColorLife", this.colorLife);
      if (life <= 0) {
        this.heroVisible = false;
        this.heroBeam.setEnabled(false);
        this.heroImpact.setEnabled(false);
      }
    }
  }

  async prewarm(): Promise<void> {
    await Promise.all([
      this.heroBeamMaterial.forceCompilationAsync(this.heroBeam, { useInstances: false }),
      this.heroImpactMaterial.forceCompilationAsync(this.heroImpact, { useInstances: false }),
      this.remoteBatch.prewarm(),
      this.chainBatch.prewarm(),
    ]);
  }

  clear(): void {
    this.heroFiring = false;
    this.heroVisible = false;
    this.heroBeam.setEnabled(false);
    this.heroImpact.setEnabled(false);
    this.remoteBatch.clear();
    this.chainBatch.clear();
  }

  dispose(): void {
    this.clear();
    this.scene.onBeforeCameraRenderObservable.remove(this.startObserver);
    this.remoteStartResolver = null;
    this.heroBeam.dispose();
    this.heroImpact.dispose();
    this.heroBeamMaterial.dispose();
    this.heroImpactMaterial.dispose();
    this.remoteBatch.dispose();
    this.chainBatch.dispose();
  }

  getDebugCounts(): { remote: number; chain: number; heroVisible: boolean } {
    return {
      remote: this.remoteBatch.activeCount,
      chain: this.chainBatch.activeCount,
      heroVisible: this.heroVisible,
    };
  }

  getDebugRemoteKeys(): string[] {
    return this.remoteBatch.activeKeys;
  }

  getDebugRemoteStart(key: string): Vector3 | null {
    return this.remoteBatch.getStart(key);
  }
}
