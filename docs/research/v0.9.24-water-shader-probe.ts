/** Real installed GLSL -> SPIR-V -> WGSL translation; no GPU execution. */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { WebGPUShaderProcessingContext } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext";
import { WebGPUShaderProcessorGLSL } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL";
import { Effect } from "@babylonjs/core/Materials/effect";
import { _ProcessShaderCode } from "@babylonjs/core/Materials/effect.functions";
import { Scene } from "@babylonjs/core/scene";
import { createUnifiedWaterMaterial, disposeWaterNoise } from "../../src/engine/rendering/water/UnifiedWaterMaterial";

async function translator(name: string) {
  const filename = resolve(`node_modules/@babylonjs/core/assets/${name}/${name}.js`);
  const module = { exports: {} };
  runInNewContext(readFileSync(filename, "utf8"), {
    module, exports: module.exports, require: createRequire(filename),
    __dirname: dirname(filename), console, TextDecoder, TextEncoder,
    setTimeout, clearTimeout, Buffer, WebAssembly,
    // Emscripten's process listeners are unnecessary in this one-shot probe.
    process: { versions: process.versions, argv: [], on() {} },
    fetch: async (path: string) => new Response(readFileSync(path), {
      headers: { "Content-Type": "application/wasm" },
    }),
  }, { filename });
  return await (module.exports as (path: string) => Promise<any>)(resolve(dirname(filename), `${name}.wasm`));
}

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  createUnifiedWaterMaterial(scene, "water");
  const context = new WebGPUShaderProcessingContext(0);
  const options = {
    defines: [], indexParameters: {}, isFragment: false,
    shouldUseHighPrecisionShader: true, processor: new WebGPUShaderProcessorGLSL(),
    supportsUniformBuffers: true, shadersRepository: "", includesShadersStore: Effect.IncludesShadersStore,
    version: "100", platformName: "WEBGPU", processingContext: context,
    isNDCHalfZRange: true, useReverseDepthBuffer: false,
  };
  const sources = await new Promise<{ vertex: string; fragment: string }>((done) => {
    _ProcessShaderCode(options, { vertex: "unifiedWater", fragment: "unifiedWater" }, null,
      (vertex, fragment) => done({ vertex, fragment }), 0, engine);
  });
  const glslang = await translator("glslang");
  const tint = await translator("twgsl");
  for (const stage of ["vertex", "fragment"] as const) {
    const spirv = glslang.compileGLSL(`#version 450\n${sources[stage]}`, stage);
    const wgsl = tint.convertSpirV2WGSL(spirv);
    if (!wgsl || !wgsl.includes(`@${stage}`)) throw new Error(`Translation failed: ${stage}`);
    writeFileSync(resolve(tmpdir(), `shag-water-${stage}.wgsl`), wgsl);
    if (stage === "fragment") {
      for (const sampler of ["uSceneColour", "uSceneDepth", "uActorReflection", "uLightVisibility"]) {
        if (!wgsl.includes(`textureSampleLevel(${sampler}Texture`)) throw new Error(`Missing explicit level for ${sampler}`);
        if (wgsl.includes(`textureSample(${sampler}Texture`)) throw new Error(`Implicit capture sampling remains: ${sampler}`);
      }
    }
    console.log("WATER_SHADER_TRANSLATED", stage, spirv.length, wgsl.length);
  }
  console.log("WATER_SHADER_BUFFERS", JSON.stringify(Object.keys(context.availableBuffers)));
} finally {
  disposeWaterNoise(scene);
  scene.dispose();
  engine.dispose();
}
