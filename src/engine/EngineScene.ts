/**
 * EngineScene - Base scene class for the SHAG Engine
 * 
 * Provides core scene functionality that any game can use:
 * - Scene creation and camera setup
 * - Camera modes (perspective, orthographic, fake_ortho)
 * - Map loading via MapRenderer
 * - Weather effects (rain, snow, fog, wind, debris)
 * - Post-processing effects
 * - Input system initialization
 * - Screen transitions
 * - Performance mode (FPS throttling)
 * 
 * Games should extend this class and override the hook methods:
 * - onSceneCreated() - Initialize game-specific systems
 * - onMapLoaded() - Handle map load events
 * - onRenderLoopStart() - Initialize game UI and start game logic
 * - onUpdate() - Per-frame game updates
 * - onDispose() - Clean up game resources
 */

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { TextureManager } from "./loader";
import { MapLoader } from "./loader/map/MapLoader";
import { CameraSystem, IsometricController } from "./camera";
import { InputSystem } from "./input";
import { SpriteManager } from "./sprites/SpriteManager";
import { AssetLoader } from "./AssetLoader";
import { MapRenderer } from "./MapRenderer";
import { SkyLightSystem } from "./lighting/SkyLightSystem";
import { StreetLampSystem } from "./lighting/StreetLampSystem";
import { WorldIndicatorSystem } from "./core/WorldIndicatorSystem";
import { BuildableSystem } from "./BuildableSystem";
import { ScreenTransition } from "./effects/ScreenTransition";
import { PostProcessingManager } from "./effects/PostProcessingManager";
import { PrecipitationEffect } from "./effects/RainEffect";
import { ThunderEffect } from "./effects/ThunderEffect";
import { FogEffect } from "./effects/FogEffect";
import { WindSystem } from "./effects/WindSystem";
import { DebrisEffect } from "./effects/DebrisEffect";
import { EventBus } from "./core/EventBus";
import { EngineSettings } from "./core/EngineSettings";
import { QualityDetector } from "./core/QualityDetector";
import { TextureMemoryManager } from "./loader";
import { InstancedMeshManager } from "./rendering/InstancedMeshManager";

/**
 * Camera rendering modes:
 * - "perspective": Regular perspective camera, full clustered lighting support
 * - "orthographic": True orthographic, may have light artifacts at screen edges
 * - "fake_ortho": Perspective with very low FOV, looks orthographic but works with clustered lights
 */
export type CameraMode = "perspective" | "orthographic" | "fake_ortho";

// Default camera heights for each mode
const DEFAULT_CAMERA_HEIGHT: Record<CameraMode, number> = {
  perspective: 800,
  orthographic: 250,
  fake_ortho: 800,
};

/**
 * Result from map loading - passed to onMapLoaded hook
 */
export interface MapLoadResult {
  mapName: string;
  playerStartPosition: Vector3;
  cameraMode: CameraMode | null;
  cameraHeight: number | null;
  cameraController: string | null;
  playlist: string | null;
  indoor: boolean;
}

export abstract class EngineScene {
  protected engine: Engine;
  protected canvas: HTMLCanvasElement;
  protected scene: Scene | null = null;
  protected camera: ArcRotateCamera | null = null;
  protected orthoSize = 250;
  protected cameraHeight: number | null = null;
  protected currentMap: string | null = null;
  protected mapCenterPosition: Vector3 = Vector3.Zero();
  protected cameraMode: CameraMode = "perspective";

  private resizeHandler: (() => void) | null = null;
  private unsubscribeMapLoaded: (() => void) | null = null;
  private unsubscribeAppStateChange: (() => void) | null = null;
  private unsubscribeBackButton: (() => void) | null = null;

  // Map entry tracking for return transitions
  private mapEntryTriggers: Map<string, { sourceMap: string; triggerPosition: Vector3 }> = new Map();

  // Performance mode
  protected targetFPS: number = 999;
  protected lastRenderTime: number = 0;
  protected frameInterval: number = 0;

  // Weather effects
  protected precipitationEffect: PrecipitationEffect | null = null;
  protected thunderEffect: ThunderEffect | null = null;
  protected fogEffect: FogEffect | null = null;
  protected windSystem: WindSystem | null = null;
  protected debrisEffect: DebrisEffect | null = null;
  protected isIndoorMap: boolean = false;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.canvas = canvas;
  }

  /**
   * Start the scene - creates scene, loads initial map, starts render loop
   */
  public async start(): Promise<void> {
    const config = AssetLoader.getInstance().getConfig();
    const startMap = config?.game.startMap || "test.map";

    // Load engine settings before creating scene
    await EngineSettings.getInstance().load();

    await this.createScene();

    // Initialize engine-level BuildableSystem
    BuildableSystem.getInstance().setTimeProvider(() => this.getGameTime());

    // Let game initialize its systems
    await this.onSceneCreated();

    await this.loadMap(startMap);

    // Let game handle post-start logic
    await this.onStart();

    this.startRenderLoop();

    // Setup Capacitor app lifecycle handlers
    this.setupCapacitorListeners();

    // Listen for map loaded events (e.g. from MapCommand)
    EventBus.on<{ result: MapLoadResult }>("map:loaded", (data) => {
      console.log(`[EngineScene] Received map:loaded event`);
      this.onMapLoaded(data.result).catch(e => console.error("Error in onMapLoaded:", e));
    });
  }

  /**
   * Get current game time - override in game scene to provide actual game time
   */
  protected getGameTime(): number {
    return Date.now();
  }

  /**
   * Update performance mode (FPS throttling)
   */
  public updatePerformanceMode(highPerformance: boolean): void {
    if (highPerformance) {
      this.targetFPS = 999;
      this.frameInterval = 0;
      console.log(`[EngineScene] High Performance mode: uncapped FPS`);
    } else {
      this.targetFPS = 30;
      this.frameInterval = 1000 / this.targetFPS;
      console.log(`[EngineScene] Battery Saver mode: 30 FPS`);
    }
  }

  protected async createScene(): Promise<void> {
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
    this.scene.collisionsEnabled = true;
    this.scene.autoClear = true;
    this.scene.skipPointerMovePicking = true;
    this.scene.blockMaterialDirtyMechanism = false;
    this.scene.blockMaterialDirtyMechanism = false;

    // Initialize Physics System
    try {
      const { PhysicsSystem } = await import('./physics/PhysicsSystem');
      const success = await PhysicsSystem.getInstance().enablePhysics(this.scene);
      console.log(`[EngineScene] PhysicsSystem init result: ${success}`);
    } catch (e) {
      console.error('[EngineScene] CRITICAL: PhysicsSystem failed to load/init', e);
    }

    TextureManager.getInstance().init(this.scene);

    // Initialize TextureMemoryManager with auto-detected quality
    const qualityDetector = QualityDetector.getInstance();
    const { quality, deviceInfo } = qualityDetector.detectQuality();
    const textureMemory = TextureMemoryManager.getInstance();
    textureMemory.init(this.scene, {
      memoryBudgetMB: qualityDetector.getRecommendedTextureBudget(),
      maxTextureSize: qualityDetector.getRecommendedMaxTextureSize(),
    });
    textureMemory.setQuality(quality);
    console.log(`[EngineScene] Texture quality: ${quality} (${deviceInfo.type}, GPU tier ${deviceInfo.gpuTier})`);

    // Initialize InstancedMeshManager
    InstancedMeshManager.getInstance().init(this.scene);

    // Initialize all scene-dependent services via ServiceLocator
    console.log('[EngineScene] Initializing scene services...');
    const { ServiceLocator } = await import('./core/ServiceLocator');
    await ServiceLocator.getInstance().initScene(this.scene);
    console.log('[EngineScene] Scene services initialized');

    // Networking is initialized by game-specific code (e.g., FPSGameManager → NetworkGameHost)

    // Load camera settings
    const engineSettings = EngineSettings.getInstance();
    const cameraSettings = engineSettings.getCameraSettings();

    // Create camera
    this.camera = new ArcRotateCamera(
      "camera",
      cameraSettings.alpha,
      cameraSettings.beta,
      200,
      Vector3.Zero(),
      this.scene
    );

    // Apply camera mode from settings
    const cameraMode = cameraSettings.mode as CameraMode;
    this.cameraHeight = cameraSettings.height;
    this.applyCameraMode(cameraMode);
    this.camera.inputs.clear();

    // Resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
    }
    this.resizeHandler = () => {
      this.engine.resize();
      this.updateCameraOrtho();
      CameraSystem.getInstance().onResize();
    };
    window.addEventListener("resize", this.resizeHandler);

    // Initialize dynamic sky lighting
    const lightingSettings = engineSettings.getLightingSettings();
    SkyLightSystem.getInstance().init(this.scene, {
      sunIntensity: lightingSettings.sunIntensity,
      moonIntensity: lightingSettings.moonIntensity,
      ambientIntensity: lightingSettings.ambientIntensity,
      enableShadows: lightingSettings.enableShadows,
    });

    // Initialize Input System
    InputSystem.getInstance().init(this.scene, this.canvas);

    // Initialize Camera System with IsometricController
    const cameraSystem = CameraSystem.getInstance();
    cameraSystem.init(this.scene, this.canvas);
    cameraSystem.setCamera(this.camera);

    // Create and register the isometric controller
    const isometricController = new IsometricController();
    cameraSystem.registerController("isometric", isometricController);
    isometricController.attach(this.camera, this.scene, this.canvas);
    cameraSystem.setActiveController(isometricController);

    // Listen for map:loaded to sync camera target
    this.unsubscribeMapLoaded?.();
    this.unsubscribeMapLoaded = EventBus.on("map:loaded", () => {
      isometricController.syncTargetPosition();
    });

    // Initialize SpriteManager
    SpriteManager.getInstance().init(this.scene, this.camera);

    // Load sprite manifest
    SpriteManager.getInstance().loadManifest('game/sprites.json').catch(err => {
      console.warn('Failed to load sprite manifest:', err);
    });

    // Initialize post-processing effects
    PostProcessingManager.getInstance().init(this.scene, this.camera);

    // Initialize weather effects
    this.precipitationEffect = new PrecipitationEffect(this.scene);
    this.thunderEffect = new ThunderEffect(this.scene);
    this.fogEffect = new FogEffect(this.scene);
    this.windSystem = WindSystem.getInstance(this.scene);
    this.debrisEffect = new DebrisEffect(this.scene);

    // Expose debug functions
    this.exposeDebugFunctions();
  }

  protected updateCameraOrtho(): void {
    if (!this.camera) return;

    const ratio = this.canvas.width / this.canvas.height;
    this.camera.orthoTop = this.orthoSize;
    this.camera.orthoBottom = -this.orthoSize;
    this.camera.orthoLeft = -this.orthoSize * ratio;
    this.camera.orthoRight = this.orthoSize * ratio;
  }

  protected applyCameraMode(mode: CameraMode): void {
    if (!this.camera) return;

    const height = this.cameraHeight ?? DEFAULT_CAMERA_HEIGHT[mode];

    switch (mode) {
      case "perspective":
        this.camera.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
        this.camera.fov = 0.8;
        this.camera.radius = height;
        this.camera.minZ = 1;
        this.camera.maxZ = 10000;
        console.log(`Camera mode: PERSPECTIVE (height: ${height})`);
        break;

      case "orthographic":
        this.camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
        this.camera.radius = Math.max(500, height * 2);
        this.camera.minZ = -10000;
        this.camera.maxZ = 10000;
        this.orthoSize = height;
        this.updateCameraOrtho();
        console.log(`Camera mode: ORTHOGRAPHIC (orthoSize: ${height}, radius: ${this.camera.radius})`);
        break;

      case "fake_ortho":
        this.camera.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
        const baseFov = 0.3;
        const fovScale = Math.min(0.6, baseFov + (height - 100) / 1000);
        this.camera.fov = fovScale;
        this.camera.radius = height * 2;
        this.camera.minZ = 0.1;
        this.camera.maxZ = Math.max(5000, height * 4);
        console.log(`Camera mode: FAKE_ORTHO (height: ${height}, fov: ${fovScale.toFixed(2)}, radius: ${this.camera.radius})`);
        break;
    }

    this.cameraMode = mode;
  }

  public setCameraMode(mode: CameraMode): void {
    if (!["perspective", "orthographic", "fake_ortho"].includes(mode)) {
      console.error(`Invalid camera mode: ${mode}`);
      return;
    }

    this.applyCameraMode(mode);

    if (mode === "orthographic") {
      this.updateCameraOrtho();
    }

    if (this.camera) {
      this.camera.getProjectionMatrix(true);
    }

    console.log(`[EngineScene] Camera mode changed to: ${mode}`);
  }

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  public setCameraHeight(height: number | string): void {
    const numHeight = typeof height === 'string' ? parseFloat(height) : height;
    if (isNaN(numHeight) || numHeight <= 0) {
      console.error(`Invalid camera height: ${height}`);
      return;
    }

    this.cameraHeight = numHeight;
    this.applyCameraMode(this.cameraMode);

    if (this.camera && this.mapCenterPosition) {
      this.camera.setTarget(this.mapCenterPosition);
    }
  }

  public getCameraHeight(): number {
    return this.cameraHeight ?? DEFAULT_CAMERA_HEIGHT[this.cameraMode];
  }

  public getCurrentMap(): string | null {
    return this.currentMap;
  }

  public setMapEntryTrigger(destinationMap: string, triggerPosition: Vector3): void {
    if (!this.currentMap) return;

    this.mapEntryTriggers.set(destinationMap, {
      sourceMap: this.currentMap,
      triggerPosition: triggerPosition.clone()
    });
    console.log(`[EngineScene] Recorded entry trigger for ${destinationMap}`);
  }

  public async loadMap(mapName: string, withTransition = true, transitionDuration?: number): Promise<void> {
    if (!this.scene) return;

    const isInitialLoad = !this.currentMap;
    const shouldTransition = withTransition && !isInitialLoad;

    if (shouldTransition) {
      const transition = ScreenTransition.getInstance();
      await transition.fadeTransition(
        async () => {
          await this.loadMapInternal(mapName);
        },
        { duration: transitionDuration }
      );
    } else {
      await this.loadMapInternal(mapName);
    }
  }

  protected async loadMapInternal(mapName: string): Promise<void> {
    if (!this.scene) return;

    const previousMap = this.currentMap;
    console.log(`[EngineScene] Loading map: ${mapName}, previous: ${previousMap}`);

    // Let game save current map state
    if (previousMap && previousMap !== mapName) {
      await this.onMapUnloading(previousMap);
    }

    // Clear existing map
    MapRenderer.clearMap(this.scene, previousMap ?? undefined);

    // Try loading via MapLoader (BSP support)
    const mapLoader = MapLoader.getInstance();
    const bspResult = await mapLoader.loadMap(mapName, this.scene);

    let resultPlayerStart = Vector3.Zero();
    let resultCameraHeight: number | null = null;
    let resultCameraMode: CameraMode | null = null;
    let resultCameraController: string | null = null;
    let resultIndoor = false;
    let resultPlaylist: string | null = null;

    if (bspResult.success && bspResult.mapType === 'bsp') {
      // BSP Loaded successfully
      console.log(`[EngineScene] Loaded BSP map: ${mapName}`);
      resultPlayerStart = bspResult.playerStartPosition || new Vector3(0, 50, 0);
      resultIndoor = true; // Assume BSPs are indoor by default for lighting? Or derived?
      // TODO: Extract other properties if available in BSP entities
    } else {
      // Fallback: AssetLoader (Text .map files)

      // Get map data
      let mapData = AssetLoader.getInstance().getMap(mapName);
      if (!mapData) {
        console.log(`[EngineScene] Map not in cache, trying dynamic load: ${mapName}`);
        const loaded = await AssetLoader.getInstance().loadMapDynamic(mapName);
        if (loaded) {
          mapData = AssetLoader.getInstance().getMap(mapName);
        }
      }
      if (!mapData) {
        console.error(`Map not found: ${mapName}`);
        return;
      }

      // Render the map
      console.log(`[EngineScene] Rendering ${mapData.entities.length} entities for ${mapName}`);
      const result = await MapRenderer.renderEntities(mapData.entities, this.scene, mapName);
      console.log(`[EngineScene] Map rendered, player start: ${result.playerStartPosition}`);

      resultPlayerStart = result.playerStartPosition;
      resultCameraHeight = result.cameraHeight;
      resultCameraMode = result.cameraMode;
      resultCameraController = result.cameraController;
      resultIndoor = result.indoor;
      resultPlaylist = result.playlist;
    }

    // Determine camera target position
    const entryInfo = this.mapEntryTriggers.get(previousMap || "");
    if (entryInfo && entryInfo.sourceMap === mapName) {
      this.mapCenterPosition = new Vector3(
        entryInfo.triggerPosition.x,
        0,
        entryInfo.triggerPosition.z
      );
      console.log(`[EngineScene] Returning from ${previousMap}: centering on entry trigger`);
    } else {
      this.mapCenterPosition = new Vector3(
        resultPlayerStart.x,
        0,
        resultPlayerStart.z
      );
    }

    // Apply camera height from map
    if (resultCameraHeight !== null) {
      this.cameraHeight = resultCameraHeight;
    } else {
      this.cameraHeight = null;
    }

    // Apply camera mode
    const modeToApply = resultCameraMode || "perspective";
    this.setCameraMode(modeToApply);

    // Apply camera controller if specified
    if (resultCameraController) {
      const cameraSystem = CameraSystem.getInstance();
      if (!cameraSystem.setController(resultCameraController)) {
        console.warn(`[EngineScene] Failed to switch to controller: ${resultCameraController}`);
      }
    }

    // Apply camera target
    if (this.camera) {
      const desiredRadius = this.camera.radius;
      this.camera.alpha = -Math.PI / 4;
      this.camera.beta = Math.PI / 4;
      this.camera.setTarget(this.mapCenterPosition);
      this.camera.radius = desiredRadius;
      CameraSystem.getInstance().getActiveController()?.setTarget?.(this.mapCenterPosition);
    }

    this.currentMap = mapName;

    // Clear world indicators
    WorldIndicatorSystem.getInstance().clearAll();

    // Notify systems
    EventBus.emit("map:loaded", { mapName });

    // Handle indoor flag
    this.isIndoorMap = resultIndoor;
    if (this.isIndoorMap) {
      if (this.precipitationEffect?.isActive_()) {
        this.precipitationEffect.stop(true);
      }
      if (this.windSystem?.isWindy()) {
        this.windSystem.stop();
      }
      if (this.debrisEffect?.isActive_()) {
        this.debrisEffect.stop();
      }
    }

    // Create result for game hook
    const loadResult: MapLoadResult = {
      mapName,
      playerStartPosition: resultPlayerStart,
      cameraMode: resultCameraMode,
      cameraHeight: resultCameraHeight,
      cameraController: resultCameraController,
      playlist: resultPlaylist,
      indoor: resultIndoor,
    };

    // Let game handle map load
    await this.onMapLoaded(loadResult);
  }

  private setupCapacitorListeners(): void {
    this.unsubscribeAppStateChange?.();
    this.unsubscribeAppStateChange = EventBus.on<{ isActive: boolean }>("app:state_change", ({ isActive }) => {
      if (isActive) {
        console.log("[EngineScene] App resumed - restarting render loop");
        this.engine.runRenderLoop(() => {
          this.scene?.render();
        });
      } else {
        console.log("[EngineScene] App backgrounded - pausing");
        this.engine.stopRenderLoop();
        this.onAppBackgrounded();
      }
    });

    this.unsubscribeBackButton?.();
    this.unsubscribeBackButton = EventBus.on<{ canGoBack: boolean }>("app:back_button", () => {
      this.onBackButton();
    });

    console.log("[EngineScene] Capacitor listeners registered");
  }

  protected startRenderLoop(): void {
    this.engine.runRenderLoop(() => {
      if (!this.scene || !this.camera) return;

      // FPS throttling
      if (this.frameInterval > 0) {
        const currentTime = performance.now();
        const elapsed = currentTime - this.lastRenderTime;

        if (elapsed < this.frameInterval) {
          return;
        }

        this.lastRenderTime = currentTime - (elapsed % this.frameInterval);
      }

      // Update street lamps
      const deltaTime = this.engine.getDeltaTime();
      if (StreetLampSystem.getInstance().isInitialized()) {
        StreetLampSystem.getInstance().update(deltaTime);
      }

      // Update day/night cycle (cvar-driven, works for BSP maps even without sun lights)
      SkyLightSystem.getInstance().update(deltaTime);

      // Update BuildableSystem
      BuildableSystem.getInstance().update();

      // Let game update
      this.onUpdate(deltaTime);

      // Only force isometric angles if using isometric controller
      const activeController = CameraSystem.getInstance().getActiveController();
      if (!activeController || activeController.type === "isometric") {
        this.camera.alpha = -Math.PI / 4;
        this.camera.beta = Math.PI / 4;
      }

      this.scene.render();
    });
  }

  protected exposeDebugFunctions(): void {
    (window as any).loadMap = (mapName: string) => this.loadMap(mapName);
    (window as any).setZoom = (newSize: number) => {
      this.orthoSize = newSize;
      this.updateCameraOrtho();
      console.log(`Zoom set to ${this.orthoSize}`);
    };

    (window as any).setCameraMode = (mode: CameraMode) => this.setCameraMode(mode);
    (window as any).getCameraMode = () => this.getCameraMode();
    (window as any).setCameraHeight = (height: number) => this.setCameraHeight(height);
    (window as any).getCameraHeight = () => this.getCameraHeight();

    (window as any).camera = {
      get: () => this.camera,
      getMode: () => this.getCameraMode(),
      getHeight: () => this.getCameraHeight(),
    };

    // Post-processing debug commands
    const pp = PostProcessingManager.getInstance();
    (window as any).fx = {
      enabled: (on: boolean) => pp.setEnabled(on),
      bloom: (on: boolean) => pp.setBloomEnabled(on),
      bloomIntensity: (v: number) => pp.setBloomIntensity(v),
      bloomThreshold: (v: number) => pp.setBloomThreshold(v),
      vignette: (on: boolean) => pp.setVignetteEnabled(on),
      vignetteIntensity: (v: number) => pp.setVignetteIntensity(v),
      ssao: (on: boolean) => pp.setSSAOEnabled(on),
      ssaoIntensity: (v: number) => pp.setSSAOIntensity(v),
      chromatic: (on: boolean) => pp.setChromaticAberrationEnabled(on),
      reset: () => pp.resetToDefaults(),
      settings: () => pp.getSettings(),
    };

    // Weather debug commands
    (window as any).weather = {
      rain: (on: boolean) => {
        if (on && this.isIndoorMap) {
          console.log("[Weather] Cannot start rain - indoor map");
          return;
        }
        on ? this.precipitationEffect?.startRain() : this.precipitationEffect?.stop();
      },
      rainIntensity: (v: number) => this.precipitationEffect?.setIntensity(v),
      rainSize: (v: number) => this.precipitationEffect?.updateSettings({ particleSize: v }),
      rainSpeed: (v: number) => this.precipitationEffect?.updateSettings({ speed: v }),
      rainWind: (angle: number, strength: number) => this.precipitationEffect?.updateSettings({ windAngle: angle, windStrength: strength }),
      snow: (on: boolean) => {
        if (on && this.isIndoorMap) {
          console.log("[Weather] Cannot start snow - indoor map");
          return;
        }
        on ? this.precipitationEffect?.startSnow() : this.precipitationEffect?.stop();
      },
      snowIntensity: (v: number) => { this.precipitationEffect?.updateSettings({ intensity: v }); },
      snowSize: (v: number) => this.precipitationEffect?.updateSettings({ particleSize: v }),
      thunder: (duration?: number) => this.thunderEffect?.trigger(duration ? { duration } : undefined),
      thunderStop: () => this.thunderEffect?.stop(),
      fog: (on: boolean) => on ? this.fogEffect?.start() : this.fogEffect?.stop(),
      fogDensity: (v: number) => this.fogEffect?.setDensity(v),
      fogColor: (r: number, g: number, b: number) => this.fogEffect?.setColor(r, g, b),
      lightMist: () => this.fogEffect?.lightMist(),
      heavyFog: () => this.fogEffect?.heavyFog(),
      morningFog: () => this.fogEffect?.morningFog(),
      spookyFog: () => this.fogEffect?.spookyFog(),
      wind: (on: boolean) => {
        if (on && this.isIndoorMap) {
          console.log("[Weather] Cannot start wind - indoor map");
          return;
        }
        on ? this.windSystem?.start() : this.windSystem?.stop();
      },
      windStrength: (v: number) => this.windSystem?.setStrength(v),
      windAngle: (v: number) => this.windSystem?.setAngle(v),
      gust: () => this.windSystem?.triggerGust(),
      calmBreeze: () => this.windSystem?.calmBreeze(),
      moderateWind: () => this.windSystem?.moderateWind(),
      stormWind: () => this.windSystem?.stormWind(),
      debris: (type: 'leaves' | 'trash' | 'dust' | 'mixed' | false) => {
        if (type && this.isIndoorMap) {
          console.log("[Weather] Cannot start debris - indoor map");
          return;
        }
        if (type === false) {
          this.debrisEffect?.stop();
        } else {
          switch (type) {
            case 'leaves': this.debrisEffect?.startLeaves(); break;
            case 'trash': this.debrisEffect?.startTrash(); break;
            case 'dust': this.debrisEffect?.startDust(); break;
            case 'mixed': this.debrisEffect?.startMixed(); break;
          }
        }
      },
      debrisDensity: (v: number) => this.debrisEffect?.updateSettings({ density: v }),
      debrisSize: (v: number) => this.debrisEffect?.updateSettings({ size: v }),
      debrisSpeed: (min: number, max: number) => this.debrisEffect?.updateSettings({ emitPowerMin: min, emitPowerMax: max }),
      debrisGravity: (v: number) => this.debrisEffect?.updateSettings({ gravity: v }),
      debrisSpin: (v: number) => this.debrisEffect?.updateSettings({ spinSpeed: v }),
      debrisLifetime: (v: number) => this.debrisEffect?.updateSettings({ lifetime: v }),
      debrisWindForce: (v: number) => this.debrisEffect?.updateSettings({ windForce: v }),
      debrisTurbulence: (v: number) => this.debrisEffect?.updateSettings({ turbulence: v }),
      debrisSpread: (v: number) => this.debrisEffect?.updateSettings({ spread: v }),
      debrisHeight: (v: number) => this.debrisEffect?.updateSettings({ height: v }),
      isRaining: () => this.precipitationEffect?.isRaining(),
      isSnowing: () => this.precipitationEffect?.isSnowing(),
      isStorming: () => this.thunderEffect?.isStorming(),
      isFoggy: () => this.fogEffect?.isFoggy(),
      isWindy: () => this.windSystem?.isWindy(),
      settings: () => ({
        precipitation: this.precipitationEffect?.getSettings(),
        thunder: this.thunderEffect?.getSettings(),
        fog: this.fogEffect?.getSettings(),
        wind: this.windSystem?.getSettings(),
        debris: this.debrisEffect?.getSettings(),
      }),
    };

    console.log("Debug: Use 'loadMap(name)', 'setZoom(value)' in console.");
    console.log("FX commands: fx.bloom(true), fx.bloomIntensity(0.5), fx.vignette(true), fx.ssao(true)");
    console.log("Weather: weather.rain(true), weather.snow(true), weather.thunder(), weather.fog(true), weather.wind(true)");
  }

  public getScene(): Scene | null {
    return this.scene;
  }

  public getCamera(): ArcRotateCamera | null {
    return this.camera;
  }

  public getEngine(): Engine {
    return this.engine;
  }

  public dispose(): void {
    // Let game clean up
    this.onDispose();

    this.engine.stopRenderLoop();

    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    this.unsubscribeMapLoaded?.();
    this.unsubscribeMapLoaded = null;
    this.unsubscribeAppStateChange?.();
    this.unsubscribeAppStateChange = null;
    this.unsubscribeBackButton?.();
    this.unsubscribeBackButton = null;

    InputSystem.getInstance().dispose();
    CameraSystem.getInstance().dispose();
    SpriteManager.getInstance().clear();
    WorldIndicatorSystem.getInstance().clearAll();

    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }

  // ==================== Hook methods for game to override ====================

  /**
   * Called after scene is created, before map loads.
   * Initialize game-specific systems here.
   */
  protected async onSceneCreated(): Promise<void> {
    // Override in game scene
  }

  /**
   * Called after initial map loads and before render loop starts.
   * Initialize game UI and start game logic here.
   */
  protected async onStart(): Promise<void> {
    // Override in game scene
  }

  /**
   * Called before a map is unloaded (when switching maps).
   * Save map state here.
   */
  protected async onMapUnloading(_mapName: string): Promise<void> {
    // Override in game scene
  }

  /**
   * Called after a map is loaded.
   * Handle game-specific map load logic here (playlists, saved state, etc.)
   */
  protected async onMapLoaded(_result: MapLoadResult): Promise<void> {
    // Override in game scene
  }

  /**
   * Called every frame in the render loop.
   * Update game logic here.
   */
  protected onUpdate(_deltaTime: number): void {
    // Override in game scene
  }

  /**
   * Called when the app is backgrounded (mobile).
   * Save game state here.
   */
  protected onAppBackgrounded(): void {
    // Override in game scene
  }

  /**
   * Called when the back button is pressed (Android).
   * Show pause menu or exit here.
   */
  protected onBackButton(): void {
    // Override in game scene
  }

  /**
   * Called when disposing the scene.
   * Clean up game resources here.
   */
  protected onDispose(): void {
    // Override in game scene
  }
}
