/**
 * Hitscan effects find where a shot stops by tracing the map's collision
 * brushes, as the server does (NullEngine, stubbed sweep backend).
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceOptions, TraceResult } from "../../physics/CollisionBackend";
import { getCollisionManager } from "../../physics/CollisionManager";
import { SurfaceFlags } from "../../physics/ContentFlags";
import type { SweepCollisionBackend } from "../../physics/SweepCollisionBackend";
import { getHitscanEffects } from "../HitscanEffects";

type Shot = { point: Vector3; normal: Vector3; marks: boolean } | null;

function setup(result: Partial<TraceResult>) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const scene = new Scene(new NullEngine());
  const trace = vi.fn(
    (_start: Vector3, _end: Vector3, _options?: TraceOptions): TraceResult => ({
      fraction: 0.5,
      endPos: new Vector3(0, 0, 50),
      normal: new Vector3(0, 0, -1),
      startSolid: false,
      allSolid: false,
      contents: 1,
      ...result,
    }),
  );
  vi.spyOn(getCollisionManager(), "getSweepBackend").mockReturnValue({ trace } as unknown as SweepCollisionBackend);
  const effects = getHitscanEffects() as unknown as {
    scene: Scene | null;
    traceRay(origin: Vector3, dir: Vector3, maxDist: number): Shot;
  };
  effects.scene = scene;
  const shoot = () => effects.traceRay(Vector3.Zero(), new Vector3(0, 0, 1), 100);
  const dispose = () => {
    effects.scene = null;
    scene.getEngine().dispose();
  };
  return { trace, shoot, dispose };
}

afterEach(() => vi.restoreAllMocks());

describe("hitscan shot trace", () => {
  it("traces a ray, not a player-sized box, against solid brushes", () => {
    const { trace, shoot, dispose } = setup({});
    const shot = shoot();
    expect(shot?.point.z).toBe(50);
    expect(shot?.marks).toBe(true);
    const [, end, options] = trace.mock.calls[0];
    expect(end.z).toBe(100);
    expect(options).toMatchObject({ radius: 0, height: 0, contentMask: 1 });
    dispose();
  });

  it("stops on surfaces that take no marks, without a mark", () => {
    const { shoot, dispose } = setup({ hitSurfaceFlags: SurfaceFlags.NOMARKS | SurfaceFlags.NODRAW });
    expect(shoot()).toMatchObject({ marks: false });
    dispose();
  });

  it("treats a surface with no impacts (sky) and a clear path as a miss", () => {
    const sky = setup({ hitSurfaceFlags: SurfaceFlags.NOIMPACT | SurfaceFlags.SKY });
    expect(sky.shoot()).toBeNull();
    sky.dispose();
    const clear = setup({ fraction: 1 });
    expect(clear.shoot()).toBeNull();
    clear.dispose();
  });
});
