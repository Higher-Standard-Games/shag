/** Headless material defines + real WebGPU shader processing; no GPU execution. */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { WebGPUShaderProcessingContext } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext";
import { WebGPUShaderProcessorWGSL } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsWGSL";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { _ProcessShaderCode } from "@babylonjs/core/Materials/effect.functions";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { applySafeMaxSimultaneousLights } from "../../src/engine/lighting/DynamicLightSafety";

const engine = new NullEngine();
Object.defineProperty(engine, "isWebGPU", { value: true });
const scene = new Scene(engine);
try {
  const mesh = CreateBox("world", {}, scene);
  for (let i = 0; i < 11; i++) new PointLight(`light${i}`, new Vector3(i, 2, 0), scene);
  const material = new StandardMaterial("bsp_mat_probe", scene);
  mesh.material = material;
  // Match the user's 11-light layout, then apply the production cap.
  material.maxSimultaneousLights = 11;
  for (const capped of [false, true]) {
    if (capped) applySafeMaxSimultaneousLights(material);
    scene.incrementRenderId();
    await material.forceCompilationAsync(mesh);
    material.isReadyForSubMesh(mesh, mesh.subMeshes[0]);
    const effect = mesh.subMeshes[0].effect!;
    const context = new WebGPUShaderProcessingContext(1);
    const options = {
      defines: effect.defines.split("\n"),
      indexParameters: { maxSimultaneousLights: material.maxSimultaneousLights },
      isFragment: false, shouldUseHighPrecisionShader: true,
      processor: new WebGPUShaderProcessorWGSL(), supportsUniformBuffers: true,
      shadersRepository: "", includesShadersStore: ShaderStore.IncludesShadersStoreWGSL,
      version: "100", platformName: "WEBGPU", processingContext: context,
      isNDCHalfZRange: true, useReverseDepthBuffer: false,
    };
    await new Promise<void>((done) => {
      _ProcessShaderCode(options, "default", null, () => done(), 1, engine);
    });
    console.log("LIGHT_LAYOUT", JSON.stringify({
      cap: material.maxSimultaneousLights,
      defines: effect.defines.split("\n").filter(line => /LIGHT\d|LIGHTCOUNT/.test(line)),
      buffers: Object.keys(context.availableBuffers),
      groups: context.bindGroupLayoutEntries.map(entries => entries.filter(entry => entry.buffer).length),
    }));
  }
} finally {
  scene.dispose(); engine.dispose();
}
