/**
 * Reflections for `map $cubemap` shader stages.
 *
 * Each object drawn with a `$cubemap` stage reflects a cubemap of the static
 * map captured from where it stands, without itself in the picture. A curved
 * object reflects its capture directly, so its own normals shape the
 * reflection. A flat one captures from the middle of its room and projects the
 * capture onto the room's box, so the reflection stays put as the viewer moves.
 * Captures are taken once, behind the loading screen; an object whose world
 * was not ready then is captured on a later frame.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Ray } from "@babylonjs/core/Culling/ray";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";

/** Captures per map; objects past it reflect the nearest capture. */
export const MAX_SURFACE_CUBEMAPS = 8;
const PROBE_SIZE = 256;
const WEAPON_LAYER = 0x10000000;
/** How far a flat surface's capture search starts in front of it. */
const FLAT_OFFSET = 4;
const ROOM_REACH = 2048;

/** One object drawn with `$cubemap`: every pass mesh over the same geometry. */
export interface CubemapSurface {
  meshes: AbstractMesh[];
  centre: Vector3;
  /** The surface's normal when it is flat, or null for a curved object. */
  flatNormal: Vector3 | null;
}

/** Whether a mesh draws a `$cubemap` stage. */
export function isCubemapSurface(mesh: AbstractMesh): boolean {
  return mesh.metadata?.generatedCubemap === true;
}

/** The world-space centre of `mesh`, and its normal when every vertex lies in one plane facing one way. */
export function describeSurface(mesh: AbstractMesh): Omit<CubemapSurface, "meshes"> {
  mesh.computeWorldMatrix(true);
  const box = mesh.getBoundingInfo().boundingBox;
  const centre = box.centerWorld.clone();
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!positions?.length || !normals?.length) return { centre, flatNormal: null };
  const world = mesh.getWorldMatrix();
  const sum = Vector3.Zero();
  const worldNormals: Vector3[] = [];
  for (let i = 0; i < normals.length; i += 3) {
    const n = Vector3.TransformNormal(Vector3.FromArray(normals, i), world).normalize();
    worldNormals.push(n);
    sum.addInPlace(n);
  }
  if (sum.length() < 1e-6) return { centre, flatNormal: null };
  const normal = sum.normalize();
  if (worldNormals.some((n) => Vector3.Dot(n, normal) < 0.999)) return { centre, flatNormal: null };
  const depth = (i: number) =>
    Vector3.Dot(Vector3.TransformCoordinates(Vector3.FromArray(positions, i), world), normal);
  const plane = depth(0);
  for (let i = 3; i < positions.length; i += 3)
    if (Math.abs(depth(i) - plane) > 0.5) return { centre, flatNormal: null };
  return { centre, flatNormal: normal };
}

/** Group pass meshes that draw the same object, by their world bounds. */
export function groupCubemapSurfaces(meshes: readonly AbstractMesh[]): CubemapSurface[] {
  const byBounds = new Map<string, AbstractMesh[]>();
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    const key = [box.minimumWorld, box.maximumWorld]
      .flatMap((v) => [v.x, v.y, v.z])
      .map((n) => Math.round(n * 10))
      .join(",");
    const group = byBounds.get(key);
    if (group) group.push(mesh);
    else byBounds.set(key, [mesh]);
  }
  return Array.from(byBounds.values(), (group) => ({ meshes: group, ...describeSurface(group[0]) }));
}

interface Capture {
  surface: CubemapSurface;
  probe: ReflectionProbe | null;
  done: boolean;
}

export class SurfaceCubemaps {
  private readonly staticMeshes = new Set<AbstractMesh>();
  private readonly captures: Capture[] = [];
  private observer: Observer<Scene> | null = null;

  constructor(private readonly scene: Scene) {}

  /** Find the `$cubemap` objects under `root` and the static world they reflect. Returns how many objects. */
  claim(root: AbstractMesh): number {
    const surfaces: AbstractMesh[] = [];
    for (const mesh of [root, ...root.getChildMeshes(false), ...this.scene.meshes.filter((m) => m.infiniteDistance)]) {
      if (isCubemapSurface(mesh)) {
        surfaces.push(mesh);
        continue;
      }
      if (mesh.metadata?.liquidKind || mesh.metadata?.effectOwned || mesh.metadata?.excludeFromWaterCapture) continue;
      if (mesh.metadata?.autosprite || mesh.metadata?.autosprite2 || (mesh.layerMask & WEAPON_LAYER) !== 0) continue;
      if (mesh.getTotalVertices() && mesh.isEnabled()) this.staticMeshes.add(mesh);
    }
    for (const surface of groupCubemapSurfaces(surfaces)) this.captures.push({ surface, probe: null, done: false });
    return this.captures.length;
  }

  /** Capture what is still pending on later frames, one object per frame. */
  captureInPlay(): void {
    if (this.observer || !this.captures.some((capture) => !capture.done)) return;
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      const camera = this.scene.activeCamera;
      if (camera) this.captureNext(camera);
    });
  }

  /**
   * Capture every object now, up to the budget. Map loading awaits this behind
   * the loading screen, where six renders of the world per object do not stall
   * play. A capture waits for its shaders to compile, up to `timeoutMs` in
   * all; what is left over is captured in play. Returns how many it captured.
   */
  async captureAll(camera: Camera, timeoutMs = 3000): Promise<number> {
    const deadline = performance.now() + timeoutMs;
    let captured = 0;
    for (;;) {
      const result = this.captureNext(camera);
      if (result) captured++;
      else if (result === null) {
        if (!this.captures.some((capture) => !capture.done) || performance.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }
    this.captureInPlay();
    return captured;
  }

  /** Capture one pending object: true when captured, false when it failed, null when none can be captured now. */
  private captureNext(camera: Camera): boolean | null {
    const pending = this.captures.find((capture) => !capture.done);
    if (!pending) {
      this.stopWatching();
      return null;
    }
    if (!pending.probe && this.captures.filter((capture) => capture.probe).length >= MAX_SURFACE_CUBEMAPS) {
      for (const capture of this.captures) if (!capture.done) this.shareNearest(capture);
      this.stopWatching();
      return null;
    }
    const meshes = Array.from(this.staticMeshes).filter((m) => !m.isDisposed() && m.isEnabled());
    if (meshes.some((m) => !m.isReady(true) || (m.material && !m.material.isReady(m)))) return null;
    const visibility = meshes.map((m) => m.isVisible);
    const transientLights = this.scene.lights.filter((light) => light.metadata?.excludeFromWaterCapture);
    const lightEnabled = transientLights.map((light) => light.isEnabled());
    try {
      for (const light of transientLights) light.setEnabled(false);
      // PVS is stored in isVisible; the capture sees the whole static world
      for (const mesh of meshes) mesh.isVisible = true;
      // Shaders compile per render pass, and a probe's passes are its own:
      // one not ready yet is kept and asked again
      pending.probe ??= this.createProbe(pending.surface, camera);
      const probe = pending.probe;
      probe.renderList = meshes;
      if (!probe.cubeTexture.isReadyForRendering()) return null;
      probe.cubeTexture.render(false);
      pending.done = true;
      for (const mesh of pending.surface.meshes) this.assign(mesh, probe);
      devLog(
        `[SurfaceCubemaps] Captured ${probe.name} for ${pending.surface.meshes[0].name} (${meshes.length} static meshes)`,
      );
      return true;
    } catch (error) {
      pending.probe?.dispose();
      pending.probe = null;
      pending.done = true;
      console.warn("[SurfaceCubemaps] Capture failed; the surface reflects nothing", error);
      return false;
    } finally {
      transientLights.forEach((light, i) => {
        if (!light.isDisposed()) light.setEnabled(lightEnabled[i]);
      });
      meshes.forEach((m, i) => {
        if (!m.isDisposed()) m.isVisible = visibility[i];
      });
    }
  }

  private createProbe(surface: CubemapSurface, camera: Camera): ReflectionProbe {
    const probe = new ReflectionProbe(
      `surface-cubemap-${this.captures.filter((capture) => capture.probe).length}`,
      PROBE_SIZE,
      this.scene,
      true,
      false,
      this.scene.imageProcessingConfiguration.applyByPostProcess && this.scene.imageProcessingConfiguration.isEnabled,
    );
    probe.refreshRate = 0;
    const target = probe.cubeTexture;
    target.activeCamera = camera;
    target.renderParticles = false;
    target.renderSprites = false;
    target.forceLayerMaskCheck = true;
    for (let group = 0; group < 4; group++) probe.setRenderingAutoClearDepthStencil(group, false);
    if (surface.flatNormal) {
      const start = surface.centre.add(surface.flatNormal.scale(FLAT_OFFSET));
      const room = this.roomAround(start);
      if (room) {
        probe.position.copyFrom(room.centre);
        target.boundingBoxPosition = room.centre;
        target.boundingBoxSize = room.size;
      } else probe.position.copyFrom(start);
    } else probe.position.copyFrom(surface.centre);
    return probe;
  }

  /**
   * The box of the room in front of a flat surface, found with rays along the
   * axes, and centred where a capture can see the surface. Null in the open
   * (a ray found no wall) or when the room's middle is out of sight.
   */
  private roomAround(start: Vector3): { centre: Vector3; size: Vector3 } | null {
    const solid = (mesh: AbstractMesh) =>
      this.staticMeshes.has(mesh) && !mesh.infiniteDistance && !mesh.material?.needAlphaBlendingForMesh(mesh);
    const min = start.clone();
    const max = start.clone();
    for (const axis of ["x", "y", "z"] as const) {
      for (const sign of [-1, 1]) {
        const direction = Vector3.Zero();
        direction[axis] = sign;
        const hit = this.scene.pickWithRay(new Ray(start, direction, ROOM_REACH), solid);
        if (!hit?.hit) return null;
        (sign > 0 ? max : min)[axis] = start[axis] + sign * hit.distance;
      }
    }
    const centre = min.add(max).scale(0.5);
    const toCentre = centre.subtract(start);
    const distance = toCentre.length();
    if (distance > 1) {
      const blocked = this.scene.pickWithRay(new Ray(start, toCentre.normalize(), distance), solid);
      if (blocked?.hit) return null;
    }
    return { centre, size: max.subtract(min) };
  }

  private shareNearest(capture: Capture): void {
    capture.done = true;
    let nearest: Capture | null = null;
    for (const other of this.captures) {
      if (!other.probe) continue;
      const distance = Vector3.DistanceSquared(other.surface.centre, capture.surface.centre);
      if (!nearest || distance < Vector3.DistanceSquared(nearest.surface.centre, capture.surface.centre))
        nearest = other;
    }
    if (nearest?.probe) for (const mesh of capture.surface.meshes) this.assign(mesh, nearest.probe);
  }

  private assign(mesh: AbstractMesh, probe: ReflectionProbe): void {
    if (mesh.isDisposed() || !(mesh.material instanceof StandardMaterial)) return;
    mesh.material.reflectionTexture = probe.cubeTexture;
    // A frozen world material only rebuilds its shader when forced
    if (mesh.material.isFrozen) mesh.material.markDirty(true);
  }

  private stopWatching(): void {
    this.observer?.remove();
    this.observer = null;
  }

  dispose(): void {
    this.stopWatching();
    const textures = new Set<BaseTexture | undefined>(this.captures.map((capture) => capture.probe?.cubeTexture));
    for (const capture of this.captures) {
      for (const mesh of capture.surface.meshes) {
        const material = mesh.material;
        if (material instanceof StandardMaterial && textures.has(material.reflectionTexture ?? undefined))
          material.reflectionTexture = null;
      }
      capture.probe?.dispose();
    }
    this.captures.length = 0;
    this.staticMeshes.clear();
  }
}
