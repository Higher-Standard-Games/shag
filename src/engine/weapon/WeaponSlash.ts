/**
 * WeaponSlash — Melee slash animation offsets and trail effect
 *
 * Manages 3-phase slash animation (windup → swing → return)
 * with multiple concurrent trail ribbon instances.
 *
 * Used by WeaponViewManager.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

// ─── Slash Animation Parameters ───────────────────────────────────────

/** Parameters for a single slash animation swing */
interface SlashParams {
  startPitch: number;
  startRoll: number;
  endPitch: number;
  endRoll: number;
  startYaw: number;
  endYaw: number;
  startOffset: { x: number; y: number; z: number };
  endOffset: { x: number; y: number; z: number };
  windupDuration: number;
  swingDuration: number;
  returnDuration: number;
}

/** Slash animation presets — cycled/randomized on each fire */
const SLASH_PRESETS: SlashParams[] = [
  // Slash 1: Big vertical down — raised high, sweeps down with lunge
  {
    startPitch: 0,
    startRoll: -2.0,
    startYaw: 0,
    endPitch: 0,
    endRoll: 1.4,
    endYaw: 0,
    startOffset: { x: 5, y: 30, z: -15 }, // raised way up, pulled back
    endOffset: { x: -5, y: -25, z: 18 }, // swept down, lunged forward hard
    windupDuration: 60,
    swingDuration: 160,
    returnDuration: 230,
  },
  // Slash 2: Diagonal upper-right to lower-left
  {
    startPitch: 0.7,
    startRoll: -1.8,
    startYaw: -0.4,
    endPitch: -0.7,
    endRoll: 1.2,
    endYaw: 0.4,
    startOffset: { x: -12, y: 28, z: -12 },
    endOffset: { x: 12, y: -22, z: 15 },
    windupDuration: 55,
    swingDuration: 165,
    returnDuration: 230,
  },
  // Slash 3: Diagonal upper-left to lower-right
  {
    startPitch: -0.7,
    startRoll: -1.8,
    startYaw: 0.4,
    endPitch: 0.7,
    endRoll: 1.2,
    endYaw: -0.4,
    startOffset: { x: 12, y: 28, z: -12 },
    endOffset: { x: -12, y: -22, z: 15 },
    windupDuration: 55,
    swingDuration: 165,
    returnDuration: 230,
  },
];

export interface SlashAnimOffsets {
  xOffset: number;
  yOffset: number;
  zOffset: number;
  pitch: number;
  yaw: number;
  roll: number;
}

// ─── Trail Instance ───────────────────────────────────────────────────

interface TrailInstance {
  tipPoints: Vector3[];
  handlePoints: Vector3[];
  mesh: Mesh | null;
  /** Points per side the mesh has room for; the rest repeat the newest point. */
  capacity: number;
  positions: Float32Array | null;
  uvs: Float32Array | null;
  material: StandardMaterial | null;
  fadeStart: number;
  active: boolean;
}

/** Room for a swing's points at high frame rates before the mesh must grow. */
const SLASH_TRAIL_CAPACITY = 64;

// ─── WeaponSlash Class ────────────────────────────────────────────────

/**
 * Write a trail's two paths into its ribbon's vertex layout: the tip path then
 * the handle path, each `capacity` long, then the same again for the back face
 * of the double-sided ribbon. UVs are what the ribbon builder gives: u is the
 * distance along the path as a fraction of its length, v is 0 on the tip path
 * and 1 on the handle path (0 where the two meet).
 */
function writeSlashRibbon(trail: TrailInstance): void {
  const positions = trail.positions!;
  const uvs = trail.uvs!;
  const capacity = trail.capacity;
  const count = trail.tipPoints.length;
  const paths = [trail.tipPoints, trail.handlePoints];
  const half = capacity * 2;
  for (let p = 0; p < 2; p++) {
    const path = paths[p];
    let total = 0;
    for (let j = 1; j < count; j++) total += Vector3.Distance(path[j], path[j - 1]);
    let along = 0;
    for (let j = 0; j < capacity; j++) {
      const point = path[Math.min(j, count - 1)];
      if (j > 0 && j < count) along += Vector3.Distance(point, path[j - 1]);
      const vertex = p * capacity + j;
      const width = Vector3.Distance(
        trail.tipPoints[Math.min(j, count - 1)],
        trail.handlePoints[Math.min(j, count - 1)],
      );
      const u = total !== 0 ? along / total : 0;
      const v = p === 0 || width === 0 ? 0 : 1;
      for (let side = 0; side <= half; side += half) {
        positions[(side + vertex) * 3] = point.x;
        positions[(side + vertex) * 3 + 1] = point.y;
        positions[(side + vertex) * 3 + 2] = point.z;
        uvs[(side + vertex) * 2] = u;
        uvs[(side + vertex) * 2 + 1] = v;
      }
    }
  }
}

/** At rest: one shared, frozen answer instead of a new object every frame. */
const NO_SLASH_OFFSETS: Readonly<SlashAnimOffsets> = Object.freeze({
  xOffset: 0,
  yOffset: 0,
  zOffset: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
});

export class WeaponSlash {
  private static readonly TRAIL_FADE_MS = 800;
  private static readonly TRAIL_ALPHA = 0.22;

  // Slash animation state
  private slashActive = false;
  private slashStartTime = 0;
  private slashParams: SlashParams = SLASH_PRESETS[0];
  private slashPresetIndex = 0;

  // Trail instances
  private trails: TrailInstance[] = [];
  private trailWasActive = false;
  private readonly _forward = new Vector3();
  private readonly _up = new Vector3();
  private readonly _right = new Vector3();

  /** True if a slash is currently animating */
  get isActive(): boolean {
    return this.slashActive;
  }

  /** Trigger a new slash animation (cycles through presets) */
  trigger(): void {
    const preset = SLASH_PRESETS[this.slashPresetIndex % SLASH_PRESETS.length];
    this.slashPresetIndex++;
    this.slashActive = true;
    this.slashStartTime = performance.now();
    this.slashParams = preset;
  }

  /** Calculate animation offsets for current frame */
  getOffsets(): Readonly<SlashAnimOffsets> {
    const zero = NO_SLASH_OFFSETS;
    if (!this.slashActive) return zero;

    const now = performance.now();
    const elapsed = now - this.slashStartTime;
    const p = this.slashParams;
    const totalDuration = p.windupDuration + p.swingDuration + p.returnDuration;

    if (elapsed >= totalDuration) {
      this.slashActive = false;
      return zero;
    }

    let t: number;
    let fromPitch: number, fromRoll: number, fromYaw: number;
    let toPitch: number, toRoll: number, toYaw: number;
    let fromX: number, fromY: number, fromZ: number;
    let toX: number, toY: number, toZ: number;

    if (elapsed < p.windupDuration) {
      t = p.windupDuration > 0 ? elapsed / p.windupDuration : 1;
      t = t * t; // easeIn
      fromPitch = 0;
      fromRoll = 0;
      fromYaw = 0;
      toPitch = p.startPitch;
      toRoll = p.startRoll;
      toYaw = p.startYaw;
      fromX = 0;
      fromY = 0;
      fromZ = 0;
      toX = p.startOffset.x;
      toY = p.startOffset.y;
      toZ = p.startOffset.z;
    } else if (elapsed < p.windupDuration + p.swingDuration) {
      t = (elapsed - p.windupDuration) / p.swingDuration;
      t = 1 - (1 - t) * (1 - t); // easeOut
      fromPitch = p.startPitch;
      fromRoll = p.startRoll;
      fromYaw = p.startYaw;
      toPitch = p.endPitch;
      toRoll = p.endRoll;
      toYaw = p.endYaw;
      fromX = p.startOffset.x;
      fromY = p.startOffset.y;
      fromZ = p.startOffset.z;
      toX = p.endOffset.x;
      toY = p.endOffset.y;
      toZ = p.endOffset.z;
    } else {
      t = (elapsed - p.windupDuration - p.swingDuration) / p.returnDuration;
      t = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // easeInOut
      fromPitch = p.endPitch;
      fromRoll = p.endRoll;
      fromYaw = p.endYaw;
      toPitch = 0;
      toRoll = 0;
      toYaw = 0;
      fromX = p.endOffset.x;
      fromY = p.endOffset.y;
      fromZ = p.endOffset.z;
      toX = 0;
      toY = 0;
      toZ = 0;
    }

    return {
      xOffset: fromX + (toX - fromX) * t,
      yOffset: fromY + (toY - fromY) * t,
      zOffset: fromZ + (toZ - fromZ) * t,
      pitch: fromPitch + (toPitch - fromPitch) * t,
      yaw: fromYaw + (toYaw - fromYaw) * t,
      roll: fromRoll + (toRoll - fromRoll) * t,
    };
  }

  /** Update trail effect — call each frame */
  updateTrail(scene: Scene | null, camera: FreeCamera | null): void {
    if (!scene || !camera) return;

    const now = performance.now();
    const isSlashing = this.slashActive;

    // Edge detect: new slash → create fresh trail
    if (isSlashing && !this.trailWasActive) {
      for (const trail of this.trails) {
        if (trail.active) {
          trail.active = false;
          trail.fadeStart = now;
        }
      }
      this.trails.push({
        tipPoints: [],
        handlePoints: [],
        mesh: null,
        capacity: 0,
        positions: null,
        uvs: null,
        material: null,
        fadeStart: 0,
        active: true,
      });
    }
    this.trailWasActive = isSlashing;

    // Collect points for active trail
    const activeTrail = this.trails.find((t) => t.active);
    if (activeTrail && isSlashing) {
      const forward = this._forward;
      const up = this._up;
      const right = this._right;
      camera.getDirectionToRef(Vector3.LeftHandedForwardReadOnly, forward);
      camera.getDirectionToRef(Vector3.UpReadOnly, up);
      camera.getDirectionToRef(Vector3.RightReadOnly, right);

      const slashOff = this.getOffsets();

      // Handle (pivot)
      const handle = camera.position.clone();
      forward.scaleAndAddToRef(15, handle);
      up.scaleAndAddToRef(-4, handle);
      right.scaleAndAddToRef(2, handle);
      up.scaleAndAddToRef(slashOff.yOffset * 0.04, handle);
      right.scaleAndAddToRef(slashOff.xOffset * 0.04, handle);

      // Tip (sweeps wide)
      const tip = camera.position.clone();
      forward.scaleAndAddToRef(28, tip);
      up.scaleAndAddToRef(5, tip);
      right.scaleAndAddToRef(-2, tip);
      up.scaleAndAddToRef(slashOff.yOffset * 0.25, tip);
      right.scaleAndAddToRef(slashOff.xOffset * 0.25, tip);
      forward.scaleAndAddToRef(slashOff.zOffset * 0.1, tip);

      activeTrail.tipPoints.push(tip);
      activeTrail.handlePoints.push(handle);

      if (activeTrail.tipPoints.length >= 2) {
        this.buildTrailMesh(scene, activeTrail);
      }
    }

    // When slash ends, start fading
    if (!isSlashing && activeTrail) {
      activeTrail.active = false;
      activeTrail.fadeStart = now;
    }

    // Update fading trails + clean up finished ones
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i];
      if (trail.active) continue;

      if (trail.fadeStart > 0) {
        const fadeProgress = (now - trail.fadeStart) / WeaponSlash.TRAIL_FADE_MS;
        if (fadeProgress >= 1.0) {
          if (trail.mesh) trail.mesh.dispose();
          if (trail.material) trail.material.dispose(false, true);
          this.trails.splice(i, 1);
        } else {
          if (trail.material) {
            trail.material.alpha = WeaponSlash.TRAIL_ALPHA * (1.0 - fadeProgress);
          }
        }
      }
    }
  }

  /** Build/rebuild ribbon mesh for a trail instance */
  private buildTrailMesh(scene: Scene, trail: TrailInstance): void {
    if (trail.tipPoints.length < 2) return;

    // The swing adds a point a frame. Rebuilding the ribbon for each one made
    // and threw away a mesh every frame of every swing, so the mesh has room
    // for more points than it uses and is rewritten in place; the spare ones
    // repeat the newest point and draw nothing. It is only rebuilt to grow.
    const count = trail.tipPoints.length;
    if (!trail.mesh || trail.capacity < count) {
      trail.mesh?.dispose();
      let capacity = SLASH_TRAIL_CAPACITY;
      while (capacity < count) capacity *= 2;
      const pad = (path: Vector3[]) => Array.from({ length: capacity }, (_, i) => path[Math.min(i, count - 1)]);
      trail.mesh = MeshBuilder.CreateRibbon(
        "slashTrail",
        {
          pathArray: [pad(trail.tipPoints), pad(trail.handlePoints)],
          updatable: true,
          sideOrientation: Mesh.DOUBLESIDE,
        },
        scene,
      );
      trail.capacity = capacity;
      trail.positions = new Float32Array(capacity * 2 * 2 * 3);
      trail.uvs = new Float32Array(capacity * 2 * 2 * 2);
    }
    writeSlashRibbon(trail);
    trail.mesh.updateVerticesData(VertexBuffer.PositionKind, trail.positions!, false, false);
    trail.mesh.updateVerticesData(VertexBuffer.UVKind, trail.uvs!, false, false);
    trail.mesh.refreshBoundingInfo();
    trail.mesh.isPickable = false;

    if (!trail.material) {
      const mat = new StandardMaterial("slashTrailMat", scene);
      mat.emissiveColor = new Color3(0.75, 0.8, 0.8);
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      // A smooth opacity envelope feathers every ribbon edge without a
      // full-screen blur pass or sampling the world behind the weapon.
      const width = 64,
        height = 32;
      const pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const envelope = Math.sin((Math.PI * x) / (width - 1)) * Math.sin((Math.PI * y) / (height - 1));
          pixels.set([255, 255, 255, Math.round(255 * envelope * envelope)], (y * width + x) * 4);
        }
      }
      const texture = RawTexture.CreateRGBATexture(
        pixels,
        width,
        height,
        scene,
        false,
        false,
        Texture.BILINEAR_SAMPLINGMODE,
      );
      texture.name = "slashTrailFeather";
      texture.hasAlpha = true;
      texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
      mat.diffuseTexture = texture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.alpha = WeaponSlash.TRAIL_ALPHA;
      trail.material = mat;
    }
    trail.material.alpha = WeaponSlash.TRAIL_ALPHA;
    trail.mesh.material = trail.material;
  }

  /** Clean up all trails */
  dispose(): void {
    for (const trail of this.trails) {
      if (trail.mesh) trail.mesh.dispose();
      if (trail.material) trail.material.dispose(false, true);
    }
    this.trails = [];
  }
}
