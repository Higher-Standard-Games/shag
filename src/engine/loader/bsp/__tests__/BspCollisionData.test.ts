import fs from "node:fs";
import path from "node:path";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { expect, it } from "vitest";
import { SweepCollisionBackend } from "../../../physics/SweepCollisionBackend";
import { resolveMapBspViaIndex } from "../../pk3/NodePk3";
import { BspLoader } from "../BspLoader";

function patchFixture(fbsp: boolean, firstVertex = 0): ArrayBuffer {
  const stride = fbsp ? 80 : 44,
    faceSize = fbsp ? 148 : 104;
  const header = 8 + 18 * 8;
  const bytes = new ArrayBuffer(header + 72 + 9 * stride + faceSize + 9);
  const view = new DataView(bytes);
  view.setUint32(0, fbsp ? 0x50534246 : 0x50534249, true);
  view.setInt32(4, fbsp ? 1 : 46, true);
  let cursor = header;
  for (const [lump, length] of [
    [1, 72],
    [10, 9 * stride],
    [13, faceSize],
    [16, 9],
  ]) {
    view.setInt32(8 + lump * 8, cursor, true);
    view.setInt32(12 + lump * 8, length, true);
    cursor += length;
  }
  view.setInt32(header + 68, 1, true);
  for (let i = 0; i < 9; i++) {
    const offset = header + 72 + i * stride;
    view.setFloat32(offset, (i % 3) * 16, true);
    view.setFloat32(offset + 4, Math.floor(i / 3) * 16, true);
    view.setFloat32(offset + 8, 96, true);
  }
  const face = header + 72 + 9 * stride;
  view.setInt32(face + 8, 2, true);
  view.setInt32(face + 12, firstVertex, true);
  view.setInt32(face + 16, 9, true);
  view.setInt32(face + faceSize - 8, 3, true);
  view.setInt32(face + faceSize - 4, 3, true);
  const vis = face + faceSize;
  view.setInt32(vis, 1, true);
  view.setInt32(vis + 4, 1, true);
  view.setUint8(vis + 8, 1);
  return bytes;
}

it.each([false, true])("reads exact patch controls without visual attributes for FBSP=%s", (fbsp) => {
  const bytes = patchFixture(fbsp);
  const full = BspLoader.load(bytes),
    compact = BspLoader.loadCollision(bytes);
  expect(compact.vertices.map((v) => v.position)).toEqual(full.vertices.map((v) => v.position));
  expect(compact.visData!.bitVectors).toEqual(Uint8Array.of(1));
  expect(compact.visData!.bitVectors.buffer.byteLength).toBe(1);
  expect(() => BspLoader.loadCollision(patchFixture(fbsp, 1))).toThrow("Invalid patch control range");
});

it.each(["wdm2", "wfdm5", "wfdm11"])("retains collision parity and independent PVS bytes for %s", async (map) => {
  if (!fs.existsSync(path.join("public/data", `map_${map}.pk3`))) return;
  const bytes = (await resolveMapBspViaIndex(["public/data"], map))!;
  const full = BspLoader.load(bytes);
  const compact = BspLoader.loadCollision(bytes);
  expect(compact.faces).toEqual(full.faces);
  expect(compact.entities).toEqual(full.entities);
  expect(compact.models).toEqual(full.models);
  expect("lightmaps" in compact).toBe(false);
  expect("lightVols" in compact).toBe(false);
  expect("meshVerts" in compact).toBe(false);
  if (full.visData) {
    expect(compact.visData!.bitVectors).toEqual(full.visData.bitVectors);
    expect(compact.visData!.bitVectors.buffer).not.toBe(bytes);
    expect(compact.visData!.bitVectors.buffer.byteLength).toBe(compact.visData!.bitVectors.byteLength);
  }
  for (const face of full.faces) {
    if (face.faceType !== 2) continue;
    for (let i = face.firstVertex; i < face.firstVertex + face.patchSize[0] * face.patchSize[1]; i++) {
      expect(compact.vertices[i].position).toEqual(full.vertices[i].position);
      expect(Object.keys(compact.vertices[i])).toEqual(["position"]);
    }
  }
  const a = new SweepCollisionBackend(),
    b = new SweepCollisionBackend();
  await a.init(full);
  await b.init(compact);
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const model = full.models[0];
  const point = () => {
    const q = model.mins.map((v, axis) => v + random() * (model.maxs[axis] - v));
    return new Vector3(q[0], q[2], q[1]);
  };
  try {
    for (let i = 0; i < 120; i++) {
      const start = point(),
        end = point();
      for (const options of [
        { radius: 0, height: 0 },
        { radius: 1, height: 2 },
        { radius: 16, height: 64 },
      ]) {
        expect(b.trace(start, end, options)).toEqual(a.trace(start, end, options));
      }
      expect(b.pointContents(start)).toBe(a.pointContents(start));
      const delta = end.subtract(start).normalize().scale(12);
      expect(b.stepSlideMove(start, delta)).toEqual(a.stepSlideMove(start, delta));
    }
  } finally {
    a.dispose();
    b.dispose();
  }
}, 30000);
