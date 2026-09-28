import { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { WebGPUShaderProcessingContext } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext";
import { WebGPUShaderProcessorWGSL } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsWGSL";
import { _ProcessShaderCode } from "@babylonjs/core/Materials/effect.functions";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { createClusteredLightingFixture, meanRGB, runClusteredLightingQA } from "../rendering/ClusteredLightingQA";
import { RendererDiagnostics } from "../rendering/RendererDiagnostics";

function fixtureEngine(webgpu: boolean) {
  const engine = new NullEngine();
  Object.defineProperty(engine, "isWebGPU", { value: webgpu });
  Object.defineProperty(engine, "version", { value: 2 });
  Object.assign(engine.getCaps(), {
    texelFetch: true,
    colorBufferFloat: true,
    blendFloat: true,
    shaderFloatPrecision: 24,
    maxVertexUniformVectors: 256,
  });
  const createRawTexture = engine.createRawTexture.bind(engine);
  vi.spyOn(engine, "createRawTexture").mockImplementation((...args) => {
    const texture = createRawTexture(...args);
    texture.isReady = true; // NullEngine allocates metadata but never uploads it.
    return texture;
  });
  // Only the GPU allocation boundary is stubbed. Babylon owns the containers,
  // membership, batching, material variants and WGSL resource processing.
  Object.assign(engine, {
    _storageBuffers: [],
    createStorageBuffer: (size: number) => {
      const buffer = new DataBuffer();
      buffer.capacity = size;
      return buffer;
    },
    setStorageBuffer: vi.fn(),
    clearStorageBuffer: vi.fn(),
    updateStorageBuffer: vi.fn(),
  });
  return engine;
}

describe("clustered lighting parity fixture", () => {
  it.each([
    false,
    true,
  ])("keeps 40 point lights in one slot through growth and frozen/skinned compilation (WebGPU=%s)", async (webgpu) => {
    const engine = fixtureEngine(webgpu);
    const scene = new Scene(engine);
    try {
      const fixture = createClusteredLightingFixture(scene);
      expect(fixture.cluster.lights).toHaveLength(1);
      fixture.grow();
      fixture.cluster._updateBatches();
      expect(fixture.cluster.lights).toHaveLength(40);
      expect(scene.lights).toHaveLength(3);
      for (const { mesh, material } of fixture.fixtures) {
        await material.forceCompilationAsync(mesh);
        material.freeze();
        scene.incrementRenderId();
        expect(material.isReadyForSubMesh(mesh, mesh.subMeshes[0])).toBe(true);
        const effect = mesh.subMeshes[0].effect!;
        expect(effect.defines).toContain("#define CLUSTLIGHT2");
        expect(effect.defines).toContain(`#define CLUSTLIGHT_BATCH ${webgpu ? 32 : 24}`);
        expect(effect.defines).not.toContain("#define LIGHT3");
        expect(mesh.lightSources).toHaveLength(3);
        if (mesh.skeleton) expect(effect.defines).toContain("#define NUM_BONE_INFLUENCERS 4");
        if (!webgpu) continue;
        const context = new WebGPUShaderProcessingContext(1);
        const options = {
          defines: effect.defines.split("\n"),
          indexParameters: { maxSimultaneousLights: material.maxSimultaneousLights },
          isFragment: false,
          shouldUseHighPrecisionShader: true,
          processor: new WebGPUShaderProcessorWGSL(),
          supportsUniformBuffers: true,
          shadersRepository: "",
          includesShadersStore: ShaderStore.IncludesShadersStoreWGSL,
          version: "100",
          platformName: "WEBGPU",
          processingContext: context,
          isNDCHalfZRange: true,
          useReverseDepthBuffer: false,
        };
        await new Promise<void>((done) => {
          _ProcessShaderCode(
            options,
            material.getClassName() === "StandardMaterial" ? "default" : "pbr",
            null,
            () => done(),
            1,
            engine,
          );
        });
        expect(context.availableBuffers).toHaveProperty("tileMaskBuffer2");
        expect(context.availableTextures).toHaveProperty("lightDataTexture2");
        const entries = context.bindGroupLayoutEntries.flat();
        for (const stage of [1, 2]) {
          const uniforms = entries.filter(
            (entry) =>
              (entry.visibility & stage) !== 0 && entry.buffer && (entry.buffer.type ?? "uniform") === "uniform",
          );
          expect(uniforms.length).toBeLessThanOrEqual(12);
        }
        expect(entries.filter((entry) => entry.buffer?.type === "read-only-storage")).toHaveLength(1);
      }
      const retainedLights = [...fixture.lights];
      scene.dispose();
      expect(retainedLights.every((light) => light.isDisposed())).toBe(true);
      expect(engine.scenes).toHaveLength(0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("requires real RGBA8 samples and preserves independent channels", () => {
    expect(meanRGB(new Uint8Array([20, 40, 60, 255, 40, 60, 80, 255]))).toEqual([30, 50, 70]);
    expect(meanRGB(new Uint8Array([20, 40, 60, 255, 40, 60, 80, 255]), "bgra8unorm")).toEqual([70, 50, 30]);
    expect(() => meanRGB(new Uint8Array(4), "rgb10a2unorm")).toThrow("Unsupported QA readback format");
    expect(() => meanRGB(new Uint8Array())).toThrow("RGBA8");
    expect(() => meanRGB(new Float32Array(4))).toThrow("RGBA8");
  });

  it("fails a compiled but unlit cluster and reads pixels before presentation", async () => {
    const engine = fixtureEngine(false);
    const scene = new Scene(engine);
    const diagnostics = new RendererDiagnostics("webgl2");
    diagnostics.attachEngine(engine);
    let inFrame = false;
    vi.spyOn(engine, "beginFrame").mockImplementation(() => {
      inFrame = true;
    });
    vi.spyOn(engine, "endFrame").mockImplementation(() => {
      inFrame = false;
    });
    vi.spyOn(engine, "readPixels").mockImplementation(async () => {
      expect(inFrame).toBe(true);
      return new Uint8Array(16 * 16 * 4); // Deliberately no contribution.
    });
    try {
      await expect(runClusteredLightingQA(scene, diagnostics, () => false)).rejects.toThrow("did not increase");
      expect(diagnostics.report.firstFailure).toMatchObject({
        stage: "cluster-pixel-evidence",
        pass: "first-batch-red",
      });
      expect(diagnostics.report.fixtures[0]).toMatchObject({ phase: "dark", compiledClusters: 1, compiledLights: 3 });
      expect(diagnostics.report.status).toBe("failed");
      expect(inFrame).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
