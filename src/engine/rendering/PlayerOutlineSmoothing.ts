import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { PlayerOutlineProxy } from "./PlayerOutlineProxy";

const adapters = new WeakMap<Scene, PlayerOutlineProxy>();

function adapterFor(scene: Scene): PlayerOutlineProxy {
  let adapter = adapters.get(scene);
  if (!adapter) {
    adapter = new PlayerOutlineProxy(scene, true);
    adapter.enabled = true;
    adapters.set(scene, adapter);
    const owned = adapter;
    scene.onDisposeObservable.addOnce(() => {
      owned.dispose();
      adapters.delete(scene);
    });
  }
  return adapter;
}

/** Average split normals only where position and skin influence agree. */
export function smoothPlayerOutlineNormals(mesh: Mesh): Float32Array | null {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
  if (!positions || !normals || !joints || !weights || mesh.numBoneInfluencers > 4) return null;
  const keys: string[] = [];
  const groups = new Map<string, Map<string, number[]>>();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const influences: [number, number][] = [];
    for (let index = 0; index < 4; index++) {
      const offset = vertex * 4 + index;
      if (weights[offset] > 0) influences.push([joints[offset], Math.round(weights[offset] * 100000)]);
    }
    influences.sort((a, b) => a[0] - b[0]);
    const start = vertex * 3;
    const key = `${Math.round(positions[start] * 100000)},${Math.round(positions[start + 1] * 100000)},${Math.round(positions[start + 2] * 100000)}|${influences.map(([joint, weight]) => `${joint}:${weight}`).join(",")}`;
    keys.push(key);
    let group = groups.get(key);
    if (!group) {
      group = new Map();
      groups.set(key, group);
    }
    const normal = [normals[start], normals[start + 1], normals[start + 2]];
    group.set(normal.map((value) => Math.round(value * 100000)).join(","), normal);
  }
  const averaged = new Map<string, number[]>();
  for (const [key, group] of groups) {
    const sum = [0, 0, 0];
    for (const normal of group.values()) for (let axis = 0; axis < 3; axis++) sum[axis] += normal[axis];
    const length = Math.hypot(...sum);
    if (length > 0.000001)
      averaged.set(
        key,
        sum.map((value) => value / length),
      );
  }
  const result = new Float32Array(normals.length);
  let changed = false;
  for (let vertex = 0; vertex < keys.length; vertex++) {
    const normal = averaged.get(keys[vertex]);
    for (let axis = 0; axis < 3; axis++) {
      const offset = vertex * 3 + axis;
      result[offset] = normal?.[axis] ?? normals[offset];
      if (Math.abs(result[offset] - normals[offset]) > 0.0001) changed = true;
    }
  }
  return changed ? result : null;
}

/** One shared outline geometry per source mesh; the lit body is unchanged. */
export class PlayerOutlineSmoothing {
  private readonly templates = new Map<NonNullable<Mesh["geometry"]>, Mesh | null>();
  constructor(private readonly scene: Scene) {}

  attach(root: Mesh, container: AssetContainer): void {
    for (const body of [root, ...root.getChildMeshes()]) {
      if (!(body instanceof Mesh) || !body.geometry || !body.skeleton || body.subMeshes.length !== 1) continue;
      const source = container.meshes.find((part) => part instanceof Mesh && part.geometry === body.geometry) as
        | Mesh
        | undefined;
      if (!source) continue;
      let template = this.templates.get(body.geometry);
      if (!this.templates.has(body.geometry)) {
        const normals = smoothPlayerOutlineNormals(source);
        template = normals ? source.clone(`${source.name}/outlineNormals`, null, true) : null;
        if (template && normals) {
          // Mesh.clone inherits the source parent even when passed null. Keep
          // this cache outside the hierarchy used for future player instances.
          template.parent = null;
          template.makeGeometryUnique();
          template.setVerticesData(VertexBuffer.NormalKind, normals, false);
          template.setEnabled(false);
          this.scene.removeMesh(template);
        }
        this.templates.set(body.geometry, template ?? null);
      }
      if (template) adapterFor(this.scene).attach(body, template);
    }
  }

  dispose(): void {
    for (const template of this.templates.values()) template?.dispose(true, false);
    this.templates.clear();
  }
}
