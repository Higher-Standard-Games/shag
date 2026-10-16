import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Q3SoftParticleDepth } from "../loader/shader/Q3SoftParticleDepth";

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
  scene.dispose();
  engine.dispose();
});
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
});
