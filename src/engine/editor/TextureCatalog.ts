/**
 * The texture browser's catalog, built from what is actually mounted: every
 * image under textures/ in the loaded PK3s plus every textures/ shader in their
 * scripts, so the browser lists exactly what the game and MakeBSP will find.
 * Pure: callers pass file paths, parsed shaders and the gamepack's tag file.
 */

import type { Q3Shader } from "../loader/shader/Q3ShaderTypes";

export interface TextureEntry {
  /** The .map face name: unprefixed, e.g. "blx/blx_dark" (MakeBSP adds textures/). */
  name: string;
  /** First folder under textures/, e.g. "blx". */
  folder: string;
  /**
   * The image the game draws for it, as a path in the packages, or null when it
   * can't be resolved. For a shader this is its editor image or first stage map,
   * not a same-named file: blx/blx_light_blue draws textures/lights/bluetrim.tga.
   * Image size (and so alignment density) comes from this file.
   */
  image: string | null;
  hasShader: boolean;
  tags: string[];
  /** Under common/: compiler and gameplay tool textures (caulk, clip, trigger...). */
  compiler: boolean;
  sky: boolean;
  transparent: boolean;
  nolightmap: boolean;
  /** A fog volume shader: it draws no image. */
  fog: boolean;
  /** Draws $whiteimage tinted by a colour rather than an image. */
  solidColor: boolean;
  /**
   * The game draws an image (a stage map) that isn't in any package, so the
   * face will render wrong; the browser shows a "missing" tile. A shader that
   * draws no image (fog, solid colour) or only lacks its editor image is not missing.
   */
  missing: boolean;
}

export interface CatalogSources {
  /** Every file path in the mounted packages. */
  files: readonly string[];
  /** Parsed shader scripts (scripts/*.shader). */
  shaders: readonly Q3Shader[];
  /** Unprefixed texture name (lower case) to tags, from shadertags.xml. */
  tags?: ReadonlyMap<string, string[]>;
}

export const IMAGE_EXTENSIONS = ["tga", "jpg", "jpeg", "png", "ktx", "webp"] as const;
/** Derived maps the engine reads from the shader, not textures a mapper picks. */
const VARIANT = /_(norm|gloss|glow|spec|specular|emissive|bump|local)$/i;

const stripExtension = (path: string): string => path.replace(/\.[a-z0-9]+$/i, "");
const unprefix = (path: string): string => path.replace(/^textures\//i, "");
const folderOf = (name: string): string => name.split("/")[0] ?? "";

/**
 * Index of image files by lower-case path without extension, so a reference
 * written as .tga finds the .jpg that actually ships (Q3 engines swap
 * extensions the same way).
 */
function indexImages(files: readonly string[]): Map<string, string> {
  const images = new Map<string, string>();
  for (const file of files) {
    const extension = file.split(".").pop()?.toLowerCase() ?? "";
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(extension)) continue;
    const key = stripExtension(file).toLowerCase();
    const current = images.get(key);
    // Prefer formats a browser can show directly when several ship.
    if (!current || rank(file) < rank(current)) images.set(key, file);
  }
  return images;
}

function rank(file: string): number {
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "webp", "tga", "ktx"].indexOf(extension);
}

function resolveImage(reference: string | undefined, images: ReadonlyMap<string, string>): string | null {
  if (!reference || reference.startsWith("$") || reference.startsWith("*")) return null;
  return images.get(stripExtension(reference).toLowerCase()) ?? null;
}

/** Image paths the game itself draws for a shader (stage maps and first animation frames). */
function drawnReferences(shader: Q3Shader): string[] {
  return shader.stages
    .flatMap((stage) => [stage.map, stage.animMap?.frames[0]])
    .filter((ref): ref is string => Boolean(ref) && !ref!.startsWith("$") && !ref!.startsWith("*"));
}

function shaderImage(shader: Q3Shader, images: ReadonlyMap<string, string>): string | null {
  const fromEditor = resolveImage(shader.editorImage, images);
  if (fromEditor) return fromEditor;
  for (const stage of shader.stages) {
    const fromStage = resolveImage(stage.map, images) ?? resolveImage(stage.animMap?.frames[0], images);
    if (fromStage) return fromStage;
  }
  return resolveImage(shader.name, images);
}

export function buildTextureCatalog({ files, shaders, tags }: CatalogSources): TextureEntry[] {
  const images = indexImages(files);
  const entries = new Map<string, TextureEntry>();
  const tagsFor = (name: string) => [...(tags?.get(name.toLowerCase()) ?? [])];
  const base = (name: string) => {
    const folder = folderOf(name);
    return { name, folder, tags: tagsFor(name), compiler: folder.toLowerCase() === "common" };
  };

  for (const shader of shaders) {
    if (!/^textures\//i.test(shader.name)) continue;
    const name = unprefix(shader.name);
    const key = name.toLowerCase();
    if (entries.has(key)) continue; // first definition wins, as the shader registry does
    const image = shaderImage(shader, images);
    const parms = shader.surfaceParms;
    const first = shader.stages[0];
    const drawn = drawnReferences(shader);
    entries.set(key, {
      ...base(name),
      image,
      hasShader: true,
      sky: parms.has("sky") || Boolean(shader.skyParms),
      transparent: parms.has("trans") || Boolean(first?.blendFunc) || Boolean(first?.alphaFunc),
      nolightmap: parms.has("nolightmap"),
      fog: Boolean(shader.fogParms) || parms.has("fog"),
      solidColor: drawn.length === 0 && shader.stages.some((stage) => stage.map === "$whiteimage"),
      missing: drawn.length > 0 && !drawn.some((ref) => resolveImage(ref, images)),
    });
  }

  for (const [key, file] of images) {
    if (!key.startsWith("textures/")) continue;
    const name = unprefix(stripExtension(file));
    if (VARIANT.test(name) || entries.has(name.toLowerCase())) continue;
    entries.set(name.toLowerCase(), {
      ...base(name),
      image: file,
      hasShader: false,
      sky: false,
      transparent: false,
      nolightmap: false,
      fog: false,
      solidColor: false,
      missing: false,
    });
  }

  return [...entries.values()].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}

/** Tags from a NetRadiant shadertags.xml: `<texture path="textures/x/y"><tag>Group</tag></texture>`. */
export function parseShaderTags(xml: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const match of xml.matchAll(/<texture\s+path="([^"]+)"\s*>([\s\S]*?)<\/texture>/g)) {
    const names = [...match[2].matchAll(/<tag>([^<]*)<\/tag>/g)].map((tag) => tag[1].trim()).filter(Boolean);
    if (names.length) tags.set(unprefix(match[1]).toLowerCase(), names);
  }
  return tags;
}

/** Folders with their entry counts, for the browser's sidebar. Case is ignored: HazelH and hazelh are one folder. */
export function catalogFolders(entries: readonly TextureEntry[]): Array<{ folder: string; count: number }> {
  const groups = new Map<string, { folder: string; count: number }>();
  for (const entry of entries) {
    const key = entry.folder.toLowerCase();
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { folder: entry.folder, count: 1 });
  }
  return [...groups.values()].sort((a, b) => (a.folder.toLowerCase() < b.folder.toLowerCase() ? -1 : 1));
}

/**
 * Entries matching every word of the query, best first: a word found whole in
 * the name beats one at the start of a path segment, which beats letters found
 * in order (so "bdark" finds blx/blx_dark). Tags are searched too.
 */
export function searchCatalog(entries: readonly TextureEntry[], query: string): TextureEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...entries];
  const scored: Array<{ entry: TextureEntry; score: number }> = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const haystack = `${name} ${entry.tags.join(" ").toLowerCase()}`;
    let score = 0;
    for (const word of words) {
      const s = wordScore(name, haystack, word);
      if (s === 0) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.entry.name.toLowerCase() < b.entry.name.toLowerCase() ? -1 : 1))
    .map((item) => item.entry);
}

function wordScore(name: string, haystack: string, word: string): number {
  const at = name.indexOf(word);
  if (at >= 0) return /[/_\-.]/.test(name[at - 1] ?? "/") ? 4 : 3;
  if (haystack.includes(word)) return 2;
  let position = 0;
  for (const char of word) {
    position = haystack.indexOf(char, position);
    if (position < 0) return 0;
    position++;
  }
  return 1;
}
