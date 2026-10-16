import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { BspMeshBuilder } from "../loader/bsp/BspMeshBuilder";
import type { ResolvedMaterialProps } from "../loader/shader/Q3ShaderTypes";

// Babylon's NullEngine.dispose touches window.removeEventListener. Stub just
// enough of a window so tests can dispose cleanly in the node environment.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function makeProps(overrides: Partial<ResolvedMaterialProps> = {}): ResolvedMaterialProps {
  return {
    hasMaterialMetadata: false,
    normalTextureExplicitlyBlank: false,
    glossTextureExplicitlyBlank: false,
    glowTextureExplicitlyBlank: false,
    resolvedBranch: "default",
    useLightmap: true,
    alphaMode: "opaque",
    backFaceCulling: true,
    twoSidedLighting: false,
    depthWrite: true,
    isTransparent: false,
    needsAnimation: false,
    polygonOffset: false,
    isSky: false,
    isFullbright: false,
    autosprite: false,
    autosprite2: false,
    ...overrides,
  };
}

describe("BspMeshBuilder generated PBR materials", () => {
  it("honors authored strength and exponent on the Standard path", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const material = new StandardMaterial("classic", scene);
    material.specularTexture = RawTexture.CreateRGBATexture(new Uint8Array([32, 32, 32, 255]), 1, 1, scene);
    // biome-ignore lint/suspicious/noExplicitAny: testing private compatibility tuning directly
    (BspMeshBuilder as any).tuneCompanionSurfaceMaterial(
      material,
      { hasNormalMap: true, hasGlossMap: true },
      makeProps({ glossIntensity: 0.2, glossExponent: 100 }),
    );
    expect(material.specularColor).toEqual(new Color3(0.2, 0.2, 0.2));
    expect(material.specularPower).toBe(100);
    expect(material.invertNormalMapX).toBe(false);
    expect(material.invertNormalMapY).toBe(false);
    expect(material.specularTexture.level).toBe(1);
    // A normal map alone does not author specular lighting.
    material.specularTexture = null;
    // biome-ignore lint/suspicious/noExplicitAny: testing private compatibility tuning directly
    (BspMeshBuilder as any).tuneCompanionSurfaceMaterial(material, { hasNormalMap: true, hasGlossMap: false });
    expect(material.specularColor).toEqual(Color3.Black());
    scene.dispose();
    engine.dispose();
  });

  it("uses authored RGB specular strength independently of the highlight lobe", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const diffuse = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false);
    const normal = RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 255, 255]), 1, 1, scene, false, false);
    const gloss = RawTexture.CreateRGBATexture(new Uint8Array([180, 180, 180, 255]), 1, 1, scene, false, false);

    // biome-ignore lint/suspicious/noExplicitAny: testing private factory directly
    const material = (BspMeshBuilder as any).createGeneratedPBRMaterial(
      "test_pbr",
      scene,
      makeProps({ glossIntensity: 0.2, glossExponent: 100 }),
      diffuse,
      normal,
      gloss,
      null,
    );

    expect(material.albedoTexture).toBe(diffuse);
    expect(material.bumpTexture).toBe(normal);
    expect(material.invertNormalMapX).toBe(false);
    expect(material.invertNormalMapY).toBe(false);
    expect(material.microSurfaceTexture).toBeNull();
    expect(material.reflectivityTexture).toBe(gloss);
    expect(material.metallic).toBeNull();
    expect(material.roughness).toBeNull();
    expect(material.microSurface).toBeCloseTo(1 - Math.sqrt(2 / 102));
    expect(material.reflectivityColor).toEqual(new Color3(0.2, 0.2, 0.2));
    expect(material.environmentIntensity).toBe(0);

    scene.dispose();
    engine.dispose();
  });
});
