import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, expect, it, vi } from "vitest";
import { WeaponCharge } from "../weapon/WeaponCharge";
import { WeaponLighting } from "../weapon/WeaponLighting";
import { WeaponSlash } from "../weapon/WeaponSlash";

const grid = vi.hoisted(() => vi.fn());
vi.mock("../loader/bsp/BspManager", () => ({ BspManager: { getInstance: () => ({ getLightingInto: grid }) } }));
afterEach(() => vi.restoreAllMocks());

it("feathers the low-opacity swing, keeps the expired trail for the next one and retires its texture on disposal", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const slash = new WeaponSlash();
  try {
    const camera = new FreeCamera("world", Vector3.Zero(), scene);
    const time = vi.spyOn(performance, "now").mockReturnValue(0);
    slash.trigger();
    slash.updateTrail(scene, camera);
    time.mockReturnValue(100);
    slash.updateTrail(scene, camera);
    const material = scene.getMaterialByName(
      "slashTrailMat",
    ) as import("@babylonjs/core/Materials/standardMaterial").StandardMaterial;
    expect(material.alpha).toBe(0.22);
    expect(material.useAlphaFromDiffuseTexture).toBe(true);
    expect(material.diffuseTexture?.hasAlpha).toBe(true);
    time.mockReturnValue(1000);
    slash.getOffsets();
    slash.updateTrail(scene, camera);
    time.mockReturnValue(1900);
    slash.updateTrail(scene, camera);
    const ribbon = scene.getMeshByName("slashTrail");
    expect(ribbon?.isEnabled()).toBe(false);

    // The next swing draws with the same ribbon and material
    time.mockReturnValue(2000);
    slash.trigger();
    slash.updateTrail(scene, camera);
    time.mockReturnValue(2100);
    slash.updateTrail(scene, camera);
    expect(scene.meshes.filter((mesh) => mesh.name === "slashTrail")).toEqual([ribbon]);
    expect(ribbon?.isEnabled()).toBe(true);
    expect(scene.materials.filter((m) => m.name === "slashTrailMat")).toEqual([material]);

    slash.dispose();
    expect(scene.getMaterialByName("slashTrailMat")).toBeNull();
    expect(scene.textures.some((texture) => texture.name === "slashTrailFeather")).toBe(false);
  } finally {
    slash.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it("grows a scale-normalized cyan charge and returns the saved outline on release", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const mesh = new Mesh("blade", scene);
    const charge = new WeaponCharge();
    const time = vi.spyOn(performance, "now").mockReturnValue(0);
    const saved = new Color3(0.2, 0.3, 0.4);
    charge.update(true, 1, [mesh], () => 30, 0.2, saved, false);
    expect(mesh.outlineWidth).toBeCloseTo(0.6 / 30);
    time.mockReturnValue(1000);
    charge.update(true, 1, [mesh], () => 30, 0.2, saved, false);
    expect(mesh.outlineWidth).toBeCloseTo(4.8 / 30);
    expect(mesh.outlineColor.g).toBeGreaterThan(mesh.outlineColor.r * 10);
    expect(mesh.outlineColor.b).toBeCloseTo(mesh.outlineColor.g * 0.9);
    expect(charge.update(false, 1, [mesh], () => 30, 0.2, saved, false)).toMatchObject({
      needsOutlineRestore: true,
      savedWidth: 0.2,
      savedColor: saved,
      savedEnabled: false,
    });
    expect(charge.progress).toBe(0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it("tints the metal specular light from the world camera lightgrid with a visibility floor", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const camera = new FreeCamera("world", new Vector3(10, 20, 30), scene);
    scene.activeCameras = [camera];
    const light = new DirectionalLight("blade", Vector3.Forward(), scene);
    const mesh = new Mesh("blade", scene);
    const metal = new PBRMaterial("blade", scene);
    mesh.material = metal;
    metal.reflectionTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
    metal.reflectionTexture.name = "blade-reflection-fill";
    const lighting = new WeaponLighting();
    grid.mockReturnValue({ ambient: [200, 30, 0], directional: [0, 0, 0] });
    lighting.update(1, scene, [mesh], light);
    expect(grid).toHaveBeenCalledWith(camera.globalPosition, expect.any(Object));
    expect(light.specular.r).toBeGreaterThan(light.specular.g);
    expect(light.specular.g).toBeGreaterThanOrEqual(0.49);
    expect(light.diffuse.equals(light.specular)).toBe(true);
    expect(metal.reflectionColor.equals(light.specular)).toBe(true);
    expect(metal.albedoColor.equals(Color3.White())).toBe(true);
    grid.mockReturnValue(null);
    lighting.update(1, scene, [mesh], light);
    expect(light.specular.equals(Color3.White())).toBe(true);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it("smoothly lowers the charging blade and restores its carry pose on cancellation or reset", () => {
  const charge = new WeaponCharge();
  const time = vi.spyOn(performance, "now").mockReturnValue(0);
  const sample = (charging: boolean) => charge.update(charging, 1, [], () => 30, 0, Color3.White(), false).pitchOffset;
  expect(sample(true)).toBeCloseTo(0);
  time.mockReturnValue(70);
  const entering = sample(true);
  expect(entering).toBeLessThan(0);
  expect(entering).toBeGreaterThan(-0.25);
  time.mockReturnValue(700);
  const held = sample(true);
  expect(held).toBeCloseTo(-0.25, 3);
  time.mockReturnValue(716);
  const returning = sample(false);
  expect(returning).toBeGreaterThan(held);
  expect(returning).toBeLessThan(0);
  time.mockReturnValue(1400);
  expect(sample(false)).toBeCloseTo(0, 4);
  charge.reset();
  expect(sample(false)).toBeCloseTo(0);
});
