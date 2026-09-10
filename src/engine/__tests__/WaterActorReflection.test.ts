import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  WaterActorReflection,
  waterActorId,
  waterActorReflectionStatus,
  waterNeedsLocalReflection,
} from "../rendering/water/WaterActorReflection";
import { type WaterPatch, waterPatch } from "../rendering/water/WaterProbeCache";

let scene: Scene, engine: NullEngine, camera: FreeCamera, reflection: WaterActorReflection;
let root: Mesh, actor: Mesh, wall: Mesh, patch: WaterPatch;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("eye", new Vector3(0, 64, -90), scene);
  camera.setTarget(Vector3.Zero());
  camera.getViewMatrix();
  camera.getProjectionMatrix();
  root = new Mesh("world", scene);
  const pool = CreateGround("pool", { width: 200, height: 200 }, scene);
  pool.parent = root;
  pool.metadata = { liquidKind: "water" };
  patch = waterPatch(pool)!;
  wall = CreateBox("wall", { size: 20 }, scene);
  wall.parent = root;
  actor = CreateBox("actor", { size: 30 }, scene);
  actor.position.y = 20;
  actor.metadata = { waterReflectionActorId: "one" };
  reflection = new WaterActorReflection(scene);
  reflection.claim(root);
  // NullEngine does not compile GPU programs; the browser fixture tests that.
  vi.spyOn(wall, "isReady").mockReturnValue(true);
  vi.spyOn(ShaderMaterial.prototype, "isReady").mockReturnValue(true);
});
afterEach(() => {
  reflection.dispose();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

it("allocates nothing while disabled, or without eligible actors", () => {
  reflection.update(camera, [patch], false);
  expect(reflection.texture).toBeNull();
  actor.setEnabled(false);
  reflection.update(camera, [patch], true);
  expect(reflection.texture?.renderList?.map((m) => m.name) ?? []).toHaveLength(0);
  expect(camera.customRenderTargets).toHaveLength(0);
});
it("requests a local body only near eligible water and reports the empty capture", () => {
  actor.setEnabled(false);
  reflection.update(camera, [patch], true);
  expect(waterNeedsLocalReflection(scene)).toBe(true);
  expect(waterActorReflectionStatus(scene)).toContain("no eligible model");
  reflection.update(camera, [patch], false, "requires quality 3");
  expect(waterNeedsLocalReflection(scene)).toBe(false);
  expect(waterActorReflectionStatus(scene)).toContain("requires quality 3");
  reflection.dispose();
  expect(waterNeedsLocalReflection(scene)).toBe(false);
});
it("shows the reflection-only local body during capture, never afterward", () => {
  actor.metadata.waterReflectionOnly = true;
  actor.isVisible = false;
  reflection.update(camera, [patch], true);
  expect(reflection.texture?.renderList?.map((m) => m.name)).toContain("actor");
  reflection.texture!.onBeforeBindObservable.notifyObservers(reflection.texture!);
  expect(actor.isVisible).toBe(true);
  reflection.texture!.onAfterUnbindObservable.notifyObservers(reflection.texture!);
  expect(actor.isVisible).toBe(false);
  actor.setEnabled(false);
  reflection.update(camera, [patch], true);
  expect(reflection.actorCount).toBe(0);
});
it("does not expose actor colour before the occlusion shader is ready", () => {
  vi.mocked(ShaderMaterial.prototype.isReady).mockReturnValue(false);
  reflection.update(camera, [patch], true);
  expect(camera.customRenderTargets).toHaveLength(0);
  expect(reflection.actorCount).toBe(0);
});
it("captures actors plus independent static occluders, not water or effects", () => {
  const effect = CreateBox("flash", {}, scene);
  effect.metadata = { waterReflectionActorId: "bad", effectOwned: true };
  reflection.update(camera, [patch], true);
  expect(reflection.texture?.renderList?.map((m) => m.name)).toEqual(["wall", "actor"]);
  expect(camera.customRenderTargets.map((t) => t.name)).toEqual(["water-actor-reflection"]);
  expect(scene.customRenderTargets).toHaveLength(0);
  expect(patch.position.y).toBe(2);
  expect(reflection.texture?.mirrorPlane.d).toBe(0);
  expect(reflection.texture?.getSize().width).toBeLessThanOrEqual(320);
});
it("limits actor groups to two, including all parts of an admitted actor", () => {
  for (let i = 0; i < 4; i++) {
    const mesh = CreateBox(`actor${i}`, {}, scene);
    mesh.position.set(i * 10, 40, 0);
    mesh.metadata = { waterReflectionActorId: `other${i}` };
  }
  reflection.update(camera, [patch], true);
  expect(reflection.actorCount).toBe(2);
});
it("suspends at distance, underwater and out of the water frustum", () => {
  reflection.update(camera, [patch], true);
  for (const position of [new Vector3(0, 400, -90), new Vector3(0, -5, -90)]) {
    camera.position.copyFrom(position);
    camera.getViewMatrix(true);
    reflection.update(camera, [patch], true);
    expect(camera.customRenderTargets).toHaveLength(0);
  }
  camera.position.set(0, 64, -90);
  camera.setTarget(new Vector3(0, 64, -400));
  camera.getViewMatrix(true);
  vi.spyOn(camera, "isInFrustum").mockReturnValue(false);
  reflection.update(camera, [patch], true);
  expect(camera.customRenderTargets).toHaveLength(0);
});
it("moves ownership on camera switch and detaches on disable/dispose", () => {
  reflection.update(camera, [patch], true);
  const other = new FreeCamera("other", camera.position.clone(), scene);
  other.setTarget(Vector3.Zero());
  reflection.update(other, [patch], true);
  expect(camera.customRenderTargets).toHaveLength(0);
  expect(other.customRenderTargets).toHaveLength(1);
  reflection.update(other, [patch], false);
  expect(other.customRenderTargets).toHaveLength(0);
  reflection.update(other, [patch], true);
  reflection.dispose();
  expect(other.customRenderTargets).toHaveLength(0);
});
it("includes PVS-hidden blockers only during capture, restoring visibility", () => {
  actor.renderOutline = true;
  wall.isVisible = false;
  reflection.update(camera, [patch], true);
  expect(reflection.texture?.renderList?.map((m) => m.name)).toContain("wall");
  reflection.texture!.onBeforeBindObservable.notifyObservers(reflection.texture!);
  expect(wall.isVisible).toBe(true);
  expect(actor.renderOutline).toBe(false);
  reflection.texture!.onAfterUnbindObservable.notifyObservers(reflection.texture!);
  expect(wall.isVisible).toBe(false);
  expect(actor.renderOutline).toBe(true);
});
it("fails closed instead of dropping occluders when the draw budget is exceeded", () => {
  for (let i = 0; i < 257; i++) CreateBox(`blocker${i}`, {}, scene).parent = root;
  reflection.claim(root);
  reflection.update(camera, [patch], true);
  expect(reflection.texture?.renderList?.map((m) => m.name) ?? []).toHaveLength(0);
  expect(camera.customRenderTargets).toHaveLength(0);
});
it("culls blockers against the reflected frustum, not the main-view active list", () => {
  const distant = CreateBox("outside", {}, scene);
  distant.position.set(10000, 200, 0);
  distant.parent = root;
  reflection.claim(root);
  reflection.update(camera, [patch], true);
  expect(reflection.texture?.renderList?.map((m) => m.name)).not.toContain("outside");
  expect(reflection.texture?.renderList?.map((m) => m.name)).toContain("wall");
});
it("inherits explicit actor metadata but excludes viewmodels and marked effects", () => {
  const child = CreateBox("part", {}, scene);
  child.parent = actor;
  expect(waterActorId(child)).toBe("one");
  child.layerMask = 0x10000000;
  expect(waterActorId(child)).toBeNull();
  child.layerMask = 1;
  child.metadata = { excludeFromWaterCapture: true };
  expect(waterActorId(child)).toBeNull();
});
it("excludes fully submerged and far-from-water actors", () => {
  actor.position.set(0, -50, 0);
  reflection.update(camera, [patch], true);
  expect(reflection.actorCount).toBe(0);
  actor.position.set(500, 40, 0);
  reflection.update(camera, [patch], true);
  expect(reflection.actorCount).toBe(0);
});
