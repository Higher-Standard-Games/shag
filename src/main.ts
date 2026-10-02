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
import { CapacitorBridge } from "./engine/core/CapacitorBridge";
import { EngineVersion } from "./engine/core/EngineVersion";
import { GamePaths } from "./engine/core/GamePaths";
import { DebugConsole } from "./engine/debug";
import { TextureManager, TextureMemoryManager } from "./engine/loader";
import { PK3Index } from "./engine/loader/pk3/PK3Index";
import { InstancedMeshManager } from "./engine/rendering/InstancedMeshManager";
import {
  installRendererRuntimeDiagnostics,
  type RendererRuntimeReport,
} from "./engine/rendering/RendererRuntimeDiagnostics";
import {
  type ActualRenderingBackend,
  createRenderingEngine,
  resolveRenderingBackend,
} from "./engine/rendering/RenderingEngineFactory";
import { applySceneRendererPolicy } from "./engine/rendering/SceneRendererPolicy";
import { LoadingScreen } from "./engine/ui/LoadingScreen";
import { MapLoadingOverlay } from "./engine/ui/MapLoadingOverlay";
import { TransferLoadingView } from "./engine/ui/TransferLoadingView";
import { UIScale } from "./engine/ui/UIScale";
import { UITheme } from "./engine/ui/UITheme";
import { LobbyPanel } from "./games/fps/client/LobbyPanel";
import { FPSPlayer } from "./games/fps/FPSPlayer";

/** How long past the player's click the start-up screen waits for the lobby to log them in */
const LOBBY_ANSWER_WAIT_MS = 4000;

interface DebugWindow extends Window {
  __lobbyPanel?: LobbyPanel;
  engine?: AbstractEngine;
  player?: FPSPlayer;
  rendererBackend?: ActualRenderingBackend;
  rendererRuntimeReport?: RendererRuntimeReport;
  scene?: Scene;
}

/**
 * Main application entry point.
 */
async function main() {
  const debugWindow = window as DebugWindow;
  if (new URLSearchParams(window.location.search).get("rendererqa") === "1") {
    const { runRendererQA } = await import("./engine/rendering/RendererQA");
    await runRendererQA(document.getElementById("renderCanvas") as HTMLCanvasElement, window.location.search);
    return;
  }

  // Platform classes, mobile CSS and the native lifecycle, before anything
  // draws. No-ops in a browser beyond the touch-device class.
  const capacitor = CapacitorBridge.getInstance();
  await capacitor.init();

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

  let canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

  // Show startup feedback before async WebGPU initialization or WebGL fallback.
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();
  loadingScreen.setStatus("Initializing renderer...");

  // The native splash is configured not to hide itself, so it waits for this.
  // Now is the moment: our own loading screen is up and showing progress, and
  // holding the splash any longer would hide that progress behind a still
  // image. No-op off a device.
  void capacitor.hideSplashScreen();

  // WebGPU remains an explicit test session while Babylon 9 pipeline parity is
  // incomplete. Ignore a previously persisted default-on r_webgpu=1 so users
  // recover to the known-good renderer; ?renderer=webgpu still enables A/B.
  const requestedBackend = resolveRenderingBackend(false, window.location.search);
  const renderer = await createRenderingEngine(canvas, requestedBackend);
  canvas = renderer.canvas;
  const engine = renderer.engine;
  if (renderer.fallbackReason) {
    console.warn(`[Main] ${renderer.fallbackReason}; using ${renderer.backend}`);
  }
  console.log(`[Main] Rendering backend: ${renderer.backend}`);
  const rendererDiagnostics = installRendererRuntimeDiagnostics(engine, (report) => {
    debugWindow.rendererRuntimeReport = report;
    // Keep the console record copyable; the complete history remains on window.
    console.error(`RENDERER_RUNTIME_REPORT ${JSON.stringify({ ...report, errors: report.errors.slice(-1) })}`);
  });

  // Handle window resize
  window.addEventListener("resize", () => engine.resize());

  // Build PK3 index
  const pk3Index = PK3Index.getInstance();
  pk3Index.setSearchPaths(["data/"]);
  loadingScreen.setStep("packages");
  await pk3Index.ensureIndex((msg) => loadingScreen.setStatus(msg));
  loadingScreen.setStep("engine");

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
  applySceneRendererPolicy(scene);
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
  // GlowEffect + SSREffect are registered scene services (EngineServices), so
  // initScene binds them to this scene and re-binds them on every scene rebuild.
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

  // ── Lobby (no 3D background — will use background image in future) ──
  // Every map is played on a server the lobby spawns; the client loads it on join.
  // The lobby is built behind the start-up screen: it connects and logs in
  // while the player is still looking at it, so it appears knowing who they
  // are, and a new player sees the name screen at once instead of the lobby
  // for a moment first. A lobby slow to answer is not waited on for long.
  loadingScreen.setStep("lobby");
  loadingScreen.setStatus("Connecting to the lobby...");
  const lobby = new LobbyPanel();
  await userReadyPromise;
  await Promise.race([lobby.connected, new Promise((resolve) => setTimeout(resolve, LOBBY_ANSWER_WAIT_MS))]);

  // Stop piping progress to splash screen
  unsubProgress();

  // Enable overlay for future map loads (e.g., joining a match), in the look of
  // the match handoff that comes before it
  MapLoadingOverlay.configure({ view: () => new TransferLoadingView() });
  MapLoadingOverlay.enable();

  // Hide splash → show lobby: the player has clicked, and the lobby has answered
  loadingScreen.hide();
  lobby.show();

  // Connect play button (Phase 1: just log; Phase 2+: real matchmaking)
  lobby.setOnPlay((mode) => {
    console.log(`[Lobby] Queue for mode: ${mode}`);
  });

  // Store lobby reference for gameplay map transitions
  debugWindow.__lobbyPanel = lobby;

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
    try {
      const deltaTime = engine.getDeltaTime() / 1000.0;

      // Update game logic
      player.update(deltaTime);

      scene.render();
    } catch (error) {
      rendererDiagnostics.recordRenderError(error);
      throw error;
    }
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
