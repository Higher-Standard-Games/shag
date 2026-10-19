import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { Cvar } from "../core/Cvar";
import { installWeaponCameraCandidates } from "../rendering/WeaponCameraCandidates";

it("keeps the cvar policy on WebGL and leaves WebGPU evaluation unchanged", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera("weapon", Vector3.Zero(), scene);
  camera.layerMask = 2;
  const world = new Mesh("world", scene);
  world.layerMask = 1;
  const gun = new Mesh("gun", scene);
  gun.layerMask = 2;
  const saved = Cvar.get("r_weapon_candidates")!;
  Cvar.set("r_weapon_candidates", 1);
  const release = installWeaponCameraCandidates(scene, camera);
  scene.activeCamera = camera;
  try {
    expect(scene.getActiveMeshCandidates().length).toBe(1);
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    expect(scene.getActiveMeshCandidates().length).toBe(2);
    Object.defineProperty(engine, "isWebGPU", { value: false, configurable: true });
    Cvar.set("r_weapon_candidates", 0);
    expect(scene.getActiveMeshCandidates().length).toBe(2);
  } finally {
    Cvar.set("r_weapon_candidates", saved);
    release();
    scene.dispose();
    engine.dispose();
  }
});

it("filters only registered camera layers, follows changed masks/providers and retains intersection-action meshes", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const world = new FreeCamera("world", Vector3.Zero(), scene);
  const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
  world.layerMask = 1;
  weapon.layerMask = 2;
  const map = new Mesh("map", scene);
  map.layerMask = 1;
  const gun = new Mesh("gun", scene);
  gun.layerMask = 2;
  const trigger = new Mesh("trigger", scene);
  trigger.layerMask = 1;
  trigger.actionManager = new ActionManager(scene);
  const original = scene.getActiveMeshCandidates;
  let enabled = true;
  const release = installWeaponCameraCandidates(scene, weapon, () => enabled);
  scene.activeCamera = world;
  expect(scene.getActiveMeshCandidates()).toBe(original.call(scene));
  scene.activeCamera = weapon;
  const candidates = scene.getActiveMeshCandidates();
  expect(candidates.data.slice(0, candidates.length)).toEqual([gun, trigger]);
  map.layerMask = 2;
  gun.layerMask = 1;
  expect(scene.getActiveMeshCandidates().data).toEqual([map, trigger]);
  enabled = false;
  expect(scene.getActiveMeshCandidates()).toBe(original.call(scene));
  enabled = true;
  const selector = scene.customLODSelector;
  scene.customLODSelector = (mesh) => mesh;
  expect(scene.getActiveMeshCandidates()).toBe(original.call(scene));
  scene.customLODSelector = selector;
  release();
  expect(scene.getActiveMeshCandidates).toBe(original);
  scene.dispose();
  engine.dispose();
});

it("preserves actual camera active sets and draw counts across moving, transparent and newly added meshes", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const world = new FreeCamera("world", Vector3.Zero(), scene);
  const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
  world.layerMask = 1;
  weapon.layerMask = 2;
  const material = new StandardMaterial("shared", scene);
  const map = MeshBuilder.CreateBox("worldBox", {}, scene);
  map.position.set(-1, 0, 6);
  map.layerMask = 1;
  map.material = material;
  const gun = MeshBuilder.CreateBox("weaponBox", {}, scene);
  gun.position.set(1, 0, 6);
  gun.layerMask = 2;
  gun.material = material;
  scene.activeCameras = [world, weapon];
  let enabled = false;
  const release = installWeaponCameraCandidates(scene, weapon, () => enabled);
  const active: Record<string, string[]> = {};
  scene.onAfterCameraRenderObservable.add((camera) => {
    const meshes = scene.getActiveMeshes();
    active[camera.name] = meshes.data
      .slice(0, meshes.length)
      .map((mesh) => mesh.name)
      .sort();
  });
  const frame = (on: boolean) => {
    enabled = on;
    scene.render();
    return { active: structuredClone(active), indices: scene.getActiveIndices() };
  };
  expect(frame(true)).toEqual(frame(false));
  material.alpha = 0.75;
  map.position.x += 0.5;
  gun.layerMask = 3;
  const late = MeshBuilder.CreateBox("lateWeapon", {}, scene);
  late.position.set(0, 1, 6);
  late.layerMask = 2;
  late.material = material;
  expect(frame(true)).toEqual(frame(false));
  late.dispose();
  expect(frame(true)).toEqual(frame(false));
  expect(active.world).toContain("worldBox");
  expect(active.weapon).toEqual(["weaponBox"]);
  release();
  scene.dispose();
  engine.dispose();
});

it("keeps shared live/demo ownership, observes additions/disposals and restores only its own provider", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const live = new FreeCamera("liveWeapon", Vector3.Zero(), scene);
  const demo = new FreeCamera("demoWeapon", Vector3.Zero(), scene);
  live.layerMask = demo.layerMask = 2;
  const original = scene.getActiveMeshCandidates;
  const beforeObservers = scene.onDisposeObservable.observers.length;
  const releaseLive = installWeaponCameraCandidates(scene, live, () => true);
  const provider = scene.getActiveMeshCandidates;
  const releaseDemo = installWeaponCameraCandidates(scene, demo, () => true);
  expect(scene.getActiveMeshCandidates).toBe(provider);
  live.dispose();
  releaseLive();
  expect(scene.getActiveMeshCandidates).toBe(provider);
  scene.activeCamera = demo;
  const gun = new Mesh("lateGun", scene);
  gun.layerMask = 2;
  expect(scene.getActiveMeshCandidates().length).toBe(1);
  gun.dispose();
  expect(scene.getActiveMeshCandidates().length).toBe(0);
  releaseDemo();
  expect(scene.getActiveMeshCandidates).toBe(original);
  // Babylon unregisters removed observers on the next task.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scene.onDisposeObservable.observers.length).toBe(beforeObservers);
  const release = installWeaponCameraCandidates(scene, demo, () => true);
  const replacement = () => ({ data: [], length: 0 });
  scene.getActiveMeshCandidates = replacement;
  release();
  expect(scene.getActiveMeshCandidates).toBe(replacement);
  scene.dispose();
  engine.dispose();
});
