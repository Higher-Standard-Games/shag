/**
 * AmmoCounterDisplay — on-weapon ammo counter (Warsow-style).
 *
 * Some weapon models carry ammo-counter attachment bones (`tag_ammo`, and the
 * per-place `tag_ammo_digit_1` / `_10` / `_100`) plus an `ammoCounter` directive
 * in their `.cfg`. Warsow renders the live ammo count onto the gun's grey
 * counter area with a bitmap font. We don't ship that font, so the digits are
 * generated procedurally into a DynamicTexture (a clean LCD look) and painted
 * onto a quad anchored at `tag_ammo`.
 *
 * The `ammoCounter` cfg line drives size/alpha so it stays tunable without code
 * changes — mirroring the tags.txt philosophy:
 *   ammoCounter <font> <fontSize> <digitW> <digitH> <digitAlpha> <iconSize> <iconAlpha>
 *
 * Only the plasmagun is authored with the counter bones today; any other weapon
 * lights up automatically once its model gains the bones + cfg line.
 */

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";

const DEG2RAD = Math.PI / 180;

/** Read a numeric cvar with a fallback. */
function cvarNum(name: string, fallback: number): number {
  const v = Cvar.get(name);
  return typeof v === "number" ? v : fallback;
}

/** Parsed `ammoCounter` cfg directive. */
export interface AmmoCounterConfig {
  fontFamily: string;
  fontSize: number;
  digitWidth: number;
  digitHeight: number;
  digitAlpha: number;
  iconSize: number;
  iconAlpha: number;
}

/** Max digits the counter renders (hundreds place). */
const MAX_DIGITS = 3;

/**
 * Parse the `ammoCounter` line out of a weapon `.cfg`. Returns null when the
 * weapon declares no counter. Tolerant of comments and extra whitespace.
 *
 * Line shape: `ammoCounter "LCDdigits" 46 0.18 0.34 0.75 0.22 0.3`
 */
export function parseAmmoCounter(cfgText: string): AmmoCounterConfig | null {
  for (const raw of cfgText.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line.toLowerCase().startsWith("ammocounter")) continue;

    // font may be quoted; the rest are numbers.
    const m = line.match(/^ammocounter\s+"?([^"\s]+)"?\s+(.+)$/i);
    if (!m) continue;
    const nums = m[2].trim().split(/\s+/).map(Number);
    if (nums.length < 6 || nums.some((n) => !Number.isFinite(n))) continue;

    const [fontSize, digitWidth, digitHeight, digitAlpha, iconSize, iconAlpha] = nums;
    return { fontFamily: m[1], fontSize, digitWidth, digitHeight, digitAlpha, iconSize, iconAlpha };
  }
  return null;
}

/**
 * Format an ammo count into a fixed-width digit string for the counter, blanking
 * leading zeros (space) and clamping to the counter's digit capacity.
 *   7 -> "  7", 42 -> " 42", 137 -> "137", 999+ -> "999", <0 -> "  0"
 */
export function formatAmmoDigits(ammo: number, maxDigits = MAX_DIGITS): string {
  const capped = Math.max(0, Math.min(ammo | 0, 10 ** maxDigits - 1));
  return String(capped).padStart(maxDigits, " ");
}

export class AmmoCounterDisplay {
  private readonly scene: Scene;
  private readonly config: AmmoCounterConfig;
  private plane: Mesh | null = null;
  private texture: DynamicTexture | null = null;
  private material: StandardMaterial | null = null;
  private lastAmmo = -1;
  /** Per-axis sign of the anchor's world scale — the counter model bones import
   *  mirrored on some weapons (e.g. worldScale.y < 0); we cancel it so digits
   *  stay upright and unmirrored. */
  private mirror = { x: 1, y: 1, z: 1 };

  private readonly renderLayer: { renderingGroupId: number; layerMask: number };

  /**
   * @param scene   the render scene
   * @param anchor  the `tag_ammo` transform node (bone) the counter mounts to
   * @param config  parsed ammoCounter cfg
   * @param renderLayer  the weapon's render group/layer — the FPS view model is
   *   drawn by a dedicated weapon camera on its own layer, so the counter MUST
   *   match it or the weapon camera won't draw it and the main camera buries it.
   */
  constructor(
    scene: Scene,
    anchor: TransformNode,
    config: AmmoCounterConfig,
    renderLayer: { renderingGroupId: number; layerMask: number },
  ) {
    this.scene = scene;
    this.config = config;
    this.renderLayer = renderLayer;
    this.build(anchor);
  }

  private build(anchor: TransformNode): void {
    // One quad wide enough for MAX_DIGITS, mounted flat on the counter bone.
    const width = this.config.digitWidth * MAX_DIGITS;
    const height = this.config.digitHeight;
    const plane = CreatePlane("ammoCounter", { width, height }, this.scene);
    plane.parent = anchor;
    plane.rotationQuaternion = null;
    plane.isPickable = false;
    // Match the weapon's dedicated render pass/camera layer (view-model overlay).
    plane.renderingGroupId = this.renderLayer.renderingGroupId;
    plane.layerMask = this.renderLayer.layerMask;

    // Cancel any mirrored parent scale so digits render upright/unmirrored.
    anchor.computeWorldMatrix(true);
    const s = anchor.absoluteScaling;
    this.mirror = { x: s.x < 0 ? -1 : 1, y: s.y < 0 ? -1 : 1, z: s.z < 0 ? -1 : 1 };

    // Texture resolution scaled off the cfg font size; keep it a power-of-two-ish
    // strip so the 3 digits stay crisp.
    const texW = 256;
    const texH = 96;
    const texture = new DynamicTexture("ammoCounterTex", { width: texW, height: texH }, this.scene, false);
    texture.hasAlpha = true;

    const mat = new StandardMaterial("ammoCounterMat", this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.diffuseTexture = texture;
    mat.emissiveTexture = texture;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = 2; // ALPHABLEND
    mat.backFaceCulling = false; // readable from either face
    mat.alpha = 1; // panel supplies its own per-pixel alpha
    mat.zOffset = -2; // bias toward camera so it isn't z-fought by the gun surface
    plane.material = mat;

    this.plane = plane;
    this.texture = texture;
    this.material = mat;
    this.applyTuning();

    // Canvas can't render a web font until it's loaded; if the first paint fell
    // back to monospace, repaint once the HUD's Orbitron is ready.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => this.redraw()).catch(() => {});
    }
  }

  /**
   * Apply the live-tunable transform (scale / rotation / forward offset) from
   * cvars, on top of the mirror correction. Cheap; safe to call every frame so
   * cvar edits take effect immediately while dialing the counter in.
   *   cg_ammocounter_scale   size multiplier
   *   cg_ammocounter_yaw/pitch/roll   facing, degrees (Q3 tag axes vary per model)
   *   cg_ammocounter_fwd     offset along the mount normal (push off the gun)
   */
  public applyTuning(): void {
    if (!this.plane) return;
    const scale = cvarNum("cg_ammocounter_scale", 1);
    this.plane.scaling.set(this.mirror.x * scale, this.mirror.y * scale, this.mirror.z * scale);
    this.plane.rotation.set(
      cvarNum("cg_ammocounter_pitch", 0) * DEG2RAD,
      cvarNum("cg_ammocounter_yaw", 0) * DEG2RAD,
      cvarNum("cg_ammocounter_roll", 0) * DEG2RAD,
    );
    this.plane.position.set(0, 0, cvarNum("cg_ammocounter_fwd", 0));
  }

  /** Update the rendered number. No-op when unchanged (cheap to call per frame). */
  public setAmmo(ammo: number): void {
    if (ammo === this.lastAmmo || !this.texture) return;
    this.lastAmmo = ammo;
    this.draw(formatAmmoDigits(ammo));
  }

  /** Re-render the current value (e.g. after the web font finishes loading). */
  private redraw(): void {
    if (this.lastAmmo >= 0) this.draw(formatAmmoDigits(this.lastAmmo));
  }

  /** Paint the digit string into the DynamicTexture — transparent LCD digits. */
  private draw(digits: string): void {
    if (!this.texture) return;
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    const { width, height } = this.texture.getSize();
    // Transparent background: the quad overlays the gun's own display recess, so
    // the digits sit ON that dark screen rather than on a painted opaque panel.
    ctx.clearRect(0, 0, width, height);

    // HUD display font (Orbitron). Sized to fill the display height with room for
    // the glow, so neither the glyphs nor the halo clip at the texture edge (the
    // earlier 1.25x font + wide blur bled past and looked pixel-cut).
    const fontPx = Math.round(height * 0.9);
    ctx.font = `900 ${fontPx}px "Orbitron", "Consolas", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Yellow backlight GLOW (0 offset = an even halo around the digits, not a
    // one-sided drop shadow) behind near-black digits — a lit-LCD look without a
    // distracting off-segment ghost.
    ctx.shadowColor = "rgba(255, 205, 70, 0.95)";
    ctx.shadowBlur = Math.max(3, height * 0.09);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = "rgba(12, 12, 12, 1)";

    // Fixed slots: paint each place centered in its own cell so digits never
    // shift as the count changes (Orbitron is proportional, not monospace). Two
    // passes per digit deepen the glow.
    const cellW = width / MAX_DIGITS;
    const cy = height / 2;
    for (let i = 0; i < digits.length && i < MAX_DIGITS; i++) {
      const ch = digits[i];
      if (ch === " ") continue;
      const cx = cellW * (i + 0.5);
      ctx.fillText(ch, cx, cy);
      ctx.fillText(ch, cx, cy);
    }
    // Reset shadow so it can't bleed into a later paint on this shared context.
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    this.texture.update();
  }

  public dispose(): void {
    this.texture?.dispose();
    this.material?.dispose();
    this.plane?.dispose();
    this.plane = null;
    this.texture = null;
    this.material = null;
  }
}

// Live tuning cvars for positioning the on-gun counter (Q3 tag axis conventions
// vary per weapon model, so the facing needs to be dialed in per-set). Changes
// apply immediately — WeaponViewManager re-applies them each frame.
Cvar.register("cg_ammocounter_scale", 1, { type: "float", min: 0.05, max: 20, description: "Ammo counter size multiplier" });
// Default 90° yaw aligns the counter with the IQM z_weapons tag_ammo axis
// convention shared by all counter-bearing models (#3, confirmed in playtest).
Cvar.register("cg_ammocounter_yaw", 90, { type: "float", min: -180, max: 180, description: "Ammo counter yaw (deg)" });
Cvar.register("cg_ammocounter_pitch", 0, { type: "float", min: -180, max: 180, description: "Ammo counter pitch (deg)" });
// Default 180° roll (with yaw 90) seats the counter upright on the IQM
// z_weapons tag_ammo bone (#3, confirmed in playtest).
Cvar.register("cg_ammocounter_roll", 180, { type: "float", min: -180, max: 180, description: "Ammo counter roll (deg)" });
Cvar.register("cg_ammocounter_fwd", 0, { type: "float", min: -10, max: 10, description: "Ammo counter forward offset" });
