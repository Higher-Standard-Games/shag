/**
 * PostProcessingManager - Manages global graphics effects
 * 
 * Uses Babylon.js DefaultRenderingPipeline for:
 * - Bloom (glow on bright objects like grow lights)
 * - Color Grading (mood/atmosphere tied to day/night)
 * - Vignette (subtle darkening at edges)
 * - SSAO (ambient occlusion for grounded feel)
 * - Chromatic Aberration (optional lens effect)
 * 
 * Designed to be extensible for future weather effects.
 */

import { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { EventBus } from "../core/EventBus";
import { CelOutlinePostProcess } from "./CelOutlinePostProcess";
import { Cvar } from "../core/Cvar";

export interface PostProcessingSettings {
  // Master toggle
  enabled: boolean;

  // Bloom settings
  bloom: {
    enabled: boolean;
    threshold: number;    // Brightness threshold (0-1)
    weight: number;       // Intensity (0-1)
    kernel: number;       // Blur kernel size (default 64)
    scale: number;        // Resolution scale (0.5 = half res for performance)
  };

  // Color grading
  colorGrading: {
    enabled: boolean;
    contrast: number;     // 1.0 = normal
    exposure: number;     // 1.0 = normal
    saturation: number;   // 1.0 = normal
  };

  // Vignette
  vignette: {
    enabled: boolean;
    weight: number;       // Intensity (0-1)
    color: { r: number; g: number; b: number };
    stretch: number;      // How much to stretch (0-1)
  };

  // SSAO (Screen Space Ambient Occlusion)
  ssao: {
    enabled: boolean;
    radius: number;       // Sample radius
    samples: number;      // Quality (8-32)
    intensity: number;    // Darkness intensity
  };

  // Chromatic Aberration (subtle lens effect)
  chromaticAberration: {
    enabled: boolean;
    amount: number;       // Intensity (0-1)
  };
}

// Default settings - balanced for performance and visuals
const DEFAULT_SETTINGS: PostProcessingSettings = {
  enabled: true,

  bloom: {
    enabled: true,
    threshold: 0.8,      // Only bright things glow
    weight: 0.3,         // Subtle glow
    kernel: 64,
    scale: 0.5,          // Half resolution for performance
  },

  colorGrading: {
    enabled: true,
    contrast: 1.05,      // Slightly more contrast
    exposure: 1.0,
    saturation: 1.1,     // Slightly more vibrant
  },

  vignette: {
    enabled: true,
    weight: 0.3,         // Subtle darkening
    color: { r: 0, g: 0, b: 0 },
    stretch: 0.5,
  },

  ssao: {
    enabled: false,      // Disabled by default (performance heavy)
    radius: 2,
    samples: 16,
    intensity: 1.0,
  },

  chromaticAberration: {
    enabled: false,      // Disabled by default
    amount: 0.5,
  },
};

export class PostProcessingManager {
  private static instance: PostProcessingManager;

  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssaoPipeline: SSAO2RenderingPipeline | null = null;

  private settings: PostProcessingSettings = { ...DEFAULT_SETTINGS };
  private initialized = false;

  private _cameraChangeUnsub: (() => void) | null = null;

  private constructor() { }

  public static getInstance(): PostProcessingManager {
    if (!PostProcessingManager.instance) {
      PostProcessingManager.instance = new PostProcessingManager();
    }
    return PostProcessingManager.instance;
  }

  /**
   * Initialize post-processing with scene and camera
   */
  public init(scene: Scene, camera: Camera): void {
    if (this.initialized) {
      console.warn("[PostProcessingManager] Already initialized");
      return;
    }

    this.scene = scene;
    this.camera = camera;

    this.createPipeline();
    this.setupEventListeners();
    this.initCelOutline(scene, camera);

    this.initialized = true;
    console.log("[PostProcessingManager] Initialized with default settings");
  }

  /**
   * Rebind post-processing to a new active camera.
   * This is needed when the engine swaps scene.activeCamera (e.g. BSP/freefly).
   */
  public setCamera(camera: Camera): void {
    if (!this.initialized) return;
    if (!this.scene) return;
    if (this.camera === camera) return;

    this.camera = camera;

    // Rebind cel outline to new camera
    CelOutlinePostProcess.getInstance().setCamera(camera);

    // Recreate the pipelines to ensure they are attached to the new camera
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (this.ssaoPipeline) {
      this.ssaoPipeline.dispose();
      this.ssaoPipeline = null;
    }

    this.createPipeline();
  }

  /**
   * Create the rendering pipeline with current settings
   */
  private createPipeline(): void {
    if (!this.scene || !this.camera) return;

    // Create DefaultRenderingPipeline
    this.pipeline = new DefaultRenderingPipeline(
      "defaultPipeline",
      true,  // HDR
      this.scene,
      [this.camera]
    );

    // Apply all settings
    this.applySettings();

    console.log("[PostProcessingManager] Pipeline created");
  }

  /**
   * Apply current settings to the pipeline
   */
  private applySettings(): void {
    if (!this.pipeline) return;

    const s = this.settings;

    // Master toggle
    if (!s.enabled) {
      this.pipeline.bloomEnabled = false;
      this.pipeline.imageProcessingEnabled = false;
      this.pipeline.chromaticAberrationEnabled = false;
      return;
    }

    // Bloom
    this.pipeline.bloomEnabled = s.bloom.enabled;
    if (s.bloom.enabled) {
      this.pipeline.bloomThreshold = s.bloom.threshold;
      this.pipeline.bloomWeight = s.bloom.weight;
      this.pipeline.bloomKernel = s.bloom.kernel;
      this.pipeline.bloomScale = s.bloom.scale;
    }

    // Color grading (via image processing)
    this.pipeline.imageProcessingEnabled = s.colorGrading.enabled || s.vignette.enabled;
    if (this.pipeline.imageProcessing) {
      this.pipeline.imageProcessing.contrast = s.colorGrading.contrast;
      this.pipeline.imageProcessing.exposure = s.colorGrading.exposure;

      // Vignette
      this.pipeline.imageProcessing.vignetteEnabled = s.vignette.enabled;
      if (s.vignette.enabled) {
        this.pipeline.imageProcessing.vignetteWeight = s.vignette.weight;
        this.pipeline.imageProcessing.vignetteColor = new Color4(
          s.vignette.color.r,
          s.vignette.color.g,
          s.vignette.color.b,
          1
        );
        this.pipeline.imageProcessing.vignetteStretch = s.vignette.stretch;
      }
    }

    // Chromatic Aberration
    this.pipeline.chromaticAberrationEnabled = s.chromaticAberration.enabled;
    if (s.chromaticAberration.enabled && this.pipeline.chromaticAberration) {
      this.pipeline.chromaticAberration.aberrationAmount = s.chromaticAberration.amount;
    }

    // SSAO (separate pipeline)
    this.updateSSAO();
  }

  /**
   * Update SSAO pipeline
   */
  private updateSSAO(): void {
    if (!this.scene || !this.camera) return;

    const s = this.settings.ssao;

    if (s.enabled && !this.ssaoPipeline) {
      // Create SSAO2 pipeline (better quality than SSAO)
      this.ssaoPipeline = new SSAO2RenderingPipeline(
        "ssao",
        this.scene,
        {
          ssaoRatio: 0.5,      // Half resolution for performance
          blurRatio: 0.5,
        },
        [this.camera]
      );
      this.ssaoPipeline.radius = s.radius;
      this.ssaoPipeline.totalStrength = s.intensity;
      this.ssaoPipeline.samples = s.samples;
      console.log("[PostProcessingManager] SSAO enabled");
    } else if (!s.enabled && this.ssaoPipeline) {
      // Dispose SSAO pipeline
      this.ssaoPipeline.dispose();
      this.ssaoPipeline = null;
      console.log("[PostProcessingManager] SSAO disabled");
    } else if (s.enabled && this.ssaoPipeline) {
      // Update existing SSAO settings
      this.ssaoPipeline.radius = s.radius;
      this.ssaoPipeline.totalStrength = s.intensity;
      this.ssaoPipeline.samples = s.samples;
    }
  }

  /**
   * Setup event listeners for day/night cycle integration
   */
  private setupEventListeners(): void {
    // Listen for time changes to adjust color grading
    EventBus.on<{ hour: number; minute: number }>("clock:tick", (data) => {
      this.updateColorGradingForTime(data.hour, data.minute);
    });

    // Keep pipeline attached to the current active camera
    if (!this._cameraChangeUnsub) {
      this._cameraChangeUnsub = EventBus.on<{ type: string }>("camera:controller_changed", () => {
        if (!this.scene) return;
        const active = this.scene.activeCamera;
        if (active) {
          this.setCamera(active);
        }
      });
    }
  }

  /**
   * Adjust color grading based on time of day
   */
  private updateColorGradingForTime(hour: number, minute: number): void {
    if (!this.pipeline?.imageProcessing || !this.settings.colorGrading.enabled) return;

    // Calculate time as decimal (0-24)
    const time = hour + minute / 60;

    // Adjust exposure and saturation based on time
    // Dawn (5-7): warm, slightly desaturated
    // Day (7-17): normal
    // Dusk (17-20): warm, golden hour
    // Night (20-5): cool, desaturated

    let exposure = 1.0;

    if (time >= 5 && time < 7) {
      // Dawn - gradually brighten
      const t = (time - 5) / 2;
      exposure = 0.8 + t * 0.2;
    } else if (time >= 17 && time < 20) {
      // Dusk - golden hour, then darken
      const t = (time - 17) / 3;
      exposure = 1.0 - t * 0.3;
    } else if (time >= 20 || time < 5) {
      // Night - dark
      exposure = 0.7;
    }

    // Apply smoothly (don't override user settings, just modulate)
    this.pipeline.imageProcessing.exposure = this.settings.colorGrading.exposure * exposure;
    // Note: saturation is not directly available in imageProcessing, would need color curves
  }

  // ==================== Public API ====================

  /**
   * Enable or disable all post-processing
   */
  public setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.applySettings();
    console.log(`[PostProcessingManager] ${enabled ? "Enabled" : "Disabled"}`);
  }

  /**
   * Enable or disable bloom
   */
  public setBloomEnabled(enabled: boolean): void {
    this.settings.bloom.enabled = enabled;
    if (this.pipeline) {
      this.pipeline.bloomEnabled = enabled;
    }
  }

  /**
   * Set bloom intensity
   */
  public setBloomIntensity(weight: number): void {
    this.settings.bloom.weight = Math.max(0, Math.min(1, weight));
    if (this.pipeline) {
      this.pipeline.bloomWeight = this.settings.bloom.weight;
    }
  }

  /**
   * Set bloom threshold (brightness level that triggers glow)
   */
  public setBloomThreshold(threshold: number): void {
    this.settings.bloom.threshold = Math.max(0, Math.min(1, threshold));
    if (this.pipeline) {
      this.pipeline.bloomThreshold = this.settings.bloom.threshold;
    }
  }

  /**
   * Enable or disable vignette
   */
  public setVignetteEnabled(enabled: boolean): void {
    this.settings.vignette.enabled = enabled;
    if (this.pipeline?.imageProcessing) {
      this.pipeline.imageProcessing.vignetteEnabled = enabled;
    }
  }

  /**
   * Set vignette intensity
   */
  public setVignetteIntensity(weight: number): void {
    this.settings.vignette.weight = Math.max(0, Math.min(1, weight));
    if (this.pipeline?.imageProcessing) {
      this.pipeline.imageProcessing.vignetteWeight = this.settings.vignette.weight;
    }
  }

  /**
   * Enable or disable SSAO
   */
  public setSSAOEnabled(enabled: boolean): void {
    this.settings.ssao.enabled = enabled;
    this.updateSSAO();
  }

  /**
   * Set SSAO intensity
   */
  public setSSAOIntensity(intensity: number): void {
    this.settings.ssao.intensity = Math.max(0, Math.min(2, intensity));
    if (this.ssaoPipeline) {
      this.ssaoPipeline.totalStrength = this.settings.ssao.intensity;
    }
  }

  /**
   * Enable or disable chromatic aberration
   */
  public setChromaticAberrationEnabled(enabled: boolean): void {
    this.settings.chromaticAberration.enabled = enabled;
    if (this.pipeline) {
      this.pipeline.chromaticAberrationEnabled = enabled;
    }
  }

  /**
   * Get current settings
   */
  public getSettings(): Readonly<PostProcessingSettings> {
    return this.settings;
  }

  /**
   * Update multiple settings at once
   */
  public updateSettings(partial: Partial<PostProcessingSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.applySettings();
  }

  /**
   * Reset to default settings
   */
  public resetToDefaults(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.applySettings();
    console.log("[PostProcessingManager] Reset to defaults");
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (this.ssaoPipeline) {
      this.ssaoPipeline.dispose();
      this.ssaoPipeline = null;
    }
    CelOutlinePostProcess.getInstance().dispose();
    if (this._cameraChangeUnsub) {
      this._cameraChangeUnsub();
      this._cameraChangeUnsub = null;
    }
    this.initialized = false;
    console.log("[PostProcessingManager] Disposed");
  }

  // ==================== Cel Outline ====================

  /**
   * Initialize cel outline post-process and register cvars
   */
  private initCelOutline(scene: Scene, camera: Camera): void {
    const cel = CelOutlinePostProcess.getInstance();
    cel.init(scene, camera);

    // Register cvars with onChange callbacks
    Cvar.register('r_cel_outlines', 1, {
      type: 'int',
      min: 0,
      max: 1,
      description: 'Enable cel-shading outlines (0/1)',
      onChange: (value) => cel.setEnabled(!!value),
    });

    Cvar.register('r_cel_thickness', 1.5, {
      type: 'float',
      min: 0.1,
      max: 8.0,
      description: 'Cel outline thickness in pixels',
      onChange: (value) => cel.setThickness(value as number),
    });

    Cvar.register('r_cel_depth_threshold', 0.1, {
      type: 'float',
      min: 0.001,
      max: 1.0,
      description: 'Cel outline depth edge sensitivity (lower = more edges)',
      onChange: (value) => cel.setDepthThreshold(value as number),
    });

    Cvar.register('r_cel_normal_threshold', 0.3, {
      type: 'float',
      min: 0.01,
      max: 2.0,
      description: 'Cel outline normal edge sensitivity (lower = more edges)',
      onChange: (value) => cel.setNormalThreshold(value as number),
    });

    Cvar.register('r_cel_opacity', 1.0, {
      type: 'float',
      min: 0.0,
      max: 1.0,
      description: 'Cel outline opacity',
      onChange: (value) => cel.setOpacity(value as number),
    });

    Cvar.register('r_cel_color', '0 0 0', {
      type: 'string',
      description: 'Cel outline RGB color ("r g b", 0-1 range)',
      onChange: (value) => cel.setColorFromString(value as string),
    });

    // Apply initial cvar values (in case they were loaded from storage)
    cel.setEnabled(Cvar.getBool('r_cel_outlines'));
    cel.setThickness(Cvar.getNumber('r_cel_thickness'));
    cel.setDepthThreshold(Cvar.getNumber('r_cel_depth_threshold'));
    cel.setNormalThreshold(Cvar.getNumber('r_cel_normal_threshold'));
    cel.setOpacity(Cvar.getNumber('r_cel_opacity'));
    cel.setColorFromString(Cvar.getString('r_cel_color'));

    console.log('[PostProcessingManager] Cel outline cvars registered');
  }
}
