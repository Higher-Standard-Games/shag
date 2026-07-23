/**
 * SSREffect (NullEngine) — screen-space reflections lifecycle. SSR is opt-in
 * (`r_ssr`, default off) and GPU-expensive, so the safety-critical property is
 * that it builds NO pipeline by default and disposes cleanly. The reflection +
 * enabled pipeline (geometry prepass) are browser-validated.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SSREffect } from "../SSREffect";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  new FreeCamera("cam", new Vector3(0, 0, 0), scene);
});

afterEach(() => {
  SSREffect.resetInstance();
  scene.dispose();
  engine.dispose();
});

describe("SSREffect", () => {
  it("builds no pipeline when r_ssr is off (default)", () => {
    const ssr = SSREffect.getInstance();
    ssr.init(scene);
    expect(ssr.isEnabled()).toBe(false);
  });

  it("disposes cleanly and idempotently", () => {
    const ssr = SSREffect.getInstance();
    ssr.init(scene);
    ssr.dispose();
    expect(ssr.isEnabled()).toBe(false);
    expect(() => ssr.dispose()).not.toThrow();
  });
});
