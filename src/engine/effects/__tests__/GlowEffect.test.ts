/**
 * GlowEffect (NullEngine) — the scene-wide emissive glow layer. Verifies it
 * constructs bound to the `r_glow` cvar intensity, that setIntensity clamps and
 * toggles enabled, and that it disposes cleanly. The lit result is browser-checked.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RenderVars from "../../rendering/RenderVars";
import { GlowEffect } from "../GlowEffect";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  GlowEffect.resetInstance();
  scene.dispose();
  engine.dispose();
});

describe("GlowEffect", () => {
  it("creates a glow layer at the r_glow cvar intensity", () => {
    const glow = GlowEffect.getInstance();
    glow.init(scene);
    expect(glow.isEnabled()).toBe(true);
    expect(glow.intensity).toBe(RenderVars.getInstance().get("r_glow")); // 0.7 default
  });

  it("clamps intensity to >= 0 and toggles enabled", () => {
    const glow = GlowEffect.getInstance();
    glow.init(scene);
    glow.setIntensity(1.5);
    expect(glow.intensity).toBe(1.5);
    glow.setIntensity(-1);
    expect(glow.intensity).toBe(0);
    expect(glow.isEnabled()).toBe(false);
  });

  it("disposes cleanly and idempotently", () => {
    const glow = GlowEffect.getInstance();
    glow.init(scene);
    glow.dispose();
    expect(glow.isEnabled()).toBe(false);
    expect(() => glow.dispose()).not.toThrow();
  });
});
