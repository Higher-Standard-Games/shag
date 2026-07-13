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

  /**
   * @param scene   the render scene
   * @param anchor  the `tag_ammo` transform node (bone) the counter mounts to
   */
  constructor(scene: Scene, anchor: TransformNode, config: AmmoCounterConfig) {
    this.scene = scene;
    this.config = config;
    this.build(anchor);
  }

  private build(anchor: TransformNode): void {
    // One quad wide enough for MAX_DIGITS, mounted flat on the counter bone.
    const width = this.config.digitWidth * MAX_DIGITS;
    const height = this.config.digitHeight;
    const plane = CreatePlane("ammoCounter", { width, height }, this.scene);
    plane.parent = anchor;
    plane.position.setAll(0);
    plane.rotationQuaternion = null;
    plane.rotation.setAll(0);
    plane.isPickable = false;

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
  }

  /** Update the rendered number. No-op when unchanged (cheap to call per frame). */
  public setAmmo(ammo: number): void {
    if (ammo === this.lastAmmo || !this.texture) return;
    this.lastAmmo = ammo;
    this.draw(formatAmmoDigits(ammo));
  }

  /** Paint the digit string into the DynamicTexture as a solid LCD panel. */
  private draw(digits: string): void {
    if (!this.texture) return;
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    const { width, height } = this.texture.getSize();
    ctx.clearRect(0, 0, width, height);

    // Opaque dark screen so the counter reads as a physical LCD panel (not a few
    // faint floating digits that are easy to miss on the grey gun body).
    ctx.fillStyle = "rgba(6, 16, 10, 1)";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(90, 200, 130, 0.5)";
    ctx.lineWidth = Math.max(2, height * 0.04);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, width - ctx.lineWidth * 2, height - ctx.lineWidth * 2);

    const fontPx = Math.round(height * 0.78);
    ctx.font = `900 ${fontPx}px "Consolas", "Menlo", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = width / 2;
    const cy = height / 2;

    // Dim "off-segment" ghost so blanked places still read as an LCD.
    ctx.fillStyle = "rgba(40, 90, 55, 0.5)";
    ctx.fillText("888", cx, cy);

    // Bright active digits.
    ctx.fillStyle = `rgba(140, 255, 175, ${Math.max(0.4, this.config.digitAlpha)})`;
    ctx.fillText(digits, cx, cy);

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
