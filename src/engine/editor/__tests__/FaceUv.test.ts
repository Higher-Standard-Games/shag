/**
 * Face alignment against what MakeBSP actually produced. The gradient tables
 * below are the WO-T0 measurements (docs/research/SHAGGED.md): ST fitted as a
 * linear function of position on every face of a compiled probe box.
 */

import { describe, expect, it } from "vitest";
import { EditorDocument, FACE_KEYS, type FaceKey, type FaceMaterial, type Vec3q } from "../EditorDocument";
import {
  FIXED_MATRIX,
  faceKeyFromNormal,
  faceST,
  faceTexMatrix,
  NATURAL_SCALE,
  naturalFace,
  type TexMatrix,
} from "../FaceUv";
import { writeMap } from "../MapWriter";

/** dS/dp and dT/dp of faceST, by finite difference (it is linear, so this is exact). */
function gradients(key: FaceKey, matrix: TexMatrix): { s: Vec3q; t: Vec3q } {
  const origin = { x: 0, y: 0, z: 0 };
  const [s0, t0] = faceST(key, matrix, origin);
  const step = (axis: keyof Vec3q) => {
    const [s, t] = faceST(key, matrix, { ...origin, [axis]: 1 });
    return [s - s0, t - t0];
  };
  const [sx, tx] = step("x");
  const [sy, ty] = step("y");
  const [sz, tz] = step("z");
  const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);
  return {
    s: { x: clean(sx), y: clean(sy), z: clean(sz) },
    t: { x: clean(tx), y: clean(ty), z: clean(tz) },
  };
}

const v = (x: number, y: number, z: number): Vec3q => ({ x, y, z });

describe("face alignment matches the compiled BSP", () => {
  it("reproduces the measured gradients for a scale matrix on every face", () => {
    const matrix: TexMatrix = [
      [1 / 64, 0, 0],
      [0, 1 / 32, 0],
    ];
    const measured: Record<FaceKey, { s: Vec3q; t: Vec3q }> = {
      "-X": { s: v(0, -1 / 64, 0), t: v(0, 0, -1 / 32) },
      "+X": { s: v(0, 1 / 64, 0), t: v(0, 0, -1 / 32) },
      "-Y": { s: v(1 / 64, 0, 0), t: v(0, 0, -1 / 32) },
      "+Y": { s: v(-1 / 64, 0, 0), t: v(0, 0, -1 / 32) },
      "-Z": { s: v(0, 1 / 64, 0), t: v(-1 / 32, 0, 0) },
      "+Z": { s: v(0, 1 / 64, 0), t: v(1 / 32, 0, 0) },
    };
    for (const key of FACE_KEYS) expect(gradients(key, matrix), key).toEqual(measured[key]);
  });

  it("reproduces the measured gradients for a rotated matrix on every face", () => {
    const matrix: TexMatrix = [
      [0, 1 / 64, 0],
      [-1 / 32, 0, 0],
    ];
    const measured: Record<FaceKey, { s: Vec3q; t: Vec3q }> = {
      "-X": { s: v(0, 0, -1 / 64), t: v(0, 1 / 32, 0) },
      "+X": { s: v(0, 0, -1 / 64), t: v(0, -1 / 32, 0) },
      "-Y": { s: v(0, 0, -1 / 64), t: v(-1 / 32, 0, 0) },
      "+Y": { s: v(0, 0, -1 / 64), t: v(1 / 32, 0, 0) },
      "-Z": { s: v(-1 / 64, 0, 0), t: v(0, -1 / 32, 0) },
      "+Z": { s: v(1 / 64, 0, 0), t: v(0, -1 / 32, 0) },
    };
    for (const key of FACE_KEYS) expect(gradients(key, matrix), key).toEqual(measured[key]);
  });
});

describe("face key from a picked normal", () => {
  it("maps each axis direction, and a tilted normal by its dominant axis", () => {
    expect(faceKeyFromNormal(v(1, 0, 0))).toBe("+X");
    expect(faceKeyFromNormal(v(-1, 0, 0))).toBe("-X");
    expect(faceKeyFromNormal(v(0, 1, 0))).toBe("+Y");
    expect(faceKeyFromNormal(v(0, -1, 0))).toBe("-Y");
    expect(faceKeyFromNormal(v(0, 0, 1))).toBe("+Z");
    expect(faceKeyFromNormal(v(0, 0, -1))).toBe("-Z");
    expect(faceKeyFromNormal(v(0.2, -0.9, 0.1))).toBe("-Y");
  });
});

describe("shift, scale and rotation to a face matrix", () => {
  it("gives natural alignment the gamepack's 0.5 units per texel", () => {
    expect(NATURAL_SCALE).toBe(0.5);
    // 128×32 at 0.5 units per texel: one repeat every 64 units across, 16 down.
    expect(faceTexMatrix(naturalFace("blx/blx_white_stripe", [128, 32]))).toEqual([
      [1 / 64, 0, 0],
      [-0, 1 / 16, 0],
    ]);
    const [s0] = faceST("+X", faceTexMatrix(naturalFace("x/y", [256, 256])), v(0, 0, 0));
    const [s1] = faceST("+X", faceTexMatrix(naturalFace("x/y", [256, 256])), v(0, 128, 0));
    expect(s1 - s0).toBeCloseTo(1, 12); // a 256 px texture spans 128 units
  });

  it("shifts in texels and rotates by degrees", () => {
    const face: FaceMaterial = { shader: "x/y", shift: [32, 8], scale: [1, 2], rotation: 90, size: [128, 64] };
    const [[a, b, c], [d, e, f]] = faceTexMatrix(face);
    expect(c).toBeCloseTo(32 / 128, 12);
    expect(f).toBeCloseTo(8 / 64, 12);
    expect(a).toBeCloseTo(0, 12);
    expect(b).toBeCloseTo(1 / 128, 12);
    expect(d).toBeCloseTo(-1 / 128, 12);
    expect(e).toBeCloseTo(0, 12);
  });
});

describe("per-face export and validation", () => {
  const brush = (faces?: Partial<Record<FaceKey, FaceMaterial>>) => ({
    id: "b",
    min: v(0, 0, 0),
    max: v(64, 64, 64),
    shader: "blx/blx_grid",
    ...(faces ? { faces } : {}),
  });

  it("writes a face without an override exactly as before face materials existed", () => {
    const document = new EditorDocument();
    document.transact((data) => data.brushes.push(brush()));
    expect(writeMap(document.snapshot())).toContain(
      "( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) ( ( 0.03125 0 0 ) ( 0 0.03125 0 ) ) blx/blx_grid 0 0 0",
    );
    expect(FIXED_MATRIX).toEqual([
      [0.03125, 0, 0],
      [0, 0.03125, 0],
    ]);
  });

  it("writes an overridden face with its own shader and matrix, at full precision", () => {
    const document = new EditorDocument();
    document.transact((data) => data.brushes.push(brush({ "+Z": naturalFace("blx/blx_white_stripe", [256, 32]) })));
    const source = writeMap(document.snapshot());
    expect(source).toContain(
      "( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) ( ( 0.0078125 0 0 ) ( 0 0.0625 0 ) ) blx/blx_white_stripe 0 0 0",
    );
    // the other five faces keep the brush's shader and the fixed matrix
    expect(source.match(/blx\/blx_grid 0 0 0/g)).toHaveLength(5);
  });

  it("refuses a textures/ prefix, a zero scale, a bad image size and an unknown face", () => {
    const document = new EditorDocument();
    const good = naturalFace("blx/blx_dark", [256, 256]);
    const reject = (faces: Record<string, unknown>) =>
      expect(() => document.transact((data) => data.brushes.push(brush(faces as never)))).toThrow();
    reject({ "+Z": { ...good, shader: "textures/blx/blx_dark" } });
    reject({ "+Z": { ...good, scale: [0, 0.5] } });
    reject({ "+Z": { ...good, size: [0, 256] } });
    reject({ "+Z": { ...good, size: [256.5, 256] } });
    reject({ "+W": good });
    expect(document.snapshot().brushes).toHaveLength(0);
  });
});
