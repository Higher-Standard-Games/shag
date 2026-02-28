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
import { LobbyPanel } from "./engine/ui/panels/LobbyPanel";
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

  // Start waiting for user click (non-blocking — runs in parallel)
  const userReadyPromise = loadingScreen.waitForReady();

  // Pipe map loading progress into the splash screen
  const { EventBus } = await import('./engine/core/EventBus');
  const unsubProgress = EventBus.on('loading:progress', (data: any) => {
    if (data?.type === 'map' && data?.phase) {
      loadingScreen.setStatus(data.detail || data.phase);
    }
  });

  // ── Engine initialization (runs while user is looking at splash screen) ──

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
  loadingScreen.setStatus('Loading engine settings...');
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
  loadingScreen.setStatus('Initializing services...');
  await ServiceLocator.getInstance().initScene(scene);

  // Initialize Physics System
  try {
    loadingScreen.setStatus('Initializing physics...');
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
    // Wait for user click before switching to MapLoadingOverlay
    await userReadyPromise;
    loadingScreen.hide();

    // Enable map loading overlay for explicit map loads
    MapLoadingOverlay.enable();

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
    // ── Load UI map as lobby background (runs while splash is still showing) ──
    loadingScreen.setStatus('Loading lobby...');
    console.log('[Main] Loading ui map as lobby background...');
    const mapLoader = MapLoader.getInstance();
    const bgResultPromise = mapLoader.loadMap('ui', scene, undefined, { backgroundOnly: true });

    // Wait for BOTH: user click AND background map loaded
    const [, bgResult] = await Promise.all([userReadyPromise, bgResultPromise]);

    if (bgResult.success && bgResult.playerStartPosition) {
      camera.position.copyFrom(bgResult.playerStartPosition);
      console.log(`[Main] Background map loaded: ui`);
    }

    // Stop piping progress to splash screen
    unsubProgress();

    // Enable overlay for future map loads (e.g., joining a match)
    MapLoadingOverlay.enable();

    // Hide splash → show lobby (seamless: both click AND map are ready)
    loadingScreen.hide();

    // Show lobby UI — main menu on top of the 3D background
    const lobby = new LobbyPanel();
    lobby.show();

    // Connect play button (Phase 1: just log; Phase 2+: real matchmaking)
    lobby.setOnPlay((mode) => {
      console.log(`[Lobby] Queue for mode: ${mode}`);
    });

    // Store lobby reference for gameplay map transitions
    (window as any).__lobbyPanel = lobby;
  }

  // Hide lobby when a GAMEPLAY map starts loading (network connect, console map cmd, etc.)
  // Uses loading:start (not map:loaded) so it fires IMMEDIATELY, not after map finishes.
  import('./engine/core/EventBus').then(({ EventBus }) => {
    EventBus.on('loading:start', (data: any) => {
      if (data?.type !== 'map') return;
      // Don't hide for background ui map
      if (data?.id === 'ui') return;

      const lobby = (window as any).__lobbyPanel as LobbyPanel | undefined;
      if (lobby?.isVisible()) {
        lobby.hide();
        console.log(`[Main] Lobby hidden (map loading: ${data?.id})`);
      }
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

// showPlaceholderUI replaced by LobbyPanel (see above)

main().catch(console.error);
