import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import * as path from 'path';
import * as fs from 'fs';

// Read engine.json for default game configuration
const engineConfigPath = path.resolve(__dirname, 'public/engine.json');
const engineConfig = JSON.parse(fs.readFileSync(engineConfigPath, 'utf-8'));

// GAME env var overrides engine.json's defaultGame (for development/testing)
const selectedGame = process.env.GAME || engineConfig.defaultGame || 'default';
console.log(`[Vite] Building game: ${selectedGame}`);

export default defineConfig({
  resolve: {
    alias: {
      '@game': path.resolve(__dirname, `src/games/${selectedGame}`),
      '@engine/server': path.resolve(__dirname, 'src/engine/server'),
      '@shared/server': path.resolve(__dirname, 'src/shared/server'),
      '@games/fps/server': path.resolve(__dirname, 'src/games/fps/server'),
    },
  },
  server: {
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
  },
  optimizeDeps: {
    /**
     * Every `@babylonjs/core/*` entry point the app can import, pre-bundled.
     *
     * Vite otherwise discovers these lazily — the first time a code path that
     * imports one actually RUNS — and a newly optimized dependency forces a
     * full page reload. In a game that means being thrown back to the loading
     * screen mid-match, with the server seeing close code 1005 (socket gone, no
     * close frame) and nothing anywhere to explain it.
     *
     * It bites hardest on rarely-reached code: Search & Destroy's bomb renderer
     * and site markers pull in the plane/cylinder/box builders, dynamic
     * textures, and the explosion effect's edge renderer — none of which any
     * other mode touches. So the reload landed a few seconds into the first S&D
     * round and nowhere else.
     *
     * Regenerate with `npm run deps:babylon`. That script matches every quoted
     * `@babylonjs/...` specifier, which a `from "..."` grep does not: side-effect
     * imports (`import "@babylonjs/core/Rendering/edgesRenderer"`) and dynamic
     * `import(...)` calls have no `from`, and missing those is exactly how the
     * reload came back after the first attempt at this list.
     *
     * `ViteBabylonDeps.test.ts` fails if the two ever drift apart, so this
     * cannot rot silently again.
     */
    include: [
      '@babylonjs/core/Animations/animation',
      '@babylonjs/core/Animations/animationGroup',
      '@babylonjs/core/AudioV2/abstractAudio/audioBus',
      '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2',
      '@babylonjs/core/AudioV2/abstractAudio/staticSound',
      '@babylonjs/core/AudioV2/abstractAudio/staticSoundBuffer',
      '@babylonjs/core/AudioV2/webAudio/webAudioEngine',
      '@babylonjs/core/Bones/bone',
      '@babylonjs/core/Bones/skeleton',
      '@babylonjs/core/Buffers/buffer',
      '@babylonjs/core/Cameras/arcRotateCamera',
      '@babylonjs/core/Cameras/camera',
      '@babylonjs/core/Cameras/freeCamera',
      '@babylonjs/core/Collisions/collisionCoordinator',
      '@babylonjs/core/Culling/ray',
      '@babylonjs/core/Debug/physicsViewer',
      '@babylonjs/core/Engines/abstractEngine',
      '@babylonjs/core/Engines/constants',
      '@babylonjs/core/Engines/engine',
      '@babylonjs/core/Engines/engineStore',
      '@babylonjs/core/Engines/nullEngine',
      '@babylonjs/core/Engines/webgpuEngine',
      '@babylonjs/core/Events/pointerEvents',
      '@babylonjs/core/Instrumentation/engineInstrumentation',
      '@babylonjs/core/Instrumentation/sceneInstrumentation',
      '@babylonjs/core/Layers/glowLayer',
      '@babylonjs/core/Lights/Clustered/clusteredLightContainer',
      '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent',
      '@babylonjs/core/Lights/Shadows/shadowGenerator',
      '@babylonjs/core/Lights/directionalLight',
      '@babylonjs/core/Lights/hemisphericLight',
      '@babylonjs/core/Lights/light',
      '@babylonjs/core/Lights/pointLight',
      '@babylonjs/core/Lights/rectAreaLight',
      '@babylonjs/core/Lights/spotLight',
      '@babylonjs/core/Loading/sceneLoader',
      '@babylonjs/core/Materials/Node/Blocks/Dual/textureBlock',
      '@babylonjs/core/Materials/Node/Blocks/Fragment/fragmentOutputBlock',
      '@babylonjs/core/Materials/Node/Blocks/Input/inputBlock',
      '@babylonjs/core/Materials/Node/Blocks/Vertex/vertexOutputBlock',
      '@babylonjs/core/Materials/Node/Blocks/addBlock',
      '@babylonjs/core/Materials/Node/Blocks/lerpBlock',
      '@babylonjs/core/Materials/Node/Blocks/multiplyBlock',
      '@babylonjs/core/Materials/Node/Blocks/transformBlock',
      '@babylonjs/core/Materials/Node/Blocks/vectorMergerBlock',
      '@babylonjs/core/Materials/Node/Enums/nodeMaterialSystemValues',
      '@babylonjs/core/Materials/Node/nodeMaterial',
      '@babylonjs/core/Materials/PBR/pbrMaterial',
      '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader.js',
      '@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader',
      '@babylonjs/core/Materials/Textures/baseTexture',
      '@babylonjs/core/Materials/Textures/cubeTexture',
      '@babylonjs/core/Materials/Textures/dynamicTexture',
      '@babylonjs/core/Materials/Textures/internalTexture',
      '@babylonjs/core/Materials/Textures/mirrorTexture',
      '@babylonjs/core/Materials/Textures/rawCubeTexture',
      '@babylonjs/core/Materials/Textures/rawTexture',
      '@babylonjs/core/Materials/Textures/renderTargetTexture',
      '@babylonjs/core/Materials/Textures/texture',
      '@babylonjs/core/Materials/effect',
      '@babylonjs/core/Materials/fresnelParameters',
      '@babylonjs/core/Materials/material',
      '@babylonjs/core/Materials/shaderLanguage',
      '@babylonjs/core/Materials/shaderMaterial',
      '@babylonjs/core/Materials/standardMaterial',
      '@babylonjs/core/Maths/math.color',
      '@babylonjs/core/Maths/math.plane',
      '@babylonjs/core/Maths/math.vector',
      '@babylonjs/core/Meshes/Builders/boxBuilder',
      '@babylonjs/core/Meshes/Builders/cylinderBuilder',
      '@babylonjs/core/Meshes/Builders/discBuilder',
      '@babylonjs/core/Meshes/Builders/icoSphereBuilder',
      '@babylonjs/core/Meshes/Builders/planeBuilder',
      '@babylonjs/core/Meshes/Builders/torusBuilder',
      '@babylonjs/core/Meshes/abstractMesh',
      '@babylonjs/core/Meshes/instancedMesh',
      '@babylonjs/core/Meshes/linesMesh',
      '@babylonjs/core/Meshes/mesh',
      '@babylonjs/core/Meshes/mesh.vertexData',
      '@babylonjs/core/Meshes/meshBuilder',
      '@babylonjs/core/Meshes/thinInstanceMesh',
      '@babylonjs/core/Meshes/trailMesh',
      '@babylonjs/core/Meshes/transformNode',
      '@babylonjs/core/Misc/areaLightsTextureTools',
      '@babylonjs/core/Misc/khronosTextureContainer2.js',
      '@babylonjs/core/Misc/khronosTextureContainer2Worker.js',
      '@babylonjs/core/Misc/logger',
      '@babylonjs/core/Misc/observable',
      '@babylonjs/core/Misc/screenshotTools',
      '@babylonjs/core/Misc/tools',
      '@babylonjs/core/Misc/workerPool.js',
      '@babylonjs/core/Particles/gpuParticleSystem',
      '@babylonjs/core/Particles/particleSystem',
      '@babylonjs/core/Particles/webgl2ParticleSystem',
      '@babylonjs/core/Physics/joinedPhysicsEngineComponent',
      '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin',
      '@babylonjs/core/Physics/v2/Plugins/havokPlugin',
      '@babylonjs/core/Physics/v2/physicsAggregate',
      '@babylonjs/core/Physics/v2/physicsEngineComponent',
      '@babylonjs/core/Physics/v2/ragdoll',
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline',
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline',
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline',
      '@babylonjs/core/PostProcesses/postProcess',
      '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess',
      '@babylonjs/core/Rendering/depthRenderer',
      '@babylonjs/core/Rendering/depthRendererSceneComponent',
      '@babylonjs/core/Rendering/edgesRenderer',
      '@babylonjs/core/Rendering/outlineRenderer',
      '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration',
      '@babylonjs/core/Shaders/ShadersInclude/instancesVertex',
      '@babylonjs/core/scene',
      '@babylonjs/havok',
      '@babylonjs/ktx2decoder',
      '@babylonjs/ktx2decoder/Transcoders/mscTranscoder.js',
      '@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js',
      '@babylonjs/loaders',
      '@babylonjs/loaders/glTF',
    ],
  },
  // Strip log/debug console calls from PRODUCTION bundles as pure (QA-15):
  // pure annotations only take effect at minify time, so dev keeps every log.
  // console.warn / console.error always survive — they are the diagnostics.
  //
  // FOOTGUN: `pure` lets the minifier delete the whole call INCLUDING its
  // arguments. So `console.log(queue.shift())` drops the shift() in prod only.
  // Never pass a side-effecting/computed expression to console.log/console.debug
  // — use the `log` façade (src/engine/core/Log.ts) instead: `log.debug(x)` calls
  // a NON-pure function, so `x` is always evaluated at the call and only the
  // console output is stripped.
  esbuild: {
    pure: ['console.log', 'console.debug'],
  },
  assetsInclude: ['**/*.pk3'], // Treat PK3 files as static assets
  // ES6 @babylonjs packages used directly - no alias needed for tree-shaking
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Target modern browsers only (smaller output, no legacy polyfills)
    target: 'es2020',
    // Hidden source maps (QA-15): .map files are emitted for CI/error
    // symbolication but bundles carry no sourceMappingURL comment.
    // The `postbuild` hook (scripts/relocate-sourcemaps.mjs) then MOVES every
    // dist/**/*.map into sourcemaps/ — so the served bundle (web) and the
    // wholesale dist/ copies (Capacitor webDir:'dist', Electron) never ship a
    // map that would expose original source, with no per-deploy discipline.
    sourcemap: 'hidden',
    // Minification settings
    minify: 'esbuild',
    cssMinify: true,
    // Optimize chunk splitting for mobile
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Babylon.js - core 3D engine (ES6 modules for tree-shaking)
          if (id.includes('node_modules/@babylonjs')) {
            return 'babylon';
          }
          // JSZip - PK3 archive handling
          if (id.includes('node_modules/jszip')) {
            return 'jszip';
          }
          // Capacitor - mobile platform bridge
          if (id.includes('node_modules/@capacitor')) {
            return 'capacitor';
          }
          // Keep other node_modules in vendor chunk
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
      plugins: [
        visualizer({
          filename: 'dist/stats.html',
          open: false,
          gzipSize: true,
          brotliSize: true,
        }),
      ],
    },
  },
});
