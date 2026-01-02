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
export { GameScene } from "./GameScene";
export type { CameraMode } from "./GameScene";

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
export { MapParser } from "./loader/MapParser";
export type { Entity, Brush, PlaneDefinition } from "./loader/MapParser";
export { BrushGenerator } from "./loader/BrushGenerator";
export type { BrushFace } from "./loader/BrushGenerator";
export { PatchGenerator } from "./loader/PatchGenerator";
export type { PatchDefinition } from "./loader/PatchGenerator";
export { TextureManager } from "./loader/TextureManager";
export type { TextureInfo } from "./loader/TextureManager";
export { TextureMemoryManager } from "./loader/TextureMemoryManager";
export type { TextureMemoryConfig, TrackedTexture, QualityLevel } from "./loader/TextureMemoryManager";
export { ModelLoader } from "./loader/ModelLoader";
export type { ModelLoadOptions } from "./loader/ModelLoader";
export { PrefabLoader } from "./loader/PrefabLoader";
export { PrefabInstance } from "./loader/PrefabInstance";
export { PK3Loader } from "./loader/PK3Loader";
export type { PK3File, PK3LoaderConfig } from "./loader/PK3Loader";

// BSP Loading (Quake 3 / Warsow FBSP)
export { BspLoader, isClusterVisible, findLeafForPoint } from "./loader/BspLoader";
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
} from "./loader/BspLoader";
export { BspMeshBuilder, getVisibleFaces } from "./loader/BspMeshBuilder";
export type { BspMeshBuildResult } from "./loader/BspMeshBuilder";
export { testBspLoading, printBspStats, testBspRendering, quickBspTest } from "./loader/BspTest";

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
