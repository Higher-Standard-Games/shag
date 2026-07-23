/**
 * Rendering utilities barrel.
 *
 * Exports:
 * - InstancedMeshManager: singleton that creates one GPU template mesh per unique
 *   (model, texture) pair and attaches per-instance transforms as ThinInstances.
 * - RenderVars: runtime `r_*` console variables (quality presets, gloss/normal
 *   intensity, tone-mapping, shadow toggles, etc.) with localStorage persistence
 *   and live `applyToScene()` hooks into scene-graph materials and post-processing.
 */

export type {
  InstanceData,
  InstanceTransform,
  TemplateData,
} from "./InstancedMeshManager";
export { InstancedMeshManager } from "./InstancedMeshManager";
export type {
  RenderingBackend,
  RenderingEngineFactories,
  RenderingEngineResult,
} from "./RenderingEngineFactory";
export { createRenderingEngine, resolveRenderingBackend } from "./RenderingEngineFactory";
export type { RenderVar, RenderVarName } from "./RenderVars";
export { RenderVars } from "./RenderVars";
