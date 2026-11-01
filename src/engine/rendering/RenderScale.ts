import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { RenderVars } from "./RenderVars";

/** The hardware scaling level that draws `scale` of the window's pixels on each axis. */
export function renderScaleLevel(scale: number): number {
  const clamped = Number.isFinite(scale) ? Math.min(1, Math.max(0.25, scale)) : 1;
  return 1 / clamped;
}

/**
 * Keep the engine's render resolution at r_renderscale of the window, live.
 * Below 1 the world draws at fewer pixels and the canvas stretches it to fit;
 * the HUD is HTML and stays sharp. Returns the unsubscribe.
 */
export function installRenderScale(engine: AbstractEngine): () => void {
  const vars = RenderVars.getInstance();
  const apply = (scale: number) => {
    const level = renderScaleLevel(scale);
    if (engine.getHardwareScalingLevel() !== level) engine.setHardwareScalingLevel(level);
  };
  apply(vars.get("r_renderscale") ?? 1);
  return vars.onChange("r_renderscale", apply);
}
