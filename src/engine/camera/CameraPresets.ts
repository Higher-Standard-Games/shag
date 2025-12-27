/**
 * CameraPresets - Predefined camera configurations for common game types
 * 
 * These presets can be applied via CameraSystem.applyPreset()
 */

import { CameraControllerConfig } from "./controllers/ICameraController";

export type CameraMode = "perspective" | "orthographic" | "fake_ortho";

export interface CameraPreset {
  name: string;
  description: string;
  /** Controller type to use */
  controllerType: "isometric" | "fps" | "sidescroll" | "follow" | "orbit";
  /** Camera rendering mode */
  cameraMode: CameraMode;
  /** Camera height/distance from target */
  height: number;
  /** Horizontal rotation angle (radians) */
  alpha: number;
  /** Vertical angle from top (radians) */
  beta: number;
  /** Field of view (for perspective cameras) */
  fov?: number;
  /** Orthographic size (for orthographic cameras) */
  orthoSize?: number;
  /** Controller-specific configuration */
  controllerConfig?: Partial<CameraControllerConfig>;
}

/**
 * Built-in camera presets
 */
export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  // Isometric/RTS presets
  isometric_default: {
    name: "Isometric Default",
    description: "Standard isometric view for RTS/strategy games",
    controllerType: "isometric",
    cameraMode: "fake_ortho",
    height: 800,
    alpha: -Math.PI / 4,  // 45° rotation
    beta: Math.PI / 4,    // 45° from top
    fov: 0.4,
    controllerConfig: {
      smoothing: 0.15,
      edgeScrollEnabled: false,
    },
  },
  
  isometric_close: {
    name: "Isometric Close",
    description: "Close-up isometric view",
    controllerType: "isometric",
    cameraMode: "fake_ortho",
    height: 400,
    alpha: -Math.PI / 4,
    beta: Math.PI / 4,
    fov: 0.35,
    controllerConfig: {
      smoothing: 0.15,
    },
  },
  
  isometric_far: {
    name: "Isometric Far",
    description: "Zoomed out isometric view",
    controllerType: "isometric",
    cameraMode: "fake_ortho",
    height: 1200,
    alpha: -Math.PI / 4,
    beta: Math.PI / 4,
    fov: 0.5,
    controllerConfig: {
      smoothing: 0.15,
    },
  },
  
  // Top-down presets
  topdown: {
    name: "Top Down",
    description: "Direct overhead view",
    controllerType: "isometric",
    cameraMode: "orthographic",
    height: 300,
    alpha: 0,
    beta: 0.01,  // Nearly straight down (can't be exactly 0)
    orthoSize: 300,
    controllerConfig: {
      smoothing: 0.15,
    },
  },
  
  // FPS presets
  fps_default: {
    name: "FPS Default",
    description: "Standard first-person view",
    controllerType: "fps",
    cameraMode: "perspective",
    height: 10,  // Eye height
    alpha: 0,
    beta: Math.PI / 2,  // Looking forward
    fov: 0.8,
    controllerConfig: {
      mouseSensitivity: 0.002,
      speed: 10,
      invertY: false,
    },
  },
  
  fps_wide: {
    name: "FPS Wide",
    description: "Wide FOV first-person view",
    controllerType: "fps",
    cameraMode: "perspective",
    height: 10,
    alpha: 0,
    beta: Math.PI / 2,
    fov: 1.2,
    controllerConfig: {
      mouseSensitivity: 0.002,
      speed: 10,
    },
  },
  
  // Side-scroller presets
  sidescroll_default: {
    name: "Side Scroll Default",
    description: "Standard 2D side-scrolling view",
    controllerType: "sidescroll",
    cameraMode: "orthographic",
    height: 200,
    alpha: Math.PI / 2,  // Looking from side
    beta: Math.PI / 2,   // Level with ground
    orthoSize: 200,
    controllerConfig: {
      lockY: false,  // Allow vertical scrolling
      lockX: false,
      smoothing: 0.1,
    },
  },
  
  sidescroll_locked: {
    name: "Side Scroll Locked",
    description: "Side-scrolling with locked vertical",
    controllerType: "sidescroll",
    cameraMode: "orthographic",
    height: 200,
    alpha: Math.PI / 2,
    beta: Math.PI / 2,
    orthoSize: 200,
    controllerConfig: {
      lockY: true,  // Lock vertical position
      smoothing: 0.1,
    },
  },
  
  // Follow/Third-person presets
  follow_default: {
    name: "Follow Default",
    description: "Third-person follow camera",
    controllerType: "follow",
    cameraMode: "perspective",
    height: 100,  // Distance behind target
    alpha: Math.PI,  // Behind target
    beta: Math.PI / 3,  // Slightly above
    fov: 0.8,
    controllerConfig: {
      smoothing: 0.08,
      minDistance: 50,
      maxDistance: 200,
    },
  },
  
  follow_close: {
    name: "Follow Close",
    description: "Close third-person camera",
    controllerType: "follow",
    cameraMode: "perspective",
    height: 50,
    alpha: Math.PI,
    beta: Math.PI / 3,
    fov: 0.9,
    controllerConfig: {
      smoothing: 0.1,
      minDistance: 30,
      maxDistance: 100,
    },
  },
  
  // Orbit/Showcase presets
  orbit_default: {
    name: "Orbit Default",
    description: "Free orbit camera for menus/showcases",
    controllerType: "orbit",
    cameraMode: "perspective",
    height: 300,
    alpha: 0,
    beta: Math.PI / 4,
    fov: 0.8,
    controllerConfig: {
      smoothing: 0.05,
      minDistance: 100,
      maxDistance: 500,
    },
  },
  
  orbit_auto: {
    name: "Orbit Auto-Rotate",
    description: "Auto-rotating showcase camera",
    controllerType: "orbit",
    cameraMode: "perspective",
    height: 400,
    alpha: 0,
    beta: Math.PI / 4,
    fov: 0.7,
    controllerConfig: {
      smoothing: 0.02,
      speed: 0.001,  // Auto-rotation speed
    },
  },
};

/**
 * Get a preset by name
 */
export function getCameraPreset(name: string): CameraPreset | undefined {
  return CAMERA_PRESETS[name];
}

/**
 * Get all preset names
 */
export function getCameraPresetNames(): string[] {
  return Object.keys(CAMERA_PRESETS);
}
