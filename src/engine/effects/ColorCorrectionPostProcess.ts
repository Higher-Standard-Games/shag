/**
 * ColorCorrectionPostProcess — colour-blindness accessibility.
 *
 * r_colorcorrection 1–3 "daltonizes" the final image for protanopia,
 * deuteranopia or tritanopia: it works out what that eye cannot tell apart
 * (the difference between a colour and how it is seen) and moves that
 * difference into channels it can, so red/green contrast becomes blue and
 * brightness contrast. r_colorcorrection_strength scales the shift.
 *
 * r_colorsimulation 1–3 shows the screen as that eye sees it, for checking a
 * map; it applies after the correction, so the two together show what a
 * colour-blind player sees with correction on.
 *
 * All of it is one 3×3 matrix, worked out here when a variable changes and
 * applied per pixel in a single pass that is last on the camera. With both
 * variables at 0 there is no pass at all.
 *
 * Simulation matrices: Machado, Oliveira & Fernandes (2009), severity 1.0,
 * linear RGB. Error shift: Fidaner, Lin & Ozguven (2005).
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import type { Scene } from "@babylonjs/core/scene";

/** 0 off, 1 protanopia (red-weak), 2 deuteranopia (green-weak), 3 tritanopia (blue-yellow). */
export type ColorVisionType = 0 | 1 | 2 | 3;

/** Row-major 3×3. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** How each type sees linear RGB. */
const SIMULATION: Record<1 | 2 | 3, Mat3> = {
  1: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  2: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  3: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** Where the unseen difference goes: red-green into green and blue, blue-yellow into red and green. */
const SHIFT: Record<1 | 2 | 3, Mat3> = {
  1: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  2: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  3: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],
};

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]);
    }
  }
  return out as unknown as Mat3;
}

const add = (a: Mat3, b: Mat3, scale = 1): Mat3 => a.map((v, i) => v + b[i] * scale) as unknown as Mat3;

export function simulationMatrix(type: ColorVisionType): Mat3 {
  return type === 0 ? IDENTITY : SIMULATION[type];
}

/** I + strength · shift · (I − simulation): the colour plus its shifted unseen part. */
export function correctionMatrix(type: ColorVisionType, strength = 1): Mat3 {
  if (type === 0 || strength <= 0) return IDENTITY;
  const unseen = add(IDENTITY, SIMULATION[type], -1);
  return add(IDENTITY, multiply(SHIFT[type], unseen), strength);
}

/** Correction first, then the simulation of what is seen. */
export function colorMatrix(correction: ColorVisionType, strength: number, simulation: ColorVisionType): Mat3 {
  return multiply(simulationMatrix(simulation), correctionMatrix(correction, strength));
}

export function asColorVisionType(value: unknown): ColorVisionType {
  const n = Math.round(Number(value));
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform mat3 colorMatrix;

void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  // The matrices hold for linear light; the frame here is display-encoded.
  vec3 linear = pow(clamp(color.rgb, 0.0, 1.0), vec3(2.2));
  vec3 mapped = clamp(colorMatrix * linear, 0.0, 1.0);
  gl_FragColor = vec4(pow(mapped, vec3(1.0 / 2.2)), color.a);
}
`;

export class ColorCorrectionPostProcess {
  private static _instance: ColorCorrectionPostProcess | null = null;

  static getInstance(): ColorCorrectionPostProcess {
    if (!ColorCorrectionPostProcess._instance) ColorCorrectionPostProcess._instance = new ColorCorrectionPostProcess();
    return ColorCorrectionPostProcess._instance;
  }

  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private postProcess: PostProcess | null = null;
  private correction: ColorVisionType = 0;
  private strength = 1;
  private simulation: ColorVisionType = 0;
  /** Column-major for the shader. */
  private readonly uniform = new Float32Array(9);

  init(scene: Scene, camera: Camera | null): void {
    this.destroy();
    this.scene = scene;
    this.camera = camera;
    Effect.ShadersStore.colorCorrectionFragmentShader = FRAGMENT;
    this.refresh();
  }

  setCamera(camera: Camera | null): void {
    if (this.camera === camera) return;
    this.destroy();
    this.camera = camera;
    this.refresh();
  }

  set(correction: ColorVisionType, strength: number, simulation: ColorVisionType): void {
    this.correction = correction;
    this.strength = Math.max(0, Math.min(1, strength));
    this.simulation = simulation;
    this.refresh();
  }

  isActive(): boolean {
    return (this.correction !== 0 && this.strength > 0) || this.simulation !== 0;
  }

  /**
   * Keep the pass last on the camera, as the final look of the frame: the
   * rendering pipelines append their own passes when they are rebuilt or
   * switched on, which would otherwise land after it.
   */
  keepLast(): void {
    if (!this.postProcess || !this.camera) return;
    const passes = this.camera._postProcesses.filter((pass) => pass);
    if (passes[passes.length - 1] === this.postProcess) return;
    this.destroy();
    this.refresh();
  }

  dispose(): void {
    this.destroy();
    this.scene = null;
    this.camera = null;
  }

  private refresh(): void {
    const m = colorMatrix(this.correction, this.strength, this.simulation);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) this.uniform[col * 3 + row] = m[row * 3 + col];

    if (!this.isActive()) {
      this.destroy();
      return;
    }
    if (this.postProcess || !this.scene || !this.camera) return;
    this.postProcess = new PostProcess(
      "colorCorrection",
      "colorCorrection",
      ["colorMatrix"],
      null,
      1.0,
      this.camera,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      this.scene.getEngine(),
      false,
      undefined,
      Constants.TEXTURETYPE_HALF_FLOAT, // as CelOutline: keep the HDR frame's precision
    );
    this.postProcess.onApply = (effect) => effect.setMatrix3x3("colorMatrix", this.uniform);
  }

  private destroy(): void {
    if (!this.postProcess) return;
    this.postProcess.dispose(this.camera ?? undefined);
    this.postProcess = null;
  }
}
