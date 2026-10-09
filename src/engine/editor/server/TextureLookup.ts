/**
 * The texture browser's catalog for Node tools (the `shagged` CLI and MCP
 * server): the same entries the editor lists, built from the packages in the
 * data root, plus each texture's image size, which face alignment needs.
 *
 * Building reads every package, so the result is cached on disk and rebuilt
 * only when the set of packages (names, sizes, dates) changes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseShaderFile } from "../../loader/shader/Q3ShaderParser";
import type { Q3Shader } from "../../loader/shader/Q3ShaderTypes";
import { imageSize } from "../ImageSize";
import { buildTextureCatalog, parseShaderTags, searchCatalog, type TextureEntry } from "../TextureCatalog";

export interface TextureInfo extends TextureEntry {
  /** Image size in texels, or null when the image is missing or unreadable. */
  size: [number, number] | null;
}

const CACHE_VERSION = 1;
const TAGS_FILE = path.resolve("editor/gamepacks/washoi.game/shadertags.xml");

let memory: { key: string; entries: TextureInfo[] } | null = null;

function packagesKey(dataRoot: string, packages: string[]): string {
  const hash = createHash("sha256").update(String(CACHE_VERSION));
  for (const name of packages) {
    const stat = statSync(path.join(dataRoot, name));
    hash.update(`${name}:${stat.size}:${stat.mtimeMs}\n`);
  }
  return hash.digest("hex");
}

/** The catalog with image sizes, from memory, the disk cache, or a fresh build. */
export async function loadTextureCatalog(
  dataRoot = path.resolve("public/data"),
  cacheFile = path.resolve("server-data/shagged/texture-catalog.json"),
): Promise<TextureInfo[]> {
  // Packages load in name order and later ones override earlier ones, as in the game.
  const packages = existsSync(dataRoot)
    ? readdirSync(dataRoot)
        .filter((f) => f.toLowerCase().endsWith(".pk3"))
        .sort()
    : [];
  const key = packagesKey(dataRoot, packages);
  if (memory?.key === key) return memory.entries;
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as { key: string; entries: TextureInfo[] };
      if (cached.key === key) {
        memory = cached;
        return cached.entries;
      }
    } catch {
      // Rebuild below.
    }
  }
  const entries = await build(dataRoot, packages);
  memory = { key, entries };
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(memory));
  return entries;
}

async function build(dataRoot: string, packages: string[]): Promise<TextureInfo[]> {
  const JSZip = (await import("jszip")).default;
  const open = async (name: string) => JSZip.loadAsync(new Uint8Array(readFileSync(path.join(dataRoot, name))));
  // Pass 1: every file's owning package (the last one wins), and the shader scripts.
  const owner = new Map<string, { pkg: string; entry: string }>();
  const shaders: Q3Shader[] = [];
  for (const pkg of packages) {
    let zip: Awaited<ReturnType<typeof open>>;
    try {
      zip = await open(pkg);
    } catch (error) {
      console.warn(`[TextureLookup] ${pkg} unreadable: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    for (const entry of Object.keys(zip.files)) {
      if (zip.files[entry].dir) continue;
      owner.set(entry.toLowerCase(), { pkg, entry });
      if (/^scripts\/.+\.shader$/i.test(entry))
        shaders.push(...parseShaderFile(await zip.files[entry].async("string")));
    }
  }
  const files = [...owner.values()].map((o) => o.entry);
  const tags = existsSync(TAGS_FILE) ? parseShaderTags(readFileSync(TAGS_FILE, "utf8")) : undefined;
  const catalog = buildTextureCatalog({ files, shaders, tags });

  // Pass 2: read each needed image once, package by package.
  const wanted = new Map<string, Array<{ entry: string; lower: string }>>();
  for (const texture of catalog) {
    if (!texture.image) continue;
    const lower = texture.image.toLowerCase();
    const found = owner.get(lower);
    if (!found) continue;
    const list = wanted.get(found.pkg) ?? [];
    list.push({ entry: found.entry, lower });
    wanted.set(found.pkg, list);
  }
  const sizes = new Map<string, [number, number] | null>();
  for (const [pkg, images] of wanted) {
    const zip = await open(pkg);
    for (const { entry, lower } of images) {
      if (sizes.has(lower)) continue;
      const bytes = await zip.file(entry)?.async("uint8array");
      sizes.set(lower, bytes ? imageSize(bytes, entry) : null);
    }
  }
  return catalog.map((texture) => ({
    ...texture,
    size: texture.image ? (sizes.get(texture.image.toLowerCase()) ?? null) : null,
  }));
}

/** The catalog entry for a .map face name, ignoring case. */
export function findTexture(entries: readonly TextureInfo[], name: string): TextureInfo | undefined {
  const key = name.toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === key);
}

/** Search like the texture browser, returning what an author needs to pick one. */
export function searchTextures(
  entries: readonly TextureInfo[],
  options: { search?: string; folder?: string; limit?: number } = {},
) {
  let found = options.search ? (searchCatalog(entries, options.search) as TextureInfo[]) : [...entries];
  if (options.folder) found = found.filter((e) => e.folder.toLowerCase() === options.folder!.toLowerCase());
  const limit = options.limit ?? 50;
  return {
    total: found.length,
    textures: found.slice(0, limit).map((e) => ({
      name: e.name,
      size: e.size,
      tags: e.tags,
      ...(e.compiler ? { tool: true } : {}),
      ...(e.sky ? { sky: true } : {}),
      ...(e.transparent ? { transparent: true } : {}),
      ...(e.missing ? { missing: true } : {}),
    })),
  };
}
