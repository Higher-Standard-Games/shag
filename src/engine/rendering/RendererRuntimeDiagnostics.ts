import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { WebGPUPipelineContext } from "@babylonjs/core/Engines/WebGPU/webgpuPipelineContext";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { Effect } from "@babylonjs/core/Materials/effect";
import type { Material } from "@babylonjs/core/Materials/material";
import { observeRendererDevice } from "./RendererDiagnostics";

export interface RendererLayoutEvidence {
  shader: string;
  key: string;
  shaderLanguage: number;
  compiledLightCap?: number;
  lightDefines: string[];
  sourceLightBuffers: string[];
  owners: string[];
  materials: { id: number; name: string; cap?: number; frozen: boolean; hotSwapping: boolean }[];
  uniformBuffers: { vertex: number; fragment: number; compute: number };
  buffers: { group: number; binding: number; name: string; visibility: number }[];
}

export interface RendererRuntimeReport {
  scope: "webgpu-gameplay-errors";
  babylonVersion: string;
  uniformBufferLimit?: number;
  errors: {
    source: "device" | "render-loop";
    frame: number;
    message: string;
    effectsInspected: number;
    oversizedLayoutCount: number;
    oversizedLayouts: RendererLayoutEvidence[];
    inspectionError?: string;
  }[];
}

/**
 * Read-only Babylon 9 adapter. GPU errors are asynchronous: these are layout
 * candidates in the effect cache, not proof of which draw raised an error.
 * No shaders, devices, bind groups or compilation callbacks are patched.
 */
function inspectLayouts(engine: AbstractEngine, limit: number | undefined) {
  // Babylon exposes each Effect's pipeline context, but not its effect cache.
  const cache = (engine as unknown as { _compiledEffects: Record<string, Effect> })._compiledEffects;
  const effects = new Set(Object.values(cache));
  const owners = new Map<Effect, string[]>();
  const materials = new Map<Effect, Map<number, RendererLayoutEvidence["materials"][number]>>();
  const addOwner = (effect: Effect | null, owner: string, material?: Material | null) => {
    if (!effect) return;
    effects.add(effect);
    const names = owners.get(effect) ?? [];
    if (names.length < 8 && !names.includes(owner)) names.push(owner.slice(0, 256));
    owners.set(effect, names);
    if (material) {
      const states = materials.get(effect) ?? new Map();
      if (states.size < 8) {
        states.set(material.uniqueId, {
          id: material.uniqueId,
          name: material.name.slice(0, 128),
          cap: (material as Material & { maxSimultaneousLights?: number }).maxSimultaneousLights,
          frozen: material.isFrozen,
          hotSwapping: material.allowShaderHotSwapping,
        });
      }
      materials.set(effect, states);
    }
  };
  for (const scene of engine.scenes) {
    for (const material of scene.materials) addOwner(material.getEffect(), `material:${material.name}`, material);
    for (const mesh of scene.meshes) {
      for (const subMesh of mesh.subMeshes ?? []) {
        const material = subMesh.getMaterial();
        addOwner(subMesh.effect, `mesh:${mesh.name}/material:${material?.name ?? "unknown"}`, material);
      }
    }
    for (const pass of scene.postProcesses) addOwner(pass.getEffect(), `postProcess:${pass.name}`);
  }
  for (const pass of engine.postProcesses) addOwner(pass.getEffect(), `postProcess:${pass.name}`);

  let oversizedLayoutCount = 0;
  const oversizedLayouts: RendererLayoutEvidence[] = [];
  for (const effect of effects) {
    const context = (effect.getPipelineContext() as WebGPUPipelineContext | null)?.shaderProcessingContext;
    if (!context?.bindGroupLayoutEntries) continue;
    const uniformBuffers = { vertex: 0, fragment: 0, compute: 0 };
    const buffers: RendererLayoutEvidence["buffers"] = [];
    context.bindGroupLayoutEntries.forEach((entries, group) => {
      for (const entry of entries ?? []) {
        if (!entry?.buffer || (entry.buffer.type ?? "uniform") !== "uniform") continue;
        // GPUShaderStage's numeric flags also work in headless diagnostic tests.
        if (entry.visibility & 1) uniformBuffers.vertex++;
        if (entry.visibility & 2) uniformBuffers.fragment++;
        if (entry.visibility & 4) uniformBuffers.compute++;
        if (buffers.length < 64) {
          buffers.push({
            group,
            binding: entry.binding,
            name: (context.bindGroupLayoutEntryInfo[group]?.[entry.binding]?.name ?? "unknown").slice(0, 128),
            visibility: entry.visibility,
          });
        }
      }
    });
    if (limit === undefined || Math.max(...Object.values(uniformBuffers)) <= limit) continue;
    oversizedLayoutCount++;
    if (oversizedLayouts.length < 8) {
      oversizedLayouts.push({
        shader: (typeof effect.name === "string" ? effect.name : JSON.stringify(effect.name)).slice(0, 512),
        key: effect.key.slice(0, 128),
        shaderLanguage: effect.shaderLanguage,
        // The cache key truncates long define lists before the lighting section.
        // Record that section independently, plus the actual include-range input.
        compiledLightCap: (effect as unknown as { _indexParameters?: { maxSimultaneousLights?: number } })
          ._indexParameters?.maxSimultaneousLights,
        lightDefines: (effect.defines ?? "")
          .split("\n")
          .filter((line) =>
            /^#define (?:MAXLIGHTCOUNT|LIGHTCOUNT|LIGHT\d+|(?:POINT|DIR|HEMI|SPOT|AREA|CLUST)LIGHT\d+)\b/.test(line),
          )
          .slice(0, 64)
          .map((line) => line.slice(0, 128)),
        sourceLightBuffers: [
          ...new Set(
            [
              ...`${effect.vertexSourceCode ?? ""}\n${effect.fragmentSourceCode ?? ""}`.matchAll(
                /(?:struct|uniform)\s+(Light\d+)\b/g,
              ),
            ].map((match) => match[1]),
          ),
        ].slice(0, 64),
        owners: owners.get(effect) ?? [],
        materials: [...(materials.get(effect)?.values() ?? [])],
        uniformBuffers,
        buffers,
      });
    }
  }
  return { effectsInspected: effects.size, oversizedLayoutCount, oversizedLayouts };
}

/** Installed only for an actual WebGPU gameplay session; no per-frame scan. */
export function installRendererRuntimeDiagnostics(
  engine: AbstractEngine,
  publish: (report: RendererRuntimeReport) => void,
): { recordRenderError: (error: unknown) => void; dispose: () => void } {
  if (!engine.isWebGPU) return { recordRenderError: () => {}, dispose: () => {} };
  const report: RendererRuntimeReport = {
    scope: "webgpu-gameplay-errors",
    babylonVersion: Engine.Version,
    uniformBufferLimit: (engine as WebGPUEngine).currentLimits?.maxUniformBuffersPerShaderStage,
    errors: [],
  };
  let disposed = false;
  const record = (source: "device" | "render-loop", error: unknown) => {
    if (disposed || report.errors.length >= 8) return;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 4096);
    if (report.errors.some((item) => item.source === source && item.message === message)) return;
    const evidence: RendererRuntimeReport["errors"][number] = {
      source,
      frame: engine.frameId,
      message,
      effectsInspected: 0,
      oversizedLayoutCount: 0,
      oversizedLayouts: [],
    };
    try {
      Object.assign(evidence, inspectLayouts(engine, report.uniformBufferLimit));
    } catch (inspectionError) {
      evidence.inspectionError = String(inspectionError).slice(0, 512);
    }
    report.errors.push(evidence);
    // Diagnostics must never replace the original rendering exception.
    try {
      publish(structuredClone(report));
    } catch {
      // A console/publisher failure is not a renderer failure.
    }
  };
  const stopObserving = observeRendererDevice(engine, (error) => record("device", error));
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopObserving();
    engine.onDisposeObservable.remove(disposeObserver);
  };
  const disposeObserver = engine.onDisposeObservable.add(dispose);
  return { recordRenderError: (error) => record("render-loop", error), dispose };
}
