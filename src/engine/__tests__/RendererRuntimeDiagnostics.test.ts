import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { Observable } from "@babylonjs/core/Misc/observable";
import { describe, expect, it, vi } from "vitest";
import { installRendererRuntimeDiagnostics, type RendererRuntimeReport } from "../rendering/RendererRuntimeDiagnostics";

function effect(name: string, entries: GPUBindGroupLayoutEntry[][]): Effect {
  return {
    name,
    key: `${name}:defines`,
    shaderLanguage: 1,
    getPipelineContext: () => ({
      shaderProcessingContext: {
        bindGroupLayoutEntries: entries,
        bindGroupLayoutEntryInfo: entries.map((group) =>
          Object.fromEntries(group.map((entry) => [entry.binding, { name: `Buffer${entry.binding}` }])),
        ),
      },
    }),
  } as unknown as Effect;
}

function fixture(effects: Effect[] = []) {
  const device = new EventTarget();
  const onContextLostObservable = new Observable<AbstractEngine>();
  const onDisposeObservable = new Observable<AbstractEngine>();
  const engine = {
    isWebGPU: true,
    currentLimits: Object.create({ maxUniformBuffersPerShaderStage: 12 }),
    _device: device,
    _compiledEffects: Object.fromEntries(effects.map((value, index) => [index, value])),
    onContextLostObservable,
    onDisposeObservable,
    scenes: [],
    postProcesses: [],
    frameId: 2271,
  } as unknown as AbstractEngine;
  const emit = (message: string) => {
    device.dispatchEvent(Object.assign(new Event("uncapturederror"), { error: { message } }));
  };
  return { engine, emit, onDisposeObservable, onContextLostObservable };
}

const buffers = (count: number, visibility = 1): GPUBindGroupLayoutEntry[] =>
  Array.from({ length: count }, (_, binding) => ({ binding, visibility, buffer: {} }));

describe("gameplay WebGPU error evidence", () => {
  it("counts uniforms across groups per stage, uses binding indices for names and finds owners", () => {
    const oversized = effect("world", [buffers(12, 3), [{ binding: 20, visibility: 1, buffer: {} }]]);
    const valid = effect("separate stages", [buffers(12), buffers(12, 2)]);
    const storage = effect("storage", [buffers(14).map((entry) => ({ ...entry, buffer: { type: "storage" } }))]);
    const { engine, emit } = fixture([oversized, valid, storage]);
    Object.assign(engine, {
      scenes: [
        {
          materials: [],
          meshes: [{ name: "floor", subMeshes: [{ effect: oversized, getMaterial: () => ({ name: "stone" }) }] }],
          postProcesses: [],
        },
      ],
    });
    const publish = vi.fn();
    const diagnostics = installRendererRuntimeDiagnostics(engine, publish);
    expect(publish).not.toHaveBeenCalled();
    emit("14 buffers exceed 12");
    const report = publish.mock.calls[0][0];
    expect(report.uniformBufferLimit).toBe(12);
    expect(report.errors[0]).toMatchObject({ frame: 2271, effectsInspected: 3, oversizedLayoutCount: 1 });
    expect(report.errors[0].oversizedLayouts[0]).toMatchObject({
      shader: "world",
      uniformBuffers: { vertex: 13, fragment: 12, compute: 0 },
      owners: ["mesh:floor/material:stone"],
    });
    expect(report.errors[0].oversizedLayouts[0].buffers.at(-1)).toMatchObject({
      group: 1,
      binding: 20,
      name: "Buffer20",
    });
    diagnostics.dispose();
  });

  it("bounds error storms, snapshots and layout output without hiding the total", () => {
    const { engine, emit } = fixture(Array.from({ length: 10 }, (_, index) => effect(`shader${index}`, [buffers(70)])));
    const publish = vi.fn();
    const diagnostics = installRendererRuntimeDiagnostics(engine, publish);
    emit("first");
    emit("first");
    const first = publish.mock.calls[0][0];
    expect(first.errors[0].oversizedLayoutCount).toBe(10);
    expect(first.errors[0].oversizedLayouts).toHaveLength(8);
    expect(first.errors[0].oversizedLayouts[0].buffers).toHaveLength(64);
    expect(first.errors[0].oversizedLayouts[0].uniformBuffers.vertex).toBe(70);
    first.errors.length = 0;
    for (let index = 0; index < 20; index++) emit(`${index}:${"x".repeat(5000)}`);
    expect(publish).toHaveBeenCalledTimes(8);
    expect(publish.mock.calls.at(-1)![0].errors).toHaveLength(8);
    expect(publish.mock.calls.at(-1)![0].errors[1].message).toHaveLength(4096);
    diagnostics.dispose();
  });

  it("preserves light defines beyond the key prefix and distinguishes current caps from compilation inputs", () => {
    const oversized = effect("default", [buffers(15)]);
    Object.assign(oversized, {
      key: "x".repeat(1500),
      defines: `${"#define UNRELATED\n".repeat(100)}#define LIGHT10\n#define LIGHTCOUNT 11\n#define MAXLIGHTCOUNT 11`,
      _indexParameters: { maxSimultaneousLights: 11 },
      vertexSourceCode: "struct Light0 {}; struct Light10 {};",
      fragmentSourceCode: "struct Light10 {};",
    });
    const material = {
      uniqueId: 7,
      name: "bsp_mat_1",
      maxSimultaneousLights: 2,
      isFrozen: true,
      allowShaderHotSwapping: false,
      getEffect: () => oversized,
    };
    const { engine, emit } = fixture([oversized]);
    Object.assign(engine, { scenes: [{ materials: [material, material], meshes: [], postProcesses: [] }] });
    const publish = vi.fn();
    const diagnostics = installRendererRuntimeDiagnostics(engine, publish);
    emit("too many buffers");
    const layout = publish.mock.calls[0][0].errors[0].oversizedLayouts[0];
    expect(layout).toMatchObject({
      compiledLightCap: 11,
      shaderLanguage: 1,
      lightDefines: ["#define LIGHT10", "#define LIGHTCOUNT 11", "#define MAXLIGHTCOUNT 11"],
      sourceLightBuffers: ["Light0", "Light10"],
      owners: ["material:bsp_mat_1"],
      materials: [{ id: 7, name: "bsp_mat_1", cap: 2, frozen: true, hotSwapping: false }],
    });
    expect(layout.key).toHaveLength(128);
    diagnostics.dispose();
  });

  it("keeps the original error when inspection or publishing fails", () => {
    const { engine } = fixture([
      {
        getPipelineContext: () => {
          throw new Error("disposed pipeline");
        },
      } as unknown as Effect,
    ]);
    const publish = vi.fn((_report: RendererRuntimeReport) => {
      throw new Error("console failure");
    });
    const diagnostics = installRendererRuntimeDiagnostics(engine, publish);
    expect(() => diagnostics.recordRenderError(new Error("missing Light3"))).not.toThrow();
    expect(publish.mock.calls[0][0].errors[0]).toMatchObject({
      message: "missing Light3",
      source: "render-loop",
      inspectionError: "Error: disposed pipeline",
    });
    diagnostics.dispose();
  });

  it("removes listeners on engine disposal and stops explicit error recording", () => {
    const { engine, emit, onDisposeObservable, onContextLostObservable } = fixture();
    const publish = vi.fn();
    const diagnostics = installRendererRuntimeDiagnostics(engine, publish);
    onContextLostObservable.notifyObservers(engine);
    expect(publish).toHaveBeenCalledOnce();
    onDisposeObservable.notifyObservers(engine);
    emit("late GPU error");
    diagnostics.recordRenderError("late frame");
    diagnostics.dispose();
    expect(publish).toHaveBeenCalledOnce();
    expect(onContextLostObservable.hasObservers()).toBe(false);
    expect(onDisposeObservable.hasObservers()).toBe(false);
  });

  it("does nothing for WebGL or NullEngine without touching GPU internals", () => {
    const publish = vi.fn();
    const diagnostics = installRendererRuntimeDiagnostics({ isWebGPU: false } as AbstractEngine, publish);
    diagnostics.recordRenderError("WebGL error");
    diagnostics.dispose();
    expect(publish).not.toHaveBeenCalled();
  });
});
