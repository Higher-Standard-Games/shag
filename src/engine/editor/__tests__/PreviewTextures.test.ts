/**
 * Preview materials on a NullEngine with a fake package: a flat colour at
 * once, the decoded image once it lands, and nothing touched after dispose.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PreviewTextureDeps, PreviewTextures } from "../PreviewTextures";
import type { TextureEntry } from "../TextureCatalog";

const entry = (name: string, patch: Partial<TextureEntry> = {}): TextureEntry => ({
  name,
  folder: name.split("/")[0],
  image: `textures/${name}.tga`,
  hasShader: false,
  tags: [],
  compiler: false,
  sky: false,
  transparent: false,
  nolightmap: false,
  fog: false,
  solidColor: false,
  missing: false,
  ...patch,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("preview textures", () => {
  let engine: NullEngine;
  let scene: Scene;
  let deps: PreviewTextureDeps;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    deps = {
      readFile: vi.fn(async (path: string) => (path.includes("absent") ? null : new ArrayBuffer(8))),
      decode: vi.fn(async () => ({ pixels: new Uint8Array(4 * 4 * 2), width: 4, height: 2 })),
    };
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it("shows a flat colour at once and the decoded image, repeating, when it lands", async () => {
    const textures = new PreviewTextures(scene, deps);
    const material = textures.material("boqu/floor", entry("boqu/floor"));
    expect(material.diffuseTexture).toBeNull();
    expect(material.backFaceCulling).toBe(false);
    await flush();
    await flush();
    expect(deps.readFile).toHaveBeenCalledWith("textures/boqu/floor.tga");
    const texture = material.diffuseTexture!;
    expect(texture.getSize()).toEqual({ width: 4, height: 2 });
    expect(texture.wrapU).toBe(1);
    expect(material.diffuseColor).toEqual(Color3.White());
    textures.dispose();
  });

  it("shares one material per shader, whatever its case", () => {
    const textures = new PreviewTextures(scene, deps);
    expect(textures.material("Boqu/Floor", entry("boqu/floor"))).toBe(
      textures.material("boqu/floor", entry("boqu/floor")),
    );
    expect(deps.readFile).toHaveBeenCalledTimes(1);
    textures.dispose();
  });

  it("marks missing and imageless shaders by colour and loads nothing for them", async () => {
    const textures = new PreviewTextures(scene, deps);
    const missing = textures.material("gone/wall", entry("gone/wall", { missing: true }));
    const unknown = textures.material("not/in/catalog", undefined);
    const fog = textures.material("fog/blue", entry("fog/blue", { image: null, fog: true }));
    await flush();
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(missing.diffuseColor).toEqual(unknown.diffuseColor);
    expect(fog.diffuseColor).not.toEqual(missing.diffuseColor);
    expect(fog.diffuseTexture).toBeNull();
    textures.dispose();
  });

  it("alpha-tests a transparent shader's image", async () => {
    const textures = new PreviewTextures(scene, deps);
    const grate = textures.material("boqu/grate", entry("boqu/grate", { transparent: true }));
    await flush();
    await flush();
    expect(grate.diffuseTexture!.hasAlpha).toBe(true);
    textures.dispose();
  });

  it("keeps the flat colour when the image can't be read, and ignores decodes that land after dispose", async () => {
    const textures = new PreviewTextures(scene, deps);
    const absent = textures.material("absent/wall", entry("absent/wall"));
    const late = textures.material("boqu/late", entry("boqu/late"));
    textures.dispose();
    await flush();
    await flush();
    expect(absent.diffuseTexture).toBeNull();
    expect(late.diffuseTexture).toBeNull();
    expect(scene.textures).toHaveLength(0);
  });
});
