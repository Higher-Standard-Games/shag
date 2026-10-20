/**
 * Colour-blindness correction: the matrices keep greys grey and make colours
 * a colour-blind eye confuses easier to tell apart, and the pass exists only
 * while asked for, last on the camera.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import {
  ColorCorrectionPostProcess,
  type ColorVisionType,
  colorMatrix,
  correctionMatrix,
  type Mat3,
  simulationMatrix,
} from "../ColorCorrectionPostProcess";

const apply = (m: Mat3, [r, g, b]: number[]) => [
  m[0] * r + m[1] * g + m[2] * b,
  m[3] * r + m[4] * g + m[5] * b,
  m[6] * r + m[7] * g + m[8] * b,
];
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** How far apart two colours look to `type`, with or without correction. */
const seenApart = (type: ColorVisionType, a: number[], b: number[], corrected: boolean) => {
  const m = colorMatrix(corrected ? type : 0, 1, type);
  return distance(apply(m, a), apply(m, b));
};

describe("colour matrices", () => {
  it("leaves the image alone when off or at zero strength", () => {
    expect(correctionMatrix(0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(correctionMatrix(2, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(colorMatrix(0, 1, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("keeps greys grey for every type", () => {
    for (const type of [1, 2, 3] as const) {
      for (const level of [0.2, 0.5, 1]) {
        for (const channel of apply(correctionMatrix(type), [level, level, level])) {
          expect(channel).toBeCloseTo(level, 2);
        }
        for (const channel of apply(simulationMatrix(type), [level, level, level])) {
          expect(channel).toBeCloseTo(level, 2);
        }
      }
    }
  });

  it("pulls apart the colours each type confuses", () => {
    const red = [0.8, 0.1, 0.1];
    const green = [0.2, 0.6, 0.1];
    for (const type of [1, 2] as const) {
      expect(seenApart(type, red, green, true)).toBeGreaterThan(seenApart(type, red, green, false) * 1.3);
    }
    const blue = [0.1, 0.3, 0.8];
    const teal = [0.1, 0.6, 0.5];
    expect(seenApart(3, blue, teal, true)).toBeGreaterThan(seenApart(3, blue, teal, false) * 1.3);
  });
});

describe("the correction pass", () => {
  let engine: NullEngine;
  let scene: Scene;
  const pass = ColorCorrectionPostProcess.getInstance();
  const names = (camera: FreeCamera) => camera._postProcesses.filter((p) => p).map((p) => p?.name);

  afterEach(() => {
    pass.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("is on the camera only while asked for, and stays last", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const camera = new FreeCamera("view", Vector3.Zero(), scene);
    pass.init(scene, camera);
    expect(names(camera)).toEqual([]);

    pass.set(2, 1, 0);
    expect(names(camera)).toEqual(["colorCorrection"]);

    // A pipeline switched on later appends its pass behind ours.
    new PostProcess("ssao", "colorCorrection", ["colorMatrix"], null, 1, camera);
    pass.keepLast();
    expect(names(camera)).toEqual(["ssao", "colorCorrection"]);

    pass.set(0, 1, 3); // simulation alone also needs the pass
    expect(names(camera)).toEqual(["ssao", "colorCorrection"]);
    pass.set(0, 1, 0);
    expect(names(camera)).toEqual(["ssao"]);
  });
});
