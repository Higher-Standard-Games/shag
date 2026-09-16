/**
 * MD3Loader material reuse (NullEngine). A map load's texture cache clear
 * disposes an MD3 material's texture. Loading the model again reuses that
 * material by name and refreshes its texture asynchronously; until then the
 * released texture must not stay bound, or model caches drop the fresh model.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import { getMD3Loader } from "../MD3Loader";

type CreateMaterial = (
  shaderName: string,
  materialName: string,
) => { material: StandardMaterial; textureLoadPromise: Promise<void> };

const SHADER = "models/objects/projectile/rlauncher/rocket_strong";

let engine: NullEngine;
let scene: Scene;
let createMaterial: CreateMaterial;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Q3ShaderRegistry.getInstance(), "resolveMaterialProps").mockReturnValue({} as never);
  // The refreshed texture has not arrived yet.
  vi.spyOn(PK3TextureLoader.getInstance(), "resolveAndLoadTexture").mockReturnValue(new Promise(() => {}));
  const loader = getMD3Loader();
  loader.init(scene);
  createMaterial = (loader as unknown as { createMaterialFromShader: CreateMaterial }).createMaterialFromShader.bind(
    loader,
  );
});

afterEach(() => {
  engine.dispose();
  vi.restoreAllMocks();
});

function texture(): RawTexture {
  return RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
}

describe("MD3Loader material reuse", () => {
  it("unbinds released textures from a reused material while the refresh loads", () => {
    const { material } = createMaterial(SHADER, "rocket_rocket");
    const released = texture();
    material.diffuseTexture = released;
    material.emissiveTexture = released;
    released.dispose();

    const reused = createMaterial(SHADER, "rocket_rocket").material;

    expect(reused).toBe(material);
    expect(reused.diffuseTexture).toBeNull();
    expect(reused.emissiveTexture).toBeNull();
  });

  it("keeps a live texture on a reused material", () => {
    const { material } = createMaterial(SHADER, "rocket_rocket");
    const live = texture();
    material.diffuseTexture = live;

    expect(createMaterial(SHADER, "rocket_rocket").material.diffuseTexture).toBe(live);
  });
});
