/**
 * SHAG Engine - FPS Mode Entry Point
 * 
 * Minimal entry point for FPS development.
 * Loads engine, creates scene, and enters FPS mode with default map.
 * Use console (~ key) to load maps: "map wdm1", "map wda1", etc.
 */

import "./style.css";
console.log("ANTIGRAVITY_DEBUG_ACTIVE: " + Date.now());
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/loaders/glTF";
// Side-effect import for Babylon native collision (used by FreeflyController)
import "@babylonjs/core/Collisions/collisionCoordinator";
import { registerEngineServices, ServiceLocator, QualityDetector } from "./engine/core";
import { LoadingScreen } from "./engine/ui/LoadingScreen";
import { MapLoadingOverlay } from "./engine/ui/MapLoadingOverlay";
import { UITheme } from "./engine/ui/UITheme";
import { UIScale } from "./engine/ui/UIScale";
import { DebugConsole } from "./engine/debug";
import { registerEngineCommands } from "./engine/console/commands";
import { GamePaths } from "./engine/core/GamePaths";
import { EngineVersion } from "./engine/core/EngineVersion";
import { PK3Index } from "./engine/loader/pk3/PK3Index";
import { MapLoader } from "./engine/loader/map/MapLoader";
import { CameraSystem } from "./engine/camera";
import { FPSController } from "./engine/camera/controllers/FPSController";
import { TextureManager, TextureMemoryManager } from "./engine/loader";
import { InstancedMeshManager } from "./engine/rendering/InstancedMeshManager";
import { FPSPlayer } from "./games/fps/FPSPlayer";
import gameJson from "@game/game.json";

/**
 * Main application entry point.
 */
async function main() {
  // Initialize GamePaths
  await GamePaths.getInstance().init(gameJson.displayName);

  // Set browser title
  EngineVersion.getInstance().setDocumentTitle();

  // Register engine services
  registerEngineServices();

  // Initialize core services
  await ServiceLocator.getInstance().initCore();

  // Auto-detect quality
  const qualityRecommendation = QualityDetector.getInstance().detectQuality();
  console.log(`[Main] Device: ${qualityRecommendation.deviceInfo.type}, Quality: ${qualityRecommendation.quality}`);

  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

  // Create engine
  const engine = new Engine(canvas, true, { stencil: false });

  // Handle window resize
  window.addEventListener("resize", () => engine.resize());

  // Loading screen
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();

  // Build PK3 index
  const pk3Index = PK3Index.getInstance();
  pk3Index.setSearchPaths(['data/']);
  await pk3Index.ensureIndex((msg) => loadingScreen.setStatus(msg));

  // Initialize debug console
  const debugConsole = DebugConsole.getInstance();
  debugConsole.enable();

  // Register engine commands
  await registerEngineCommands();

  // Initialize UI
  UIScale.getInstance().init();
  const uiTheme = UITheme.getInstance();
  await uiTheme.loadNunitoFont();
  await uiTheme.loadShareTechMonoFont();

  // Wait for user click
  await loadingScreen.waitForReady();
  loadingScreen.hide();

  // Enable map loading overlay
  // Enable map loading overlay
  MapLoadingOverlay.enable();

  // Create scene
  console.log('[Main] Creating scene...');
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
  scene.ambientColor = new Color3(1, 1, 1); // Required for BSP lightmaps to render
  scene.collisionsEnabled = true;
  scene.autoClear = true;
  scene.skipPointerMovePicking = true; // Performance optimization
  scene.blockMaterialDirtyMechanism = false; // CRITICAL: Allow material updates after texture assignment

  // Create FPS camera
  const camera = new FreeCamera("fpsCamera", new Vector3(0, 50, 0), scene);
  camera.attachControl(canvas, true);
  camera.minZ = 1.0; // Match EngineScene default to prevent depth issues
  camera.maxZ = 10000;
  scene.activeCamera = camera;
  scene.autoClear = true; // Ensure buffer clearing matches EngineScene

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
  console.log(`[Main] Texture quality: ${quality} (${deviceInfo.type}, GPU tier ${deviceInfo.gpuTier})`);

  // Load engine settings
  const { EngineSettings } = await import("./engine/core/EngineSettings");
  await EngineSettings.getInstance().load();

  // Initialize SkyLightSystem (for ambient lighting)
  const { SkyLightSystem } = await import("./engine/lighting/SkyLightSystem");
  const lightingSettings = EngineSettings.getInstance().getLightingSettings();
  SkyLightSystem.getInstance().init(scene, {
    sunIntensity: lightingSettings.sunIntensity,
    moonIntensity: lightingSettings.moonIntensity,
    ambientIntensity: lightingSettings.ambientIntensity,
    enableShadows: lightingSettings.enableShadows,
  });

  // Initialize InstancedMeshManager
  InstancedMeshManager.getInstance().init(scene);
  console.log('[InstancedMeshManager] Initialized');

  // Initialize scene services
  await ServiceLocator.getInstance().initScene(scene);

  // Initialize Physics System
  try {
    const { PhysicsSystem } = await import('./engine/physics/PhysicsSystem');
    const success = await PhysicsSystem.getInstance().enablePhysics(scene);
    console.log(`[Main] Physics initialized: ${success}`);
  } catch (e) {
    console.error('[Main] Failed to init physics:', e);
  }

  // Initialize camera system
  const cameraSystem = CameraSystem.getInstance();
  cameraSystem.init(scene, canvas);
  cameraSystem.setCamera(camera); // CRITICAL: Register the camera we created
  cameraSystem.registerController('fps', new FPSController());
  cameraSystem.setController('fps');
  const controller = cameraSystem.getController('fps') as FPSController;

  console.log('[Main] FPS controller initialized');

  // Initialize FPSPlayer (Game Logic)
  const player = new FPSPlayer(controller);
  console.log('[Main] FPSPlayer initialized');

  // Check if a map was specified via URL param
  const requestedMap = new URLSearchParams(window.location.search).get('map');

  if (requestedMap) {
    // Load map if specified in URL
    console.log(`[Main] Loading map from URL: ${requestedMap}`);
    const mapLoader = MapLoader.getInstance();
    const result = await mapLoader.loadMap(requestedMap, scene);

    if (result.success && result.playerStartPosition) {
      console.log(`[Main] Map loaded: ${requestedMap}`);
      const fpsController = cameraSystem.getController('fps');
      if (fpsController && 'setPosition' in fpsController) {
        (fpsController as FPSController).setPosition(result.playerStartPosition);
      } else {
        camera.position.copyFrom(result.playerStartPosition);
      }
    } else {
      console.error(`[Main] Failed to load map: ${requestedMap}`);
    }
  } else {
    // Show placeholder UI - no map specified
    showPlaceholderUI();
  }

  // Import EventBus async
  import('./engine/core/EventBus').then(({ EventBus }) => {
    const unsubscribe = EventBus.on('map:loaded', () => {
      const el = document.getElementById('placeholder-ui');
      if (el) {
        el.style.transition = 'opacity 0.3s ease';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
        console.log('[Main] Placeholder UI removed');
      }
      unsubscribe();
    });
  });

  // Start render loop
  engine.runRenderLoop(() => {
    const deltaTime = engine.getDeltaTime() / 1000.0;

    // Update game logic
    player.update(deltaTime);

    scene.render();
  });

  // Expose for debug
  (window as any).scene = scene;
  (window as any).engine = engine;
  (window as any).player = player;

  console.log('[Main] FPS mode ready. Press ~ for console, use "map <name>" to load maps.');
}

function showPlaceholderUI() {
  const container = document.createElement('div');
  container.id = 'placeholder-ui';
  container.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: #fff;
    font-family: 'Share Tech Mono', monospace;
    z-index: 100;
    pointer-events: none;
  `;
  container.innerHTML = `
    <h1 style="font-size: 24px; margin: 0 0 20px;">SHAG Engine - FPS Mode</h1>
    <p style="margin: 10px 0; font-size: 14px; color: #888;">Press <code style="background: #333; padding: 2px 6px; border-radius: 3px; color: #0f0;">~</code> to open console</p>
    <p style="margin: 10px 0; font-size: 14px; color: #888;">Type <code style="background: #333; padding: 2px 6px; border-radius: 3px; color: #0f0;">map wdm1</code> to load a map</p>
    <p style="margin: 20px 0 0; font-size: 12px; color: #666;">Or add <code>?map=wdm1</code> to URL</p>
  `;
  document.body.appendChild(container);
  console.log('[Main] Placeholder UI shown');
}

main().catch(console.error);
