import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { gateSkinPreparation } from "../animation/SkinPreparationGate";
import { devLog } from "../core/DevLog";
import { QualityDetector } from "../core/QualityDetector";
import { ServiceLocator } from "../core/ServiceLocator";
import { TextureManager, TextureMemoryManager } from "../loader";
import { InstancedMeshManager } from "../rendering/InstancedMeshManager";
import {
  createRenderingEngine,
  resolveRenderingBackend,
  resolveWebGPUNonCompatibilityMode,
} from "../rendering/RenderingEngineFactory";
import { applySceneRendererPolicy } from "../rendering/SceneRendererPolicy";
import { WorldFogController } from "../rendering/WorldFogController";

/** Create a renderer using the engine's supported backend/fallback policy. */
export async function createBrowserRenderer(canvas: HTMLCanvasElement, search: string) {
  // WebGPU is an explicit URL opt-in while renderer parity is under validation.
  // Persisted backend preferences do not override the default WebGL policy.
  return createRenderingEngine(canvas, resolveRenderingBackend(false, search), undefined, {
    nonCompatibilityMode: resolveWebGPUNonCompatibilityMode(search),
  });
}

/** Install scene policy before the application creates cameras or materials. */
export function createBrowserScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.preventDefaultOnPointerDown = false;
  applySceneRendererPolicy(scene);
  gateSkinPreparation(scene);
  WorldFogController.getInstance();
  scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
  scene.ambientColor = new Color3(1, 1, 1);
  scene.collisionsEnabled = true;
  scene.autoClear = true;
  scene.skipPointerMovePicking = true;
  scene.blockMaterialDirtyMechanism = false;
  return scene;
}

/** Initialize after the application supplies its active camera and core services. */
export async function initializeBrowserScene(scene: Scene, onStatus: (status: string) => void): Promise<void> {
  // Initialize texture systems
  TextureManager.getInstance().init(scene);
  // Initialize TextureMemoryManager with auto-detected quality
  const qualityDetector = QualityDetector.getInstance();
  const { quality, deviceInfo } = qualityDetector.detectQuality();

  TextureMemoryManager.getInstance().init(scene, {
    memoryBudgetMB: qualityDetector.getRecommendedTextureBudget(),
    maxTextureSize: qualityDetector.getRecommendedMaxTextureSize(),
  });
  TextureMemoryManager.getInstance().setQuality(quality);
  devLog(`[Main] Texture quality: ${quality} (${deviceInfo.type}, GPU tier ${deviceInfo.gpuTier})`);

  // Load engine settings
  onStatus("Loading engine settings...");
  const { EngineSettings } = await import("../core/EngineSettings");
  await EngineSettings.getInstance().load();

  // Initialize SkyLightSystem (for ambient lighting)
  const { SkyLightSystem } = await import("../lighting/SkyLightSystem");
  const lightingSettings = EngineSettings.getInstance().getLightingSettings();
  SkyLightSystem.getInstance().init(scene, {
    sunIntensity: lightingSettings.sunIntensity,
    moonIntensity: lightingSettings.moonIntensity,
    ambientIntensity: lightingSettings.ambientIntensity,
    enableShadows: lightingSettings.enableShadows,
  });

  // Initialize InstancedMeshManager
  InstancedMeshManager.getInstance().init(scene);
  devLog("[InstancedMeshManager] Initialized");

  // Initialize scene services
  onStatus("Initializing services...");
  // GlowEffect + SSREffect are registered scene services (EngineServices), so
  // initScene binds them to this scene and re-binds them on every scene rebuild.
  await ServiceLocator.getInstance().initScene(scene);

  // Initialize Physics System
  try {
    onStatus("Initializing physics...");
    const { PhysicsSystem } = await import("../physics/PhysicsSystem");
    const success = await PhysicsSystem.getInstance().enablePhysics(scene);
    devLog(`[Main] Physics initialized: ${success}`);
  } catch (e) {
    console.error("[Main] Failed to init physics:", e);
  }
}
