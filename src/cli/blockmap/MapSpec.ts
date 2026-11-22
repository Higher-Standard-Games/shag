/**
 * A block map: the placeholder map format the media tool compiles to IBSP.
 *
 * Everything is an axis-aligned box in Quake units (Z up), which is enough for
 * a voxel-style diorama and needs no CSG. Real maps will come from SHAGGED and
 * MakeBSP/MakeLight; this exists so the game has a playable BSP before that
 * toolchain is set up for it.
 */

import type { Shape } from "./Shapes";

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

/** Texture names without extension, as they appear in the PK3 (`textures/...`). */
export interface BoxTextures {
  top: string;
  side: string;
  bottom?: string;
}

export interface Box {
  mins: Vec3;
  maxs: Vec3;
  textures: BoxTextures;
  /** Emit the bottom face. Off by default: dioramas are seen from above. */
  bottomFace?: boolean;
  /**
   * A water volume: its textures get `CONTENTS_WATER` instead of solid, so
   * SHAG draws them with its liquid renderer and collision lets you in. It
   * casts no shadow, does not hide the faces of boxes it touches, and only
   * its top face is drawn. SHAG's water renderer handles one flat surface per
   * texture best, so give water at different heights different textures.
   */
  liquid?: boolean;
}

export interface PointLight {
  origin: Vec3;
  /** Linear RGB, 1 = full brightness at the light. */
  color: Rgb;
  /** Distance in units where the light reaches zero. */
  radius: number;
}

export interface MapLighting {
  /** Direction the sunlight travels (pointing down for a sun above). */
  sunDirection: Vec3;
  sunColor: Rgb;
  /** Ambient light from the sky, for faces that look up. */
  skyAmbient: Rgb;
  /** Ambient light bounced from the ground, for faces that look down. */
  groundAmbient: Rgb;
  points: PointLight[];
  /**
   * Baked ambient occlusion (contact shadows): ambient light is dimmed where
   * short rays from a surface hit nearby boxes, so wall feet, corners and the
   * ground under eaves darken. Off when left out.
   */
  occlusion?: {
    /** Ray length in units: how far away a box still darkens. */
    radius: number;
    /** 0..1: how much a fully enclosed spot loses. */
    strength: number;
  };
}

export interface BlockMap {
  name: string;
  /** Text for worldspawn `message`. */
  title: string;
  boxes: Box[];
  /** Stairs and arches, built from boxes at compile time (see `Shapes.ts`). */
  shapes?: Shape[];
  lighting: MapLighting;
  /** Extra entities, as key/value pairs. Each needs a `classname`. */
  entities: Record<string, string>[];
  /** World units per lightmap texel. */
  luxelSize: number;
  /** Light grid spacing, written to worldspawn `gridsize`. */
  gridSize: Vec3;
  /** World units covered by one repeat of a texture. */
  textureScale: number;
  /**
   * A sky shader name (from a `.shader` script in the PK3s, with `skyparms`).
   * The compiler adds a hidden sky surface so SHAG draws that skybox, which
   * also gives water something to reflect.
   */
  sky?: string;
}
