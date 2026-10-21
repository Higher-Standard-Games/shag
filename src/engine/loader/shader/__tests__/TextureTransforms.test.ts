import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilterBlendMaterial } from "../FilterBlendShaderMaterial";
import { GlowOverlayShaderMaterial } from "../GlowOverlayShaderMaterial";
import { ShaderAnimationSystem } from "../ShaderAnimationSystem";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  ShaderAnimationSystem.getInstance().dispose();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

describe("texture transform ownership", () => {
  it("cycles glow frames without replacing the opaque base image", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const animation = ShaderAnimationSystem.getInstance();
    animation.init(scene);
    const material = new StandardMaterial("pad", scene);
    const base = new Texture(null, scene);
    const frames = [new Texture(null, scene), new Texture(null, scene)];
    material.diffuseTexture = base;
    material.emissiveTexture = frames[0];
    animation.registerMaterial("pad", material, frames[0], [], undefined, undefined, "emissive", {
      frequency: 2,
      textures: frames,
    });
    now += 600;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(material.emissiveTexture).toBe(frames[1]);
    expect(material.diffuseTexture).toBe(base);
    now += 500;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(material.emissiveTexture).toBe(frames[0]);
    expect(material.diffuseTexture).toBe(base);
  });
  it.each([StandardMaterial, PBRMaterial])(
    "animates additive emission independently of base color: %s",
    (MaterialType) => {
      const animation = ShaderAnimationSystem.getInstance();
      animation.init(scene);
      const material = new MaterialType("shine", scene);
      material.emissiveColor.set(1, 1, 1);
      const texture = new Texture(null, scene);
      const base = "diffuseColor" in material ? material.diffuseColor : material.albedoColor;
      const original = base.clone();
      texture.vOffset = 0.25;
      animation.registerMaterial(
        "shine",
        material,
        texture,
        [],
        { type: "wave", wave: { func: "sin", base: 0.5, amplitude: 0, phase: 0, frequency: 5 } },
        undefined,
        "emissive",
      );
      material.freeze();
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(material.isFrozen).toBe(false);
      if (material instanceof StandardMaterial) {
        expect(material.emissiveColor.r).toBe(0);
        expect(material.useEmissiveAsIllumination).toBe(true);
        expect(texture.level).toBe(0.5);
      } else expect(material.emissiveColor.r).toBe(0.5);
      expect(base.equals(original)).toBe(true);
      expect(texture.vOffset).toBe(0.25);
    },
  );
  it("binds independent base/glow transforms without changing BSP lightmap coordinates", async () => {
    const base = new Texture(null, scene);
    const glow = new Texture(null, scene);
    const lightmap = new Texture(null, scene);
    for (const texture of [base, glow, lightmap]) vi.spyOn(texture, "isReady").mockReturnValue(true);
    base.vScale = -1;
    base.vOffset = 1;
    glow.uScale = 2;
    glow.uOffset = 0.125;
    const material = GlowOverlayShaderMaterial.create("panel", scene, base, lightmap, glow);
    const mesh = CreatePlane("panel", {}, scene);
    mesh.setVerticesData("uv2", [0, 0, 1, 0, 1, 1, 0, 1]);
    mesh.material = material;
    await material.forceCompilationAsync(mesh);
    const subMesh = mesh.subMeshes[0];
    expect(material.isReady(mesh, false, subMesh)).toBe(true);
    const bind = vi.spyOn(subMesh.effect!, "setMatrix");
    const sample = (name: string, uv: Vector3) => {
      const matrix = bind.mock.calls.filter(([uniform]) => uniform === name).at(-1)?.[1];
      if (!(matrix instanceof Matrix)) throw new Error(`Missing texture transform: ${name}`);
      return Vector3.TransformCoordinates(uv, matrix);
    };
    material.bindForSubMesh(Matrix.Identity(), mesh, subMesh);
    expect(sample("baseMatrix", new Vector3(0.2, 0.3, 1)).y).toBeCloseTo(0.7);
    expect(sample("glowMatrix", new Vector3(0.2, 0.3, 1)).x).toBeCloseTo(0.525);
    material.freeze();
    glow.vScale = -1;
    glow.vOffset = 1;
    bind.mockClear();
    material.bindForSubMesh(Matrix.Identity(), mesh, subMesh);
    expect(sample("glowMatrix", new Vector3(0.2, 0.3, 1)).y).toBeCloseTo(0.7);
    expect(lightmap.getTextureMatrix().isIdentityAs3x2()).toBe(true);
    expect(material.isFrozen).toBe(true);
    material.dispose();
    expect(material.onBindObservable.hasObservers()).toBe(false);
    for (const texture of [base, glow, lightmap]) expect(scene.textures).toContain(texture);
  });

  it.each(["rgb", "alpha"])("preserves loader orientation and UV transforms during %s-only waves", (kind) => {
    const animation = ShaderAnimationSystem.getInstance();
    animation.init(scene);
    const material = new StandardMaterial("halo", scene);
    const texture = new Texture(null, scene);
    // The same public transform used by Babylon's compressed-texture wrapper,
    // plus authored UV placement. Colour animation must not change any of it.
    texture.vScale = -1;
    texture.vOffset = 1;
    texture.uOffset = 0.25;
    texture.uScale = 2;
    texture.wAng = 0.3;
    const original = texture.getTextureMatrix().clone();
    const wave = {
      type: "wave" as const,
      wave: { func: "sin" as const, base: 0.5, amplitude: 0, phase: 0, frequency: 1 },
    };
    animation.registerMaterial(
      "halo",
      material,
      texture,
      [],
      kind === "rgb" ? wave : undefined,
      kind === "alpha" ? wave : undefined,
    );
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(kind === "rgb" ? material.diffuseColor.r : material.alpha).toBe(0.5);
    expect(texture.getTextureMatrix().equals(original)).toBe(true);
  });

  it("binds decal UV transforms on first draw and after a frozen material's texture changes", async () => {
    const texture = new Texture(null, scene);
    vi.spyOn(texture, "isReady").mockReturnValue(true); // No hardware upload in NullEngine.
    texture.vScale = -1;
    texture.vOffset = 1;
    const material = createFilterBlendMaterial("decal", scene, texture);
    expect(material.alphaMode).toBe(Constants.ALPHA_MULTIPLY);
    const mesh = CreatePlane("decal", {}, scene);
    mesh.material = material;
    await material.forceCompilationAsync(mesh);
    const subMesh = mesh.subMeshes[0];
    expect(material.isReady(mesh, false, subMesh)).toBe(true);
    const effect = subMesh.effect!;
    const bind = vi.spyOn(effect, "setMatrix");
    const sampledUV = () => {
      material.bindForSubMesh(Matrix.Identity(), mesh, subMesh);
      const matrix = bind.mock.calls.filter(([name]) => name === "diffuseMatrix").at(-1)?.[1];
      if (!(matrix instanceof Matrix)) throw new Error("Decal draw did not bind its texture matrix");
      // Babylon's UV matrices store translation in the third column.
      return Vector3.TransformCoordinates(new Vector3(0.2, 0.3, 1), matrix);
    };
    expect(sampledUV().y).toBeCloseTo(0.7);
    material.freeze();
    texture.vOffset = 0.5;
    bind.mockClear();
    expect(sampledUV().y).toBeCloseTo(0.2);
    expect(material.isFrozen).toBe(true);
    material.dispose();
    expect(texture.getScene()).toBe(scene);
    expect(scene.textures).toContain(texture);
  });
});
