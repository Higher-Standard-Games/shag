/**
 * EngineSettings - Load and apply engine configuration from JSON
 * 
 * Reads settings from game directory engine-settings.json and applies them
 * to engine systems (camera, lighting, post-processing, etc.)
 */

import { GamePaths } from './GamePaths';

export interface CameraSettings {
  mode: 'perspective' | 'orthographic' | 'fake_ortho';
  height: number;
  alpha: number;
  beta: number;
  fov: number;
  smoothing: number;
}

export interface LightingSettings {
  sunIntensity: number;
  moonIntensity: number;
  ambientIntensity: number;
  enableShadows: boolean;
}

export interface TimeSettings {
  dayLengthSeconds: number;
  startHour: number;
  startDay: number;
}

export interface PostProcessingSettings {
  bloom: { enabled: boolean; intensity: number };
  vignette: { enabled: boolean; weight: number };
  ssao: { enabled: boolean; intensity: number };
  chromaticAberration: { enabled: boolean };
}

export interface EngineSettingsData {
  camera?: CameraSettings;
  lighting?: LightingSettings;
  time?: TimeSettings;
  postProcessing?: PostProcessingSettings;
}

export class EngineSettings {
  private static instance: EngineSettings;
  private settings: EngineSettingsData | null = null;
  private loaded: boolean = false;

  private constructor() {}

  public static getInstance(): EngineSettings {
    if (!EngineSettings.instance) {
      EngineSettings.instance = new EngineSettings();
    }
    return EngineSettings.instance;
  }

  /**
   * Load settings from engine-settings.json
   */
  public async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const settingsPath = GamePaths.getInstance().engineSettingsPath();
      const response = await fetch(settingsPath);
      if (!response.ok) {
        console.log('[EngineSettings] No engine-settings.json found, using defaults');
        this.loaded = true;
        return;
      }
      
      this.settings = await response.json();
      this.loaded = true;
      console.log('[EngineSettings] Loaded engine settings:', this.settings);
    } catch (error) {
      console.warn('[EngineSettings] Failed to load engine-settings.json:', error);
      this.loaded = true;
    }
  }

  /**
   * Get camera settings (or defaults)
   */
  public getCameraSettings(): CameraSettings {
    return this.settings?.camera ?? {
      mode: 'fake_ortho',
      height: 800,
      alpha: -Math.PI / 4,
      beta: Math.PI / 4,
      fov: 0.4,
      smoothing: 0.15
    };
  }

  /**
   * Get lighting settings (or defaults)
   */
  public getLightingSettings(): LightingSettings {
    return this.settings?.lighting ?? {
      sunIntensity: 0.6,
      moonIntensity: 0.12,
      ambientIntensity: 0.25,
      enableShadows: true
    };
  }

  /**
   * Get time settings (or defaults)
   */
  public getTimeSettings(): TimeSettings {
    return this.settings?.time ?? {
      dayLengthSeconds: 180,
      startHour: 8,
      startDay: 1
    };
  }

  /**
   * Get post-processing settings (or defaults)
   */
  public getPostProcessingSettings(): PostProcessingSettings {
    return this.settings?.postProcessing ?? {
      bloom: { enabled: true, intensity: 0.3 },
      vignette: { enabled: true, weight: 0.3 },
      ssao: { enabled: false, intensity: 0.5 },
      chromaticAberration: { enabled: false }
    };
  }

  /**
   * Check if settings have been loaded
   */
  public isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get raw settings data
   */
  public getRawSettings(): EngineSettingsData | null {
    return this.settings;
  }
}
