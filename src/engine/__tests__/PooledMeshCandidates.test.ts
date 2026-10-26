import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerPooledMeshCandidate } from "../rendering/PooledMeshCandidates";
import { installWeaponCameraCandidates } from "../rendering/WeaponCameraCandidates";

let scene: Scene, engine: NullEngine;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  new FreeCamera("eye", Vector3.Zero(), scene);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});
const candidates = () => {
  const source = scene.getActiveMeshCandidates();
  return source.data.slice(0, source.length);
};

it("skips only declared disabled pools and immediately retains an external enable", () => {
  const before = CreateBox("before", {}, scene),
    pool = CreateBox("pool", {}, scene),
    after = CreateBox("after", {}, scene);
  before.setEnabled(false);
  pool.setEnabled(false);
  const release = registerPooledMeshCandidate(pool);
  expect(candidates()).toEqual([before, after]);
  pool.setEnabled(true);
  expect(candidates()).toEqual([before, pool, after]);
  pool.setEnabled(false);
  pool.actionManager = new ActionManager(scene);
  expect(candidates()).toEqual([before, pool, after]);
  pool.actionManager = null;
  const selector = scene.customLODSelector;
  scene.customLODSelector = (mesh) => mesh;
  expect(candidates()).toEqual([before, pool, after]);
  scene.customLODSelector = selector;
  release();
  expect(candidates()).toEqual([before, pool, after]);
});

it("shares one filter across duplicate leases, owners and cameras", () => {
  const pool = CreateBox("pool", {}, scene);
  pool.setEnabled(false);
  const original = scene.getActiveMeshCandidates;
  const a = registerPooledMeshCandidate(pool),
    provider = scene.getActiveMeshCandidates;
  const b = registerPooledMeshCandidate(pool);
  const late = CreateBox("late", {}, scene);
  late.setEnabled(false);
  const c = registerPooledMeshCandidate(late);
  expect(scene.getActiveMeshCandidates).toBe(provider);
  a();
  a();
  expect(candidates()).toEqual([]);
  b();
  expect(candidates()).toEqual([pool]);
  const camera = new FreeCamera("weapon", Vector3.Zero(), scene);
  camera.layerMask = 0x10000000;
  const releaseWeapon = installWeaponCameraCandidates(scene, camera, () => true);
  scene.activeCamera = camera;
  expect(candidates()).toEqual([]);
  c();
  expect(scene.getActiveMeshCandidates).toBe(provider);
  releaseWeapon();
  expect(scene.getActiveMeshCandidates).toBe(original);
});

it("preserves active draw output while avoiding idle readiness and keeping full-scene readiness", () => {
  const active = CreateBox("active", {}, scene);
  active.material = new StandardMaterial("active", scene);
  active.position.z = 8;
  const pool = CreateBox("pool", {}, scene);
  pool.setEnabled(false);
  const ready = vi.spyOn(pool, "isReady");
  scene.render();
  const baseline = scene.getActiveIndices();
  expect(ready).toHaveBeenCalled();
  const release = registerPooledMeshCandidate(pool);
  ready.mockClear();
  scene.render();
  expect(scene.getActiveIndices()).toBe(baseline);
  expect(ready).not.toHaveBeenCalled();
  scene.isReady();
  expect(ready).toHaveBeenCalled();
  release();
});

it("cleans mesh-first and scene-first disposal without overwriting a foreign provider", () => {
  const pool = CreateBox("pool", {}, scene),
    original = scene.getActiveMeshCandidates;
  const a = registerPooledMeshCandidate(pool);
  pool.dispose();
  a();
  expect(scene.getActiveMeshCandidates).toBe(original);
  const another = CreateBox("another", {}, scene);
  const release = registerPooledMeshCandidate(another);
  const foreign = () => ({ data: [], length: 0 });
  scene.getActiveMeshCandidates = foreign;
  scene.dispose();
  release();
  expect(scene.getActiveMeshCandidates).toBe(foreign);
  registerPooledMeshCandidate(another)();
});

it("retains idle membership across parent changes and bypasses filtering while all members are active", () => {
  const pool = CreateBox("pool", {}, scene);
  const parent = CreateBox("parent", {}, scene);
  pool.parent = parent;
  const hadEnabledObservers = pool.onEffectiveEnabledStateChangedObservable.hasObservers();
  const release = registerPooledMeshCandidate(pool);
  expect(scene.getActiveMeshCandidates().data).toBe(scene.meshes);
  parent.setEnabled(false);
  expect(candidates()).toEqual([parent]);
  parent.setEnabled(true);
  expect(scene.getActiveMeshCandidates().data).toBe(scene.meshes);
  release();
  expect(pool.onEffectiveEnabledStateChangedObservable.hasObservers()).toBe(hadEnabledObservers);
});
