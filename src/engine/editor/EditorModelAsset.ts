/**
 * Loads a misc_model asset into an editor scene. A model packed in a PK3 is
 * read from the package (its folder's packages are loaded first); anything
 * else is fetched loose from /data/. MD3 goes through the engine's MD3 loader
 * and is skinned with plain diffuse images from the packages, like the
 * textured preview: no shader stages. GLB/glTF/OBJ go through Babylon's.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import type { Vec3q } from "./EditorDocument";
import { IMAGE_EXTENSIONS } from "./TextureCatalog";

/** Model extents in Quake units (Z up), at scale 1 and angle 0. */
export interface ModelBounds {
  min: Vec3q;
  max: Vec3q;
}

/** Shown while a skin decodes, and kept when the packages have none. */
const UNSKINNED = new Color3(0.62, 0.66, 0.7);

async function loadPackages(pk3s: Iterable<string | undefined>): Promise<void> {
  const loader = PK3Loader.getInstance();
  const loaded = new Set(loader.getPackageInfo().map((pkg) => pkg.filename));
  const wanted = new Set([...pk3s].filter((pk3): pk3 is string => Boolean(pk3) && !loaded.has(pk3!)));
  await Promise.all([...wanted].map((pk3) => loader.loadPK3(pk3)));
}

/** Loads the packages holding the model's folder, then reads the model; null when no package has it. */
async function packagedBytes(path: string): Promise<ArrayBuffer | null> {
  const index = PK3Index.getInstance();
  if (!index.findByPattern(path).length) return null;
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  await loadPackages(index.findByPattern(`${folder}*`).map((hit) => hit.pk3));
  return PK3Loader.getInstance().getFile(path);
}

/** The packaged image an MD3 surface shader names, by any image extension. */
function skinImage(shader: string): { file: string; pk3: string } | null {
  const base = shader.replace(/\\/g, "/").replace(/\.[a-z0-9]+$/i, "");
  const index = PK3Index.getInstance();
  for (const ext of IMAGE_EXTENSIONS) {
    const hit = index.findByPattern(`${base}.${ext}`)[0];
    if (hit) return hit;
  }
  return null;
}

/** A flat material at once, given its image when the decode lands. */
function skinMaterial(scene: Scene, name: string, file: string | null, backFaceCulling: boolean): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = UNSKINNED;
  material.specularColor = Color3.Black();
  material.backFaceCulling = backFaceCulling;
  if (!file) return material;
  void (async () => {
    const bytes = await PK3Loader.getInstance().getFile(file);
    const { previewPixels } = await import("./TexturePixels");
    const decoded = bytes ? await previewPixels(file, bytes) : null;
    if (!decoded || scene.isDisposed || material.getScene() !== scene || !material.getBindedMeshes().length) return;
    const texture = new RawTexture(
      decoded.pixels,
      decoded.width,
      decoded.height,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = file;
    material.diffuseColor = Color3.White();
    material.diffuseTexture = texture;
  })().catch((error) => console.warn(`[SHAGGED] model skin ${file} failed`, error));
  return material;
}

async function loadMd3(scene: Scene, bytes: ArrayBuffer, name: string): Promise<TransformNode> {
  const { MD3Loader } = await import("../loader/model/MD3Loader");
  const md3 = MD3Loader.getInstance();
  const model = md3.parseMD3(bytes);
  const skins = new Map<string, { file: string; pk3: string } | null>(
    model.surfaces.map((surface) => {
      const shader = surface.shaders[0]?.name;
      return [`${name}_${surface.header.name}`, shader ? skinImage(shader) : null];
    }),
  );
  await loadPackages([...skins.values()].map((skin) => skin?.pk3));
  // the loader is shared: point it at this scene for this one build
  md3.init(scene);
  const result = md3.createMeshes(model, name);
  if (!result) throw new Error("MD3 has no drawable surfaces");
  for (const mesh of result.meshes) {
    const engineMaterial = mesh.material;
    mesh.material = skinMaterial(
      scene,
      `${mesh.name}_skin`,
      skins.get(mesh.name)?.file ?? null,
      engineMaterial?.backFaceCulling ?? true,
    );
    // its texture belongs to the engine's shared cache; keep that alive
    engineMaterial?.dispose(false, false);
  }
  return result.root;
}

/** A root node holding the model at the origin, unscaled; the caller positions and disposes it. */
export async function loadEditorModel(scene: Scene, path: string, name: string): Promise<TransformNode> {
  const lower = path.toLowerCase();
  const bytes = await packagedBytes(path);
  if (lower.endsWith(".md3")) {
    if (!bytes) throw new Error("MD3 models load from packages only; none holds this path");
    return loadMd3(scene, bytes, name);
  }
  const slash = path.lastIndexOf("/");
  const result =
    bytes && lower.endsWith(".glb")
      ? await ImportMeshAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" })
      : await ImportMeshAsync(path.slice(slash + 1), scene, { rootUrl: `/data/${path.slice(0, slash + 1)}` });
  const root = new TransformNode(name, scene);
  for (const node of result.transformNodes) if (!node.parent) node.parent = root;
  for (const mesh of result.meshes) if (!mesh.parent) mesh.parent = root;
  return root;
}

/** The loaded model's extents, measured before it is moved. */
export function measureModel(root: TransformNode): ModelBounds | null {
  root.computeWorldMatrix(true);
  if (!root.getChildMeshes(false).some((mesh) => mesh.getTotalVertices() > 0)) return null;
  const { min, max } = root.getHierarchyBoundingVectors(true, (mesh) => mesh.getTotalVertices() > 0);
  // Babylon is Y up; the editor's Quake axes are Z up
  return { min: { x: min.x, y: min.z, z: min.y }, max: { x: max.x, y: max.z, z: max.y } };
}

export function formatBounds(bounds: ModelBounds | null): string {
  if (!bounds) return "size unknown";
  const size = (axis: keyof Vec3q) => Math.round(bounds.max[axis] - bounds.min[axis]);
  return `${size("x")}×${size("y")}×${size("z")} units`;
}

/** Bounds of the model as placed: scaled, then turned by its yaw about Z, as an axis-aligned box. */
export function placedBounds(bounds: ModelBounds, scale: number, angleDegrees: number): ModelBounds {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y]) {
      xs.push((x * cos - y * sin) * scale);
      ys.push((x * sin + y * cos) * scale);
    }
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys), z: bounds.min.z * scale },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: bounds.max.z * scale },
  };
}
