/**
 * GlowEffect — a scene-wide Babylon `GlowLayer` for controllable emissive glow.
 *
 * Distinct from the `DefaultRenderingPipeline` bloom (which blooms any pixel over
 * a brightness threshold): the glow layer glows meshes by their material emissive
 * at a chosen strength, so neon strips, signs, energy surfaces and weapon FX read
 * as glowing even when they aren't bright enough to trip bloom — and layers on top
 * of it. Driven by the persisted `r_glow` cvar (0 = off, the default); tunes live.
 *
 * Lazy, like SSREffect: a GlowLayer runs its own blur passes every frame, so when
 * `r_glow` is 0 we create NO layer at all (and dispose it live when it's turned
 * back off) rather than leave one running at zero intensity for no visible result.
 */

import "@babylonjs/core/Layers/glowLayer";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { Scene } from "@babylonjs/core/scene";
import RenderVars from "../rendering/RenderVars";

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

  private scene: Scene | null = null;
  private glow: GlowLayer | null = null;
  private unsub: (() => void) | null = null;

  /** Bind to the scene; build the glow layer now only if `r_glow` > 0. */
  init(scene: Scene): void {
    this.dispose();
    this.scene = scene;
    if (this.requested()) this.createLayer();
    this.unsub = RenderVars.getInstance().onChange("r_glow", () => this.refresh());
  }

  isEnabled(): boolean {
    return this.glow !== null;
  }

  get intensity(): number {
    return this.glow?.intensity ?? 0;
  }

  private requested(): boolean {
    return (RenderVars.getInstance().get("r_glow") ?? 0) > 0;
  }

  /** Create / retune / destroy the layer to match the current `r_glow`. */
  private refresh(): void {
    if (this.requested()) {
      if (!this.glow) this.createLayer();
      else this.applyIntensity();
    } else {
      this.destroyLayer();
    }
  }

  private createLayer(): void {
    if (!this.scene || this.glow) return;
    this.glow = new GlowLayer("glow", this.scene);
    this.applyIntensity();
  }

  private applyIntensity(): void {
    if (this.glow) this.glow.intensity = Math.max(0, RenderVars.getInstance().get("r_glow") ?? 0);
  }

  private destroyLayer(): void {
    this.glow?.dispose();
    this.glow = null;
  }

  dispose(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.destroyLayer();
    this.scene = null;
  }
}
