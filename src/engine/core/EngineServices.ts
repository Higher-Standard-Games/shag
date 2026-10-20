/**
 * EngineServices - Central registration of all engine services
 *
 * This file defines the engine's service dependency graph with explicit
 * initialization order. Services are organized by phase:
 *
 * CORE PHASE (no scene required):
 *   - GamePaths: Base paths for asset loading
 *   - EngineSettings: Engine configuration
 *   - EventBus: Global event system (stateless singleton, no init needed)
 *
 * SCENE PHASE (requires Babylon scene):
 *   - TextureManager: Texture loading and caching
 *   - ProceduralTextures: Generated textures
 *   - ModelLoader: 3D model loading
 *   - PrefabLoader: .map prefab loading
 *   - SpriteManager: Billboard sprites
 *   - SpriteBuildingManager: Static sprite buildings
 *   - SkyLightSystem: Day/night lighting
 *   - StreetLampSystem: Point lights
 *   - PostProcessingManager: Visual effects
 *   - AudioManager: Sound and music
 *
 * Usage:
 *   import { registerEngineServices } from './EngineServices';
 *   registerEngineServices();
 *   await ServiceLocator.getInstance().initCore();
 *   await ServiceLocator.getInstance().initScene(scene);
 */

import { AudioManager } from "../AudioManager";
import { GlowEffect } from "../effects/GlowEffect";
// NOTE: StreetLampSystem import removed - games that need it should import and init it themselves
import { PostProcessingManager } from "../effects/PostProcessingManager";
import { SSREffect } from "../effects/SSREffect";
import { SkyLightSystem } from "../lighting/SkyLightSystem";
import { ModelLoader } from "../loader/model/ModelLoader";
import { PrefabLoader } from "../loader/model/PrefabLoader";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { TextureManager } from "../loader/texture/TextureManager";
import { ProceduralTextureGenerator } from "../procedural/ProceduralTextureGenerator";
import { RenderVars } from "../rendering/RenderVars";
import { SpriteBuildingManager } from "../sprites/SpriteBuilding";
import { SpriteManager } from "../sprites/SpriteManager";
import { devLog } from "./DevLog";
import { EngineSettings } from "./EngineSettings";
import { GamePaths } from "./GamePaths";
import { ServiceLocator, type ServiceRegistration } from "./ServiceLocator";
import { WorldIndicatorSystem } from "./WorldIndicatorSystem";

/**
 * Core engine service registrations
 * These are the foundational services that don't require a scene
 */
export const CORE_SERVICES: ServiceRegistration[] = [
  {
    name: "gamePaths",
    factory: () => GamePaths.getInstance(),
    phase: "core",
    dependencies: [],
  },
  {
    name: "engineSettings",
    factory: () => EngineSettings.getInstance(),
    phase: "core",
    dependencies: ["gamePaths"],
  },
  {
    name: "pk3Loader",
    factory: () => PK3Loader.getInstance(),
    phase: "core",
    dependencies: ["gamePaths"],
  },
];

/**
 * Scene-dependent service registrations
 * These require a Babylon scene to initialize
 */
export const SCENE_SERVICES: ServiceRegistration[] = [
  {
    name: "textureManager",
    factory: () => TextureManager.getInstance(),
    reset: () => TextureManager.resetInstance(),
    phase: "scene",
    dependencies: ["gamePaths"],
  },
  {
    name: "proceduralTextures",
    factory: () => ProceduralTextureGenerator.getInstance(),
    reset: () => ProceduralTextureGenerator.resetInstance(),
    phase: "scene",
    dependencies: ["textureManager"],
  },
  {
    name: "modelLoader",
    factory: () => ModelLoader.getInstance(),
    reset: () => ModelLoader.resetInstance(),
    phase: "scene",
    dependencies: ["textureManager"],
  },
  {
    name: "prefabLoader",
    factory: () => PrefabLoader.getInstance(),
    phase: "scene",
    dependencies: ["textureManager"],
  },
  {
    name: "spriteManager",
    factory: () => SpriteManager.getInstance(),
    reset: () => SpriteManager.resetInstance(),
    phase: "scene",
    dependencies: ["textureManager"],
  },
  {
    name: "spriteBuildingManager",
    factory: () => SpriteBuildingManager.getInstance(),
    reset: () => SpriteBuildingManager.resetInstance(),
    phase: "scene",
    dependencies: ["textureManager"],
  },
  {
    name: "skyLightSystem",
    factory: () => SkyLightSystem.getInstance(),
    reset: () => SkyLightSystem.resetInstance(),
    phase: "scene",
    dependencies: [],
  },
  // NOTE: StreetLampSystem is NOT auto-initialized by engine.
  // Games that need it (isometric, RTS) should call StreetLampSystem.getInstance().init(scene) explicitly.
  {
    name: "postProcessing",
    factory: () => PostProcessingManager.getInstance(),
    reset: () => PostProcessingManager.resetInstance(),
    phase: "scene",
    dependencies: [],
  },
  // Scene-scoped post/render effects — like postProcessing, they bind a
  // GlowLayer / SSR pipeline to the CURRENT scene, so they must reset+re-init
  // through this lifecycle on every scene rebuild (WO13). SSR also rebuilds on
  // camera swaps against its bound scene, so a stale scene here is a real
  // freeze/leak hazard, not just a silently-off effect.
  {
    name: "glowEffect",
    factory: () => GlowEffect.getInstance(),
    reset: () => GlowEffect.resetInstance(),
    phase: "scene",
    dependencies: [],
  },
  {
    name: "ssrEffect",
    factory: () => SSREffect.getInstance(),
    reset: () => SSREffect.resetInstance(),
    phase: "scene",
    dependencies: [],
  },
  {
    name: "audioManager",
    factory: () => AudioManager.getInstance(),
    reset: () => AudioManager.resetInstance(),
    phase: "scene",
    dependencies: ["gamePaths"],
  },
  {
    name: "worldIndicators",
    factory: () => WorldIndicatorSystem.getInstance(),
    reset: () => WorldIndicatorSystem.resetInstance(),
    phase: "scene",
    dependencies: [],
  },
  {
    name: "renderVars",
    factory: () => RenderVars.getInstance(),
    phase: "scene",
    dependencies: [],
  },
];

/**
 * All engine service registrations
 */
export const ENGINE_SERVICES: ServiceRegistration[] = [...CORE_SERVICES, ...SCENE_SERVICES];

/**
 * Register all engine services with the ServiceLocator
 * Call this once during app startup before any initialization
 */
export function registerEngineServices(): void {
  const locator = ServiceLocator.getInstance();
  locator.registerAll(ENGINE_SERVICES);
  devLog(`[EngineServices] Registered ${ENGINE_SERVICES.length} engine services`);
}

/**
 * Service name constants for type-safe access
 */
export const Services = {
  // Core
  GAME_PATHS: "gamePaths",
  ENGINE_SETTINGS: "engineSettings",

  // Scene
  TEXTURE_MANAGER: "textureManager",
  PROCEDURAL_TEXTURES: "proceduralTextures",
  MODEL_LOADER: "modelLoader",
  PREFAB_LOADER: "prefabLoader",
  SPRITE_MANAGER: "spriteManager",
  SPRITE_BUILDING_MANAGER: "spriteBuildingManager",
  SKY_LIGHT_SYSTEM: "skyLightSystem",
  STREET_LAMP_SYSTEM: "streetLampSystem",
  POST_PROCESSING: "postProcessing",
  AUDIO_MANAGER: "audioManager",
  WORLD_INDICATORS: "worldIndicators",
  RENDER_VARS: "renderVars",
  NETWORK_MANAGER: "networkManager",
} as const;

export type ServiceName = (typeof Services)[keyof typeof Services];
