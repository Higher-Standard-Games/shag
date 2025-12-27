/**
 * Engine Camera System
 * 
 * Provides flexible camera management with swappable controllers
 * for different game types (isometric, FPS, side-scroll, etc.)
 */

export { CameraSystem } from './CameraSystem';
export { getCameraPreset, getCameraPresetNames, CAMERA_PRESETS } from './CameraPresets';
export type { CameraPreset, CameraMode } from './CameraPresets';

// Controllers
export * from './controllers';
