import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { WeaponViewManager } from "../weapon/WeaponViewManager";

vi.mock("../weapon/HitscanEffects", () => ({
  getHitscanEffects: () => ({
    init: vi.fn(),
    stopBeam: vi.fn(),
    stopLightning: vi.fn(),
  }),
}));

vi.mock("../weapon/ProjectileManager", () => ({
  getProjectileManager: () => ({ init: vi.fn() }),
}));

describe("WeaponViewManager demo lifecycle", () => {
  it("releases scene observers and view resources before repeated playback", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const firstCamera = new FreeCamera("first", Vector3.Zero(), scene);
    const secondCamera = new FreeCamera("second", Vector3.Zero(), scene);
    const manager = WeaponViewManager.getInstance();
    const internals = manager as unknown as { updateObserver: Observer<Scene> | null };

    try {
      manager.init(scene, firstCamera);
      const firstObserver = internals.updateObserver;
      const firstWeaponCamera = scene.getCameraByName("weaponCamera");
      const firstRoot = scene.getTransformNodeByName("weaponView");
      const firstWeaponLight = scene.getLightByName("weaponLight");
      const firstMuzzleLight = scene.getLightByName("muzzleFlash");

      expect(firstObserver).not.toBeNull();
      expect(scene.onBeforeRenderObservable.observers).toContain(firstObserver);
      expect(scene.activeCameras).toContain(firstWeaponCamera);

      manager.resetDemoPlayback();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(manager.isInitialized()).toBe(false);
      expect(scene.onBeforeRenderObservable.observers).not.toContain(firstObserver);
      expect(scene.activeCameras ?? []).not.toContain(firstWeaponCamera);
      expect(firstWeaponCamera?.isDisposed()).toBe(true);
      expect(firstRoot?.isDisposed()).toBe(true);
      expect(firstWeaponLight?.isDisposed()).toBe(true);
      expect(firstMuzzleLight?.isDisposed()).toBe(true);

      manager.init(scene, secondCamera);
      const secondObserver = internals.updateObserver;
      expect(secondObserver).not.toBe(firstObserver);
      expect(scene.onBeforeRenderObservable.observers).toContain(secondObserver);
      expect(scene.activeCameras?.[0]).toBe(secondCamera);
      expect(scene.getCameraByName("weaponCamera")).not.toBe(firstWeaponCamera);

      manager.resetDemoPlayback();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scene.onBeforeRenderObservable.observers).not.toContain(secondObserver);
    } finally {
      if (manager.isInitialized()) manager.resetDemoPlayback();
      scene.dispose();
      engine.dispose();
    }
  });
});
