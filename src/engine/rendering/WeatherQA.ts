import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PrecipitationEffect, type PrecipitationType } from "../effects/RainEffect";
import { beginRendererValidation, type RendererDiagnostics, waitForRendererGPU } from "./RendererDiagnostics";

/** Frames simulated before the pixel sample: several rain lifetimes, about one second. */
export const WEATHER_QA_FRAMES = 60;
/** A pixel counts as lit when any channel clears the black clear colour by this much. */
const LIT_THRESHOLD = 16;
/** Sparse additive streaks: a few hundred pixels at 1280x720 is ample signal. */
export const WEATHER_QA_MIN_LIT_PIXELS = 50;

/** The simulation the engine's capabilities promise, independent of what the effect chose. */
export function expectedPrecipitationBackend(engine: AbstractEngine): "gpu" | "cpu" {
  const caps = engine.getCaps();
  return (engine.isWebGPU ? caps.supportComputeShaders : caps.supportTransformFeedbacks) ? "gpu" : "cpu";
}

export function countLitPixels(bytes: ArrayBufferView): number {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length % 4 !== 0) {
    throw new Error("Expected non-empty RGBA8 GPU readback");
  }
  let lit = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i] > LIT_THRESHOLD || bytes[i + 1] > LIT_THRESHOLD || bytes[i + 2] > LIT_THRESHOLD) lit++;
  }
  return lit;
}

/**
 * Rain and snow through the production PrecipitationEffect: the simulation
 * backend must match the engine's capabilities, particles must reach the
 * framebuffer, and an immediate stop must leave nothing drawn.
 */
export async function runWeatherQA(scene: Scene, diagnostics: RendererDiagnostics, stopped: () => boolean) {
  const engine = scene.getEngine();
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.imageProcessingConfiguration.isEnabled = false;
  const camera = new FreeCamera("weather-qa-camera", new Vector3(0, 0, 0), scene);
  camera.setTarget(new Vector3(0, 40, 200));
  scene.activeCamera = camera;
  const precipitation = new PrecipitationEffect(scene);
  const expected = expectedPrecipitationBackend(engine);
  const width = engine.getRenderWidth();
  const height = engine.getRenderHeight();

  const renderAndCount = async (frames: number, context: { material: string; mesh: string; pass: string }) => {
    let litPixels = 0;
    const closeValidation = beginRendererValidation(engine);
    try {
      await diagnostics.runStage(
        "weather-render",
        async () => {
          if (width < 128 || height < 128) throw new Error("Weather QA requires a canvas at least 128x128");
          for (let frame = 0; frame < frames; frame++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
            if (stopped() || diagnostics.report.status === "failed") return;
            engine.beginFrame();
            try {
              scene.render();
              if (frame === frames - 1) litPixels = countLitPixels(await engine.readPixels(0, 0, width, height));
            } finally {
              if (!stopped()) engine.endFrame();
            }
            diagnostics.frame();
          }
          await waitForRendererGPU(engine);
        },
        context,
      );
      await diagnostics.runStage("weather-gpu-validation", closeValidation, context);
    } finally {
      void closeValidation().catch((error) => diagnostics.fail(error));
    }
    return litPixels;
  };

  try {
    for (const type of ["rain", "snow"] as PrecipitationType[]) {
      if (stopped()) return;
      const material = `precipitation-${type}`;
      if (type === "rain") precipitation.startRain({ intensity: 1 });
      else precipitation.startSnow({ intensity: 1 });
      const system = precipitation.getParticleSystem();
      const backend = precipitation.getSimulationBackend();
      const running = { material, mesh: "precipEmitter", pass: "running" };
      await diagnostics.runStage(
        "weather-compilation",
        async () => {
          if (!system || !backend) throw new Error("Precipitation did not create a particle system");
          while (!system.isReady()) {
            if (stopped()) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
            engine.beginFrame();
            scene.render();
            engine.endFrame();
          }
        },
        running,
      );
      const litPixels = await renderAndCount(WEATHER_QA_FRAMES, running);
      await diagnostics.runStage(
        "weather-pixel-evidence",
        async () => {
          diagnostics.fixture({
            material,
            phase: "running",
            cap: 0,
            activeLights: 0,
            compiledLights: 0,
            frozen: false,
            particleBackend: backend!,
            activeParticles: system!.getActiveCount(),
            litPixels,
            viewport: { width, height },
          });
          if (backend !== expected)
            throw new Error(`Precipitation simulated on ${backend}; capabilities promise ${expected}`);
          if (litPixels < WEATHER_QA_MIN_LIT_PIXELS) throw new Error(`Only ${litPixels} lit pixels from ${type}`);
        },
        running,
      );

      precipitation.stop(true);
      const cleared = { material, mesh: "precipEmitter", pass: "stopped" };
      const remaining = await renderAndCount(3, cleared);
      await diagnostics.runStage(
        "weather-pixel-evidence",
        async () => {
          diagnostics.fixture({
            material,
            phase: "stopped",
            cap: 0,
            activeLights: 0,
            compiledLights: 0,
            frozen: false,
            particleBackend: backend!,
            litPixels: remaining,
            viewport: { width, height },
          });
          if (precipitation.getParticleSystem()) throw new Error("Stopped precipitation kept its particle system");
          if (remaining > 0) throw new Error(`${remaining} pixels still lit after an immediate stop`);
        },
        cleared,
      );
    }
  } finally {
    precipitation.dispose();
  }
}
