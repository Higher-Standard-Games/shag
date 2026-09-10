/**
 * Q3/Warsow BSP Content and Surface Flags
 *
 * These flags determine collision behavior for brushes.
 * Stored in texture.contentFlags for each brush.
 */

/** Content flags - what type of volume this brush represents */
export enum ContentFlags {
  SOLID = 0x1, // Completely solid - blocks everything
  LAVA = 0x8, // Lava volume (damage + blocks)
  SLIME = 0x10, // Slime volume (damage + blocks)
  WATER = 0x20, // Water volume (swimming)
  FOG = 0x40, // Fog volume (visual only)
  AREAPORTAL = 0x8000, // Area portal
  PLAYERCLIP = 0x10000, // Blocks players only (invisible)
  MONSTERCLIP = 0x20000, // Blocks monsters/NPCs only
  ORIGIN = 0x1000000, // Origin brush (removed at compile)
  DETAIL = 0x8000000, // Detail brush - NO collision
  STRUCTURAL = 0x10000000, // Structural brush
  TRANSLUCENT = 0x20000000, // Translucent (doesn't block vis)
  TRIGGER = 0x40000000, // Trigger volume
  NODROP = 0x80000000, // Don't drop items here
}

/** Surface flags - properties of brush faces */
export enum SurfaceFlags {
  NODAMAGE = 0x1, // No fall damage
  SLICK = 0x2, // Slippery surface
  SKY = 0x4, // Sky surface
  LADDER = 0x8, // Climbable
  NOIMPACT = 0x10, // No impact effects
  NOMARKS = 0x20, // No decals/marks
  FLESH = 0x40, // Flesh sounds
  NODRAW = 0x80, // Don't draw (invisible)
  HINT = 0x100, // Hint brush
  SKIP = 0x200, // Skip brush
  NOLIGHTMAP = 0x400, // No lightmap
  POINTLIGHT = 0x800, // Point light
  METALSTEPS = 0x1000, // Metal footsteps
  NOSTEPS = 0x2000, // No footsteps
  NONSOLID = 0x4000, // Not solid (explicitly)
  LIGHTFILTER = 0x8000, // Light filter
  ALPHASHADOW = 0x10000, // Alpha shadow
  NODLIGHT = 0x20000, // No dynamic light
  DUST = 0x40000, // Dust particles on impact
}

/** Collision masks - combinations of content flags */
export const CollisionMasks = {
  /** What blocks player movement */
  PLAYERSOLID: ContentFlags.SOLID | ContentFlags.PLAYERCLIP,

  /** What blocks all entities */
  ALL: ContentFlags.SOLID | ContentFlags.PLAYERCLIP | ContentFlags.MONSTERCLIP,

  /** What blocks shots/projectiles */
  SHOT: ContentFlags.SOLID,

  /**
   * Every liquid volume: water, slime and lava.
   *
   * A single brush can carry more than one of these bits — four shaders in the
   * shipped map pack declare `WATER | SLIME` together — so callers that need to
   * know *which* liquid must read the individual bits rather than assume the
   * mask matched exactly one.
   */
  LIQUID: ContentFlags.WATER | ContentFlags.LAVA | ContentFlags.SLIME,

  /** @deprecated Name predates slime/lava; use {@link CollisionMasks.LIQUID}. */
  WATER: ContentFlags.WATER | ContentFlags.LAVA | ContentFlags.SLIME,

  /** Opaque to visibility */
  OPAQUE: ContentFlags.SOLID,
} as const;

/**
 * Check if content flags indicate solid for players.
 * NOTE: CONTENTS_DETAIL is a BSP/vis flag, not a solidity flag — a detail brush is
 * solid iff it carries SOLID/PLAYERCLIP content (Q3/Warsow collide detail brushes).
 */
export function isPlayerSolid(contentFlags: number): boolean {
  return (contentFlags & CollisionMasks.PLAYERSOLID) !== 0;
}

/**
 * Check if content flags indicate any solid (see isPlayerSolid re: detail).
 */
export function isSolid(contentFlags: number): boolean {
  return (contentFlags & ContentFlags.SOLID) !== 0;
}

/**
 * Check if this is a water/liquid volume
 */
export function isLiquid(contentFlags: number): boolean {
  return (contentFlags & CollisionMasks.LIQUID) !== 0;
}

/**
 * Which liquid a set of content flags describes, or null for none.
 *
 * Where a brush carries several liquid bits at once, the most hostile one
 * wins: standing in something that is both slime and water should read as
 * slime, because that is the bit with consequences.
 */
export function liquidKindOf(contentFlags: number): "water" | "slime" | "lava" | null {
  if (contentFlags & ContentFlags.LAVA) return "lava";
  if (contentFlags & ContentFlags.SLIME) return "slime";
  if (contentFlags & ContentFlags.WATER) return "water";
  return null;
}
