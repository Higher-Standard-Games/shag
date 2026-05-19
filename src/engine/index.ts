/**
 * SHAG Engine - Main exports
 *
 * A Babylon.js engine for Quake 3 / Warsow-style games and beyond.
 * Supports BSP map loading (Q3 / Warsow FBSP), PK3 virtual filesystem,
 * Q3 shaders, server-authoritative networking, BSP collision, Q3-style
 * movement, skeletal animation, weather, sprites, HUD/UI, and console.
 *
 * Engine-generic; game-specific code lives under `src/games/<game>`.
 */

export type { GameConfig, LoadedMap, LoadProgress, ProgressCallback } from "./AssetLoader";

// Asset loading
export { AssetLoader } from "./AssetLoader";
// Audio
export { AudioManager } from "./AudioManager";
// Animation System
export * from "./animation";
// Camera System
export * from "./camera";
// Core systems
export * from "./core";
export type { CameraMode, MapLoadResult } from "./EngineScene";
// Scene management
export { EngineScene } from "./EngineScene";
export type { SkyLightConfig } from "./lighting/SkyLightSystem";

// Lighting
export { SkyLightSystem } from "./lighting/SkyLightSystem";
export type { StreetLampConfig } from "./lighting/StreetLampSystem";
export { StreetLampSystem } from "./lighting/StreetLampSystem";
export type {
  BspEntity,
  BspFace,
  BspFile,
  BspHeader,
  BspLeaf,
  BspModel,
  BspNode,
  BspPlane,
  BspTexture,
  BspVertex,
  BspVertexFBSP,
  BspVertexIBSP,
  BspVisData,
} from "./loader/bsp/BspLoader";
// BSP Loading (Quake 3 / Warsow FBSP)
export { BspLoader, findLeafForPoint, isClusterVisible } from "./loader/bsp/BspLoader";
export type { BspMeshBuildResult, BuildOptions as BspBuildOptions } from "./loader/bsp/BspMeshBuilder";
export { BspMeshBuilder, getVisibleFaces } from "./loader/bsp/BspMeshBuilder";
export { printBspStats, quickBspTest, testBspLoading, testBspRendering } from "./loader/bsp/BspTest";
export type { BrushFace } from "./loader/map/BrushGenerator";
export { BrushGenerator } from "./loader/map/BrushGenerator";
export type { Brush, Entity, PlaneDefinition } from "./loader/map/MapParser";
// Loaders
export { MapParser } from "./loader/map/MapParser";
export type { PatchDefinition } from "./loader/map/PatchGenerator";
export { PatchGenerator } from "./loader/map/PatchGenerator";
export type { ModelLoadOptions } from "./loader/model/ModelLoader";
export { ModelLoader } from "./loader/model/ModelLoader";
export { PrefabInstance } from "./loader/model/PrefabInstance";
export { PrefabLoader } from "./loader/model/PrefabLoader";
export type { PK3File, PK3LoaderConfig } from "./loader/pk3/PK3Loader";
export { PK3Loader } from "./loader/pk3/PK3Loader";
export type { SkyboxLoadResult } from "./loader/texture/SkyboxLoader";
export { SkyboxLoader } from "./loader/texture/SkyboxLoader";
export type { TextureInfo } from "./loader/texture/TextureManager";
export { TextureManager } from "./loader/texture/TextureManager";
export type { QualityLevel, TextureMemoryConfig, TrackedTexture } from "./loader/texture/TextureMemoryManager";
export { TextureMemoryManager } from "./loader/texture/TextureMemoryManager";
export type { MapRenderResult } from "./MapRenderer";
// Map rendering
export { MapRenderer } from "./MapRenderer";
export type { InstanceData, InstanceTransform, TemplateData } from "./rendering/InstancedMeshManager";
// Rendering
export { InstancedMeshManager } from "./rendering/InstancedMeshManager";
// Validators
export { SpawnValidator } from "./SpawnValidator";
export type { SpriteAnimationState } from "./sprites/BillboardSprite";
export { BillboardSprite } from "./sprites/BillboardSprite";
export type { SpriteBuildingConfig } from "./sprites/SpriteBuilding";
export { SpriteBuildingManager } from "./sprites/SpriteBuilding";
// Sprites
export { SpriteManager } from "./sprites/SpriteManager";
export type { SpriteSheetConfig } from "./sprites/SpriteSheet";
export { SpriteSheet } from "./sprites/SpriteSheet";
// UI System
export * from "./ui";
