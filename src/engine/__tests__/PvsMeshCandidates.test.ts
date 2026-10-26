import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BspFile } from "../loader/bsp/BspLoader";
import { PVSCuller } from "../loader/bsp/PVSCuller";
import { installPvsMeshCandidates } from "../rendering/PvsMeshCandidates";
import { installWeaponCameraCandidates } from "../rendering/WeaponCameraCandidates";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function setup() {
  const world = new FreeCamera("eye", new Vector3(2, 0, 0), scene);
  world.layerMask = 1;
  const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
  weapon.layerMask = 0x10000000;
  scene.activeCameras = [world, weapon];
  scene.activeCamera = world;
  const visible = MeshBuilder.CreateBox("visible", {}, scene);
  const hidden = MeshBuilder.CreateBox("hidden", {}, scene);
  visible.position.set(2, 0, 8);
  hidden.position.set(-2, 0, 8);
  visible.layerMask = hidden.layerMask = 1;
  const material = new StandardMaterial("world", scene);
  visible.material = hidden.material = material;
  const gun = MeshBuilder.CreateBox("gun", {}, scene);
  gun.position.z = 4;
  gun.layerMask = weapon.layerMask;
  gun.material = material;
  const bsp = {
    planes: [{ normal: [1, 0, 0], dist: 0 }],
    nodes: [{ planeIndex: 0, children: [-1, -2] }],
    leafs: [{ cluster: 0 }, { cluster: 1 }],
    visData: { numClusters: 2, bytesPerCluster: 1, bitVectors: new Uint8Array([1, 2]) },
  } as BspFile;
  const culler = new PVSCuller(bsp);
  culler.registerClusterMeshes([
    { cluster: 0, meshes: [visible] },
    { cluster: 1, meshes: [hidden] },
  ]);
  culler.update(world.position);
  return { world, weapon, visible, hidden, gun, culler };
}

it.each([true, false])("composes PVS and weapon leases in either install order: %s", (pvsFirst) => {
  const { world, weapon, visible, hidden, gun, culler } = setup();
  const original = scene.getActiveMeshCandidates;
  const first = pvsFirst
    ? installPvsMeshCandidates(scene, culler, () => world)
    : installWeaponCameraCandidates(scene, weapon, () => true);
  const provider = scene.getActiveMeshCandidates;
  const second = pvsFirst
    ? installWeaponCameraCandidates(scene, weapon, () => true)
    : installPvsMeshCandidates(scene, culler, () => world);
  expect(scene.getActiveMeshCandidates).toBe(provider);
  const worldList = scene.getActiveMeshCandidates();
  expect(worldList.data).toEqual([visible, gun]);
  scene.activeCamera = weapon;
  const weaponList = scene.getActiveMeshCandidates();
  expect(weaponList.data).toEqual([gun]);
  expect(worldList).not.toBe(weaponList);
  expect(worldList.data).toEqual([visible, gun]);
  scene.activeCamera = world;
  hidden.actionManager = new ActionManager(scene);
  expect(scene.getActiveMeshCandidates().data).toEqual([visible, hidden, gun]);
  second();
  expect(scene.getActiveMeshCandidates).toBe(provider);
  first();
  expect(scene.getActiveMeshCandidates).toBe(original);
});

it("fails open for foreign/multiple views, unknown cluster, disabled PVS and custom LOD", () => {
  const { world, weapon, hidden, culler } = setup();
  const release = installPvsMeshCandidates(scene, culler, () => world);
  const includesHidden = () => {
    const list = scene.getActiveMeshCandidates();
    return list.data.slice(0, list.length).includes(hidden);
  };
  expect(includesHidden()).toBe(false);
  const reflection = new FreeCamera("reflection", Vector3.Zero(), scene);
  reflection.layerMask = 1;
  scene.activeCamera = reflection;
  expect(includesHidden()).toBe(true);
  scene.activeCameras = null;
  expect(includesHidden()).toBe(true);
  scene.activeCamera = world;
  scene.activeCameras = [world, reflection, weapon];
  expect(includesHidden()).toBe(true);
  scene.activeCameras = [world, weapon];
  const selector = scene.customLODSelector;
  scene.customLODSelector = (mesh) => mesh;
  expect(includesHidden()).toBe(true);
  scene.customLODSelector = selector;
  culler.update(null);
  hidden.isVisible = false;
  expect(includesHidden()).toBe(true);
  culler.update(world.position);
  culler.setEnabled(false);
  expect(includesHidden()).toBe(true);
  release();
});

it("preserves per-camera active sets and draws while avoiding hidden-world readiness", () => {
  const { world, hidden, culler } = setup();
  let enabled = false;
  const release = installPvsMeshCandidates(
    scene,
    culler,
    () => world,
    () => enabled,
  );
  const readiness = vi.spyOn(hidden, "isReady");
  const active: Record<string, string[]> = {};
  scene.onAfterCameraRenderObservable.add((camera) => {
    const list = scene.getActiveMeshes();
    active[camera.name] = list.data.slice(0, list.length).map((mesh) => mesh.name);
  });
  const frame = (on: boolean) => {
    enabled = on;
    readiness.mockClear();
    scene.render();
    return {
      active: structuredClone(active),
      indices: scene.getActiveIndices(),
      hiddenReadyCalls: readiness.mock.calls.length,
    };
  };
  const before = frame(false),
    after = frame(true);
  expect(after.active).toEqual(before.active);
  expect(after.indices).toBe(before.indices);
  // The secondary weapon view deliberately keeps the original candidate path.
  expect(after.hiddenReadyCalls).toBe(before.hiddenReadyCalls - 1);
  scene.activeCameras = null;
  scene.activeCamera = world;
  expect(frame(true).hiddenReadyCalls).toBe(0);
  const late = MeshBuilder.CreateBox("late", {}, scene);
  late.position.z = 6;
  late.material = hidden.material;
  expect(frame(true).active).toEqual(frame(false).active);
  culler.update(new Vector3(-2, 0, 0));
  expect(frame(true).active).toEqual(frame(false).active);
  release();
});

it("cleans scene-first disposal and never restores over a foreign provider", () => {
  const { world, weapon, culler } = setup();
  const original = scene.getActiveMeshCandidates;
  const releaseWorld = installPvsMeshCandidates(scene, culler, () => world);
  const releaseWeapon = installWeaponCameraCandidates(scene, weapon, () => true);
  weapon.dispose();
  releaseWeapon();
  expect(scene.getActiveMeshCandidates).not.toBe(original);
  const foreign = () => ({ data: [], length: 0 });
  scene.getActiveMeshCandidates = foreign;
  releaseWorld();
  expect(scene.getActiveMeshCandidates).toBe(foreign);
  installPvsMeshCandidates(scene, culler, () => world);
  scene.dispose();
  expect(scene.getActiveMeshCandidates).toBe(foreign);
});
