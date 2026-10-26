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
import { VoltaicEffectRenderer } from "../../weapon/voltaic/VoltaicEffectRenderer";
import { createRenderingEngine, type RenderingBackend } from "../RenderingEngineFactory";

/** Isolated development fixture, imported by scripts/benchmarks/renderer-groundwork.mjs only. */
export async function runGroundworkFixture(
  backend: RenderingBackend,
  mode: "effects" | "materials",
  reference = false,
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
    if (mode === "effects") {
      camera.position.set(0, 20, -200);
      camera.setTarget(new Vector3(0, 0, 100));
      let time = 1;
      const referencePath = "/.cache/renderer-groundwork/VoltaicReference.ts";
      const Renderer = reference
        ? (await import(/* @vite-ignore */ referencePath)).VoltaicEffectRenderer
        : VoltaicEffectRenderer;
      const effect = new Renderer(scene, () => time);
      let bytes = 0,
        writes = 0;
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
        bytes = 0;
        writes = 0;
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
        let restoration = "not requested";
        if (!engine.isWebGPU && !reference) {
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
        return {
          backend,
          mode,
          frames: 120,
          submittedBytes,
          writeCalls,
          wallMsIncludingReadback,
          imageHash: hash,
          restoration,
          passed: signal > 0 && imageSignal > 0 && restoration !== "pixel mismatch",
          signal,
          restoredSignal: imageSignal,
          active: effect.getDebugCounts(),
        };
      } finally {
        engine.updateDynamicVertexBuffer = original;
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
