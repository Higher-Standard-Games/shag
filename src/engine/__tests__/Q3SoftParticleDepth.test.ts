import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/instancedMesh";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Q3SoftParticleDepth } from "../loader/shader/Q3SoftParticleDepth";
import { RenderVars } from "../rendering/RenderVars";

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;
let material: StandardMaterial;
let provider: Q3SoftParticleDepth;
beforeEach(() => {
  engine = new NullEngine();
  engine.getCaps().textureHalfFloatRender = true;
  scene = new Scene(engine);
  camera = new FreeCamera("world", new Vector3(0, 0, -10), scene);
  camera.setTarget(Vector3.Zero());
  material = new StandardMaterial("soft", scene);
  const mesh = CreateBox("cone", {}, scene);
  mesh.material = material;
  provider = Q3SoftParticleDepth.acquire(material);
});
afterEach(() => {
  softHalos(1);
  scene.dispose();
  engine.dispose();
});
// The variable's value directly: setting it schedules a scene update on an animation frame
const softHalos = (value: number) => {
  RenderVars.getInstance().getVar("r_softhalos")!.value = value;
};
const frame = () => {
  camera.getViewMatrix();
  camera.getProjectionMatrix();
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
};

describe("soft particle depth ownership", () => {
  it("shares one capture between materials and releases it with the last owner", () => {
    const other = new StandardMaterial("other", scene);
    expect(Q3SoftParticleDepth.acquire(other)).toBe(provider);
    frame();
    const map = provider.mapFor(camera);
    expect(map).not.toBeNull();
    material.dispose();
    expect(scene.textures).toContain(map);
    other.dispose();
    expect(scene.textures).not.toContain(map);
    expect(scene.textures).not.toContain(provider.fallback);
    expect(camera.customRenderTargets).not.toContain(map);
    expect(scene.onBeforeCameraRenderObservable.hasObservers()).toBe(false);
  });
  it("keeps outline depth independent and follows camera changes without leaking", () => {
    const outline = scene.enableDepthRenderer(camera);
    frame();
    const previous = provider.mapFor(camera);
    expect(previous).not.toBe(outline.getDepthMap());
    expect(scene.enableDepthRenderer(camera)).toBe(outline);
    camera = new FreeCamera("spectate", new Vector3(0, 0, -20), scene);
    camera.setTarget(Vector3.Zero());
    frame();
    expect(provider.mapFor(camera)).not.toBe(previous);
    expect(scene.textures).not.toContain(previous);
    expect(scene.cameras.flatMap((c) => c.customRenderTargets)).toHaveLength(1);
  });
  it("pauses offscreen and on weapon cameras without destroying the retained capture", () => {
    frame();
    const map = provider.mapFor(camera);
    camera.setTarget(new Vector3(0, 0, -20));
    frame();
    expect(provider.mapFor(camera)).toBeNull();
    expect(scene.textures).toContain(map);
    camera.setTarget(Vector3.Zero());
    frame();
    expect(provider.mapFor(camera)).toBe(map);
    const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
    weapon.layerMask = 0x10000000;
    scene.onBeforeCameraRenderObservable.notifyObservers(weapon);
    expect(provider.mapFor(weapon)).toBeNull();
    expect(weapon.customRenderTargets).toHaveLength(0);
    expect(provider.mapFor(camera)).toBe(map);
  });
  it("excludes the soft surface, sky and viewmodel from the opaque candidates", () => {
    const solid = CreateBox("solid", {}, scene);
    const sky = CreateBox("sky", {}, scene);
    sky.infiniteDistance = true;
    const weapon = CreateBox("weapon", {}, scene);
    weapon.layerMask = 0x10000000;
    frame();
    const map = provider.mapFor(camera) as RenderTargetTexture;
    expect(map.getCustomRenderList!(0, scene.meshes, scene.meshes.length)).toEqual([solid]);
  });
  it("disables fading on devices without a float render target", () => {
    engine.getCaps().textureHalfFloatRender = false;
    engine.getCaps().textureFloatRender = false;
    frame();
    expect(provider.mapFor(camera)).toBeNull();
    expect(camera.customRenderTargets).toHaveLength(0);
    expect(provider.fallback).toBeDefined();
  });
  it("draws only meshes that share screen with a soft surface and come nearer than the fade depth behind it", () => {
    const at = (name: string, position: Vector3) => {
      const box = CreateBox(name, {}, scene);
      box.position = position;
      box.computeWorldMatrix(true);
      return box;
    };
    // The soft box sits 10 in front of the camera; it fades over 50 behind it
    at("behind", new Vector3(0, 0, 20));
    at("past the fade", new Vector3(0, 0, 100));
    at("beside it", new Vector3(30, 0, 0));
    at("in front", new Vector3(0, 0, -5));
    const around = at("around the camera", new Vector3(0, 0, -10));
    around.scaling.setAll(400);
    around.computeWorldMatrix(true);
    frame();
    const map = provider.mapFor(camera) as RenderTargetTexture;
    const drawn = map.getCustomRenderList!(0, scene.meshes, scene.meshes.length)!.map((mesh) => mesh.name);
    expect(drawn).toEqual(["behind", "in front", "around the camera"]);
  });
  it("finds soft meshes however they came by the material, and forgets those that lost it", () => {
    const inView = () => {
      frame();
      return provider.mapFor(camera) !== null;
    };
    scene.getMeshByName("cone")!.setEnabled(false);
    expect(inView()).toBe(false);

    const later = CreateBox("assigned later", {}, scene);
    later.material = material;
    expect(inView()).toBe(true);
    later.material = new StandardMaterial("plain", scene);
    expect(inView()).toBe(false);

    // An instance draws with its source's material: the source switched off, the instance drawn
    const source = CreateBox("source", {}, scene);
    source.material = material;
    source.setEnabled(false);
    const instance = source.createInstance("instance");
    instance.setEnabled(true);
    expect(inView()).toBe(true);
    instance.dispose();
    expect(inView()).toBe(false);

    // Babylon also lists a mesh that uses the material for one render pass only
    const pass = CreateBox("pass only", {}, scene);
    pass.setMaterialForRenderPass(1, material);
    expect(inView()).toBe(false);

    later.material = material;
    expect(inView()).toBe(true);
    later.dispose();
    expect(inView()).toBe(false);
  });
  it("stops the capture while soft halos are off", () => {
    frame();
    const map = provider.mapFor(camera);
    softHalos(0);
    frame();
    expect(provider.mapFor(camera)).toBeNull();
    expect(camera.customRenderTargets).not.toContain(map);
    softHalos(1);
    frame();
    expect(provider.mapFor(camera)).toBe(map);
  });
});
