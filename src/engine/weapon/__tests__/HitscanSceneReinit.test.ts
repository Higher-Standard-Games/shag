import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { getHitscanEffects } from "../HitscanEffects";

it("rebuilds effect resources after map clearing keeps the same scene", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  new FreeCamera("camera", new Vector3(0, 20, -50), scene);
  const effects = getHitscanEffects();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    effects.init(scene);
    const first = scene.getMeshByName("voltaic_world_beam")!;
    effects.init(scene);
    expect(scene.getMeshByName("voltaic_world_beam")).toBe(first);
    for (const mesh of [...scene.meshes]) mesh.dispose(false, true);
    expect(first.isDisposed()).toBe(true);
    effects.init(scene);
    const beam = scene.getMeshByName("voltaic_world_beam") as Mesh | null;
    expect(beam).not.toBeNull();
    expect(beam).not.toBe(first);
    expect(beam!.isDisposed()).toBe(false);
    effects.updateRemoteLightningBeam("player_1", {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, 0, 1),
      endpoint: new Vector3(0, 0, 100),
      impactKind: "none",
    });
    effects.update(1 / 60);
    expect(beam!.thinInstanceCount).toBe(1);
    expect(beam!.isEnabled()).toBe(true);
    for (const name of ["voltaic_hero_beam", "voltaic_world_impact", "voltaic_chain_beam"])
      expect(scene.getMeshByName(name)?.isDisposed()).toBe(false);
  } finally {
    effects.clear();
    engine.dispose();
    warn.mockRestore();
  }
});
