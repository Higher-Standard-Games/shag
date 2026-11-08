import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceResult } from "../../physics/CollisionBackend";
import { getCollisionManager } from "../../physics/CollisionManager";
import { SurfaceFlags } from "../../physics/ContentFlags";
import type { SweepCollisionBackend } from "../../physics/SweepCollisionBackend";
import { getHitscanEffects } from "../HitscanEffects";
import type { VoltaicEffectRenderer } from "../voltaic/VoltaicEffectRenderer";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const effects = getHitscanEffects();
  effects.init(scene);
  const trace = vi.fn(
    (start: Vector3, end: Vector3): TraceResult => ({
      fraction: 0.5,
      endPos: Vector3.Lerp(start, end, 0.5),
      normal: new Vector3(0, 0, -1),
      startSolid: false,
      allSolid: false,
      contents: 1,
    }),
  );
  vi.spyOn(getCollisionManager(), "getSweepBackend").mockReturnValue({ trace } as unknown as SweepCollisionBackend);
  const renderer = (effects as unknown as { voltaicRenderer: VoltaicEffectRenderer }).voltaicRenderer;
  const update = vi.spyOn(renderer, "updateHero");
  const dispose = () => {
    effects.clear();
    engine.dispose();
  };
  return { scene, effects, trace, update, dispose };
}

describe("local Voltaic beam presentation", () => {
  it("clips predicted player contacts to the world trace without changing remote presentation", () => {
    const { effects, update, dispose } = setup();
    const resolver = vi.fn((_origin: Vector3, _direction: Vector3, _distance: number, result: Vector3) => {
      result.set(0, 40, 30);
      return true;
    });
    effects.setLocalLightningTargetResolver(resolver);
    try {
      const origin = new Vector3(2, 38, 4);
      const eye = new Vector3(0, 40, 0);
      expect(
        effects.updateLightningBeam({ origin, traceOrigin: eye, direction: Vector3.Forward(), maxRange: 200 }),
      ).toEqual(new Vector3(0, 40, 30));
      expect(resolver.mock.calls[0][2]).toBe(100);
      expect(update.mock.calls[0][0]).toMatchObject({
        start: origin,
        end: new Vector3(0, 40, 30),
        impactKind: "player",
      });
    } finally {
      effects.clearLocalLightningTargetResolver(resolver);
      dispose();
    }
  });

  it("follows every rendered eye/aim sample, with a separate current muzzle and stable resources", () => {
    const { scene, effects, trace, update, dispose } = setup();
    try {
      const meshes = scene.meshes.length;
      const materials = scene.materials.length;
      const eye = new Vector3(0, 40, 0);
      const muzzle = new Vector3(2, 38, 4);
      for (let frame = 0; frame < 240; frame++) {
        eye.x = frame * 0.25;
        muzzle.x = eye.x + 2;
        const angle = frame * 0.0005;
        const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle));
        const endpoint = eye.add(direction.scale(100));
        const contact = effects.updateLightningBeam({ origin: muzzle, traceOrigin: eye, direction, maxRange: 200 });
        expect(Vector3.Distance(contact!, endpoint)).toBeLessThan(1e-10);
        expect(trace.mock.calls.at(-1)![0]).toBe(eye);
        const sample = update.mock.calls.at(-1)![0];
        expect(sample.start).toBe(muzzle);
        expect(Vector3.Distance(sample.end, endpoint)).toBeLessThan(1e-10);
        expect(sample.impactKind).toBe("world");
      }
      expect(trace).toHaveBeenCalledTimes(240);
      expect(scene.meshes).toHaveLength(meshes);
      expect(scene.materials).toHaveLength(materials);
    } finally {
      dispose();
    }
  });

  it.each([0, SurfaceFlags.SKY | SurfaceFlags.NOIMPACT])(
    "ends misses and sky at the current eye ray's full range (%s)",
    (flags) => {
      const { effects, trace, update, dispose } = setup();
      try {
        trace.mockImplementation((_start, end) => ({
          fraction: flags ? 0.5 : 1,
          endPos: end,
          hitSurfaceFlags: flags,
          startSolid: false,
          allSolid: false,
          contents: 1,
        }));
        const origin = new Vector3(2, 38, 4);
        const eye = new Vector3(20, 40, 0);
        expect(
          effects.updateLightningBeam({ origin, traceOrigin: eye, direction: Vector3.Forward(), maxRange: 200 }),
        ).toBeNull();
        expect(update.mock.calls.at(-1)![0]).toMatchObject({
          start: origin,
          end: new Vector3(20, 40, 200),
          impactKind: "none",
        });
      } finally {
        dispose();
      }
    },
  );
});
