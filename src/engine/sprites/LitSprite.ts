/**
 * A lit pixel-art sprite for BSP maps: an upright, alpha-tested quad that
 * turns about its vertical axis to face the camera (the HD-2D "paper
 * figure"), sampled nearest, and lit from the map's light grid.
 *
 * Lighting: every frame the sprite samples the BSP light grid at its middle
 * (`BspManager.getLightingInto`, trilinear over the grid) and shades itself
 * with the grid's ambient plus its directional light, half-Lambert against
 * the quad's facing, so a sprite walking past a lamp warms up and one in a
 * house's shadow darkens. The colour goes into the material's emissive term
 * with scene lighting off, so the sprite looks the same whatever lights the
 * scene has; each sprite owns its material for that reason.
 *
 * Alpha test rather than blend: the quad writes depth and sorts correctly
 * with the world.
 *
 * Shadow: SHAG's BSP world draws with its own ShaderMaterials, which do not
 * read Babylon shadow maps, so a shadow generator cannot darken the world
 * from game code. Instead the sprite lays its own silhouette on the ground
 * along the sun (a planar projected shadow), faded out where the light grid
 * says the sun does not reach. It is exact on flat ground and only
 * approximate on steps and walls.
 *
 * Unlike SHAG's `sprites/BillboardSprite` (point lights summed on the CPU into
 * a material shared per sheet, alpha blend, a disc shadow, wired to the
 * `.map` path), this is meant for BSP maps and per-sprite light.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { BspLightVol } from "../loader/bsp/BspLoader";
import { BspManager } from "../loader/bsp/BspManager";

/** A sprite sheet: a grid of equal frames in one texture. */
export interface LitSpriteSheet {
  texture: Texture;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

export interface LitSpriteOptions {
  /** World units per art pixel. */
  unitsPerPixel: number;
  /**
   * Linear light per light grid byte step: q3map2 grids store light at 0..255
   * for 0..1, so 1/255 there; a grid written at half range (0..255 for 0..2)
   * uses 2/255.
   */
  gridScale?: number;
  /** Overall brightness, to match the sprite to the baked world. */
  exposure?: number;
  /** How much of the directional light reaches the back of the quad (0 = Lambert, 1 = flat). */
  wrap?: number;
  /** Light when the map has no light grid. */
  fallback?: Color3;
  /** A projected sun shadow (see `shadowDirection`); off when left out. */
  shadow?: {
    /** Opacity of a shadow in full sun. */
    opacity: number;
    /**
     * Directional light (after `gridScale`, summed over RGB / 3) that counts as
     * full sun: the shadow fades out where the grid's directional light is
     * weaker, in the shade of a house, so shadows do not stack.
     */
    sunLevel?: number;
  };
}

const UP = new Vector3(0, 1, 0);

export class LitSprite {
  readonly mesh: Mesh;
  readonly material: StandardMaterial;
  readonly width: number;
  readonly height: number;
  /** The sampled light, before exposure; for probes and debugging. */
  readonly light = new Color3(1, 1, 1);

  private readonly sample: BspLightVol = { ambient: [0, 0, 0], directional: [0, 0, 0], direction: [0, 0] };
  private readonly probe = new Vector3();
  private readonly toLight = new Vector3();
  private readonly facing = new Vector3();
  private readonly uvs = new Float32Array(8);
  private readonly shadowPositions = new Float32Array(12);
  private readonly shadowMesh: Mesh | null = null;
  private readonly shadowMaterial: StandardMaterial | null = null;
  /** Shadow opacity in full sun; 0 hides it. */
  shadowOpacity: number;
  /** Directional light (summed RGB / 3) that counts as full sun for the shadow. */
  sunLevel: number;
  private flipped = false;
  /**
   * The direction sunlight travels (Babylon axes, pointing down). With a
   * shadow option set, the sprite lays its silhouette on the ground along it:
   * a planar projected shadow, which needs nothing from the world's materials.
   */
  shadowDirection: Vector3 | null = null;
  private column = -1;
  private row = -1;
  private readonly gridScale: number;
  /** How much directional light reaches the back of the quad (0 = Lambert, 1 = flat). */
  wrap: number;
  private readonly fallback: Color3;
  exposure: number;

  constructor(
    name: string,
    readonly sheet: LitSpriteSheet,
    scene: Scene,
    options: LitSpriteOptions,
  ) {
    this.width = sheet.frameWidth * options.unitsPerPixel;
    this.height = sheet.frameHeight * options.unitsPerPixel;
    this.gridScale = options.gridScale ?? 1 / 255;
    this.exposure = options.exposure ?? 1;
    this.wrap = options.wrap ?? 0.5;
    this.fallback = options.fallback ?? new Color3(1, 1, 1);

    // A quad standing on its bottom edge, facing -Z (Babylon's billboard front)
    const mesh = new Mesh(name, scene);
    const halfWidth = this.width / 2;
    const data = new VertexData();
    data.positions = [-halfWidth, 0, 0, halfWidth, 0, 0, halfWidth, this.height, 0, -halfWidth, this.height, 0];
    data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
    data.indices = [0, 2, 1, 0, 3, 2];
    data.uvs = Array.from(this.uvs);
    data.applyToMesh(mesh, true);
    // Turned towards the view camera in updateLighting, not by a billboard mode:
    // a billboard faces whichever camera renders it, which in a shadow pass is the sun
    mesh.isPickable = false;
    this.mesh = mesh;

    const material = new StandardMaterial(`${name}-material`, scene);
    material.diffuseTexture = sheet.texture;
    material.diffuseTexture.hasAlpha = true;
    // Needed for the alpha test to read the texture's alpha (DIFFUSEHASALPHA)
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHATEST;
    material.alphaCutOff = 0.5;
    material.backFaceCulling = false;
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.ambientColor = Color3.Black();
    material.emissiveColor = new Color3(1, 1, 1);
    mesh.material = material;
    this.material = material;

    if (options.shadow) {
      const shadow = new Mesh(`${name}-shadow`, scene);
      const shadowData = new VertexData();
      shadowData.positions = Array.from(this.shadowPositions);
      shadowData.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      shadowData.indices = [0, 2, 1, 0, 3, 2];
      shadowData.uvs = Array.from(this.uvs);
      shadowData.applyToMesh(shadow, true);
      shadow.isPickable = false;
      shadow.alwaysSelectAsActiveMesh = true;
      const shade = new StandardMaterial(`${name}-shadow-material`, scene);
      shade.diffuseTexture = sheet.texture;
      shade.useAlphaFromDiffuseTexture = true;
      shade.transparencyMode = Material.MATERIAL_ALPHATESTANDBLEND;
      shade.alphaCutOff = 0.5;
      shade.backFaceCulling = false;
      shade.disableLighting = true;
      shade.disableDepthWrite = true;
      shade.zOffset = -2;
      shade.diffuseColor = Color3.Black();
      shade.specularColor = Color3.Black();
      shade.emissiveColor = Color3.Black();
      shade.ambientColor = Color3.Black();
      shadow.material = shade;
      this.shadowMesh = shadow;
      this.shadowMaterial = shade;
    }
    this.shadowOpacity = options.shadow?.opacity ?? 0;
    this.sunLevel = options.shadow?.sunLevel ?? 0.6;

    this.setFrame(0, 0);
  }

  /** Feet position in Babylon space. */
  get position(): Vector3 {
    return this.mesh.position;
  }

  get frameColumn(): number {
    return this.column;
  }

  get frameRow(): number {
    return this.row;
  }

  setFrame(column: number, row: number): void {
    if (column === this.column && row === this.row) return;
    this.column = column;
    this.row = row;
    const { columns, rows } = this.sheet;
    const u0 = column / columns;
    const u1 = (column + 1) / columns;
    // Textures load with invertY, so v runs from the sheet's bottom row up
    const v0 = 1 - (row + 1) / rows;
    const v1 = 1 - row / rows;
    const uvs = this.uvs;
    uvs[0] = u0;
    uvs[1] = v0;
    uvs[2] = u1;
    uvs[3] = v0;
    uvs[4] = u1;
    uvs[5] = v1;
    uvs[6] = u0;
    uvs[7] = v1;
    this.mesh.updateVerticesData(VertexBuffer.UVKind, uvs);
    this.shadowMesh?.updateVerticesData(VertexBuffer.UVKind, uvs);
  }

  /** Mirror the sprite horizontally (a figure walking the other way). */
  setFlipped(flipped: boolean): void {
    this.flipped = flipped;
    this.mesh.scaling.x = flipped ? -1 : 1;
  }

  /** Re-light from the light grid. Call once a frame, after moving. */
  updateLighting(camera: Camera): void {
    // Face the camera about the vertical axis (the quad's front is -Z)
    const dx = camera.globalPosition.x - this.mesh.position.x;
    const dz = camera.globalPosition.z - this.mesh.position.z;
    this.mesh.rotation.y = Math.atan2(-dx, -dz);
    const probe = this.probe.copyFrom(this.mesh.position);
    probe.y += this.height * 0.5;
    const grid = BspManager.getInstance().getLightingInto(probe, this.sample);
    if (!grid) {
      this.light.copyFrom(this.fallback);
    } else {
      // Q3 direction bytes: longitude from +Z, then latitude around Z, in Q3 axes (Z up)
      const longitude = (grid.direction[0] / 256) * Math.PI * 2;
      const latitude = (grid.direction[1] / 256) * Math.PI * 2;
      const sinLongitude = Math.sin(longitude);
      // Q3 (x, y, z) to Babylon (x, z, y)
      this.toLight.set(Math.cos(latitude) * sinLongitude, Math.cos(longitude), Math.sin(latitude) * sinLongitude);
      // The quad faces the camera about the vertical axis
      this.facing.copyFrom(camera.globalPosition).subtractInPlace(this.mesh.position);
      this.facing.y = 0;
      const length = this.facing.length();
      if (length > 1e-4) this.facing.scaleInPlace(1 / length);
      const cos = Vector3.Dot(this.toLight, this.facing);
      const lambert = Math.max(0, cos * (1 - this.wrap) + this.wrap);
      // Light from above still lights an upright figure a little
      const top = Math.max(0, Vector3.Dot(this.toLight, UP)) * 0.35;
      const direct = Math.min(1, lambert + top);
      const s = this.gridScale;
      this.light.set(
        grid.ambient[0] * s + grid.directional[0] * s * direct,
        grid.ambient[1] * s + grid.directional[1] * s * direct,
        grid.ambient[2] * s + grid.directional[2] * s * direct,
      );
    }
    this.light.scaleToRef(this.exposure, this.material.emissiveColor);
    if (this.shadowMesh) {
      const sun = grid ? (grid.directional[0] + grid.directional[1] + grid.directional[2]) * (this.gridScale / 3) : 1;
      this.updateShadow(Math.min(1, sun / this.sunLevel));
    }
  }

  /** Lay the silhouette on the ground: a card across the sun, flattened along it. */
  private updateShadow(sun: number): void {
    const mesh = this.shadowMesh!;
    const material = this.shadowMaterial!;
    const direction = this.shadowDirection;
    if (!direction || direction.y > -0.05 || sun <= 0.01 || this.shadowOpacity <= 0) {
      mesh.isVisible = false;
      return;
    }
    mesh.isVisible = this.mesh.isVisible && this.mesh.isEnabled();
    material.alpha = this.shadowOpacity * sun;
    // Ground offset of the sprite's top, along the sun's horizontal travel
    const along = Math.min(4, 1 / -direction.y) * this.height;
    const horizontal = Math.hypot(direction.x, direction.z) || 1;
    const ax = direction.x * along;
    const az = direction.z * along;
    // Across the sun, half the sprite wide; mirrored with the sprite
    let cx = -direction.z / horizontal;
    let cz = direction.x / horizontal;
    if (this.flipped) {
      cx = -cx;
      cz = -cz;
    }
    cx *= this.width / 2;
    cz *= this.width / 2;
    const { x, y, z } = this.mesh.position;
    const p = this.shadowPositions;
    const lift = y + 0.5;
    p[0] = x - cx;
    p[1] = lift;
    p[2] = z - cz;
    p[3] = x + cx;
    p[4] = lift;
    p[5] = z + cz;
    p[6] = x + cx + ax;
    p[7] = lift;
    p[8] = z + cz + az;
    p[9] = x - cx + ax;
    p[10] = lift;
    p[11] = z - cz + az;
    mesh.updateVerticesData(VertexBuffer.PositionKind, p);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.shadowMesh?.dispose();
    this.shadowMaterial?.dispose();
  }
}

/** Nearest sampling for a sprite sheet: art pixels stay square at any size. */
export function usePixelSampling(texture: Texture): void {
  texture.updateSamplingMode(Constants.TEXTURE_NEAREST_NEAREST_MIPLINEAR);
}
