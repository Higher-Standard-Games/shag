/**
 * SHAG Engine - FPS Mode Entry Point
 *
 * Minimal entry point for FPS development.
 * Loads engine, creates scene, and enters FPS mode with default map.
 * Use console (~ key) to load maps: "map wdm1", "map wda1", etc.
 */

import "./style.css";
import "./engine/ui/styles/WashikiFonts.css"; // Washiki fonts available at startup (before HUD)

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
// Side-effect import for Babylon native collision (used by FreeflyController)
import "@babylonjs/core/Collisions/collisionCoordinator";
import gameJson from "@game/game.json";
import { CameraSystem } from "./engine/camera";
import { FPSController } from "./engine/camera/controllers/FPSController";
import { registerEngineCommands } from "./engine/console/commands";
import { QualityDetector, registerEngineServices, ServiceLocator } from "./engine/core";
import { EngineVersion } from "./engine/core/EngineVersion";
import { GamePaths } from "./engine/core/GamePaths";
import { DebugConsole } from "./engine/debug";
import { TextureManager, TextureMemoryManager } from "./engine/loader";
import { MapLoader } from "./engine/loader/map/MapLoader";
import { PK3Index } from "./engine/loader/pk3/PK3Index";
import { InstancedMeshManager } from "./engine/rendering/InstancedMeshManager";
import {
  createRenderingEngine,
  type RenderingBackend,
  resolveRenderingBackend,
} from "./engine/rendering/RenderingEngineFactory";
import { LoadingScreen } from "./engine/ui/LoadingScreen";
import { MapLoadingOverlay } from "./engine/ui/MapLoadingOverlay";
import { UIScale } from "./engine/ui/UIScale";
import { UITheme } from "./engine/ui/UITheme";
import { LobbyPanel } from "./games/fps/client/LobbyPanel";
import { FPSPlayer } from "./games/fps/FPSPlayer";

interface DebugWindow extends Window {
  __lobbyPanel?: LobbyPanel;
  engine?: AbstractEngine;
  player?: FPSPlayer;
  rendererBackend?: RenderingBackend;
  scene?: Scene;
}

/**
 * Main application entry point.
 */
async function main() {
  const debugWindow = window as DebugWindow;
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

  // Show startup feedback before async WebGPU initialization or WebGL fallback.
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();
  loadingScreen.setStatus("Initializing renderer...");

  // WebGPU remains an explicit test session while Babylon 9 pipeline parity is
  // incomplete. Ignore a previously persisted default-on r_webgpu=1 so users
  // recover to the known-good renderer; ?renderer=webgpu still enables A/B.
  const requestedBackend = resolveRenderingBackend(false, window.location.search);
  const renderer = await createRenderingEngine(canvas, requestedBackend);
  const engine = renderer.engine;
  if (renderer.fallbackReason) {
    console.warn(`[Main] ${renderer.fallbackReason}; using WebGL2`);
  }
  console.log(`[Main] Rendering backend: ${renderer.backend}`);

  // Handle window resize
  window.addEventListener("resize", () => engine.resize());

  // Build PK3 index
  const pk3Index = PK3Index.getInstance();
  pk3Index.setSearchPaths(["data/"]);
  await pk3Index.ensureIndex((msg) => loadingScreen.setStatus(msg));

  // Initialize debug console
  const debugConsole = DebugConsole.getInstance();
  debugConsole.enable();

  // Register engine commands, then fps-specific commands (connect, disconnect, demo*, netsim)
  // and register the fps NetworkConnector so the engine's lobby ConnectingOverlay can
  // initiate a connection without importing fps directly.
  await registerEngineCommands();
  const fpsModule = await import("./games/fps");
  await fpsModule.registerFpsCommands();
  const { registerNetworkConnector } = await import("./engine/ui/components/NetworkConnector");
  registerNetworkConnector(fpsModule.fpsNetworkConnector);
  const { registerGameplayMapLauncher } = await import("./engine/console/GameplayMapLauncher");
  registerGameplayMapLauncher(fpsModule.fpsMapLauncher);

  // Initialize UI
  UIScale.getInstance().init();
  const uiTheme = UITheme.getInstance();
  await uiTheme.loadShareTechMonoFont();

  // Start waiting for user click (non-blocking — runs in parallel)
  const userReadyPromise = loadingScreen.waitForReady();

  // Pipe map loading progress into the splash screen
  const { EventBus } = await import("./engine/core/EventBus");
  const unsubProgress = EventBus.on("loading:progress", (data: any) => {
    if (data?.type === "map" && data?.phase) {
      loadingScreen.setStatus(data.detail || data.phase);
    }
  });

  // ── Engine initialization (runs while user is looking at splash screen) ──

  // Create scene
  console.log("[Main] Creating scene...");
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
  loadingScreen.setStatus("Loading engine settings...");
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
  console.log("[InstancedMeshManager] Initialized");

  // Initialize scene services
  loadingScreen.setStatus("Initializing services...");
  await ServiceLocator.getInstance().initScene(scene);

  // Initialize Physics System
  try {
    loadingScreen.setStatus("Initializing physics...");
    const { PhysicsSystem } = await import("./engine/physics/PhysicsSystem");
    const success = await PhysicsSystem.getInstance().enablePhysics(scene);
    console.log(`[Main] Physics initialized: ${success}`);
  } catch (e) {
    console.error("[Main] Failed to init physics:", e);
  }

  // Initialize camera system
  const cameraSystem = CameraSystem.getInstance();
  cameraSystem.init(scene, canvas);
  cameraSystem.setCamera(camera); // CRITICAL: Register the camera we created
  cameraSystem.registerController("fps", new FPSController());
  cameraSystem.setController("fps");
  const controller = cameraSystem.getController("fps") as FPSController;

  console.log("[Main] FPS controller initialized");

  // Initialize FPSPlayer (Game Logic)
  const player = new FPSPlayer(controller);
  console.log("[Main] FPSPlayer initialized");

  // Check if a map was specified via URL param
  const requestedMap = new URLSearchParams(window.location.search).get("map");

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
      const fpsController = cameraSystem.getController("fps");
      if (fpsController && "setPosition" in fpsController) {
        (fpsController as FPSController).setPosition(result.playerStartPosition);
      } else {
        camera.position.copyFrom(result.playerStartPosition);
      }
    } else {
      console.error(`[Main] Failed to load map: ${requestedMap}`);
    }
  } else {
    // ── Lobby (no 3D background — will use background image in future) ──
    loadingScreen.setStatus("Loading lobby...");
    await userReadyPromise;

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
    debugWindow.__lobbyPanel = lobby;
  }

  // Hide lobby when a GAMEPLAY map starts loading (network connect, console map cmd, etc.)
  // Uses loading:start (not map:loaded) so it fires IMMEDIATELY, not after map finishes.
  import("./engine/core/EventBus").then(({ EventBus }) => {
    EventBus.on("loading:start", (data: any) => {
      if (data?.type !== "map") return;
      // Don't hide for background ui map
      if (data?.id === "ui") return;

      const lobby = debugWindow.__lobbyPanel;
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
  debugWindow.scene = scene;
  debugWindow.engine = engine;
  debugWindow.rendererBackend = renderer.backend;
  debugWindow.player = player;

  console.log('[Main] FPS mode ready. Press ~ for console, use "map <name>" to load maps.');
}

// showPlaceholderUI replaced by LobbyPanel (see above)

main().catch(console.error);
