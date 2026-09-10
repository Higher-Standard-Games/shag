/**
 * Which BSP surfaces and volumes are liquid, and why.
 *
 * Renderer-independent by design: this answers "what is this" from compiled
 * BSP semantics and shader declarations, and nothing here knows how water will
 * eventually be drawn. The renderer consumes the descriptors; it does not
 * produce them.
 *
 * The central rule is that a liquid VOLUME and a liquid SURFACE are different
 * objects and are classified separately. Mappers routinely author a
 * `common/nodrawwater` brush for the volume you swim in and a completely
 * different shader for the water you look at — on wdm5 every liquid brush is
 * nodraw and the visible shader has no brushes at all. Treating them as one
 * descriptor renders an invisible brush and misses the real waterline.
 */

import { ContentFlags, isLiquid, liquidKindOf, SurfaceFlags } from "../../physics/ContentFlags";
import type { BspFile, BspTexture } from "./BspLoader";

export type LiquidKind = "water" | "slime" | "lava";

/** What told us this is liquid. Retained so the audit can explain itself. */
export type LiquidSignal = "override" | "contentFlag" | "surfaceParm";

export interface LiquidSurfaceDescriptor {
  /** Normalized shader name — lowercase, forward slashes, junk stripped. */
  shaderName: string;
  /** Index into `BspFile.textures`. */
  textureIndex: number;
  kind: LiquidKind;
  /** Raw BSP content flags, preserved: a brush can be several liquids at once. */
  rawContents: number;
  surfaceFlags: number;
  signals: LiquidSignal[];
  /** Optional appearance profile selected by an exact compatibility override. */
  profile?: string;
  /** Optional six-face cubemap base path supplied by the original shader. */
  environmentMap?: string;
  /**
   * Whether this shader contributes a drawn surface. A `NODRAW` liquid is a
   * volume with no picture, which is normal rather than broken.
   */
  drawn: boolean;
  /** Brushes whose own shader is this one: the swimmable volume. */
  volumeBrushes: number;
  /** Faces drawn with this shader: the visible surface. */
  drawnFaces: number;
}

export interface LiquidOverride {
  /** Force this shader to be treated as liquid, or never to be. */
  include?: boolean;
  exclude?: boolean;
  kind?: LiquidKind;
  /** Visual profile id; the renderer decides what it means. */
  profile?: string;
}

export type LiquidOverrideTable = Readonly<Record<string, LiquidOverride>>;

/**
 * Versioned engine compatibility corrections.
 *
 * Keep this asset-centric and deliberately small. Most maps should classify
 * from their compiled contents or top-level surfaceparm; entries belong here
 * only after a broken asset has been verified in the corpus.
 */
export const DEFAULT_LIQUID_OVERRIDES: LiquidOverrideTable = Object.freeze({});

/** Resolve the dominant liquid declared by top-level shader surfaceparms. */
export function liquidKindFromSurfaceParms(surfaceParms: Iterable<string>): LiquidKind | null {
  const normalized = new Set(Array.from(surfaceParms, (parm) => parm.toLowerCase()));
  // Match ContentFlags.liquidKindOf: the most hostile combined kind wins.
  if (normalized.has("lava")) return "lava";
  if (normalized.has("slime")) return "slime";
  if (normalized.has("water")) return "water";
  return null;
}

/**
 * Strip a BSP shader name down to something comparable.
 *
 * The 64-byte name field in the textures lump is not reliably null-terminated.
 * Several shipped maps carry uninitialized bytes after the name — fragments of
 * ASE model text left in the compiler's buffer — so `textures/world/bluewater1`
 * arrives with a tail of geometry data attached. Cut at the first character
 * that cannot appear in a shader path, then normalize case and separators.
 *
 * Without this, an exact-name override could never match the malformed assets
 * that are the most likely things to need one.
 */
export function normalizeShaderName(raw: string): string {
  const printableEnd = raw.search(/[^\x20-\x7e]/);
  const trimmed = (printableEnd === -1 ? raw : raw.slice(0, printableEnd)).trim();
  // A real shader path has no whitespace; anything after the first space is the
  // compiler's leftovers rather than part of the name.
  const firstToken = trimmed.split(/\s/)[0] ?? "";
  return firstToken.replace(/\\/g, "/").toLowerCase();
}

/**
 * Liquid declared by a shader's own `surfaceparm`, keyed by normalized name.
 *
 * Supplied by the shader registry when it has parsed the map's scripts. The BSP
 * content flag is the stronger signal and is checked first; this exists to
 * catch surfaces whose compiled flags are missing or wrong, and to record
 * agreement when both are present.
 */
export type SurfaceParmLookup = (shaderName: string) => LiquidKind | null;
export type EnvironmentMapLookup = (shaderName: string) => string | null;

function kindFromOverride(override: LiquidOverride | undefined, fallback: LiquidKind | null): LiquidKind | null {
  if (!override) return fallback;
  if (override.exclude) return null;
  return override.kind ?? fallback ?? (override.include ? "water" : null);
}

/**
 * Classify every liquid shader in a map.
 *
 * Precedence, highest first:
 *   1. an exact-name `exclude` override;
 *   2. an exact-name `include` / `kind` override;
 *   3. the compiled BSP content flag;
 *   4. a parsed top-level `surfaceparm water|slime|lava`.
 *
 * A name that merely contains "water" never qualifies. `waterfall_trim`,
 * decals and glass all read that way and none of them are liquid.
 */
export function classifyLiquids(
  bsp: BspFile,
  options: {
    overrides?: LiquidOverrideTable;
    surfaceParm?: SurfaceParmLookup;
    environmentMap?: EnvironmentMapLookup;
  } = {},
): LiquidSurfaceDescriptor[] {
  const overrides = options.overrides ?? {};
  const surfaceParm = options.surfaceParm;

  const volumeBrushes = new Map<number, number>();
  for (const brush of bsp.brushes) {
    volumeBrushes.set(brush.shaderIndex, (volumeBrushes.get(brush.shaderIndex) ?? 0) + 1);
  }

  const drawnFaces = new Map<number, number>();
  for (const face of bsp.faces) {
    drawnFaces.set(face.textureIndex, (drawnFaces.get(face.textureIndex) ?? 0) + 1);
  }

  const out: LiquidSurfaceDescriptor[] = [];

  for (let textureIndex = 0; textureIndex < bsp.textures.length; textureIndex++) {
    const texture: BspTexture | undefined = bsp.textures[textureIndex];
    if (!texture) continue;

    const shaderName = normalizeShaderName(texture.name ?? "");
    const override = overrides[shaderName];
    if (override?.exclude) continue;

    const signals: LiquidSignal[] = [];
    let kind: LiquidKind | null = null;

    if (override?.include || override?.kind) {
      signals.push("override");
      kind = kindFromOverride(override, null);
    }

    if (isLiquid(texture.contentFlags)) {
      signals.push("contentFlag");
      kind = kind ?? liquidKindOf(texture.contentFlags);
    }

    const declared = surfaceParm?.(shaderName) ?? null;
    if (declared) {
      signals.push("surfaceParm");
      kind = kind ?? declared;
    }

    if (!kind || signals.length === 0) continue;

    out.push({
      shaderName,
      textureIndex,
      kind,
      rawContents: texture.contentFlags,
      surfaceFlags: texture.surfaceFlags,
      signals,
      profile: override?.profile,
      environmentMap: options.environmentMap?.(shaderName) ?? undefined,
      drawn: (texture.surfaceFlags & SurfaceFlags.NODRAW) === 0,
      volumeBrushes: volumeBrushes.get(textureIndex) ?? 0,
      drawnFaces: drawnFaces.get(textureIndex) ?? 0,
    });
  }

  return out;
}

/**
 * The descriptors that should produce a rendered water surface.
 *
 * A `NODRAW` shader is excluded even though it is genuinely liquid, and so is
 * a shader with no faces — both are volumes, and drawing them would put a
 * surface where the mapper deliberately put none.
 */
export function renderableLiquids(descriptors: readonly LiquidSurfaceDescriptor[]): LiquidSurfaceDescriptor[] {
  return descriptors.filter((d) => d.drawn && d.drawnFaces > 0);
}

/**
 * The descriptors that back a swimmable volume.
 *
 * Independent of how the surface looks, or whether it has one at all.
 */
export function volumeLiquids(descriptors: readonly LiquidSurfaceDescriptor[]): LiquidSurfaceDescriptor[] {
  return descriptors.filter((d) => d.volumeBrushes > 0);
}

/** Overrides that matched nothing in this map — a maintenance signal. */
export function unmatchedOverrides(
  descriptors: readonly LiquidSurfaceDescriptor[],
  overrides: LiquidOverrideTable,
): string[] {
  const seen = new Set(descriptors.map((d) => d.shaderName));
  return Object.keys(overrides).filter((name) => !seen.has(name));
}

/** Re-exported so callers do not need the physics module for a flag check. */
export { ContentFlags, SurfaceFlags };
