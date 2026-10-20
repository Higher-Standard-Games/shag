/** Static room captures. Never consumes the player/weapon camera's active list. */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { Effect } from "@babylonjs/core/Materials/effect";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../../core/DevLog";

const MAX_PROBES = 4;
const PROBE_SIZE = 256;
const WEAPON_LAYER = 0x10000000;

export interface WaterPatch {
  meshes: AbstractMesh[];
  min: Vector3;
  max: Vector3;
  position: Vector3;
  triangles: Vector3[][];
  contains(x: number, y: number, z: number): boolean;
}

function inTriangle(x: number, z: number, t: Vector3[]): boolean {
  const cross = (a: Vector3, b: Vector3) => (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
  const a = cross(t[0], t[1]),
    b = cross(t[1], t[2]),
    c = cross(t[2], t[0]);
  return (a >= -0.01 && b >= -0.01 && c >= -0.01) || (a <= 0.01 && b <= 0.01 && c <= 0.01);
}

/** Only flat, connected geometry is eligible. Ambiguous multi-pool batches retain authored reflection. */
export function waterPatch(mesh: AbstractMesh): WaterPatch | null {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices?.length) return null;
  const world = mesh.computeWorldMatrix(true);
  const vertices: Vector3[] = [];
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const p = Vector3.TransformCoordinates(Vector3.FromArray(positions, i), world);
    vertices.push(p);
    min.minimizeInPlace(p);
    max.maximizeInPlace(p);
  }
  if (max.y - min.y > 0.1 || max.x - min.x < 1 || max.z - min.z < 1) return null;
  const triangles: Vector3[][] = [];
  const parents: number[] = [];
  const seen = new Map<string, number>();
  const find = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  let largest = 0;
  let position = min.add(max).scale(0.5);
  for (let i = 0; i < indices.length; i += 3) {
    const t = [vertices[indices[i]], vertices[indices[i + 1]], vertices[indices[i + 2]]];
    if (t.some((p) => !p)) return null;
    const area = Math.abs((t[1].x - t[0].x) * (t[2].z - t[0].z) - (t[1].z - t[0].z) * (t[2].x - t[0].x));
    if (area < 0.001) continue;
    const id = triangles.length;
    parents.push(id);
    triangles.push(t);
    for (const p of t) {
      const key = `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
      const other = seen.get(key);
      if (other !== undefined) parents[find(id)] = find(other);
      else seen.set(key, id);
    }
    if (area > largest) {
      largest = area;
      position = t[0]
        .add(t[1])
        .add(t[2])
        .scale(1 / 3);
    }
  }
  if (!triangles.length || parents.some((_, i) => find(i) !== find(0))) return null;
  const centre = min.add(max).scale(0.5);
  if (triangles.some((t) => inTriangle(centre.x, centre.z, t))) position = centre;
  position.y += 2;
  return {
    meshes: [mesh],
    min,
    max,
    position,
    triangles,
    contains(x, y, z) {
      return Math.abs(y - min.y) < 3 && triangles.some((t) => inTriangle(x, z, t));
    },
  };
}

export interface CachedWaterProbe {
  patch: WaterPatch;
  probe: ReflectionProbe;
  roomMin: Vector3;
  roomMax: Vector3;
  ready: boolean;
}

export class WaterProbeCache {
  readonly entries: CachedWaterProbe[] = [];
  private readonly staticMeshes = new Set<AbstractMesh>();
  private readonly patches = new Map<AbstractMesh, WaterPatch>();
  private lastCaptureFrame = -1;
  private readonly failed = new Set<WaterPatch>();

  constructor(
    private readonly scene: Scene,
    private readonly probeLift = 64,
  ) {}

  claim(root: AbstractMesh, liquids: AbstractMesh[]): void {
    for (const mesh of [root, ...root.getChildMeshes(false), ...this.scene.meshes.filter((m) => m.infiniteDistance)]) {
      if (mesh.metadata?.liquidKind || mesh.metadata?.effectOwned || mesh.metadata?.excludeFromWaterCapture) continue;
      if (mesh.metadata?.autosprite || mesh.metadata?.autosprite2 || (mesh.layerMask & WEAPON_LAYER) !== 0) continue;
      if (mesh.getTotalVertices() && mesh.isEnabled()) this.staticMeshes.add(mesh);
    }
    for (const mesh of liquids) {
      if (this.patches.has(mesh)) continue;
      const patch = waterPatch(mesh);
      if (patch) this.patches.set(mesh, patch);
      else
        console.warn(
          `[Water] ${mesh.name}: non-flat or disconnected batch; using authored/sky fallback, no local waves`,
        );
    }
    // BSP faces split by material/lightmap must share a capture and impulses
    // when their actual boundary vertices meet on the same horizontal plane.
    let merged = true;
    while (merged) {
      merged = false;
      const regions = Array.from(new Set(this.patches.values()));
      outer: for (let i = 0; i < regions.length; i++) {
        const a = regions[i];
        const vertices = new Set(a.triangles.flat().map((p) => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`));
        for (const b of regions.slice(i + 1)) {
          if (
            Math.abs(a.min.y - b.min.y) > 0.1 ||
            !b.triangles.some((t) => t.some((p) => vertices.has(`${Math.round(p.x * 100)},${Math.round(p.z * 100)}`)))
          )
            continue;
          const triangles = [...a.triangles, ...b.triangles];
          const min = Vector3.Minimize(a.min, b.min),
            max = Vector3.Maximize(a.max, b.max);
          const centre = min.add(max).scale(0.5);
          const patch: WaterPatch = {
            meshes: [...a.meshes, ...b.meshes],
            min,
            max,
            triangles,
            position: triangles.some((t) => inTriangle(centre.x, centre.z, t))
              ? centre.add(new Vector3(0, 2, 0))
              : a.position,
            contains: (x, y, z) => Math.abs(y - min.y) < 3 && triangles.some((t) => inTriangle(x, z, t)),
          };
          for (const mesh of patch.meshes) this.patches.set(mesh, patch);
          for (let entry = this.entries.length - 1; entry >= 0; entry--) {
            if (this.entries[entry].patch === a || this.entries[entry].patch === b)
              this.entries.splice(entry, 1)[0].probe.dispose();
          }
          merged = true;
          break outer;
        }
      }
    }
  }

  patchFor(mesh: AbstractMesh): WaterPatch | undefined {
    return this.patches.get(mesh);
  }

  remove(mesh: AbstractMesh): void {
    const patch = this.patches.get(mesh);
    this.patches.delete(mesh);
    if (!patch) return;
    patch.meshes = patch.meshes.filter((m) => m !== mesh);
    if (patch.meshes.length) return;
    this.failed.delete(patch);
    const index = this.entries.findIndex((entry) => entry.patch === patch);
    if (index >= 0) this.entries.splice(index, 1)[0].probe.dispose();
  }

  surfaceAt(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
    const patch = Array.from(this.patches.values())
      .filter((p) => Math.abs(p.min.y - position.y) <= 64 && p.contains(position.x, p.min.y, position.z))
      .sort((a, b) => Math.abs(a.min.y - position.y) - Math.abs(b.min.y - position.y))[0];
    return patch ? { x: position.x, y: patch.min.y, z: position.z } : null;
  }

  /** Called before main rendering. One complete capture per frame, with a fixed total budget. */
  update(camera: Camera): void {
    if (this.lastCaptureFrame === this.scene.getFrameId()) return;
    const patch = Array.from(this.patches.values()).find(
      (p) => !this.failed.has(p) && !this.entries.some((e) => e.patch === p),
    );
    if (!patch || this.entries.length >= MAX_PROBES) return;
    const meshes = Array.from(this.staticMeshes).filter((m) => !m.isDisposed() && m.isEnabled());
    if (!meshes.length || meshes.some((m) => !m.isReady(true) || (m.material && !m.material.isReady(m)))) return;
    this.lastCaptureFrame = this.scene.getFrameId();
    let probe: ReflectionProbe | undefined;
    const visibility = meshes.map((m) => m.isVisible);
    const transientLights = this.scene.lights.filter((light) => light.metadata?.excludeFromWaterCapture);
    const lightEnabled = transientLights.map((light) => light.isEnabled());
    try {
      transientLights.forEach((light) => {
        light.setEnabled(false);
      });
      meshes.forEach((m) => {
        m.isVisible = true;
      });
      const position = this.capturePosition(patch);
      if (!position) throw new Error("No open probe position above this water patch");
      // Capture in the scene's current colour space, without toggling its
      // material variants. Preserve this encoding on the texture for sampling
      // even if image processing is later enabled/disabled by the player.
      probe = new ReflectionProbe(
        `water-room-${this.entries.length}`,
        PROBE_SIZE,
        this.scene,
        true,
        false,
        this.scene.imageProcessingConfiguration.applyByPostProcess && this.scene.imageProcessingConfiguration.isEnabled,
      );
      probe.position.copyFrom(position);
      probe.refreshRate = 0;
      probe.renderList = meshes;
      const target = probe.cubeTexture;
      target.activeCamera = camera;
      target.renderParticles = false;
      target.renderSprites = false;
      target.forceLayerMaskCheck = true;
      // Keep depth across map rendering groups, including transparent static trim.
      for (let group = 0; group < 4; group++) probe.setRenderingAutoClearDepthStencil(group, false);
      const entry: CachedWaterProbe = {
        patch,
        probe,
        roomMin: position.subtractFromFloats(1024, 256, 1024),
        roomMax: position.add(new Vector3(1024, 1024, 1024)),
        ready: false,
      };
      // PVS is stored in isVisible. Override only the captured static list and
      // restore it even if a shader/driver throws. No camera active-list dependency.
      for (const [axis, direction] of [
        ["x", new Vector3(1, 0, 0)],
        ["y", new Vector3(0, 1, 0)],
        ["z", new Vector3(0, 0, 1)],
      ] as const) {
        for (const sign of [-1, 1]) {
          const ray = new Ray(position, direction.scale(sign), 2048);
          const hit = this.scene.pickWithRay(ray, (m) => this.staticMeshes.has(m) && !m.infiniteDistance);
          if (hit?.hit && hit.distance > 4)
            (sign > 0 ? entry.roomMax : entry.roomMin)[axis] = position[axis] + sign * hit.distance;
        }
      }
      // Interior islands are not the room boundary. Keep the proxy enclosing
      // its entire water region so crossing that island's axis cannot abruptly
      // switch from local projection to the infinite-distance fallback.
      entry.roomMin.x = Math.min(entry.roomMin.x, patch.min.x - 1);
      entry.roomMin.z = Math.min(entry.roomMin.z, patch.min.z - 1);
      entry.roomMax.x = Math.max(entry.roomMax.x, patch.max.x + 1);
      entry.roomMax.z = Math.max(entry.roomMax.z, patch.max.z + 1);
      // A raised probe can see an island's top below it. The projection volume
      // must still contain the actual water, not start at that island's height.
      entry.roomMin.y = Math.min(entry.roomMin.y, patch.min.y - 1);
      if (target.isReadyForRendering()) {
        target.render(false);
        entry.ready = true;
        this.entries.push(entry);
        devLog(
          `[Water] Captured ${probe.name}: ${meshes.length} static meshes, ${PROBE_SIZE}px x 6; no recurring reflection pass`,
        );
      } else probe.dispose();
    } catch (error) {
      probe?.dispose();
      // Remember failure to avoid repeated expensive driver failures.
      this.failed.add(patch);
      console.warn("[Water] Room capture failed; retaining authored environment", error);
    } finally {
      transientLights.forEach((light, i) => {
        if (!light.isDisposed()) light.setEnabled(lightEnabled[i]);
      });
      meshes.forEach((m, i) => {
        if (!m.isDisposed()) m.isVisible = visibility[i];
      });
    }
  }

  /** BSP water polygons can run UNDER a solid island. A triangle centroid is
   * not proof of free space. Reject candidates whose nearest opaque hit exits
   * a backface (inside solid geometry), then try interior samples of the pool. */
  private capturePosition(patch: WaterPatch): Vector3 | null {
    const candidates = [patch.position];
    for (const x of [0.25, 0.75, 0.125, 0.875]) {
      for (const z of [0.25, 0.75, 0.125, 0.875]) {
        const point = new Vector3(
          patch.min.x + (patch.max.x - patch.min.x) * x,
          patch.min.y + 2,
          patch.min.z + (patch.max.z - patch.min.z) * z,
        );
        if (patch.contains(point.x, patch.min.y, point.z)) candidates.push(point);
      }
    }
    for (const triangle of patch.triangles.slice(0, 24))
      candidates.push(
        triangle[0]
          .add(triangle[1])
          .add(triangle[2])
          .scale(1 / 3)
          .add(new Vector3(0, 2, 0)),
      );
    const directions = [
      Vector3.Right(),
      Vector3.Left(),
      Vector3.Up(),
      Vector3.Down(),
      Vector3.Forward(),
      Vector3.Backward(),
    ];
    const anchor = candidates.find((position) =>
      directions.every((direction) => {
        const hit = this.scene.pickWithRay(
          new Ray(position, direction, 2048),
          (mesh) =>
            this.staticMeshes.has(mesh) && !mesh.infiniteDistance && !mesh.material?.needAlphaBlendingForMesh(mesh),
        );
        if (!hit?.hit) return true;
        // PickingInfo normally flips normals to face its ray, hiding backfaces.
        // This result is local; clear its ray to retain the geometry's orientation.
        hit.ray = null;
        const normal = hit.getNormal(true);
        return hit.distance > 1 && (!normal || Vector3.Dot(normal, direction) <= 0.01);
      }),
    );
    if (!anchor) return null;
    // The waterline viewpoint can see little except black retaining walls.
    // Prefer a room-height viewpoint, but trace the entire lift so an overhang
    // cannot put the cubemap inside a solid or in a different room above it.
    const lift = Number.isFinite(this.probeLift) ? Math.max(0, Math.min(128, this.probeLift)) : 0;
    const ceiling = this.scene.pickWithRay(
      new Ray(anchor, Vector3.Up(), lift + 4),
      (mesh) => this.staticMeshes.has(mesh) && !mesh.infiniteDistance && !mesh.material?.needAlphaBlendingForMesh(mesh),
    );
    const allowedLift = ceiling?.hit ? Math.min(lift, Math.max(0, ceiling.distance - 4)) : lift;
    return anchor.add(new Vector3(0, allowedLift, 0));
  }

  bind(effect: Effect, mesh: AbstractMesh, fallback: BaseTexture | null): void {
    const entry = this.entries.find((e) => e.ready && e.patch.meshes.includes(mesh));
    const texture = entry?.probe.cubeTexture ?? fallback;
    if (texture?.isCube) effect.setTexture("uEnvironment", texture);
    effect.setFloat("uHasEnvironment", texture?.isCube ? 1 : 0);
    // Babylon render-target cubemaps use INVCUBIC_MODE (6). StandardMaterial
    // flips Y for these; a raw shader lookup must do the same or reflect the floor.
    effect.setFloat("uEnvironmentYSign", texture?.coordinatesMode === 6 ? -1 : 1);
    effect.setFloat("uEnvironmentIsLinear", texture?.gammaSpace === false ? 1 : 0);
    effect.setFloat("uLocalProbe", entry ? 1 : 0);
    if (entry) {
      effect.setVector3("uProbePosition", entry.probe.position);
      effect.setVector3("uProbeMin", entry.roomMin);
      effect.setVector3("uProbeMax", entry.roomMax);
    }
  }

  dispose(): void {
    for (const entry of this.entries) entry.probe.dispose();
    this.entries.length = 0;
    this.staticMeshes.clear();
    this.patches.clear();
    this.failed.clear();
  }
}
