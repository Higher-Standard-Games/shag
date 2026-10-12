/**
 * Sky portals (`misc_skyportal`, also `props_skyportal`): the sky shows a part
 * of the map seen from the portal's origin, as Warfork draws it (g_misc.cpp
 * SP_skyportal, cg_view.cpp CG_SkyPortal, r_portals.c R_DrawSkyportal).
 *
 * Each frame the portal camera takes the player's view angles (plus the
 * portal's rotation speeds) at the portal origin and renders into a target the
 * size of the screen. That target is the background of the main view, and the
 * BSP leaves sky surfaces undrawn, so the sky openings show it. The sky meshes
 * move to a layer only the portal camera sees.
 *
 * Keys: `origin`; `fov` (else the player's); `scale` (world/sky-area ratio:
 * the camera moves by the player's offset from the world centre over scale);
 * `noents` (the portal shows map geometry only); `angles` read as pitch, yaw
 * and roll speeds in degrees per second, as Warfork reads them.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Layer } from "@babylonjs/core/Layers/layer";
import "@babylonjs/core/Layers/layerSceneComponent";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { leadingNumbers } from "../loader/bsp/WorldFog";
import { isSkyMesh } from "./AtmosphericFogPlugin";

/** Layer bit for sky meshes while a sky portal draws the sky. */
export const SKY_PORTAL_LAYER = 0x20000000;
/** The FPS weapon view's layer: its camera never sees the portal. */
const WEAPON_LAYER = 0x10000000;

export interface SkyPortalConfig {
  /** Portal camera origin, Quake axes. */
  origin: [number, number, number];
  /** Horizontal field of view in degrees; 0 keeps the player's. */
  fov: number;
  /** Warfork's `scale` key; 0 for a fixed camera. */
  scale: number;
  noEnts: boolean;
  /** Pitch, yaw and roll speeds in degrees per second. */
  rotationSpeed: [number, number, number];
}

/** The map's sky portal from its entities, or null. */
export function parseSkyPortal(
  entities: readonly { classname: string; properties: Record<string, string> }[],
): SkyPortalConfig | null {
  const entity = entities.find((e) => e.classname === "misc_skyportal" || e.classname === "props_skyportal");
  if (!entity) return null;
  const origin = leadingNumbers(entity.properties.origin, 3);
  if (origin.length < 3) return null;
  const angles = leadingNumbers(entity.properties.angles, 3);
  return {
    origin: [origin[0], origin[1], origin[2]],
    fov: leadingNumbers(entity.properties.fov, 1)[0] ?? 0,
    scale: leadingNumbers(entity.properties.scale, 1)[0] ?? 0,
    noEnts: (leadingNumbers(entity.properties.noents, 1)[0] ?? 0) !== 0,
    rotationSpeed: [angles[0] ?? 0, angles[1] ?? 0, angles[2] ?? 0],
  };
}

const q3ToEngine = ([x, y, z]: readonly number[]) => new Vector3(x, z, y);

/**
 * Where the portal camera stands for a player at `viewOrigin` (engine space):
 * the portal origin, moved by the player's offset from the world centre over
 * the scale when there is one.
 */
export function skyPortalCameraOrigin(
  portalOrigin: Vector3,
  scale: number,
  worldCentre: Vector3,
  viewOrigin: Vector3,
): Vector3 {
  if (!scale) return portalOrigin.clone();
  // Warfork: vieworg = portal - (1/scale) * (centre - view)
  return portalOrigin.subtract(worldCentre.subtract(viewOrigin).scale(1 / scale));
}

export interface SkyPortalHooks {
  /** Show the PVS from a position (engine space); called before and after the portal pass. */
  setVisibilityFrom?: (position: Vector3 | null) => void;
  /** Scale world fog for the portal pass (Warfork's skyportal fog scale), 0 to undo. */
  setFogScale?: (scale: number) => void;
  /** Meshes that belong to the map, for `noents`. */
  isMapMesh?: (mesh: AbstractMesh) => boolean;
}

export class SkyPortalView {
  private readonly camera: TargetCamera;
  private readonly target: RenderTargetTexture;
  private readonly layer: Layer;
  private readonly portalOrigin: Vector3;
  private readonly worldCentre: Vector3;
  private readonly startTime = performance.now();
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly config: SkyPortalConfig,
    worldBounds: { mins: readonly number[]; maxs: readonly number[] },
    private readonly hooks: SkyPortalHooks = {},
  ) {
    this.portalOrigin = q3ToEngine(config.origin);
    this.worldCentre = q3ToEngine(worldBounds.mins).add(q3ToEngine(worldBounds.maxs)).scale(0.5);

    this.camera = new TargetCamera("skyportal_camera", this.portalOrigin.clone(), scene, false);
    this.camera.layerMask = 0x0fffffff | SKY_PORTAL_LAYER;
    this.camera.rotationQuaternion = Quaternion.Identity();

    // The screen's own size: a size ratio would round to a power of two
    const engine = scene.getEngine();
    const screen = () => ({ width: engine.getRenderWidth(), height: engine.getRenderHeight() });
    this.target = new RenderTargetTexture("skyportal", screen(), scene, false, true);
    const resized = engine.onResizeObservable.add(() => this.target.resize(screen()));
    this.cleanups.push(() => engine.onResizeObservable.remove(resized));
    this.target.activeCamera = this.camera;
    this.target.renderList = null;
    this.target.renderListPredicate = (mesh) =>
      !(mesh.layerMask & WEAPON_LAYER) && (!config.noEnts || isSkyMesh(mesh) || (hooks.isMapMesh?.(mesh) ?? true));
    scene.customRenderTargets.push(this.target);

    const before = this.target.onBeforeRenderObservable.add(() => {
      this.followView();
      this.hooks.setVisibilityFrom?.(this.camera.position);
      this.hooks.setFogScale?.(config.scale ? 1 / config.scale : 0);
      scene.resetCachedMaterial();
    });
    const after = this.target.onAfterRenderObservable.add(() => {
      this.hooks.setFogScale?.(0);
      this.hooks.setVisibilityFrom?.(this.mainCamera()?.globalPosition ?? null);
      scene.resetCachedMaterial();
    });
    this.cleanups.push(
      () => this.target.onBeforeRenderObservable.remove(before),
      () => this.target.onAfterRenderObservable.remove(after),
    );

    this.layer = new Layer("skyportal_background", null, scene, true);
    this.layer.texture = this.target;
    this.layer.layerMask = 0x0fffffff;

    this.moveSkyToPortalLayer();
    const added = scene.onNewMeshAddedObservable.add((mesh) => {
      if (isSkyMesh(mesh)) mesh.layerMask = SKY_PORTAL_LAYER;
    });
    this.cleanups.push(() => scene.onNewMeshAddedObservable.remove(added));
  }

  /** The player's view: the scene's camera that sees the world, not the weapon. */
  private mainCamera(): Camera | null {
    const cameras = this.scene.activeCameras?.length ? this.scene.activeCameras : [this.scene.activeCamera];
    return cameras.find((c) => c && c !== this.camera && (c.layerMask & ~WEAPON_LAYER) !== 0) ?? null;
  }

  private moveSkyToPortalLayer(): void {
    for (const mesh of this.scene.meshes) if (isSkyMesh(mesh)) mesh.layerMask = SKY_PORTAL_LAYER;
  }

  private followView(): void {
    const view = this.mainCamera();
    if (!view) return;
    view.getViewMatrix();
    this.camera.position.copyFrom(
      skyPortalCameraOrigin(this.portalOrigin, this.config.scale, this.worldCentre, view.globalPosition),
    );

    // The player's view rotation, turned by the portal's rotation speeds
    const seconds = (performance.now() - this.startTime) / 1000;
    this.camera.rotationQuaternion = skyPortalViewRotation(view.absoluteRotation, this.config.rotationSpeed, seconds);

    this.camera.minZ = view.minZ;
    this.camera.maxZ = view.maxZ;
    this.camera.fovMode = view.fovMode;
    this.camera.fov = this.config.fov > 0 ? fovFromHorizontal(this.config.fov, this.scene) : view.fov;
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const index = this.scene.customRenderTargets.indexOf(this.target);
    if (index >= 0) this.scene.customRenderTargets.splice(index, 1);
    for (const mesh of this.scene.meshes) if (isSkyMesh(mesh)) mesh.layerMask = 0x0fffffff;
    this.layer.dispose();
    this.target.dispose();
    this.camera.dispose();
  }
}

/**
 * The portal camera's rotation: the player's, turned by the portal's rotation
 * speeds after `seconds`. Warfork adds the speeds to the view's Quake angles:
 * yaw turns about up (positive turns left, from Quake +X toward +Y), pitch and
 * roll about the view's own axes (positive pitch looks down).
 */
export function skyPortalViewRotation(
  base: Quaternion,
  [pitchSpeed, yawSpeed, rollSpeed]: readonly number[],
  seconds: number,
): Quaternion {
  const rotation = base.clone();
  if (!pitchSpeed && !yawSpeed && !rollSpeed) return rotation;
  const toRad = Math.PI / 180;
  // Quake +Y is engine +Z, so a Quake left turn is a negative turn about engine up
  const yaw = Quaternion.RotationAxis(Vector3.Up(), -yawSpeed * seconds * toRad);
  const local = Quaternion.RotationYawPitchRoll(0, pitchSpeed * seconds * toRad, rollSpeed * seconds * toRad);
  return yaw.multiply(rotation).multiply(local);
}

/** A horizontal fov in degrees as Babylon's vertical fov in radians, for the screen's aspect. */
function fovFromHorizontal(degrees: number, scene: Scene): number {
  const engine = scene.getEngine();
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const horizontal = (degrees * Math.PI) / 180;
  return 2 * Math.atan(Math.tan(horizontal / 2) / aspect);
}
