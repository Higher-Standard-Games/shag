/**
 * World fog for the loaded map, drawn through Babylon's scene fog.
 *
 * The map's worldspawn fog (WorldFog.ts) becomes Babylon EXP fog: density 3 /
 * fog_dist, `fogStart` = mindist (EXP counts from it once `fixFogStartForExp`
 * has patched the shader), colour as given. Babylon carries those values to
 * every material that draws fog, on WebGL and WebGPU alike.
 *
 * Cvars follow Warfork (r_main.c): `r_fog 0` turns world fog off. The
 * `r_fog_*` overrides need `developer 1` and take over only while
 * `r_fog_distance` is above 0, which also shows fog on maps without any.
 *
 * Fog volumes and the underwater view borrow the scene fog: `suspend(owner)`
 * while they set their own, `resume(owner)` to hand it back.
 */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { type EngineWorldFog, leadingNumbers, type WorldFogConfig, worldFogToEngine } from "../loader/bsp/WorldFog";
import { DEFAULT_SKY_HEIGHT } from "../loader/shader/Q3ShaderTypes";
import { registerAtmosphericFogPlugin } from "./AtmosphericFogPlugin";
import { fixFogStartForExp } from "./BabylonShaderFixes";

/** The cvar values that shape world fog. */
export interface FogCvars {
  enabled: boolean;
  distance: number;
  color: string;
  minDist: number;
  heightClear: number;
  heightFull: number;
  sunDir: string;
  sunColor: string;
  sunInscatter: number;
  skyBlend: number;
}

/** "Not set" sentinels, as Warfork's cvar defaults. */
const INHERIT_HEIGHT_CLEAR = 99999;
const INHERIT_HEIGHT_FULL = -99999;
/** r_fog_color's default: with the overrides on, the colour comes from it even on a fogged map. */
const OVERRIDE_COLOR = "0.75 0.75 0.75";

/**
 * The fog to draw, from the map's fog and the cvars, as Warfork's r_main.c
 * decides it. Quake units and axes. Null for no fog.
 */
export function resolveWorldFog(
  map: WorldFogConfig | null,
  cvars: FogCvars,
  developer: boolean,
): WorldFogConfig | null {
  if (!cvars.enabled) return null;
  const override = developer && cvars.distance > 0;
  if (!override) return map;

  // The cvars are the source, starting from the map's fog. A map without fog
  // has no colour (Warfork's alpha 0) until r_fog_color gives one.
  const color = leadingNumbers(cvars.color, 3);
  if (!map && color.length < 3) return null;
  const fog: WorldFogConfig = map
    ? {
        ...map,
        height: map.height && { ...map.height },
        sun: map.sun && { ...map.sun },
        sky: map.sky && { ...map.sky },
      }
    : { color: [0, 0, 0], density: 0, minDist: 0, height: null, sun: null, sky: null };
  fog.density = 3 / cvars.distance;
  if (color.length >= 3) fog.color = [color[0], color[1], color[2]];
  if (cvars.minDist >= 0) fog.minDist = cvars.minDist;

  if (cvars.heightClear < 90000) fog.height = { clear: cvars.heightClear, full: fog.height?.full ?? 0 };
  if (cvars.heightFull > -90000) fog.height = { clear: fog.height?.clear ?? 0, full: cvars.heightFull };

  const sun = fog.sun ?? { dir: [0.577, 0.577, 0.577], color: [1, 0.9, 0.7], intensity: 1.5, exponent: 16 };
  let sunChanged = false;
  if (cvars.sunInscatter >= 0) {
    sun.intensity = cvars.sunInscatter;
    sunChanged = true;
  }
  const dir = leadingNumbers(cvars.sunDir, 3);
  if (dir.length === 3) {
    const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    sun.dir = [dir[0] / length, dir[1] / length, dir[2] / length];
    sunChanged = true;
  }
  const sunColor = leadingNumbers(cvars.sunColor, 4);
  if (sunColor.length >= 3) {
    sun.color = [sunColor[0], sunColor[1], sunColor[2]];
    sun.exponent = sunColor[3] !== undefined && sunColor[3] > 0 ? sunColor[3] : 16;
    sunChanged = true;
  }
  if (sunChanged) fog.sun = sun;

  if (cvars.skyBlend >= 0) {
    fog.sky = cvars.skyBlend > 0 ? (fog.sky ?? { horizonBias: 0.05, horizonScale: 2, zenithFalloff: 3 }) : null;
  }
  return fog;
}

export class WorldFogController {
  private static instance: WorldFogController | null = null;

  private scene: Scene | null = null;
  private mapFog: WorldFogConfig | null = null;
  private skyHeight = DEFAULT_SKY_HEIGHT;
  private active: EngineWorldFog | null = null;
  /** Inside a sky portal pass: Warfork's skyportal fog scale (1 / the portal's scale), else 0. */
  private portalScale = 0;
  private portalFog: EngineWorldFog | null = null;
  private readonly borrowers = new Set<string>();
  private readonly listeners = new Set<(fog: EngineWorldFog | null) => void>();
  private cvarsRegistered = false;

  static getInstance(): WorldFogController {
    WorldFogController.instance ??= new WorldFogController();
    return WorldFogController.instance;
  }

  private constructor() {
    fixFogStartForExp();
    registerAtmosphericFogPlugin(this);
  }

  /** Register `r_fog` and the developer overrides; idempotent. */
  registerCvars(): void {
    if (this.cvarsRegistered) return;
    this.cvarsRegistered = true;
    const refresh = () => this.refresh();
    const dev = { persist: false, onChange: refresh };
    Cvar.register("r_fog", true, { type: "bool", description: "World fog from the map (0/1)", onChange: refresh });
    Cvar.register("r_fog_distance", 0, {
      ...dev,
      type: "float",
      min: 0,
      description: "Developer: fog ~95% opaque at this distance; above 0 the r_fog_* cvars replace the map's fog",
    });
    Cvar.register("r_fog_color", OVERRIDE_COLOR, {
      ...dev,
      type: "string",
      description: 'Developer: fog colour "r g b" (0-1)',
    });
    Cvar.register("r_fog_mindist", -1, {
      ...dev,
      type: "float",
      description: "Developer: fog start distance; -1 keeps the map's",
    });
    Cvar.register("r_fog_height_clear", INHERIT_HEIGHT_CLEAR, {
      ...dev,
      type: "float",
      description: "Developer: height where fog is clear; 99999 keeps the map's",
    });
    Cvar.register("r_fog_height_full", INHERIT_HEIGHT_FULL, {
      ...dev,
      type: "float",
      description: "Developer: height where fog is full; -99999 keeps the map's",
    });
    Cvar.register("r_fog_sun_dir", "", {
      ...dev,
      type: "string",
      description: 'Developer: sun direction "x y z" (Quake axes)',
    });
    Cvar.register("r_fog_sun_color", "", {
      ...dev,
      type: "string",
      description: 'Developer: sun glow "r g b [exponent]"',
    });
    Cvar.register("r_fog_sun_inscatter", -1, {
      ...dev,
      type: "float",
      description: "Developer: sun glow intensity; -1 keeps the map's",
    });
    Cvar.register("r_fog_sky_blend", -1, {
      ...dev,
      type: "float",
      description: "Developer: sky horizon tint 0/1; -1 keeps the map's",
    });
  }

  /** The map's fog and sky height, at load; null at unload. */
  setMap(scene: Scene | null, fog: WorldFogConfig | null, skyHeight = DEFAULT_SKY_HEIGHT): void {
    const previous = this.scene;
    if (previous && previous !== scene && this.borrowers.size === 0) previous.fogMode = Scene.FOGMODE_NONE;
    this.scene = scene;
    this.mapFog = fog;
    this.skyHeight = skyHeight > 0 ? skyHeight : DEFAULT_SKY_HEIGHT;
    this.refresh();
  }

  /** The fog being drawn, in engine space; null for none. Scaled inside a sky portal pass. */
  getActive(): EngineWorldFog | null {
    return this.portalScale > 0 ? this.portalFog : this.active;
  }

  /**
   * A sky portal draws its area at a scale: Warfork multiplies the fog's start
   * and heights by `scale` and divides its density by it for that pass. 0 ends it.
   */
  setPortalScale(scale: number): void {
    if (scale === this.portalScale) return;
    this.portalScale = scale;
    const fog = this.active;
    this.portalFog =
      scale > 0 && fog
        ? {
            ...fog,
            minDist: fog.minDist * scale,
            density: fog.density / scale,
            height: fog.height && { clear: fog.height.clear * scale, full: fog.height.full * scale },
          }
        : null;
    this.applyToScene();
  }

  /** World fog is drawn now: there is fog, and no one has borrowed the scene fog. */
  isDrawing(): boolean {
    return this.active !== null && this.active.density > 0 && this.borrowers.size === 0;
  }

  /**
   * Whether `scene` is drawing world fog: the map's scene, not a preview or
   * the menu logo, whose materials carry the plugin as every material does.
   */
  isDrawingIn(scene: Scene): boolean {
    return this.scene === scene && this.isDrawing();
  }

  /** The sky's height, the distance world fog treats the sky as being at. */
  getSkyHeight(): number {
    return this.skyHeight;
  }

  /** Hear about every change of the drawn fog; returns the unsubscribe. */
  onChange(listener: (fog: EngineWorldFog | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Another system takes the scene fog (a fog volume, under water). */
  suspend(owner: string): void {
    const first = this.borrowers.size === 0;
    this.borrowers.add(owner);
    // Materials go back to Babylon's fog, which the borrower sets
    if (first) this.refreshMaterials();
  }

  /** The scene fog comes back; world fog is drawn again once no one holds it. */
  resume(owner: string): void {
    if (this.borrowers.delete(owner) && this.borrowers.size === 0) {
      this.applyToScene();
      this.refreshMaterials();
    }
  }

  private cvars(): FogCvars {
    const number = (name: string, fallback: number) => {
      const value = Cvar.get(name);
      return typeof value === "number" ? value : fallback;
    };
    return {
      enabled: Cvar.get("r_fog") === undefined ? true : Cvar.getBool("r_fog"),
      distance: number("r_fog_distance", 0),
      color: Cvar.getString("r_fog_color"),
      minDist: number("r_fog_mindist", -1),
      heightClear: number("r_fog_height_clear", INHERIT_HEIGHT_CLEAR),
      heightFull: number("r_fog_height_full", INHERIT_HEIGHT_FULL),
      sunDir: Cvar.getString("r_fog_sun_dir"),
      sunColor: Cvar.getString("r_fog_sun_color"),
      sunInscatter: number("r_fog_sun_inscatter", -1),
      skyBlend: number("r_fog_sky_blend", -1),
    };
  }

  private refresh(): void {
    const fog = this.scene ? resolveWorldFog(this.mapFog, this.cvars(), Cvar.getBool("developer")) : null;
    this.active = fog ? worldFogToEngine(fog) : null;
    this.applyToScene();
    this.refreshMaterials();
    for (const listener of this.listeners) listener(this.active);
  }

  private applyToScene(): void {
    const scene = this.scene;
    if (!scene || this.borrowers.size > 0) return;
    const fog = this.getActive();
    if (!fog || fog.density <= 0) {
      scene.fogMode = Scene.FOGMODE_NONE;
      return;
    }
    scene.fogMode = Scene.FOGMODE_EXP;
    scene.fogDensity = fog.density;
    scene.fogStart = fog.minDist;
    scene.fogColor = new Color3(fog.color[0], fog.color[1], fog.color[2]);
  }

  /**
   * Fog that changes after a map has loaded has to reach every material: its
   * shader may gain or lose fog, and its fog values change. A frozen material
   * checks and binds only once, so it is marked dirty again by freeze().
   */
  private refreshMaterials(): void {
    for (const material of this.scene?.materials ?? []) {
      if (material.isFrozen) material.freeze();
      else material.markDirty(true);
    }
  }
}
