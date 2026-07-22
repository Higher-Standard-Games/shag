/**
 * GlowEffect — a scene-wide Babylon `GlowLayer` for controllable emissive glow.
 *
 * Distinct from the `DefaultRenderingPipeline` bloom (which blooms any pixel over
 * a brightness threshold): the glow layer glows meshes by their material emissive
 * at a chosen strength, so neon strips, signs, energy surfaces and weapon FX read
 * as glowing even when they aren't bright enough to trip bloom — and layers on top
 * of it. Driven by the persisted `r_glow` cvar (0 = off); tunes live.
 */

import "@babylonjs/core/Layers/glowLayer";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { Scene } from "@babylonjs/core/scene";
import RenderVars from "../rendering/RenderVars";

const DEFAULT_INTENSITY = 0.7;

export class GlowEffect {
  private static instance: GlowEffect;

  /** Clear the cached singleton so a fresh scene re-inits cleanly (QA-WO13 pattern). */
  static resetInstance(): void {
    GlowEffect.instance?.dispose();
    GlowEffect.instance = null as unknown as GlowEffect;
  }

  static getInstance(): GlowEffect {
    if (!GlowEffect.instance) {
      GlowEffect.instance = new GlowEffect();
    }
    return GlowEffect.instance;
  }

  private glow: GlowLayer | null = null;
  private unsub: (() => void) | null = null;

  /** Create the glow layer on the scene and bind it to the `r_glow` cvar. */
  init(scene: Scene): void {
    this.dispose();
    this.glow = new GlowLayer("glow", scene);
    this.applyIntensity();
    this.unsub = RenderVars.getInstance().onChange("r_glow", (v) => this.setIntensity(v));
  }

  isEnabled(): boolean {
    return this.glow !== null && this.glow.intensity > 0;
  }

  get intensity(): number {
    return this.glow?.intensity ?? 0;
  }

  setIntensity(value: number): void {
    if (this.glow) this.glow.intensity = Math.max(0, value);
  }

  private applyIntensity(): void {
    this.setIntensity(RenderVars.getInstance().get("r_glow") ?? DEFAULT_INTENSITY);
  }

  dispose(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.glow?.dispose();
    this.glow = null;
  }
}
