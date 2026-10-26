import type { TcMod, WaveFunc } from "./Q3ShaderTypes";

/** Mutable texture-space state; units and ordered operations match the authored adapter. */
export interface TcState {
  uOffset: number;
  vOffset: number;
  rotation: number;
  uScale: number;
  vScale: number;
}

export function createTcState(tcMods: readonly TcMod[]): TcState {
  const state: TcState = { uOffset: 0, vOffset: 0, rotation: 0, uScale: 1, vScale: 1 };
  for (const tcMod of tcMods) {
    if (tcMod.type === "scale") {
      state.uScale = tcMod.sScale;
      state.vScale = tcMod.tScale;
    }
  }
  return state;
}

/** Sample a wave without scene/material state; the caller owns time and randomness. */
export function evaluateWaveFunc(wave: WaveFunc, time: number, rng: () => number = Math.random): number {
  const phase = wave.phase + time * wave.frequency;
  let value: number;

  switch (wave.func) {
    case "sin":
      value = Math.sin(phase * 2 * Math.PI);
      break;
    case "triangle":
      // Triangle wave: -1 to 1 linearly
      value = Math.abs((((phase % 1) + 1) % 1) * 4 - 2) - 1;
      break;
    case "square":
      value = phase % 1 < 0.5 ? 1 : -1;
      break;
    case "sawtooth":
      value = (((phase % 1) + 1) % 1) * 2 - 1;
      break;
    case "inversesawtooth":
      value = 1 - (((phase % 1) + 1) % 1) * 2;
      break;
    case "noise":
      // Simplified noise - just random per evaluation
      // For proper noise, would need seeded random based on time
      value = rng() * 2 - 1;
      break;
    default:
      value = 0;
  }

  return wave.base + value * wave.amplitude;
}

/** Advance ordered tcMods in place without allocating frame objects or touching a texture. */
export function stepTcModsInto(
  state: TcState,
  tcMods: readonly TcMod[],
  deltaSeconds: number,
  elapsedSeconds: number,
  rng: () => number = Math.random,
): void {
  for (const tcMod of tcMods) {
    switch (tcMod.type) {
      case "scroll":
        state.uOffset += tcMod.sSpeed * deltaSeconds;
        state.vOffset += tcMod.tSpeed * deltaSeconds;
        // Wrap to prevent float overflow on long sessions
        state.uOffset = state.uOffset % 1000;
        state.vOffset = state.vOffset % 1000;
        break;

      case "scale":
        // Static - already applied at registration
        break;

      case "rotate": {
        const radPerSec = tcMod.degreesPerSecond * (Math.PI / 180);
        state.rotation += radPerSec * deltaSeconds;
        // Wrap rotation
        state.rotation = state.rotation % (2 * Math.PI);
        break;
      }

      case "stretch":
        if (tcMod.func) {
          const waveValue = evaluateWaveFunc(tcMod.func, elapsedSeconds, rng);
          state.uScale = waveValue;
          state.vScale = waveValue;
        }
        break;

      case "turb": {
        // Simplified turbulence - oscillate UV offset
        const turbPhase = elapsedSeconds * tcMod.frequency + tcMod.phase;
        const turbU = Math.sin(turbPhase * 2 * Math.PI) * tcMod.amplitude;
        const turbV = Math.cos(turbPhase * 2 * Math.PI + 0.7) * tcMod.amplitude;
        // Add to existing offset (turb is additive)
        state.uOffset += turbU * deltaSeconds * 10; // Scale for visibility
        state.vOffset += turbV * deltaSeconds * 10;
        break;
      }

      case "transform": {
        // 2D affine matrix transform: [u', v'] = [m00 m01; m10 m11] * [u, v] + [t0, t1]
        // Decompose into scale, rotation, and translation that Babylon supports
        // Note: This doesn't handle shear correctly, but covers most Q3 shader use cases

        // Extract scale from matrix (length of each row vector)
        const scaleU = Math.sqrt(tcMod.m00 * tcMod.m00 + tcMod.m01 * tcMod.m01);
        const scaleV = Math.sqrt(tcMod.m10 * tcMod.m10 + tcMod.m11 * tcMod.m11);

        // Extract rotation from first row (assumes no shear)
        const rotation = Math.atan2(tcMod.m01, tcMod.m00);

        // Apply: set state (transform is typically static, applied once)
        state.uScale = scaleU;
        state.vScale = scaleV;
        state.rotation = rotation;
        state.uOffset = tcMod.t0;
        state.vOffset = tcMod.t1;
        break;
      }
    }
  }
}
