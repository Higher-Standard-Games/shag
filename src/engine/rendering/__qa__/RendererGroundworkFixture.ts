import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Scene } from "@babylonjs/core/scene";
import { Q3AnalyticAnimationPlugin } from "../../loader/shader/Q3AnalyticAnimationPlugin";
import { evaluateWaveFunc } from "../../loader/shader/Q3StageEvaluation";
import { ShaderAnimationSystem } from "../../loader/shader/ShaderAnimationSystem";
import { VoltaicEffectRenderer } from "../../weapon/voltaic/VoltaicEffectRenderer";
import { createRenderingEngine, type RenderingBackend } from "../RenderingEngineFactory";

/** Isolated development fixture, imported by scripts/benchmarks/renderer-groundwork.mjs only. */
export async function runGroundworkFixture(
  backend: RenderingBackend,
  mode: "effects" | "materials" | "fixed-scale" | "matrix-free-effects",
  reference: string | false = false,
) {
  document.body.innerHTML = '<canvas width="256" height="256"></canvas>';
  const canvas = document.querySelector("canvas")!;
  const result = await createRenderingEngine(canvas, backend);
  const engine = result.engine;
  if (result.backend !== backend) {
    engine.dispose();
    throw new Error(`Requested ${backend}, got ${result.backend}: ${result.fallbackReason}`);
  }
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.025, 0.025, 0.025, 1);
  const camera = new FreeCamera("fixture", new Vector3(0, 0, -3), scene);
  camera.setTarget(Vector3.Zero());
  try {
    if (mode === "fixed-scale") {
      const referencePath = `/.cache/renderer-groundwork/ShaderAnimationReference-${reference}.ts`;
      const Animation = reference
        ? (await import(/* @vite-ignore */ referencePath)).ShaderAnimationSystem
        : ShaderAnimationSystem;
      const animation = Animation.getInstance();
      animation.setEnabled(true);
      animation.setTimeScale(1);
      animation.init(scene);
      new HemisphericLight("light", new Vector3(0, 0, -1), scene);
      const plane = CreatePlane("surface", { size: 2 }, scene);
      const comparisons = [];
      try {
        for (const family of ["standard", "pbr"] as const) {
          const material = family === "pbr" ? new PBRMaterial("fixed", scene) : new StandardMaterial("fixed", scene);
          const data = new Uint8Array([200, 40, 60, 255, 20, 180, 60, 255, 20, 40, 220, 255, 190, 170, 30, 255]);
          const texture = RawTexture.CreateRGBATexture(data, 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
          if (material instanceof PBRMaterial) {
            material.albedoTexture = texture;
            material.metallic = 0;
            material.roughness = 1;
          } else material.diffuseTexture = texture;
          plane.material = material;
          animation.registerMaterial("fixed", material, texture, [{ type: "scale", sScale: 2, tScale: 3 }]);
          scene.onBeforeRenderObservable.notifyObservers(scene);
          await material.forceCompilationAsync(plane);
          await scene.whenReadyAsync();
          scene.render();
          material.freeze();
          let writes = 0;
          for (const key of ["uOffset", "vOffset", "uScale", "vScale", "wAng"] as const) {
            let value = texture[key];
            Object.defineProperty(texture, key, {
              configurable: true,
              get: () => value,
              set: (next: number) => {
                writes++;
                value = next;
              },
            });
          }
          for (let i = 0; i < 120; i++) scene.render();
          const stableWrites = writes;
          const frozen = material.isFrozen;
          const capture = async () => {
            const pixels = await engine.readPixels(0, 0, 256, 256);
            const copy = new Uint8Array(pixels.byteLength);
            copy.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
            const signal = copy.reduce((count, value, i) => count + (i % 4 !== 3 && value > 40 ? 1 : 0), 0);
            const hash = await crypto.subtle.digest("SHA-256", copy);
            return {
              signal,
              hash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
            };
          };
          const stable = await capture();
          material.freeze();
          texture.vOffset = 0.25;
          scene.render();
          const repaired = await capture();
          const restored = texture.vOffset === 0 && !material.isFrozen && repaired.hash === stable.hash;
          animation.unregisterMaterial("fixed");
          texture.uScale = 7;
          scene.onBeforeRenderObservable.notifyObservers(scene);
          comparisons.push({ family, stableWrites, frozen, ...stable, restored, unregistered: texture.uScale === 7 });
          material.dispose();
          texture.dispose();
        }
      } finally {
        animation.dispose();
      }
      return {
        backend,
        mode,
        comparisons,
        passed: comparisons.every(
          (c) => c.signal > 0 && c.restored && c.unregistered && (reference || (c.frozen && c.stableWrites === 0)),
        ),
      };
    }
    if (mode === "effects" || mode === "matrix-free-effects") {
      const matrixFree = mode === "matrix-free-effects";
      camera.position.set(0, 20, -200);
      camera.setTarget(new Vector3(0, 0, 100));
      let time = 1;
      const referencePath = `/.cache/renderer-groundwork/${matrixFree ? "MatrixFreeVoltaic" : "VoltaicReference"}-${reference}.ts`;
      const Renderer = reference
        ? (await import(/* @vite-ignore */ referencePath)).VoltaicEffectRenderer
        : VoltaicEffectRenderer;
      const effect = new Renderer(scene, () => time);
      let bytes = 0,
        writes = 0;
      let drawCalls = 0;
      const draw = engine.drawElementsType;
      engine.drawElementsType = function (fillMode, indexStart, indexCount, instancesCount) {
        drawCalls++;
        return draw.call(this, fillMode, indexStart, indexCount, instancesCount);
      };
      const original = engine.updateDynamicVertexBuffer;
      engine.updateDynamicVertexBuffer = function (buffer, data, byteOffset, byteLength) {
        writes++;
        bytes += byteLength ?? (Array.isArray(data) ? data.length * 4 : data.byteLength);
        return original.call(this, buffer, data, byteOffset, byteLength);
      };
      try {
        const sample = {
          start: Vector3.Zero(),
          end: new Vector3(0, 0, 150),
          color: new Color3(0.2, 0.7, 1),
          impactKind: "world" as const,
          impactNormal: new Vector3(0, 0, -1),
        };
        await effect.prewarm();
        effect.updateRemote("remote", sample, Vector3.Forward());
        effect.update(0);
        await scene.whenReadyAsync();
        scene.render();
        const batches = scene.meshes.filter((mesh) => /voltaic_(world|chain)_/.test(mesh.name));
        const matrixCpuArrays = new Set<ArrayBufferLike>();
        const matrixGpuBuffers = new Set<unknown>();
        let matrixGpuBytes = 0;
        const layouts = batches.map((mesh) => {
          const matrix = mesh.getVertexBuffer("world0");
          const data = matrix?.getData();
          if (data instanceof Float32Array) matrixCpuArrays.add(data.buffer);
          const gpu = matrix?.getBuffer();
          if (gpu && !matrixGpuBuffers.has(gpu)) {
            matrixGpuBuffers.add(gpu);
            matrixGpuBytes += gpu.capacity;
          }
          const compiled = mesh.subMeshes[0]?.effect;
          return {
            name: mesh.name,
            matrixBuffer: !!matrix,
            activeAttributes: compiled
              ?.getAttributesNames()
              .filter((name) => compiled.getAttributeLocationByName(name) >= 0),
            alwaysActive: mesh.alwaysSelectAsActiveMesh,
            finiteBounds: [
              ...mesh.getBoundingInfo().minimum.asArray(),
              ...mesh.getBoundingInfo().maximum.asArray(),
            ].every(Number.isFinite),
          };
        });
        bytes = 0;
        writes = 0;
        drawCalls = 0;
        const started = performance.now();
        for (let i = 0; i < 120; i++) {
          time += 1 / 120;
          effect.updateRemote("remote", sample, Vector3.Forward());
          effect.update(1 / 120);
          scene.render();
        }
        let imageSignal = 0;
        const imageHash = async () => {
          const image = await engine.readPixels(0, 0, 256, 256);
          const copy = new Uint8Array(image.byteLength);
          copy.set(new Uint8Array(image.buffer, image.byteOffset, image.byteLength));
          imageSignal = 0;
          for (let i = 0; i < copy.length; i++) if (i % 4 !== 3 && copy[i] > 40) imageSignal++;
          const hash = await crypto.subtle.digest("SHA-256", copy);
          return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
        };
        const hash = await imageHash();
        const signal = imageSignal;
        const wallMsIncludingReadback = performance.now() - started;
        const submittedBytes = bytes,
          writeCalls = writes;
        const measuredDrawCalls = drawCalls;
        const sceneActiveIndices = scene.getActiveIndices();
        let restoration = "not requested";
        if (!engine.isWebGPU && (!reference || matrixFree)) {
          const extension = canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
          if (extension) {
            await new Promise<void>((resolve, reject) => {
              const observer = engine.onContextRestoredObservable.addOnce(() => {
                clearTimeout(timeout);
                resolve();
              });
              const timeout = setTimeout(() => {
                engine.onContextRestoredObservable.remove(observer);
                reject(new Error("Context restoration timed out"));
              }, 15000);
              extension.loseContext();
              setTimeout(() => extension.restoreContext(), 100);
            });
            await scene.whenReadyAsync();
            effect.update(0);
            scene.render();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            scene.render();
            restoration = (await imageHash()) === hash ? "identical pixels" : "pixel mismatch";
          } else restoration = "unsupported";
        }
        const afterRecoverySignal = imageSignal;
        effect.clear();
        effect.update(0);
        drawCalls = 0;
        scene.render();
        const emptyDrawCalls = drawCalls;
        effect.updateRemote("reused", sample, Vector3.Forward());
        effect.update(0);
        drawCalls = 0;
        scene.render();
        const reuseDrawCalls = drawCalls;
        const lifecycle: { label: string; hash: string; draws: number; expectedDraws: number; signal: number }[] = [];
        const captureCase = async (label: string, expectedDraws: number) => {
          effect.update(0);
          await scene.whenReadyAsync();
          drawCalls = 0;
          scene.render();
          const caseHash = await imageHash();
          lifecycle.push({ label, hash: caseHash, draws: drawCalls, expectedDraws, signal: imageSignal });
        };
        effect.fireChainArc(sample, 1);
        await captureCase("world-and-chain", 4);
        for (const mesh of batches) {
          mesh.position.x = 8;
          mesh.computeWorldMatrix(true);
        }
        await captureCase("transformed-batches", 4);
        for (const mesh of batches) {
          mesh.position.x = 0;
          mesh.computeWorldMatrix(true);
        }
        effect.updateHero(sample);
        await captureCase("hero-world-chain", 6);
        const occluder = CreatePlane("depth-control", { size: 200 }, scene);
        occluder.position.z = 50;
        const occluderMaterial = new StandardMaterial("depth-control", scene);
        occluderMaterial.disableLighting = true;
        occluderMaterial.diffuseColor.set(0, 0, 0);
        occluderMaterial.backFaceCulling = false;
        occluder.material = occluderMaterial;
        await captureCase("depth-occluder", 7);
        occluder.dispose();
        occluderMaterial.dispose();
        effect.clear();
        for (let i = 0; i < 32; i++) {
          const start = new Vector3(i * 4 - 60, 0, 0);
          effect.updateRemote(
            `capacity_${i}`,
            { ...sample, start, end: new Vector3(start.x, 0, 150) },
            Vector3.Forward(),
          );
        }
        for (let i = 0; i < 24; i++) {
          const start = new Vector3(i * 4 - 40, 20, 0);
          effect.fireChainArc({ ...sample, start, end: new Vector3(start.x + 30, 20, 150) }, 1);
        }
        await captureCase("full-capacity", 4);
        const capacityCounts = effect.getDebugCounts();
        effect.removeRemote("capacity_15");
        await captureCase("swap-removal", 4);
        const swapCounts = effect.getDebugCounts();
        time += 2;
        effect.update(2);
        await captureCase("expired-empty", 0);
        effect.updateRemote("after-expiry", sample, Vector3.Forward());
        await captureCase("reuse-after-expiry", 2);
        return {
          backend,
          mode,
          frames: 120,
          submittedBytes,
          writeCalls,
          wallMsIncludingReadback,
          imageHash: hash,
          restoration,
          passed:
            signal > 0 &&
            afterRecoverySignal > 0 &&
            restoration !== "pixel mismatch" &&
            emptyDrawCalls === 0 &&
            reuseDrawCalls === 2 &&
            capacityCounts.remote === 32 &&
            capacityCounts.chain === 24 &&
            swapCounts.remote === 31 &&
            lifecycle.every(
              (item) => item.draws === item.expectedDraws && (item.expectedDraws === 0 || item.signal > 0),
            ) &&
            layouts.every((layout) => layout.finiteBounds && layout.alwaysActive),
          signal,
          restoredSignal: afterRecoverySignal,
          measuredDrawCalls,
          sceneActiveIndices,
          statisticsMatchControlledDraws:
            sceneActiveIndices ===
            batches
              .filter((mesh) => mesh.name.startsWith("voltaic_world_"))
              .reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0),
          emptyDrawCalls,
          reuseDrawCalls,
          matrixGpuBytes,
          matrixCpuBytes: [...matrixCpuArrays].reduce((sum, array) => sum + array.byteLength, 0),
          layouts,
          lifecycle,
          capacityCounts,
          swapCounts,
          active: effect.getDebugCounts(),
        };
      } finally {
        engine.updateDynamicVertexBuffer = original;
        engine.drawElementsType = draw;
        effect.dispose();
      }
    }

    new HemisphericLight("light", new Vector3(0, 0, -1), scene);
    const plane = CreatePlane("surface", { size: 2 }, scene);
    const data = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        data.set([30 + x * 12, 30 + y * 12, 100, 255], i);
      }
    const pixels = async () => {
      // Identity/nonidentity UV matrices can select a different Babylon variant.
      await scene.whenReadyAsync();
      scene.render();
      const read = await engine.readPixels(0, 0, 256, 256);
      return new Uint8Array(read.buffer, read.byteOffset, read.byteLength).slice();
    };
    const comparisons = [];
    for (const family of ["standard", "pbr"] as const) {
      for (const feature of ["scroll", "wave", "both"] as const) {
        const reference =
          family === "pbr" ? new PBRMaterial("reference", scene) : new StandardMaterial("reference", scene);
        const candidate =
          family === "pbr" ? new PBRMaterial("candidate", scene) : new StandardMaterial("candidate", scene);
        const textures = [reference, candidate].map((material) => {
          const texture = RawTexture.CreateRGBATexture(data, 16, 16, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
          if (material instanceof PBRMaterial) {
            material.albedoTexture = texture;
            material.metallic = 0;
            material.roughness = 1;
          } else {
            material.diffuseTexture = texture;
            material.specularColor.set(0, 0, 0);
          }
          return texture;
        });
        const scroll = feature === "wave" ? null : { type: "scroll" as const, sSpeed: -0.1, tSpeed: 0.2 };
        const wave =
          feature === "scroll" ? null : { func: "sin" as const, base: 0.6, amplitude: 0.3, phase: 0.1, frequency: 0.5 };
        const plugin = new Q3AnalyticAnimationPlugin(candidate, scroll, wave);
        try {
          plane.material = reference;
          await reference.forceCompilationAsync(plane);
          scene.render();
          plane.material = candidate;
          await candidate.forceCompilationAsync(plane);
          scene.render();
          candidate.freeze();
          for (const time of [0, 0.25, 1.125, -0.25, 1005.25]) {
            textures[0].uOffset = scroll ? (scroll.sSpeed * time) % 1000 : 0;
            textures[0].vOffset = scroll ? (scroll.tSpeed * time) % 1000 : 0;
            const gain = wave ? Math.max(0, Math.min(1, evaluateWaveFunc(wave, time))) : 1;
            if (reference instanceof PBRMaterial) reference.albedoColor.set(gain, gain, gain);
            else reference.diffuseColor.set(gain, gain, gain);
            plugin.setTime(time);
            plane.material = reference;
            const expected = await pixels();
            plane.material = candidate;
            const actual = await pixels();
            let maxDelta = 0,
              changed = 0,
              signal = 0;
            for (let i = 0; i < expected.length; i++) {
              const delta = Math.abs(expected[i] - actual[i]);
              maxDelta = Math.max(maxDelta, delta);
              if (delta > 2) changed++;
              if (expected[i] > 40 && i % 4 !== 3) signal++;
            }
            comparisons.push({
              family,
              feature,
              time,
              maxDelta,
              channelsOverTolerance: changed,
              signal,
              candidateFrozen: candidate.isFrozen,
            });
          }
        } finally {
          reference.dispose();
          candidate.dispose();
          for (const texture of textures) texture.dispose();
        }
      }
    }
    return {
      backend,
      mode,
      comparisons,
      passed: comparisons.every((c) => c.channelsOverTolerance === 0 && c.signal > 0 && c.candidateFrozen),
    };
  } finally {
    scene.dispose();
    engine.dispose();
  }
}
