/**
 * GlowEffect (NullEngine) — the scene-wide emissive glow layer. Off by default
 * (r_glow 0): no layer is created at all, so it costs nothing. When r_glow > 0 it
 * builds the layer live at that intensity and disposes it again when turned back
 * off. Verifies that lifecycle + clean/idempotent disposal; the lit result is
 * browser-checked.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RenderVars from "../../rendering/RenderVars";
import { GLOW_BLUR_KERNEL, GlowEffect } from "../GlowEffect";

// requestAnimationFrame isn't available in the Node test env; RenderVars.set
// schedules its live scene-apply through it, so no-op it (running the callback
// synchronously) to let set() reach notifyListeners → GlowEffect's onChange.
// biome-ignore lint/suspicious/noExplicitAny: mock global for tests
(globalThis as any).requestAnimationFrame = ((cb: () => void) => {
  cb();
  return 0;
}) as typeof requestAnimationFrame;

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  GlowEffect.resetInstance();
  RenderVars.getInstance().set("r_glow", 0); // persistent singleton — restore default
  scene.dispose();
  engine.dispose();
});

describe("GlowEffect", () => {
  it("creates no layer when r_glow is 0 (default — zero cost)", () => {
    RenderVars.getInstance().set("r_glow", 0);
    const glow = GlowEffect.getInstance();
    glow.init(scene);
    expect(glow.isEnabled()).toBe(false);
    expect(glow.intensity).toBe(0);
  });

  it("builds the layer at the r_glow intensity when > 0, and toggles live", () => {
    RenderVars.getInstance().set("r_glow", 0.8);
    const glow = GlowEffect.getInstance();
    glow.init(scene);
    expect(glow.isEnabled()).toBe(true);
    expect(glow.intensity).toBe(RenderVars.getInstance().get("r_glow"));
    expect(glow.blurKernelSize).toBe(GLOW_BLUR_KERNEL);

    // Turning it off disposes the layer; turning it back on re-creates it.
    RenderVars.getInstance().set("r_glow", 0);
    expect(glow.isEnabled()).toBe(false);
    RenderVars.getInstance().set("r_glow", 1.2);
    expect(glow.isEnabled()).toBe(true);
    expect(glow.intensity).toBe(RenderVars.getInstance().get("r_glow"));
  });

  it("disposes cleanly and idempotently", () => {
    RenderVars.getInstance().set("r_glow", 0.7);
    const glow = GlowEffect.getInstance();
    glow.init(scene);
    expect(glow.isEnabled()).toBe(true);
    glow.dispose();
    expect(glow.isEnabled()).toBe(false);
    expect(() => glow.dispose()).not.toThrow();
  });
});
