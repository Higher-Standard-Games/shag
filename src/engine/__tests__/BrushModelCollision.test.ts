import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { SweepCollisionBackend } from "../physics/SweepCollisionBackend";
import { liftBsp } from "./fixtures/liftBsp";

describe("switchable inline brushes", () => {
  it("removes exact trace and contents collision, then restores without a static ghost", async () => {
    const bsp = liftBsp();
    bsp.entities = [{ classname: "func_explosive", properties: { model: "*1", targetname: "site_a" } }];
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    const trace = () => backend.trace(new Vector3(0, 150, 0), new Vector3(0, 50, 0), { radius: 0, height: 0 });
    expect(trace().fraction).toBeLessThan(1);
    expect(backend.pointContents(new Vector3(0, 96, 0)) & 1).toBe(1);
    backend.brushModels?.setEnabled(1, false);
    expect(trace().fraction).toBe(1);
    expect(backend.pointContents(new Vector3(0, 96, 0)) & 1).toBe(0);
    backend.brushModels?.reset();
    expect(trace().fraction).toBeLessThan(1);
    expect(backend.pointContents(new Vector3(0, 96, 0)) & 1).toBe(1);
    backend.dispose();
  });

  it("collides with the model's patches while it stands, and not once it is gone", async () => {
    const bsp = liftBsp();
    // A flat 3x3 patch at z=200 that belongs only to the model, with no brush under it
    const vertices = [];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) vertices.push({ position: [-64 + col * 64, -64 + row * 64, 200] });
    Object.assign(bsp, {
      vertices,
      faces: [{ textureIndex: 0, faceType: 2, firstVertex: 0, numVertices: 9, patchSize: [3, 3] }],
      models: [
        bsp.models[0],
        { mins: [-64, -64, 200], maxs: [64, 64, 200], firstFace: 0, numFaces: 1, firstBrush: 0, numBrushes: 0 },
      ],
      entities: [{ classname: "func_explosive", properties: { model: "*1", targetname: "site_a" } }],
    });
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    // Ends above the fixture's world platform (z 92..100), so only the patch can stop it
    const drop = () => backend.trace(new Vector3(0, 300, 0), new Vector3(0, 150, 0));
    expect(drop().fraction).toBeLessThan(1);
    expect(drop().endPos.y).toBeGreaterThan(200);
    backend.brushModels?.setEnabled(1, false);
    expect(drop().fraction).toBe(1);
    backend.brushModels?.reset();
    expect(drop().fraction).toBeLessThan(1);
    backend.dispose();
  });

  it("honors trigger-spawn and translated inline geometry", async () => {
    const bsp = liftBsp();
    bsp.entities = [{ classname: "func_explosive", properties: { model: "*1", origin: "200 0 0", spawnflags: "1" } }];
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    expect(backend.pointContents(new Vector3(200, 96, 0)) & 1).toBe(0);
    backend.brushModels?.setEnabled(1, true);
    expect(backend.pointContents(new Vector3(200, 96, 0)) & 1).toBe(1);
    expect(backend.pointContents(new Vector3(0, 96, 0)) & 1).toBe(0);
    expect(backend.trace(new Vector3(200, 150, 0), new Vector3(200, 50, 0)).fraction).toBeLessThan(1);
    backend.dispose();
  });
});
