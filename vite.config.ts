import { defineConfig, type Plugin } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import * as path from 'path';
import * as fs from 'fs';
import { readPackagePolicy } from './src/cli/pk3-package-policy';
import { browserApplicationPlugin, resolveBrowserApplication } from './scripts/browser-application';

const application = resolveBrowserApplication(__dirname, process.env.SHAG_APP);

/** True when loaded by vite-node rather than the dev server or a build. */
const isViteNode = /vite-node/.test(process.argv[1] ?? "");

/**
 * Serve `public/data` from disk as it is now, in the dev server.
 *
 * The watcher ignores `public/data`, so Vite knows only the files that were
 * there when it started: a demo recorded or a pk3 added after that fell
 * through to the app's index.html, and the demo player read the HTML as a demo
 * ("bad magic bytes"). A file that exists on disk is served from it; anything
 * else goes on to Vite.
 */
const DATA_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tga": "image/x-tga",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m3u": "audio/x-mpegurl",
};

function liveGameData(): Plugin {
  const root = path.resolve(__dirname, "public/data");
  return {
    name: "live-game-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if ((req.method !== "GET" && req.method !== "HEAD") || !url.startsWith("/data/")) return next();
        let file: string;
        try {
          file = path.resolve(root, decodeURIComponent(url.slice("/data/".length)));
        } catch {
          return next();
        }
        if (!file.startsWith(root + path.sep)) return next();
        fs.stat(file, (error, stat) => {
          if (error || !stat.isFile()) return next();
          res.setHeader("Content-Type", DATA_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
          res.setHeader("Content-Length", stat.size);
          res.setHeader("Cache-Control", "no-cache");
          if (req.method === "HEAD") return res.end();
          fs.createReadStream(file).on("error", next).pipe(res);
        });
      });
    },
  };
}

/** Design mockups and ignored source packages are served locally, omitted from releases. */
function dropDevOnlyAssets(): Plugin {
  let outDir = "";
  return {
    name: "drop-dev-only-assets",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      fs.rmSync(path.join(outDir, "ui-proto"), { recursive: true, force: true });
      for (const filename of readPackagePolicy().ignoredPackages) {
        fs.rmSync(path.join(outDir, "data", filename), { force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [browserApplicationPlugin(__dirname, application), liveGameData(), dropDevOnlyAssets()],
  resolve: {
    alias: {
      '@game': application.directory,
      '@engine/server': path.resolve(__dirname, 'src/engine/server'),
      '@shared/server': path.resolve(__dirname, 'src/shared/server'),
      '@games/fps/server': path.resolve(__dirname, 'src/games/fps/server'),
    },
  },
  server: {
    fs: { allow: [__dirname, application.directory] },
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
    // vite-node (game servers, CLIs) runs code once and watches nothing. It
    // asks for `watch: null`, but Vite's config merge drops nulls, so it is
    // decided here: setting up watchers over this tree cost every spawned game
    // server over half a minute before its first line of game code.
    watch: isViteNode
      ? null
      : {
          // Never source: game data (gigabytes of pk3s and demos), caches
          // (full worktree snapshots), server state and docs.
          ignored: ["**/.cache/**", "**/public/data/**", "**/server-data/**", "**/docs/**", "**/dist/**", "**/android/**"],
        },
  },
  optimizeDeps: {
    // HTML entry injection happens after the dependency scanner reads the template.
    entries: [application.entry],
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
      '@babylonjs/core/Actions/actionManager',
      '@babylonjs/core/Animations/animatable',
      '@babylonjs/core/Animations/animation',
      '@babylonjs/core/Animations/animationEvent',
      '@babylonjs/core/Animations/animationGroup',
      '@babylonjs/core/AudioV2/abstractAudio/audioBus',
      '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2',
      '@babylonjs/core/AudioV2/abstractAudio/staticSound',
      '@babylonjs/core/AudioV2/abstractAudio/staticSoundBuffer',
      '@babylonjs/core/AudioV2/webAudio/webAudioEngine',
      '@babylonjs/core/Bones/bone',
      '@babylonjs/core/Bones/skeleton',
      '@babylonjs/core/Buffers/buffer',
      '@babylonjs/core/Buffers/dataBuffer',
      '@babylonjs/core/Cameras/arcRotateCamera',
      '@babylonjs/core/Cameras/camera',
      '@babylonjs/core/Cameras/freeCamera',
      '@babylonjs/core/Cameras/targetCamera',
      '@babylonjs/core/Collisions/collisionCoordinator',
      '@babylonjs/core/Culling/boundingBox',
      '@babylonjs/core/Culling/boundingInfo',
      '@babylonjs/core/Culling/ray',
      '@babylonjs/core/Debug/physicsViewer',
      '@babylonjs/core/Engines/AbstractEngine/abstractEngine.query',
      '@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery',
      '@babylonjs/core/Engines/Extensions/engine.query',
      '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader',
      '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture',
      '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender',
      '@babylonjs/core/Engines/WebGPU/webgpuPipelineContext',
      '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext',
      '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsWGSL',
      '@babylonjs/core/Engines/WebGPU/webgpuStencilStateComposer',
      '@babylonjs/core/Engines/abstractEngine',
      '@babylonjs/core/Engines/constants',
      '@babylonjs/core/Engines/engine',
      '@babylonjs/core/Engines/engineStore',
      '@babylonjs/core/Engines/nullEngine',
      '@babylonjs/core/Engines/renderTargetWrapper',
      '@babylonjs/core/Engines/shaderStore',
      '@babylonjs/core/Engines/webgpuEngine',
      '@babylonjs/core/Events/pointerEvents',
      '@babylonjs/core/Instrumentation/engineInstrumentation',
      '@babylonjs/core/Instrumentation/sceneInstrumentation',
      '@babylonjs/core/Layers/effectLayer',
      '@babylonjs/core/Layers/glowLayer',
      '@babylonjs/core/Layers/layer',
      '@babylonjs/core/Layers/layerSceneComponent',
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
      '@babylonjs/core/Materials/Node/nodeMaterialBlockConnectionPoint',
      '@babylonjs/core/Materials/PBR/pbrBaseMaterial',
      '@babylonjs/core/Materials/PBR/pbrMaterial',
      '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader',
      '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader.js',
      '@babylonjs/core/Materials/Textures/Loaders/textureLoaderManager',
      '@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader',
      '@babylonjs/core/Materials/Textures/baseTexture',
      '@babylonjs/core/Materials/Textures/cubeTexture',
      '@babylonjs/core/Materials/Textures/dynamicTexture',
      '@babylonjs/core/Materials/Textures/internalTexture',
      '@babylonjs/core/Materials/Textures/ktx2decoderTypes',
      '@babylonjs/core/Materials/Textures/mirrorTexture',
      '@babylonjs/core/Materials/Textures/rawCubeTexture',
      '@babylonjs/core/Materials/Textures/rawTexture',
      '@babylonjs/core/Materials/Textures/rawTexture2DArray',
      '@babylonjs/core/Materials/Textures/renderTargetTexture',
      '@babylonjs/core/Materials/Textures/texture',
      '@babylonjs/core/Materials/effect',
      '@babylonjs/core/Materials/effect.functions',
      '@babylonjs/core/Materials/effectRenderer',
      '@babylonjs/core/Materials/material',
      '@babylonjs/core/Materials/materialDefines',
      '@babylonjs/core/Materials/materialPluginBase',
      '@babylonjs/core/Materials/materialPluginManager',
      '@babylonjs/core/Materials/multiMaterial',
      '@babylonjs/core/Materials/shaderLanguage',
      '@babylonjs/core/Materials/shaderMaterial',
      '@babylonjs/core/Materials/standardMaterial',
      '@babylonjs/core/Materials/uniformBuffer',
      '@babylonjs/core/Maths/math.color',
      '@babylonjs/core/Maths/math.frustum',
      '@babylonjs/core/Maths/math.plane',
      '@babylonjs/core/Maths/math.vector',
      '@babylonjs/core/Maths/math.viewport',
      '@babylonjs/core/Maths/sphericalPolynomial',
      '@babylonjs/core/Meshes/Builders/boxBuilder',
      '@babylonjs/core/Meshes/Builders/cylinderBuilder',
      '@babylonjs/core/Meshes/Builders/groundBuilder',
      '@babylonjs/core/Meshes/Builders/icoSphereBuilder',
      '@babylonjs/core/Meshes/Builders/planeBuilder',
      '@babylonjs/core/Meshes/Builders/sphereBuilder',
      '@babylonjs/core/Meshes/abstractMesh',
      '@babylonjs/core/Meshes/instancedMesh',
      '@babylonjs/core/Meshes/linesMesh',
      '@babylonjs/core/Meshes/mesh',
      '@babylonjs/core/Meshes/mesh.vertexData',
      '@babylonjs/core/Meshes/meshBuilder',
      '@babylonjs/core/Meshes/subMesh',
      '@babylonjs/core/Meshes/thinInstanceMesh',
      '@babylonjs/core/Meshes/transformNode',
      '@babylonjs/core/Misc/areaLightsTextureTools',
      '@babylonjs/core/Misc/khronosTextureContainer2',
      '@babylonjs/core/Misc/khronosTextureContainer2.js',
      '@babylonjs/core/Misc/khronosTextureContainer2Worker.js',
      '@babylonjs/core/Misc/logger',
      '@babylonjs/core/Misc/observable',
      '@babylonjs/core/Misc/screenshotTools',
      '@babylonjs/core/Misc/tags',
      '@babylonjs/core/Misc/tools',
      '@babylonjs/core/Misc/typeStore',
      '@babylonjs/core/Misc/workerPool',
      '@babylonjs/core/Misc/workerPool.js',
      '@babylonjs/core/Particles/IParticleSystem',
      '@babylonjs/core/Particles/computeShaderParticleSystem',
      '@babylonjs/core/Particles/gpuParticleSystem',
      '@babylonjs/core/Particles/particleSystem',
      '@babylonjs/core/Particles/webgl2ParticleSystem',
      '@babylonjs/core/Physics/joinedPhysicsEngineComponent',
      '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin',
      '@babylonjs/core/Physics/v2/Plugins/havokPlugin',
      '@babylonjs/core/Physics/v2/physicsAggregate',
      '@babylonjs/core/Physics/v2/physicsEngineComponent',
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline',
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline',
      '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline',
      '@babylonjs/core/PostProcesses/postProcess',
      '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess',
      '@babylonjs/core/Probes/reflectionProbe',
      '@babylonjs/core/Rendering/boundingBoxRenderer',
      '@babylonjs/core/Rendering/depthRenderer',
      '@babylonjs/core/Rendering/depthRendererSceneComponent',
      '@babylonjs/core/Rendering/edgesRenderer',
      '@babylonjs/core/Rendering/outlineRenderer',
      '@babylonjs/core/Rendering/renderingGroup',
      '@babylonjs/core/Shaders/ShadersInclude/fogFragmentDeclaration',
      '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration',
      '@babylonjs/core/Shaders/ShadersInclude/instancesVertex',
      '@babylonjs/core/ShadersWGSL/ShadersInclude/fogFragmentDeclaration',
      '@babylonjs/core/ShadersWGSL/geometry.fragment',
      '@babylonjs/core/States/stencilState',
      '@babylonjs/core/assetContainer',
      '@babylonjs/core/node',
      '@babylonjs/core/scene',
      '@babylonjs/havok',
      '@babylonjs/ktx2decoder',
      '@babylonjs/ktx2decoder/Transcoders/mscTranscoder.js',
      '@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js',
      '@babylonjs/loaders',
      '@babylonjs/loaders/glTF',
      '@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry',
      ...application.optimizeDeps,
    ],
  },
  // Strip log/debug console calls from PRODUCTION bundles as pure (QA-15):
  // pure annotations only take effect at minify time, so dev keeps every log.
  // console.warn / console.error always survive — they are the diagnostics.
  //
  // esbuild drops the call but keeps arguments with side effects, so
  // `console.log(queue.shift())` still shifts in production.
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
