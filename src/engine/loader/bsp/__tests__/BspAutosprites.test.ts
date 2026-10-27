import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { EffectLayer } from "@babylonjs/core/Layers/effectLayer";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSPRITE_CENTER_KIND,
  AUTOSPRITE_FRAME_KIND,
  AUTOSPRITE_RIGHT_KIND,
  isGpuAutosprite,
} from "../../shader/Q3AutospritePlugin";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";
import { createAutosprite2Geometry, updateAutosprite2Geometry } from "../mesh/autosprite2";
import { type AutospriteVertexData, autospriteBounds, autospriteVertexData } from "../mesh/autospriteRecords";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function billboard(isAutosprite2 = false) {
  const worldMesh = new Mesh("world", scene);
  const mesh = new Mesh("sprite", scene);
  mesh.parent = worldMesh;
  const h = isAutosprite2 ? 2 : 1;
  mesh.setVerticesData(VertexBuffer.PositionKind, [-1, -h, 0, 1, -h, 0, 1, h, 0, -1, h, 0], true);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  const result = {
    worldMesh,
    autospriteMeshes: [
      {
        mesh,
        center: [0, 0, 0],
        halfWidth: 1,
        halfHeight: h,
        isAutosprite2,
        vertexOffsets: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      },
    ],
  } as BspMeshBuildResult;
  return { mesh, result, upload: vi.spyOn(mesh, "updateVerticesData") };
}

describe("cached BSP billboards", () => {
  it.each([false, true])("updates normals for projected-distance fades (autosprite2=%s)", (cylindrical) => {
    const { mesh, result } = billboard(cylindrical);
    mesh.setVerticesData(VertexBuffer.NormalKind, Array.from({ length: 4 }, () => [0, 0, 1]).flat(), true);
    BspMeshBuilder.updateAutosprites(result, new Vector3(3, 4, 0));
    const normal = Array.from(mesh.getVerticesData(VertexBuffer.NormalKind)!).slice(0, 3);
    expect(normal[0]).toBeCloseTo(cylindrical ? 1 : 0.6);
    expect(normal[1]).toBeCloseTo(cylindrical ? 0 : 0.8);
    expect(normal[2]).toBe(0);
  });
  it("does no vertex reads or uploads for an unchanged eye, then catches even tiny motion", () => {
    const { mesh, result, upload } = billboard();
    const eye = new Vector3(0, 0, 10);
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);
    const read = vi.spyOn(mesh, "getVerticesData");
    expect(BspMeshBuilder.updateAutosprites(result, eye.clone())).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
    eye.x = 0.0001;
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it.each(["hidden", "disabled", "parent disabled", "zero visibility"])(
    "skips %s sprites and refreshes on re-entry at an unchanged eye",
    (reason) => {
      const { mesh, result, upload } = billboard();
      const eye = new Vector3(0, 0, 10);
      BspMeshBuilder.updateAutosprites(result, eye);
      if (reason === "hidden") mesh.isVisible = false;
      if (reason === "disabled") mesh.setEnabled(false);
      if (reason === "parent disabled") result.worldMesh.setEnabled(false);
      if (reason === "zero visibility") mesh.visibility = 0;
      const read = vi.spyOn(mesh, "getVerticesData");
      expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(0);
      expect(read).not.toHaveBeenCalled();
      mesh.isVisible = true;
      mesh.setEnabled(true);
      result.worldMesh.setEnabled(true);
      mesh.visibility = 1;
      expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);
      expect(upload).toHaveBeenCalledTimes(2);
    },
  );

  it.each([false, true])("preserves full/cylindrical billboard geometry (autosprite2=%s)", (cylindrical) => {
    const { mesh, result } = billboard(cylindrical);
    BspMeshBuilder.updateAutosprites(result, new Vector3(10, 0, 0));
    const z = 1,
      h = cylindrical ? 2 : 1;
    expect(Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!)).toEqual([
      0,
      -h,
      z,
      0,
      -h,
      -z,
      0,
      h,
      -z,
      0,
      h,
      z,
    ]);
    expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("keeps per-mesh state independent and does not poison it with invalid eye positions", () => {
    const first = billboard();
    const second = billboard();
    const eye = new Vector3(0, 0, 10);
    expect(BspMeshBuilder.updateAutosprites(first.result, eye)).toBe(1);
    expect(BspMeshBuilder.updateAutosprites(second.result, eye)).toBe(1);
    expect(BspMeshBuilder.updateAutosprites(first.result, new Vector3(Number.NaN, 0, 10))).toBe(0);
    expect(BspMeshBuilder.updateAutosprites(first.result, new Vector3(0, 0, Infinity))).toBe(0);
    expect(BspMeshBuilder.updateAutosprites(first.result, Vector3.Zero())).toBe(0);
    expect(BspMeshBuilder.updateAutosprites(first.result, eye)).toBe(0);
    first.mesh.dispose();
    expect(BspMeshBuilder.updateAutosprites(first.result, new Vector3(10, 0, 0))).toBe(0);
  });
});

describe("map-owned billboard callbacks", () => {
  it("updates after frame visibility changes and before active-mesh selection in a real scene render", () => {
    const { mesh, result, upload } = billboard();
    const camera = new FreeCamera("eye", new Vector3(0, 0, 10), scene);
    camera.setTarget(Vector3.Zero());
    mesh.isVisible = false;
    BspMeshBuilder.registerAutospriteUpdates(result);
    // Register later, as BspManager does at the end of gameplay loading.
    scene.onBeforeRenderObservable.add(() => {
      mesh.isVisible = true;
    });
    const counts: number[] = [];
    scene.onBeforeActiveMeshesEvaluationObservable.add(() => counts.push(upload.mock.calls.length));
    scene.render();
    expect(counts).toEqual([1]);
    scene.render();
    expect(counts).toEqual([1, 1]);
  });

  it("uses parented world positions, ignores the weapon camera, and refreshes for each world view", () => {
    const { result, upload } = billboard();
    const parent = new TransformNode("rig", scene);
    parent.position.z = 10;
    const eye = new FreeCamera("eye", Vector3.Zero(), scene);
    eye.parent = parent;
    const weapon = new FreeCamera("weapon", new Vector3(-10, 0, 0), scene);
    weapon.layerMask = 0x10000000;
    BspMeshBuilder.registerAutospriteUpdates(result);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    scene.onBeforeCameraRenderObservable.notifyObservers(weapon);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    expect(upload).toHaveBeenCalledTimes(1);
    const other = new FreeCamera("other", new Vector3(10, 0, 0), scene);
    scene.onBeforeCameraRenderObservable.notifyObservers(other);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    expect(upload).toHaveBeenCalledTimes(3);
    parent.position.x = 1;
    scene.activeCamera = eye;
    scene.render();
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it("waits for a camera and removes its observer on map disposal and replacement", () => {
    const first = billboard();
    const count = () => scene.onBeforeCameraRenderObservable.observers.filter((o) => !o._willBeUnregistered).length;
    const before = count();
    BspMeshBuilder.registerAutospriteUpdates(first.result);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(first.upload).not.toHaveBeenCalled();
    expect(count()).toBe(before + 1);
    first.result.worldMesh.dispose();
    expect(count()).toBe(before);
    const second = billboard();
    BspMeshBuilder.registerAutospriteUpdates(second.result);
    const eye = new FreeCamera("eye", new Vector3(0, 0, 10), scene);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    expect(first.upload).not.toHaveBeenCalled();
    expect(second.upload).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(count()).toBe(0);
  });
});

describe("Qfusion autosprite2 authored axes", () => {
  const cases = [
    { name: "vertical", up: [0, 0, 1], right: [1, 0, 0] },
    { name: "horizontal", up: [1, 0, 0], right: [0, 1, 0] },
    { name: "tilted", up: [1, 2, 3], right: [2, -1, 0] },
  ];
  const convert = (v: Vector3) => new Vector3(v.x, v.z, v.y);
  for (const { name, up: u, right: r } of cases) {
    it(`retains the ${name} long axis, centre and UV orientation across views`, () => {
      const up = Vector3.FromArray(u).normalize(),
        right = Vector3.FromArray(r).normalize();
      const center = new Vector3(13, -7, 23);
      const normal = Vector3.Cross(right, up).normalize();
      const signs = [
        [-1, -3],
        [1, -3],
        [1, 3],
        [-1, 3],
      ];
      const original = signs.flatMap(([x, y]) => convert(center.add(right.scale(x)).add(up.scale(y))).asArray());
      const geometry = createAutosprite2Geometry(original, [0, 2, 1, 0, 3, 2]);
      const positions = [...original],
        normals = Array(12).fill(0);
      expect(geometry.quads).toHaveLength(1);
      const referenceEye = convert(center.add(normal.scale(10)));
      updateAutosprite2Geometry(geometry, positions, normals, referenceEye);
      positions.forEach((v, i) => {
        expect(v).toBeCloseTo(original[i]);
      });
      // Move along the fixed axis as well: only the transverse view matters.
      const sideEye = convert(center.add(right.scale(10)).add(up.scale(17)));
      updateAutosprite2Geometry(geometry, positions, normals, sideEye);
      const newRight = Vector3.Cross(up, right);
      signs.forEach(([x, y], i) => {
        const expected = convert(center.add(newRight.scale(x)).add(up.scale(y)));
        expected.asArray().forEach((v, j) => {
          expect(positions[i * 3 + j]).toBeCloseTo(v);
        });
      });
      convert(right)
        .asArray()
        .forEach((v, i) => {
          expect(normals[i]).toBeCloseTo(v);
        });
      expect(updateAutosprite2Geometry(geometry, positions, normals, convert(center.add(up.scale(20))))).toBe(false);
      expect(positions.every(Number.isFinite)).toBe(true);
      updateAutosprite2Geometry(geometry, positions, normals, referenceEye);
      positions.forEach((v, i) => {
        expect(v).toBeCloseTo(original[i]);
      });
    });
  }
  it("handles distinct quads independently and ignores degenerate triangles", () => {
    const original = [-1, -3, 0, 1, -3, 0, 1, 3, 0, -1, 3, 0, 7, 0, -1, 13, 0, -1, 13, 0, 1, 7, 0, 1];
    const geometry = createAutosprite2Geometry(original, [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    expect(geometry.quads).toHaveLength(2);
    expect(Math.abs(geometry.quads[0].axis[1])).toBe(1);
    expect(Math.abs(geometry.quads[1].axis[0])).toBe(1);
    const positions = [...original];
    updateAutosprite2Geometry(geometry, positions, null, new Vector3(5, 10, 10));
    expect(positions.every(Number.isFinite)).toBe(true);
    expect(createAutosprite2Geometry([0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 0, 2, 1]).quads).toHaveLength(0);
  });
});

/** The vertex shader's billboard (Q3AutospritePlugin), evaluated on the CPU. */
function shaderPosition(data: AutospriteVertexData, positions: ArrayLike<number>, v: number, eye: Vector3): number[] {
  const [cx, cy, cz, mode] = Array.from(data.center.subarray(v * 4, v * 4 + 4));
  const frame = data.frame.subarray(v * 4, v * 4 + 4);
  const authored = Array.from(positions).slice(v * 3, v * 3 + 3);
  if (mode < 0.5) return authored;
  const center = new Vector3(cx, cy, cz);
  const toEye = eye.subtract(center);
  if (mode < 1.5) {
    const distance = toEye.length();
    if (distance < 0.001) return authored;
    const f = toEye.scale(1 / distance);
    let right = new Vector3(f.z, 0, -f.x);
    let up: Vector3;
    if (right.length() < 0.001) {
      right = new Vector3(1, 0, 0);
      up = new Vector3(0, 0, -1);
    } else {
      right = right.normalize();
      up = new Vector3(f.y * right.z, f.z * right.x - f.x * right.z, -f.y * right.x);
    }
    return center.add(right.scale(frame[0])).add(up.scale(frame[1])).asArray();
  }
  const axis = new Vector3(frame[0], frame[1], frame[2]);
  const across = toEye.subtract(axis.scale(Vector3.Dot(toEye, axis)));
  if (across.length() < 0.0001) return authored;
  const a = across.normalize();
  const turned = new Vector3(axis.z * a.y - axis.y * a.z, axis.x * a.z - axis.z * a.x, axis.y * a.x - axis.x * a.y);
  return center
    .add(axis.scale(frame[3]))
    .add(turned.scale(data.right[v * 4 + 3]))
    .asArray();
}

describe("vertex-shader billboard data", () => {
  const eyes = [
    new Vector3(0, 0, 10),
    new Vector3(30, 5, -4),
    new Vector3(-7, -20, 3),
    new Vector3(0.3, 50, 0.2),
    new Vector3(12, 0.5, 40),
  ];

  it.each([false, true])("places every vertex where the CPU billboard does (autosprite2=%s)", (cylindrical) => {
    const { mesh, result } = billboard(cylindrical);
    const record = result.autospriteMeshes![0];
    const authored = Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!);
    if (cylindrical) record.axisGeometry = createAutosprite2Geometry(authored, mesh.getIndices()!);
    record.vertexStart = 0;
    const data = autospriteVertexData([record], authored);
    const bounds = autospriteBounds(authored, data.center, data.frame, data.right);
    for (const eye of eyes) {
      BspMeshBuilder.updateAutosprites(result, eye);
      const cpu = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      for (let v = 0; v < 4; v++) {
        const gpu = shaderPosition(data, authored, v, eye);
        gpu.forEach((value, axis) => {
          expect(value).toBeCloseTo(cpu[v * 3 + axis], 5);
          expect(value).toBeGreaterThanOrEqual(bounds[axis] - 1e-5);
          expect(value).toBeLessThanOrEqual(bounds[axis + 3] + 1e-5);
        });
      }
    }
  });

  it("keeps a face of fewer than four vertices as authored", () => {
    const { mesh, result } = billboard();
    const record = result.autospriteMeshes![0];
    record.vertexOffsets = record.vertexOffsets.slice(0, 3);
    const data = autospriteVertexData([record], mesh.getVerticesData(VertexBuffer.PositionKind)!);
    expect(Array.from(data.center).filter((_, i) => i % 4 === 3)).toEqual([0, 0, 0, 0]);
  });

  it("hands a mesh to the vertex shader once its material takes the billboard, CPU while an effect layer draws", () => {
    const { mesh, result, upload } = billboard();
    const authored = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const data = autospriteVertexData(result.autospriteMeshes!, authored);
    mesh.setVerticesData(AUTOSPRITE_CENTER_KIND, data.center, false, 4);
    mesh.setVerticesData(AUTOSPRITE_FRAME_KIND, data.frame, false, 4);
    mesh.setVerticesData(AUTOSPRITE_RIGHT_KIND, data.right, false, 4);
    mesh.material = new StandardMaterial("sprite", scene);
    BspMeshBuilder.registerAutospriteUpdates(result);
    expect(isGpuAutosprite(mesh)).toBe(true);
    // The box holds the quad turned to any side, not just as authored
    const box = mesh.getBoundingInfo().boundingBox;
    expect(box.minimum.z).toBeCloseTo(-Math.SQRT2);
    expect(box.maximum.x).toBeCloseTo(Math.SQRT2);

    const eye = new Vector3(0, 0, 10);
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(0);
    expect(upload).not.toHaveBeenCalled();
    // A material assigned later takes the billboard too
    mesh.material = new StandardMaterial("replacement", scene);
    expect(isGpuAutosprite(mesh)).toBe(true);
    // A material that cannot take it leaves the mesh to the CPU billboard
    mesh.material = new ShaderMaterial("custom", scene, "custom", {});
    expect(isGpuAutosprite(mesh)).toBe(false);
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);

    mesh.material = new StandardMaterial("again", scene);
    scene.effectLayers.push({} as EffectLayer);
    expect(isGpuAutosprite(mesh)).toBe(false);
    expect(BspMeshBuilder.updateAutosprites(result, new Vector3(5, 0, 10))).toBe(1);
  });
});
