/**
 * A map's unload disposes the textures its materials hold, generated fallbacks
 * included. The next map must get live ones: a disposed texture never becomes
 * ready, and the shader warm-up waited on it for good, so playing a second
 * demo, or loading a map again, stopped at "Warming up effect shaders".
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRadialGradientTexture, createSolidColorTexture } from "../fallbackTextures";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("fallback textures", () => {
  it("share one texture while it lives", () => {
    expect(createSolidColorTexture(scene, 255, 255, 255)).toBe(createSolidColorTexture(scene, 255, 255, 255));
    expect(createRadialGradientTexture(scene)).toBe(createRadialGradientTexture(scene));
  });

  it("make a new texture once the cached one is disposed with a map", () => {
    const first = createSolidColorTexture(scene, 255, 255, 255);
    first.dispose();
    const second = createSolidColorTexture(scene, 255, 255, 255);
    expect(second).not.toBe(first);
    expect(second.getInternalTexture()).not.toBeNull();

    const halo = createRadialGradientTexture(scene);
    halo.dispose();
    expect(createRadialGradientTexture(scene)).not.toBe(halo);
  });

  it("never hand a texture to another scene", () => {
    const first = createSolidColorTexture(scene, 0, 0, 0);
    const other = new Scene(engine);
    expect(createSolidColorTexture(other, 0, 0, 0)).not.toBe(first);
    other.dispose();
  });
});
