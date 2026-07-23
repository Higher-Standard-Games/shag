/**
 * StreetLampSystem - Manages street lamps that turn on/off with day/night cycle
 *
 * Features:
 * - Automatic on/off based on time of day
 * - Smooth fade in/out transitions
 * - Configurable colors and intensities
 * - Optional flickering effect
 */

import { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer";
import "@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { GameClock, type TimePeriod } from "../core/GameClock";
import { supportsClusteredLighting } from "./DynamicLightCluster";

// ==================== Types ====================

export interface StreetLampConfig {
  id: string;
  position: Vector3;
  color?: Color3; // Light color (default: warm yellow)
  intensity?: number; // Max intensity when on (default: 1.0)
  range?: number; // Light range (default: 100)
  fadeTime?: number; // Fade duration in seconds (default: 2)
  turnOnHour?: number; // Hour to turn on (default: 18 - 6 PM)
  turnOffHour?: number; // Hour to turn off (default: 6 - 6 AM)
  flickerEnabled?: boolean; // Enable subtle flicker (default: false)
  showBulb?: boolean; // Show glowing bulb mesh (default: true)
  bulbSize?: number; // Bulb mesh size (default: 3)
}

interface StreetLamp {
  config: Required<StreetLampConfig>;
  light: PointLight;
  bulb: Mesh | null;
  bulbMaterial: StandardMaterial | null;
  isOn: boolean;
  currentIntensity: number;
  targetIntensity: number;
}

// ==================== Default Values ====================

const DEFAULT_LAMP_COLOR = new Color3(1.0, 0.85, 0.5); // Warm yellow
const DEFAULT_INTENSITY = 1.0;
const DEFAULT_RANGE = 100;
const DEFAULT_FADE_TIME = 2; // seconds
const DEFAULT_TURN_ON_HOUR = 18; // 6 PM
const DEFAULT_TURN_OFF_HOUR = 6; // 6 AM
const DEFAULT_BULB_SIZE = 3;

// ==================== StreetLampSystem Class ====================

export class StreetLampSystem {
  private static instance: StreetLampSystem;

  private scene: Scene | null = null;
  private lamps: Map<string, StreetLamp> = new Map();
  private clusteredLights: ClusteredLightContainer | null = null;

  private constructor() {}

  public static getInstance(): StreetLampSystem {
    if (!StreetLampSystem.instance) {
      StreetLampSystem.instance = new StreetLampSystem();
    }
    return StreetLampSystem.instance;
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Initialize the street lamp system
   */
  public init(scene: Scene): void {
    this.scene = scene;

    // Note: ClusteredLightContainer is now created lazily when the first light is added.
    // Creating an empty container can cause issues with Babylon.js material ready checks.

    // Subscribe to clock period changes for instant response
    const clock = GameClock.getInstance();
    clock.on((event, data) => {
      if (event === "period_changed") {
        const { to } = data as { from: TimePeriod; to: TimePeriod };
        this.onPeriodChanged(to);
      }
    });

    // Initial state check
    this.checkLampStates();

    console.log("StreetLampSystem initialized (clustered lights will be created on demand)");
  }

  /**
   * Ensure clustered light container exists (lazy initialization)
   */
  private ensureClusteredLights(): void {
    if (!this.scene || this.clusteredLights) return;
    if (!supportsClusteredLighting(this.scene)) return;

    // Create clustered light container for street lamp point lights
    // Configure for orthographic camera compatibility
    this.clusteredLights = new ClusteredLightContainer("streetLampCluster", [], this.scene);
    this.clusteredLights.depthSlices = 4;
    this.clusteredLights.horizontalTiles = 8;
    this.clusteredLights.verticalTiles = 8;
    this.clusteredLights.maxRange = 1000;
    console.log("StreetLampSystem: Created clustered light container");
  }

  /**
   * Create a street lamp
   */
  public createLamp(config: StreetLampConfig): StreetLamp | null {
    if (!this.scene) {
      console.error("StreetLampSystem not initialized");
      return null;
    }

    // Apply defaults
    const fullConfig: Required<StreetLampConfig> = {
      id: config.id,
      position: config.position,
      color: config.color ?? DEFAULT_LAMP_COLOR,
      intensity: config.intensity ?? DEFAULT_INTENSITY,
      range: config.range ?? DEFAULT_RANGE,
      fadeTime: config.fadeTime ?? DEFAULT_FADE_TIME,
      turnOnHour: config.turnOnHour ?? DEFAULT_TURN_ON_HOUR,
      turnOffHour: config.turnOffHour ?? DEFAULT_TURN_OFF_HOUR,
      flickerEnabled: config.flickerEnabled ?? false,
      showBulb: config.showBulb ?? true,
      bulbSize: config.bulbSize ?? DEFAULT_BULB_SIZE,
    };

    // Create point light
    const light = new PointLight(`streetLamp_${config.id}`, config.position, this.scene);
    light.diffuse = fullConfig.color;
    light.specular = fullConfig.color.scale(0.3);
    light.range = fullConfig.range;
    light.intensity = 0; // Start off

    // Lazily create clustered light container, then add this light
    this.ensureClusteredLights();
    if (this.clusteredLights) {
      this.clusteredLights.addLight(light);
    }

    // Create glowing bulb mesh
    let bulb: Mesh | null = null;
    let bulbMaterial: StandardMaterial | null = null;

    if (fullConfig.showBulb) {
      bulb = MeshBuilder.CreateSphere(
        `lampBulb_${config.id}`,
        {
          diameter: fullConfig.bulbSize,
          segments: 8,
        },
        this.scene,
      );
      bulb.position = config.position;

      bulbMaterial = new StandardMaterial(`lampBulbMat_${config.id}`, this.scene);
      bulbMaterial.emissiveColor = new Color3(0, 0, 0); // Start dark
      bulbMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
      bulbMaterial.specularColor = new Color3(0, 0, 0);
      bulb.material = bulbMaterial;
    }

    // Determine initial state based on current time
    const clock = GameClock.getInstance();
    const hour = clock.getTimeOfDay().hour;
    const shouldBeOn = this.shouldLampBeOn(hour, fullConfig);

    const lamp: StreetLamp = {
      config: fullConfig,
      light,
      bulb,
      bulbMaterial,
      isOn: shouldBeOn,
      currentIntensity: shouldBeOn ? fullConfig.intensity : 0,
      targetIntensity: shouldBeOn ? fullConfig.intensity : 0,
    };

    // Set initial intensity
    light.intensity = lamp.currentIntensity;
    if (bulbMaterial && shouldBeOn) {
      bulbMaterial.emissiveColor = fullConfig.color.scale(lamp.currentIntensity);
    }

    this.lamps.set(config.id, lamp);
    console.log(`Created street lamp: ${config.id} at ${config.position.toString()}`);

    return lamp;
  }

  /**
   * Update lamp intensities (call every frame)
   */
  public update(deltaTime: number): void {
    for (const lamp of this.lamps.values()) {
      // Smooth fade towards target
      if (lamp.currentIntensity !== lamp.targetIntensity) {
        const fadeSpeed = lamp.config.intensity / lamp.config.fadeTime;
        const diff = lamp.targetIntensity - lamp.currentIntensity;
        const change = Math.sign(diff) * fadeSpeed * deltaTime;

        if (Math.abs(change) >= Math.abs(diff)) {
          lamp.currentIntensity = lamp.targetIntensity;
        } else {
          lamp.currentIntensity += change;
        }

        // Apply intensity
        lamp.light.intensity = lamp.currentIntensity;

        // Update bulb glow
        if (lamp.bulbMaterial) {
          lamp.bulbMaterial.emissiveColor = lamp.config.color.scale(lamp.currentIntensity / lamp.config.intensity);
        }
      }

      // Optional flicker effect when on
      if (lamp.config.flickerEnabled && lamp.isOn && lamp.currentIntensity > 0) {
        const flicker = 1 + (Math.random() - 0.5) * 0.1; // ±5% variation
        lamp.light.intensity = lamp.currentIntensity * flicker;
      }
    }
  }

  /**
   * Check if a lamp should be on based on hour
   */
  private shouldLampBeOn(hour: number, config: Required<StreetLampConfig>): boolean {
    // Handle overnight case (e.g., on at 18, off at 6)
    if (config.turnOnHour > config.turnOffHour) {
      return hour >= config.turnOnHour || hour < config.turnOffHour;
    } else {
      return hour >= config.turnOnHour && hour < config.turnOffHour;
    }
  }

  /**
   * Check and update all lamp states based on current time
   */
  private checkLampStates(): void {
    const clock = GameClock.getInstance();
    const hour = clock.getTimeOfDay().hour;

    for (const lamp of this.lamps.values()) {
      const shouldBeOn = this.shouldLampBeOn(hour, lamp.config);

      if (shouldBeOn !== lamp.isOn) {
        lamp.isOn = shouldBeOn;
        lamp.targetIntensity = shouldBeOn ? lamp.config.intensity : 0;
      }
    }
  }

  /**
   * Handle period changes for responsive lighting
   */
  private onPeriodChanged(period: TimePeriod): void {
    // Turn on during dusk/evening/night, off during dawn/morning/afternoon
    const nightPeriods: TimePeriod[] = ["dusk", "evening", "night"];
    const isNightTime = nightPeriods.includes(period);

    for (const lamp of this.lamps.values()) {
      // Only auto-switch if using default hours
      if (lamp.config.turnOnHour === DEFAULT_TURN_ON_HOUR && lamp.config.turnOffHour === DEFAULT_TURN_OFF_HOUR) {
        if (isNightTime && !lamp.isOn) {
          this.turnOn(lamp.config.id);
        } else if (!isNightTime && lamp.isOn) {
          this.turnOff(lamp.config.id);
        }
      }
    }
  }

  /**
   * Turn on a specific lamp
   */
  public turnOn(id: string): void {
    const lamp = this.lamps.get(id);
    if (lamp && !lamp.isOn) {
      lamp.isOn = true;
      lamp.targetIntensity = lamp.config.intensity;
    }
  }

  /**
   * Turn off a specific lamp
   */
  public turnOff(id: string): void {
    const lamp = this.lamps.get(id);
    if (lamp?.isOn) {
      lamp.isOn = false;
      lamp.targetIntensity = 0;
    }
  }

  /**
   * Toggle a specific lamp
   */
  public toggle(id: string): void {
    const lamp = this.lamps.get(id);
    if (lamp) {
      if (lamp.isOn) {
        this.turnOff(id);
      } else {
        this.turnOn(id);
      }
    }
  }

  /**
   * Set lamp color
   */
  public setColor(id: string, color: Color3): void {
    const lamp = this.lamps.get(id);
    if (lamp) {
      lamp.config.color = color;
      lamp.light.diffuse = color;
      lamp.light.specular = color.scale(0.3);
    }
  }

  /**
   * Get all lamps
   */
  public getLamps(): Map<string, StreetLamp> {
    return this.lamps;
  }

  /**
   * Get a specific lamp
   */
  public getLamp(id: string): StreetLamp | undefined {
    return this.lamps.get(id);
  }

  /**
   * Remove a lamp
   */
  public removeLamp(id: string): void {
    const lamp = this.lamps.get(id);
    if (lamp) {
      lamp.light.dispose();
      lamp.bulb?.dispose();
      lamp.bulbMaterial?.dispose();
      this.lamps.delete(id);
    }
  }

  /**
   * Clear all lamps
   */
  public clear(): void {
    for (const lamp of this.lamps.values()) {
      lamp.light.dispose();
      lamp.bulb?.dispose();
      lamp.bulbMaterial?.dispose();
    }
    this.lamps.clear();
  }

  /**
   * Dispose the system
   */
  public dispose(): void {
    this.clear();
    this.scene = null;
  }
}
