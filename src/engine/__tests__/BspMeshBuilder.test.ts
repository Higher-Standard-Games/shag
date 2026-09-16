import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
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
  it("treats gloss maps as microsurface input instead of metallic input", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const diffuse = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false);
    const normal = RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 255, 255]), 1, 1, scene, false, false);
    const gloss = RawTexture.CreateRGBATexture(new Uint8Array([180, 180, 180, 255]), 1, 1, scene, false, false);

    // biome-ignore lint/suspicious/noExplicitAny: testing private factory directly
    const material = (BspMeshBuilder as any).createGeneratedPBRMaterial(
      "test_pbr",
      scene,
      makeProps(),
      diffuse,
      normal,
      gloss,
      null,
    );

    expect(material.albedoTexture).toBe(diffuse);
    expect(material.bumpTexture).toBe(normal);
    expect(material.microSurfaceTexture).toBe(gloss);
    expect(material.reflectivityTexture).toBeNull();
    expect(material.metallic).toBe(0);
    expect(material.roughness).toBeCloseTo(0.78);
    expect(material.microSurface).toBeCloseTo(0.9);
    expect(material.reflectivityColor).toEqual(new Color3(0.62, 0.62, 0.62));
    expect(material.environmentIntensity).toBe(0);

    scene.dispose();
    engine.dispose();
  });
});
