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

import { ServiceLocator, type ServiceRegistration } from './ServiceLocator';

/**
 * Core engine service registrations
 * These are the foundational services that don't require a scene
 */
export const CORE_SERVICES: ServiceRegistration[] = [
  {
    name: 'gamePaths',
    factory: () => {
      const { GamePaths } = require('./GamePaths');
      return GamePaths.getInstance();
    },
    phase: 'core',
    dependencies: [],
  },
  {
    name: 'engineSettings',
    factory: () => {
      const { EngineSettings } = require('./EngineSettings');
      return EngineSettings.getInstance();
    },
    phase: 'core',
    dependencies: ['gamePaths'],
  },
];

/**
 * Scene-dependent service registrations
 * These require a Babylon scene to initialize
 */
export const SCENE_SERVICES: ServiceRegistration[] = [
  {
    name: 'textureManager',
    factory: () => {
      const { TextureManager } = require('../loader/TextureManager');
      return TextureManager.getInstance();
    },
    phase: 'scene',
    dependencies: ['gamePaths'],
  },
  {
    name: 'proceduralTextures',
    factory: () => {
      const { ProceduralTextureGenerator } = require('../procedural/ProceduralTextureGenerator');
      return ProceduralTextureGenerator.getInstance();
    },
    phase: 'scene',
    dependencies: ['textureManager'],
  },
  {
    name: 'modelLoader',
    factory: () => {
      const { ModelLoader } = require('../loader/ModelLoader');
      return ModelLoader.getInstance();
    },
    phase: 'scene',
    dependencies: ['textureManager'],
  },
  {
    name: 'prefabLoader',
    factory: () => {
      const { PrefabLoader } = require('../loader/PrefabLoader');
      return PrefabLoader.getInstance();
    },
    phase: 'scene',
    dependencies: ['textureManager'],
  },
  {
    name: 'spriteManager',
    factory: () => {
      const { SpriteManager } = require('../sprites/SpriteManager');
      return SpriteManager.getInstance();
    },
    phase: 'scene',
    dependencies: ['textureManager'],
  },
  {
    name: 'spriteBuildingManager',
    factory: () => {
      const { SpriteBuildingManager } = require('../sprites/SpriteBuilding');
      return SpriteBuildingManager.getInstance();
    },
    phase: 'scene',
    dependencies: ['textureManager'],
  },
  {
    name: 'skyLightSystem',
    factory: () => {
      const { SkyLightSystem } = require('../lighting/SkyLightSystem');
      return SkyLightSystem.getInstance();
    },
    phase: 'scene',
    dependencies: [],
  },
  {
    name: 'streetLampSystem',
    factory: () => {
      const { StreetLampSystem } = require('../lighting/StreetLampSystem');
      return StreetLampSystem.getInstance();
    },
    phase: 'scene',
    dependencies: ['skyLightSystem'],
  },
  {
    name: 'postProcessing',
    factory: () => {
      const { PostProcessingManager } = require('../effects/PostProcessingManager');
      return PostProcessingManager.getInstance();
    },
    phase: 'scene',
    dependencies: [],
  },
  {
    name: 'audioManager',
    factory: () => {
      const { AudioManager } = require('../AudioManager');
      return AudioManager.getInstance();
    },
    phase: 'scene',
    dependencies: ['gamePaths'],
  },
  {
    name: 'worldIndicators',
    factory: () => {
      const { WorldIndicatorSystem } = require('./WorldIndicatorSystem');
      return WorldIndicatorSystem.getInstance();
    },
    phase: 'scene',
    dependencies: [],
  },
];

/**
 * All engine service registrations
 */
export const ENGINE_SERVICES: ServiceRegistration[] = [
  ...CORE_SERVICES,
  ...SCENE_SERVICES,
];

/**
 * Register all engine services with the ServiceLocator
 * Call this once during app startup before any initialization
 */
export function registerEngineServices(): void {
  const locator = ServiceLocator.getInstance();
  locator.registerAll(ENGINE_SERVICES);
  console.log(`[EngineServices] Registered ${ENGINE_SERVICES.length} engine services`);
}

/**
 * Service name constants for type-safe access
 */
export const Services = {
  // Core
  GAME_PATHS: 'gamePaths',
  ENGINE_SETTINGS: 'engineSettings',
  
  // Scene
  TEXTURE_MANAGER: 'textureManager',
  PROCEDURAL_TEXTURES: 'proceduralTextures',
  MODEL_LOADER: 'modelLoader',
  PREFAB_LOADER: 'prefabLoader',
  SPRITE_MANAGER: 'spriteManager',
  SPRITE_BUILDING_MANAGER: 'spriteBuildingManager',
  SKY_LIGHT_SYSTEM: 'skyLightSystem',
  STREET_LAMP_SYSTEM: 'streetLampSystem',
  POST_PROCESSING: 'postProcessing',
  AUDIO_MANAGER: 'audioManager',
  WORLD_INDICATORS: 'worldIndicators',
} as const;

export type ServiceName = typeof Services[keyof typeof Services];
