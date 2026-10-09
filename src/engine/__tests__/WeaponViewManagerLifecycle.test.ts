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
    setMuzzleAnchorResolver: vi.fn(),
    fireMuzzleFlash: vi.fn(),
  }),
}));

vi.mock("../weapon/ProjectileManager", () => ({
  getProjectileManager: () => ({ init: vi.fn() }),
}));

type Internals = { updateObserver: Observer<Scene> | null };

describe("WeaponViewManager demo lifecycle", () => {
  it("releases scene observers and view resources before repeated playback", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const firstCamera = new FreeCamera("first", Vector3.Zero(), scene);
    const secondCamera = new FreeCamera("second", Vector3.Zero(), scene);
    const manager = new WeaponViewManager();
    const internals = manager as unknown as Internals;

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

      manager.dispose();
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

      manager.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scene.onBeforeRenderObservable.observers).not.toContain(secondObserver);
    } finally {
      if (manager.isInitialized()) manager.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  // QA-8 / QA-WO9 proof: live and demo are separate instances — disposing the
  // demo one can never destroy the live viewmodel (the `demoplay stop` bug).
  it("disposing a demo instance leaves the live instance's view intact", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const liveCamera = new FreeCamera("liveCam", Vector3.Zero(), scene);
    const spectatorCamera = new FreeCamera("spectatorCam", Vector3.Zero(), scene);
    const live = new WeaponViewManager();
    const demo = new WeaponViewManager();
    const liveInternals = live as unknown as Internals;

    try {
      live.init(scene, liveCamera);
      const liveObserver = liveInternals.updateObserver;
      const liveWeaponCamera = scene.activeCameras?.[1] ?? null;
      expect(liveObserver).not.toBeNull();
      expect(liveWeaponCamera).not.toBeNull();

      // Demo playback starts: its own instance takes over the active cameras.
      demo.init(scene, spectatorCamera);
      expect(scene.activeCameras?.[0]).toBe(spectatorCamera);

      // Demo playback stops.
      demo.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The live instance is untouched: still initialized, its observer still
      // registered, its weapon camera not disposed.
      expect(live.isInitialized()).toBe(true);
      expect(scene.onBeforeRenderObservable.observers).toContain(liveObserver);
      expect(liveWeaponCamera?.isDisposed()).toBe(false);

      // And it can re-assert its camera pair to resume rendering.
      live.reassertCameras();
      expect(scene.activeCameras?.[0]).toBe(liveCamera);
      expect(scene.activeCameras?.[1]).toBe(liveWeaponCamera);
    } finally {
      if (live.isInitialized()) live.dispose();
      if (demo.isInitialized()) demo.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("leaves no camera of its own in the draw list once disposed", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const chase = new FreeCamera("chase", Vector3.Zero(), scene);
    const flyby = new FreeCamera("flyby", Vector3.Zero(), scene);
    const manager = new WeaponViewManager();
    try {
      manager.init(scene, chase);
      // A cinematic cuts to a flyby, or `demoplay stop` hands back the camera.
      scene.activeCamera = flyby;
      manager.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // activeCameras overrides activeCamera: the chase camera left in it froze
      // the screen on the old view (D1, D5).
      expect(scene.activeCameras ?? []).not.toContain(chase);
    } finally {
      if (manager.isInitialized()) manager.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("is not ready once a map unload disposed its root, and rebuilds showing no weapon", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("main", Vector3.Zero(), scene);
    const manager = new WeaponViewManager();
    try {
      manager.init(scene, camera);
      expect(manager.isReady).toBe(true);
      (manager as unknown as { _intendedWeaponId: string | null })._intendedWeaponId = "rlauncher";

      // What a map change does to every scene node; the instance itself survives it.
      scene.getTransformNodeByName("weaponView")!.dispose();
      expect(manager.isReady).toBe(false);

      manager.init(scene, camera);
      expect(manager.isReady).toBe(true);
      expect(manager.getDisplayedWeaponId()).toBeNull();
    } finally {
      manager.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
