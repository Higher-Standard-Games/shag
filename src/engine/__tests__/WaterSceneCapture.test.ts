/**
 * The refraction capture.
 *
 * One property carries the whole thing: the water must not be in its own
 * capture. If it is, each frame samples the previous frame's water and the
 * error compounds — the classic feedback tunnel, and it does not look like a
 * bug for the first few frames, it looks like the effect is working.
 *
 * The rest is ownership. This is the most expensive thing in the water feature
 * — a second pass over the world — so it must exist only while Epic is on and
 * must be gone the moment it is not.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXCLUDE_FROM_WATER_CAPTURE, WaterSceneCapture } from "../rendering/water/WaterSceneCapture";

let engine: NullEngine;
let scene: Scene;
let capture: WaterSceneCapture;
let camera: FreeCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("eye", new Vector3(0, 0, 0), scene);
  capture = new WaterSceneCapture(scene);
});

afterEach(() => {
  capture.dispose();
  scene.dispose();
  engine.dispose();
});

/** Force the predicate to run and return what it selected. */
function captured(): AbstractMesh[] {
  const texture = capture.textureFor(camera);
  if (!texture) return [];
  const predicate = texture.renderListPredicate;
  return scene.meshes.filter((m) => predicate(m));
}

describe("what goes into the capture", () => {
  it("includes ordinary world geometry", () => {
    const wall = CreateBox("wall", { size: 1 }, scene);

    expect(captured()).toContain(wall);
  });

  it("excludes liquid surfaces", () => {
    // The feedback tunnel. Water sampling itself compounds frame over frame,
    // and for the first few frames it looks like the effect working.
    const pool = CreateBox("pool", { size: 1 }, scene);
    pool.metadata = { liquidKind: "water" };

    expect(captured()).not.toContain(pool);
  });

  it("excludes anything tagged out", () => {
    // Splash spray: it is above the surface, so including it would draw the
    // crown a second time, bent, underneath the pool it came from.
    const spray = CreateBox("spray", { size: 1 }, scene);
    spray.metadata = { [EXCLUDE_FROM_WATER_CAPTURE]: true };

    expect(captured()).not.toContain(spray);
  });

  it("excludes the viewmodel", () => {
    // The weapon is not behind the water. It is not behind anything.
    const gun = CreateBox("viewmodel", { size: 1 }, scene);
    gun.layerMask = 0x10000000;

    expect(captured()).not.toContain(gun);
  });

  it("excludes hidden and disabled meshes", () => {
    const hidden = CreateBox("hidden", { size: 1 }, scene);
    hidden.isVisible = false;
    const off = CreateBox("off", { size: 1 }, scene);
    off.setEnabled(false);

    const list = captured();
    expect(list).not.toContain(hidden);
    expect(list).not.toContain(off);
  });

  it("picks up meshes that appear after it was built", () => {
    // Players, projectiles and gibs all arrive mid-map. The predicate is
    // re-evaluated against scene.meshes every render precisely so nothing has
    // to register itself.
    capture.textureFor(camera);
    const latecomer = CreateBox("player", { size: 1 }, scene);

    expect(captured()).toContain(latecomer);
  });
});

describe("ownership", () => {
  it("registers exactly one target", () => {
    capture.textureFor(camera);
    capture.textureFor(camera);

    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("follows the active camera without rebuilding", () => {
    // Unlike the depth pass, an RTT can just be re-pointed — so a switch to
    // the death or spectate camera costs nothing here.
    const first = capture.textureFor(camera);
    const second = capture.textureFor(new FreeCamera("death", new Vector3(0, 0, 0), scene));

    expect(second).toBe(first);
    expect(second?.activeCamera?.name).toBe("death");
    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("removes its target on dispose", () => {
    // The most expensive thing in the feature. Leaving it behind means a full
    // extra pass over a scene that may have no water in it at all.
    const texture = capture.textureFor(camera);
    expect(scene.customRenderTargets).toContain(texture);

    capture.dispose();

    expect(scene.customRenderTargets).not.toContain(texture);
    expect(scene.customRenderTargets.length).toBe(0);
  });

  it("is idempotent", () => {
    capture.textureFor(camera);
    capture.dispose();

    expect(() => capture.dispose()).not.toThrow();
  });

  it("can be rebuilt after disposal", () => {
    // Dropping to Medium and back to Epic without a map reload.
    capture.textureFor(camera);
    capture.dispose();

    expect(capture.textureFor(camera)).not.toBeNull();
    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("does not stack targets across repeated tier changes", () => {
    for (let i = 0; i < 10; i++) {
      capture.textureFor(camera);
      capture.dispose();
    }
    capture.textureFor(camera);

    expect(scene.customRenderTargets.length).toBe(1);
  });
});
