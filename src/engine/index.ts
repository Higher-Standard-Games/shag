/**
 * HSG Engine - Main exports
 * 
 * A BabylonJS-based game engine for isometric/RTS games.
 * Supports Quake-style .map files, sprites, lighting, and more.
 */

// Core systems
export * from "./core";

// Asset loading
export { AssetLoader } from "./AssetLoader";
export type { GameConfig, LoadedMap, LoadProgress, ProgressCallback } from "./AssetLoader";

// Audio
export { AudioManager } from "./AudioManager";

// Scene management
export { EngineScene } from "./EngineScene";
export type { CameraMode, MapLoadResult } from "./EngineScene";

// Map rendering
export { MapRenderer } from "./MapRenderer";
export type { MapRenderResult } from "./MapRenderer";

// Camera System
export * from "./camera";

// Lighting
export { SkyLightSystem } from "./lighting/SkyLightSystem";
export type { SkyLightConfig } from "./lighting/SkyLightSystem";
export { StreetLampSystem } from "./lighting/StreetLampSystem";
export type { StreetLampConfig } from "./lighting/StreetLampSystem";

// Loaders
export { MapParser } from "./loader/map/MapParser";
export type { Entity, Brush, PlaneDefinition } from "./loader/map/MapParser";
export { BrushGenerator } from "./loader/map/BrushGenerator";
export type { BrushFace } from "./loader/map/BrushGenerator";
export { PatchGenerator } from "./loader/map/PatchGenerator";
export type { PatchDefinition } from "./loader/map/PatchGenerator";
export { TextureManager } from "./loader/texture/TextureManager";
export type { TextureInfo } from "./loader/texture/TextureManager";
export { TextureMemoryManager } from "./loader/texture/TextureMemoryManager";
export type { TextureMemoryConfig, TrackedTexture, QualityLevel } from "./loader/texture/TextureMemoryManager";
export { ModelLoader } from "./loader/model/ModelLoader";
export type { ModelLoadOptions } from "./loader/model/ModelLoader";
export { PrefabLoader } from "./loader/model/PrefabLoader";
export { PrefabInstance } from "./loader/model/PrefabInstance";
export { PK3Loader } from "./loader/pk3/PK3Loader";
export type { PK3File, PK3LoaderConfig } from "./loader/pk3/PK3Loader";

// BSP Loading (Quake 3 / Warsow FBSP)
export { BspLoader, isClusterVisible, findLeafForPoint } from "./loader/bsp/BspLoader";
export type {
  BspFile,
  BspHeader,
  BspEntity,
  BspVertex,
  BspVertexIBSP,
  BspVertexFBSP,
  BspFace,
  BspTexture,
  BspPlane,
  BspNode,
  BspLeaf,
  BspModel,
  BspVisData,
} from "./loader/bsp/BspLoader";
export { BspMeshBuilder, getVisibleFaces } from "./loader/bsp/BspMeshBuilder";
export type { BuildOptions as BspBuildOptions } from "./loader/bsp/BspMeshBuilder";
export type { BspMeshBuildResult } from "./loader/bsp/BspMeshBuilder";
export { testBspLoading, printBspStats, testBspRendering, quickBspTest } from "./loader/bsp/BspTest";
export { SkyboxLoader } from "./loader/texture/SkyboxLoader";
export type { SkyboxLoadResult } from "./loader/texture/SkyboxLoader";

// Rendering
export { InstancedMeshManager } from "./rendering/InstancedMeshManager";
export type { InstanceData, TemplateData, InstanceTransform } from "./rendering/InstancedMeshManager";

// Sprites
export { SpriteManager } from "./sprites/SpriteManager";
export { SpriteSheet } from "./sprites/SpriteSheet";
export type { SpriteSheetConfig } from "./sprites/SpriteSheet";
export { BillboardSprite } from "./sprites/BillboardSprite";
export type { SpriteAnimationState } from "./sprites/BillboardSprite";
export { SpriteBuildingManager } from "./sprites/SpriteBuilding";
export type { SpriteBuildingConfig } from "./sprites/SpriteBuilding";

// Validators
export { SpawnValidator } from "./SpawnValidator";

// UI System
export * from "./ui";

// Animation System
export * from "./animation";
