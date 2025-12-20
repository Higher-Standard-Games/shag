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

// Camera
export { RTSCameraController } from "./camera/RTSCameraController";

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
export { ModelLoader } from "./loader/ModelLoader";
export type { ModelLoadOptions } from "./loader/ModelLoader";
export { PrefabLoader } from "./loader/PrefabLoader";
export { PrefabInstance } from "./loader/PrefabInstance";

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
