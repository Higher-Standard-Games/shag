/**
 * Babylon ES6 side-effect import regression lock.
 *
 * Babylon attaches several Scene/Mesh capabilities via side-effect module
 * imports (`import "@babylonjs/core/Rendering/outlineRenderer"` etc.). Bare
 * `@babylonjs/core` BARREL imports used to load every one of them implicitly —
 * when the last barrel imports were removed (WS2, Babylon 9 upgrade), any
 * feature nobody imported explicitly silently stopped working. First casualty:
 * `mesh.renderOutline` (enemy-model team outlines) drew nothing because the
 * OutlineRenderer scene component was never registered.
 *
 * This test imports the real app modules that USE those features and asserts
 * the corresponding scene augmentations exist — if an import chain loses the
 * side-effect module again, this fails instead of the visuals silently dying.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The app modules whose features depend on side-effect registrations.
import "../animation/PlayerModelManager"; // mesh.renderOutline (player/enemy outlines)
import "../weapon/WeaponViewManager"; // weapon viewmodel outline
import "../loader/bsp/BspEntityHandlers"; // scene.beginAnimation (BSP frame anims)

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

describe("Babylon side-effect registrations", () => {
  it("OutlineRenderer is registered (mesh.renderOutline draws)", () => {
    // The Rendering/outlineRenderer side-effect adds Scene.getOutlineRenderer.
    // biome-ignore lint/suspicious/noExplicitAny: probing runtime augmentation
    expect(typeof (scene as any).getOutlineRenderer).toBe("function");
    // biome-ignore lint/suspicious/noExplicitAny: probing runtime augmentation
    expect((scene as any).getOutlineRenderer()).toBeTruthy();
  });

  it("Animatable extensions are registered (scene.beginAnimation exists)", () => {
    // The Animations/animatable side-effect adds Scene.beginAnimation.
    // biome-ignore lint/suspicious/noExplicitAny: probing runtime augmentation
    expect(typeof (scene as any).beginAnimation).toBe("function");
  });
});
