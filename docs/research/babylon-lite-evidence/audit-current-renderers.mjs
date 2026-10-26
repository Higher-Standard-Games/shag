import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Research evidence only: read the installed Babylon package and SHAG source.
// Do not import or execute application, renderer or downloaded package code.
const root = process.cwd();
const core = path.join(root, 'node_modules/@babylonjs/core');
const metadata = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
const probes = [
  ['Materials/shaderMaterial.pure.d.ts', ['setFloat(name: string', 'setUniformBuffer(name: string']],
  ['Materials/shaderMaterial.pure.js', ['this._floats[name] = value', 'effect.setFloat(name, this._floats[name])']],
  ['Materials/materialPluginBase.pure.d.ts', ['getCustomCode(', 'bindForSubMesh(']],
  ['Materials/uniformBuffer.d.ts', ['addUniform(', 'updateFloat:', 'update(): void']],
  ['Materials/uniformBuffer.js', ['if (!this._dynamic && !this._needSync)', 'this._engine.updateUniformBuffer']],
  ['Engines/WebGL/webGLPipelineContext.js', ['setFloat(uniformName, value)', 'cache !== undefined && cache === value']],
  ['Meshes/thinInstanceMesh.types.d.ts', ['thinInstancePartialBufferUpdate(', 'thinInstanceSetBuffer(']],
  ['Meshes/thinInstanceMesh.pure.js', ['Object.defineProperty(Mesh.prototype, "thinInstanceCount"', 'typeof dataOrLength === "number"']],
  ['Buffers/buffer.pure.d.ts', ['updateDirectly(data: DataArray', 'interface IVertexBufferOptions']],
  ['Meshes/mesh.pure.js', ['get forcedInstanceCount()', 'this.forcedInstanceCount || instancesCount']],
  ['BakedVertexAnimation/bakedVertexAnimationManager.d.ts', ['setAnimationParameters(', 'time: number']],
  ['BakedVertexAnimation/bakedVertexAnimationManager.js', ['effect.setFloat("bakedVertexAnimationTime", this.time)']],
  ['BakedVertexAnimation/vertexAnimationBaker.d.ts', ['bakeVertexDataSync(', 'textureFromBakedVertexData(']],
  ['BakedVertexAnimation/vertexAnimationBaker.js', ['const floatsPerFrame = (bones + 1) * 16', 'this._scene.render()']],
  ['Shaders/ShadersInclude/bakedVertexAnimation.js', ['VATStartFrame', 'VATInfluence']],
  ['Materials/materialHelper.functions.js', ['bakedVertexAnimationSettingsInstanced']],
  ['Materials/Textures/rawTexture2DArray.d.ts', ['class RawTexture2DArray']],
  ['Materials/Textures/renderTargetTexture.pure.d.ts', ['getCustomRenderList', 'get renderList()']],
  ['FrameGraph/frameGraph.d.ts', ['constructor(scene: Scene', 'textureManager: FrameGraphTextureManager']],
  ['FrameGraph/Tasks/Rendering/objectRendererTask.d.ts', ['objectList: FrameGraphObjectList', 'depthTexture?: FrameGraphTextureHandle']],
  ['Compute/computeShader.pure.js', ['this._engine.getCaps().supportComputeShaders']],
  ['Culling/Helper/boundingInfoHelper.js', ['supportComputeShaders', 'supportTransformFeedbacks']],
  ['Particles/gpuParticleSystem.pure.js', ['caps.supportTransformFeedbacks || caps.supportComputeShaders']],
  ['Engines/engineCapabilities.d.ts', ['canUseGLVertexID', 'texture2DArrayMaxLayerCount']],
];
const sources = [
  'src/engine/loader/shader/ShaderAnimationSystem.ts',
  'src/engine/loader/shader/Q3ShaderMaterialFactory.ts',
  'src/engine/loader/shader/GlowOverlayShaderMaterial.ts',
  'src/engine/loader/shader/Q3NodeMaterialBuilder.ts',
  'src/engine/loader/shader/Q3StageColorPlugin.ts',
  'src/engine/loader/shader/Q3DistanceRampPlugin.ts',
  'src/engine/loader/shader/__tests__/TextureTransforms.test.ts',
  'src/engine/console/commands/ShaderCommand.ts',
  'src/engine/weapon/voltaic/VoltaicEffectRenderer.ts',
  'src/engine/weapon/voltaic/VoltaicShaderMaterial.ts',
  'src/engine/weapon/explosion/ExplosionBatchRenderer.ts',
  'src/engine/weapon/explosion/ExplosionBatchMaterial.ts',
  'src/engine/animation/PlayerModelManager.ts',
  'src/engine/rendering/PlayerOutlineProxy.ts',
  'src/engine/rendering/FrozenWorldMaterials.ts',
  'src/engine/rendering/WeaponCameraCandidates.ts',
  'src/engine/rendering/SceneDepthCapture.ts',
  'src/engine/rendering/water/WaterProbeCache.ts',
  'src/engine/rendering/RenderingEngineFactory.ts',
  'src/engine/rendering/RendererPerformanceCapture.ts',
  'src/engine/loader/bsp/mesh/spatialBatching.ts',
  'src/engine/loader/bsp/BspMeshBuilder.ts',
  'src/engine/loader/model/MD3Loader.ts',
  'src/engine/loader/shader/Q3ShaderTypes.ts',
  'src/engine/core/GameTimer.ts',
  'src/engine/loader/map/MapLoader.ts',
  'src/engine/console/commands/PerfCommand.ts',
  'src/engine/weapon/__tests__/VoltaicEffectRenderer.test.ts',
  'src/engine/__tests__/ExplosionBatch.test.ts',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashSource = file => ({file, sha256: sha256(fs.readFileSync(path.join(root, file)))});
const inspectedPackageFiles = probes.map(([file, needles]) => {
  const bytes = fs.readFileSync(path.join(core, file));
  for (const needle of needles) assert(bytes.toString('utf8').includes(needle), `${file}: missing ${needle}`);
  return {file, sha256: sha256(bytes), checkedTokens: needles};
});
const evidence = {
  method: 'Selected installed-package declaration/implementation token checks and SHA-256 snapshots, plus manually reviewed SHAG owner hashes. No execution, compilation of proposed classes, exhaustive API compatibility claim or performance measurement.',
  package: {name: metadata.name, version: metadata.version, metadataSha256: sha256(fs.readFileSync(path.join(core, 'package.json')))},
  inspectedPackageFiles,
  shagSources: sources.map(hashSource),
};
const output = path.join(root, '.cache/babylon-lite-research/current-renderer-summary.json');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(`PASS: ${metadata.name}@${metadata.version}; ${probes.length} installed package files and ${sources.length} SHAG owners recorded; selected API tokens found`);
