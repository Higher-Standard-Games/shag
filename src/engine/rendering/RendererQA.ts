import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import {
  beginRendererValidation,
  observeRendererDevice,
  RendererDiagnostics,
  type RendererQAReport,
  waitForRendererGPU,
} from "./RendererDiagnostics";
import { createRenderingEngine, resolveRenderingBackend } from "./RenderingEngineFactory";
import { applySceneRendererPolicy } from "./SceneRendererPolicy";

/** Isolated opt-in smoke test. No PK3, game services, input capture or saved settings. */
export async function runRendererQA(canvas: HTMLCanvasElement, search: string): Promise<RendererQAReport> {
  const testCase = new URLSearchParams(search).get("rendererqacase");
  const refreshFrozen = testCase === "lights-refresh";
  const testLights = testCase === "lights" || refreshFrozen;
  const output = document.createElement("pre");
  output.id = "renderer-qa-report";
  output.style.cssText =
    "position:fixed;top:0;left:0;max-height:80vh;max-width:55vw;overflow:auto;z-index:10000;background:#111d;color:#eee;padding:12px;font:12px monospace;white-space:pre-wrap";
  document.body.append(output);
  const diagnostics = new RendererDiagnostics(
    resolveRenderingBackend(false, search),
    (report) => {
      output.textContent = JSON.stringify(report, null, 2);
      (window as Window & { rendererQAReport?: RendererQAReport }).rendererQAReport = report;
    },
    refreshFrozen ? "standard-pbr-lights-refresh" : testLights ? "standard-pbr-lights" : "standard-pbr-smoke",
  );
  let engine: AbstractEngine | undefined;
  let scene: Scene | undefined;
  let stopped = false;
  let frameHandle: number | undefined;
  let removeDeviceListener = () => {};
  const onError = (event: ErrorEvent) => diagnostics.fail(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => diagnostics.fail(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  try {
    const renderer = await diagnostics.runStage("engine-initialization", async () => {
      const result = await createRenderingEngine(canvas, diagnostics.report.requestedBackend);
      // A timed-out initialization may finish later; never orphan its engine.
      if (stopped) {
        result.engine.dispose();
        throw new Error("QA initialization already timed out");
      }
      engine = result.engine;
      return result;
    });
    engine = renderer.engine;
    diagnostics.attachEngine(engine, renderer.fallbackReason, renderer.fallbackStage);
    removeDeviceListener = observeRendererDevice(engine, (error) => diagnostics.fail(error));
    scene = new Scene(engine);
    scene.clearColor = new Color4(0.03, 0.05, 0.08, 1);
    applySceneRendererPolicy(scene);
    const camera = new FreeCamera("qa-camera", new Vector3(0, 1, -5), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    new HemisphericLight("qa-light", new Vector3(0, 1, -1), scene);
    const extraLights = testLights
      ? Array.from({ length: 10 }, (_, index) => {
          const light = new PointLight(`qa-point-${index}`, new Vector3((index % 3) - 1, 2, -2), scene);
          light.intensity = 0.1;
          light.setEnabled(false);
          return light;
        })
      : [];
    const mesh = CreateBox("qa-box", { size: 1.5 }, scene);
    const standard = new StandardMaterial("qa-standard", scene);
    standard.diffuseColor = new Color3(0.15, 0.65, 0.95);
    const pbr = new PBRMaterial("qa-pbr", scene);
    pbr.albedoColor = new Color3(0.95, 0.5, 0.15);
    pbr.metallic = 0;
    pbr.roughness = 0.65;
    applySceneRendererPolicy(scene);
    for (const material of [standard, pbr]) {
      mesh.material = material;
      material.onError = (_effect, errors) => diagnostics.fail(errors);
      const phases = testLights
        ? ["one-light", "many-lights", "frozen-many", "frozen-one", "frozen-restored"]
        : ["main"];
      for (const phase of phases) {
        if (phase === "one-light") for (const light of extraLights) light.setEnabled(false);
        if (phase === "many-lights" || phase === "frozen-restored")
          for (const light of extraLights) light.setEnabled(true);
        if (phase === "frozen-many") material.freeze();
        if (phase === "frozen-one") for (const light of extraLights) light.setEnabled(false);
        // Explicit control experiment: Babylon's frozen readiness shortcut can
        // retain old light defines even after the mesh's light list changes.
        // The raw `lights` case deliberately leaves that behavior observable.
        if (refreshFrozen && (phase === "frozen-one" || phase === "frozen-restored")) material.markDirty(true);
        const context = { material: material.name, mesh: mesh.name, pass: phase };
        const closeValidation = beginRendererValidation(engine);
        try {
          await diagnostics.runStage("shader-compilation", () => material.forceCompilationAsync(mesh), context);
          const activeScene = scene;
          const activeEngine = engine;
          await diagnostics.runStage(
            "render",
            async () => {
              for (let frame = 0; frame < 3; frame++) {
                await new Promise<void>((resolve) => {
                  frameHandle = requestAnimationFrame(() => {
                    frameHandle = undefined;
                    resolve();
                  });
                });
                if (stopped || diagnostics.report.status === "failed") return;
                activeEngine.beginFrame();
                activeScene.render();
                activeEngine.endFrame();
                diagnostics.frame();
              }
              await waitForRendererGPU(activeEngine);
              // Give uncaptured GPU validation errors a task turn to be delivered.
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            },
            context,
          );
          await diagnostics.runStage("gpu-validation", closeValidation, context);
          await diagnostics.runStage(
            "fixture-evidence",
            async () => {
              const effect = mesh.subMeshes[0].effect;
              if (!effect?.isReady()) throw new Error("Fixture has no ready draw effect");
              const compiledLights = (effect.defines.match(/^#define LIGHT\d+\s*$/gm) ?? []).length;
              diagnostics.fixture({
                material: material.name,
                phase,
                cap: material.maxSimultaneousLights,
                activeLights: mesh.lightSources.length,
                compiledLights,
                frozen: material.isFrozen,
              });
              const expected = Math.min(mesh.lightSources.length, material.maxSimultaneousLights);
              if (compiledLights !== expected) {
                throw new Error(
                  `Fixture compiled ${compiledLights} lights; expected ${expected} with cap ${material.maxSimultaneousLights}`,
                );
              }
            },
            context,
          );
        } finally {
          // Pop even when compilation times out. Do not wait indefinitely while
          // handling an earlier failure; the first failure remains authoritative.
          void closeValidation().catch((error) => diagnostics.fail(error));
        }
      }
      material.unfreeze();
    }
    diagnostics.complete();
  } catch (error) {
    diagnostics.fail(error);
  } finally {
    stopped = true;
    if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    removeDeviceListener();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    try {
      scene?.dispose();
    } catch (error) {
      diagnostics.fail(error);
    }
    try {
      engine?.dispose();
    } catch (error) {
      diagnostics.fail(error);
    }
  }
  const report = diagnostics.report;
  console.log("RENDERER_QA_REPORT", JSON.stringify(report));
  return report;
}
