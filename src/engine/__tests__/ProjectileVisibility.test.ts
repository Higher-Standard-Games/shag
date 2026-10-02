/**
 * Projectile visibility (NullEngine). A projectile spawns transparent;
 * ProjectileManager.update fades it in and builds its trail.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEntityRegistry } from "../../shared/entities";
import { getMD3Loader, type MD3LoadResult } from "../loader/model/MD3Loader";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { getExplosionEffect } from "../weapon/ExplosionEffect";
import { ProjectileManager } from "../weapon/ProjectileManager";
import { WeaponViewManager } from "../weapon/WeaponViewManager";

let engine: NullEngine;
let scene: Scene;
let manager: ProjectileManager;
let now = 0;
let shots = 0;

function loadedModel(): MD3LoadResult {
  const root = new TransformNode("md3_rocket", scene);
  const mesh = MeshBuilder.CreateBox("rocket_rocket", { size: 4 }, scene);
  mesh.material = new StandardMaterial("rocket_rocket", scene);
  mesh.parent = root;
  return {
    root,
    meshes: [mesh],
    model: {} as MD3LoadResult["model"],
    currentFrame: 0,
    setFrame: () => {},
    getTag: () => null,
  };
}

/** A server-driven rocket, as spawnFromServer creates for every snapshot projectile. */
const fire = () =>
  manager.spawn("rocket", Vector3.Zero(), new Vector3(0, 0, 1), {
    isServerDriven: true,
    serverEntityId: `projectile_${++shots}`,
  });

/** How opaque each of a shot's meshes is drawn: its visibility times its material's alpha. */
function opacityOf(id: string | null): number[] {
  const node = id ? scene.getTransformNodeByName(id) : null;
  return node?.getChildMeshes().map((mesh) => mesh.visibility * (mesh.material?.alpha ?? 1)) ?? [];
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  now = 0;
  (ProjectileManager as unknown as { instance?: ProjectileManager }).instance = undefined;
  (WeaponViewManager as unknown as { instance?: WeaponViewManager }).instance = undefined;
  manager = ProjectileManager.getInstance();
  (manager as unknown as { scene: Scene }).scene = scene;

  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(getExplosionEffect(), "update").mockImplementation(() => {});
  vi.spyOn(getEntityRegistry(), "get").mockReturnValue({
    id: "rocket",
    modelPath: "models/objects/projectile/rlauncher/rocket_strong.md3",
    speed: 1814,
    lifetime: 10,
    trailEffect: "rocket_trail",
  } as never);
  vi.spyOn(PK3Loader.getInstance(), "getFile").mockResolvedValue(new ArrayBuffer(8));
  vi.spyOn(PK3Loader.getInstance(), "hasFile").mockReturnValue(false);
  vi.spyOn(getMD3Loader(), "parseMD3").mockReturnValue({} as never);
  vi.spyOn(getMD3Loader(), "createMeshes").mockImplementation(() => loadedModel());
});

afterEach(() => {
  manager.clear();
  (ProjectileManager as unknown as { instance?: ProjectileManager }).instance = undefined;
  (WeaponViewManager as unknown as { instance?: WeaponViewManager }).instance = undefined;
  engine.dispose();
  vi.restoreAllMocks();
});

describe("projectile visibility", () => {
  it.each([-0.6, 0.6])("starts at the rendered barrel after yaw %s, then converges onto authority", async (yaw) => {
    await manager.preloadModel("rocket");
    const camera = new FreeCamera("world", new Vector3(240, 80, -100), scene);
    camera.rotation.set(-0.3, yaw, 0.05);
    camera.fov = 1.7;
    const weaponCamera = new FreeCamera("weapon", Vector3.Zero(), scene);
    weaponCamera.parent = camera;
    weaponCamera.fov = 0.9;
    const root = new TransformNode("weaponView", scene);
    root.parent = weaponCamera;
    root.position.set(2, -4, 8);
    const socket = new TransformNode("tag_flash", scene);
    socket.parent = root;
    socket.position.set(1, 2, 25);
    const view = WeaponViewManager.getInstance();
    Object.assign(view, {
      scene,
      mainCamera: camera,
      weaponCamera,
      weaponRoot: root,
      muzzleSocket: socket,
      currentWeapon: { root },
      _visible: true,
    });
    // The last pass selected a different camera; projectile placement must not
    // use scene.activeCamera as either the eye or the muzzle.
    scene.activeCamera = new FreeCamera("otherPass", new Vector3(500, 900, 400), scene);
    camera.getViewMatrix(true);
    const direction = camera.getDirection(Vector3.Forward());
    const position = camera.globalPosition.add(direction.scale(70));
    const originalPosition = position.clone();
    const velocity = direction.scale(1814);
    const originalVelocity = velocity.clone();
    const muzzle = view.getProjectileMuzzlePosition(position, velocity);
    expect(muzzle).not.toBeNull();
    const id = manager.spawnFromServer("proj_1", "rocket", position, velocity, muzzle);
    const node = scene.getTransformNodeByName(id!)!;
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const socketPixel = Vector3.Project(
      socket.getAbsolutePosition(),
      Matrix.Identity(),
      weaponCamera.getTransformationMatrix(),
      viewport,
    );
    const projectilePixel = Vector3.Project(
      node.position,
      Matrix.Identity(),
      camera.getTransformationMatrix(),
      viewport,
    );
    expect(Math.abs(projectilePixel.x - socketPixel.x)).toBeLessThan(0.05);
    expect(Math.abs(projectilePixel.y - socketPixel.y)).toBeLessThan(0.05);
    expect(Vector3.Distance(node.position, camera.globalPosition)).toBeCloseTo(34, 3);

    const authoritative = position.add(velocity.scale(0.11));
    now = 110;
    manager.updateServerPosition("proj_1", authoritative, velocity);
    expect(Vector3.Distance(node.position, authoritative.add(muzzle!.subtract(position).scale(0.5)))).toBeLessThan(
      0.001,
    );
    // Subsequent mouse movement must not steer a shot already in flight.
    camera.rotation.y += 0.8;
    now = 230;
    manager.updateServerPosition("proj_1", authoritative, velocity);
    expect(node.position.equals(authoritative)).toBe(true);
    expect(position.equals(originalPosition)).toBe(true);
    expect(velocity.equals(originalVelocity)).toBe(true);
  });

  it("leaves shots without a first-person muzzle on the authoritative path", async () => {
    await manager.preloadModel("rocket");
    scene.activeCamera = new FreeCamera("spectator", Vector3.Zero(), scene);
    const position = new Vector3(0, 0, 50);
    const velocity = new Vector3(0, 0, 1814);
    const id = manager.spawnFromServer("proj_remote", "rocket", position, velocity);
    expect(scene.getTransformNodeByName(id!)!.position.equals(position)).toBe(true);
  });

  it("keeps a shot already in flight visible when another is fired", async () => {
    await manager.preloadModel("rocket");
    const first = fire();
    now = 500;
    manager.update(0.5);
    expect(opacityOf(first)).toEqual([1]);

    const second = fire();

    expect(opacityOf(first)).toEqual([1]);
    expect(opacityOf(second)).toEqual([0]);
  });

  it("fades shots in and draws their trails with no view weapon at all, as a spectator has", async () => {
    // Its particle texture needs a canvas, which this environment has not got
    vi.spyOn(getExplosionEffect(), "init").mockImplementation(() => {});
    manager.init(scene);
    await manager.preloadModel("rocket");
    const shot = fire();
    expect(opacityOf(shot)).toEqual([0]);
    now = 500;

    // The manager ticks with the scene; nothing here loads or updates a view weapon
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(500);
    scene.onBeforeRenderObservable.notifyObservers(scene);

    expect(opacityOf(shot)).toEqual([1]);
    expect(scene.getMeshByName(`${shot}_trail`)).not.toBeNull();
  });

  it("drops a shot whose meshes a map unload disposed, instead of updating its trail", async () => {
    vi.spyOn(getExplosionEffect(), "init").mockImplementation(() => {});
    manager.init(scene);
    await manager.preloadModel("rocket");
    const shot = fire();
    now = 500;
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(16);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(scene.getMeshByName(`${shot}_trail`)).not.toBeNull();

    // What a map change does to every scene mesh, the shot's own included.
    for (const mesh of [...scene.meshes]) mesh.dispose();
    for (const node of [...scene.transformNodes]) node.dispose();

    now = 520;
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
    now = 540;
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
    expect(scene.getMeshByName(`${shot}_trail`)).toBeNull();
  });
});
