import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { BillboardSprite } from "../sprites/BillboardSprite";
import { SpriteSheet } from "../sprites/SpriteSheet";

// A sprite asks for its UVs every frame. It used to make a new GPU buffer each
// time; now an unchanged frame sends nothing, and a new frame updates in place.
it("sends sprite UVs only when the frame changes, into the same buffer", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const camera = new FreeCamera("eye", new Vector3(0, 0, -50), scene);
    const sheet = new SpriteSheet(
      { path: "data:,", frameWidth: 16, frameHeight: 16, framesPerDirection: 4, directions: 1, frameRate: 10 },
      scene,
    );
    const sprite = new BillboardSprite("npc", sheet, scene, camera);
    sprite.setFrame(0);
    const buffer = sprite.mesh.getVertexBuffer("uv");
    const set = vi.spyOn(sprite.mesh, "setVerticesData");
    const update = vi.spyOn(sprite.mesh, "updateVerticesData");
    for (let i = 0; i < 5; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    sprite.setFrame(2);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    expect(sprite.mesh.getVertexBuffer("uv")).toBe(buffer);
    expect(Array.from(sprite.mesh.getVerticesData("uv") ?? []).slice(0, 2)).toEqual([0.5, 0]);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
