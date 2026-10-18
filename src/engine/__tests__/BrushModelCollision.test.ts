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
