/**
 * LoadingPalettes - Color palette definitions for loading animations
 *
 * These palettes are used by LoadingAnimation for the smoke puff effect.
 * Games can define their own palettes for custom theming.
 */

export interface PaletteColor {
  bg: string; // Background/fill color (e.g., '#E85D04')
  glow: string; // Glow color with alpha (e.g., 'rgba(232, 93, 4, 0.6)')
}

/**
 * SHAG Engine default palette - colors from the SHAG logo
 * Orange, Yellow, Teal, Magenta, Green
 */
export const SHAG_PALETTE: PaletteColor[] = [
  { bg: "#E85D04", glow: "rgba(232, 93, 4, 0.6)" }, // Orange (S)
  { bg: "#FAC748", glow: "rgba(250, 199, 72, 0.6)" }, // Yellow (H)
  { bg: "#2EC4B6", glow: "rgba(46, 196, 182, 0.6)" }, // Teal (A)
  { bg: "#E040FB", glow: "rgba(224, 64, 251, 0.6)" }, // Magenta (G)
  { bg: "#4ADE80", glow: "rgba(74, 222, 128, 0.6)" }, // Green (glow)
];

/**
 * Fire palette - warm oranges and reds
 */
export const FIRE_PALETTE: PaletteColor[] = [
  { bg: "#ff4400", glow: "rgba(255, 68, 0, 0.6)" },
  { bg: "#ff6600", glow: "rgba(255, 102, 0, 0.6)" },
  { bg: "#ff8800", glow: "rgba(255, 136, 0, 0.6)" },
  { bg: "#ffaa00", glow: "rgba(255, 170, 0, 0.6)" },
  { bg: "#ffcc00", glow: "rgba(255, 204, 0, 0.6)" },
];

/**
 * Ice palette - cool blues and cyans
 */
export const ICE_PALETTE: PaletteColor[] = [
  { bg: "#00d4ff", glow: "rgba(0, 212, 255, 0.6)" },
  { bg: "#00b4d8", glow: "rgba(0, 180, 216, 0.6)" },
  { bg: "#0096c7", glow: "rgba(0, 150, 199, 0.6)" },
  { bg: "#48cae4", glow: "rgba(72, 202, 228, 0.6)" },
  { bg: "#90e0ef", glow: "rgba(144, 224, 239, 0.6)" },
];

/**
 * Monochrome palette - grayscale
 */
export const MONO_PALETTE: PaletteColor[] = [
  { bg: "#ffffff", glow: "rgba(255, 255, 255, 0.5)" },
  { bg: "#cccccc", glow: "rgba(204, 204, 204, 0.5)" },
  { bg: "#999999", glow: "rgba(153, 153, 153, 0.5)" },
  { bg: "#666666", glow: "rgba(102, 102, 102, 0.5)" },
];
