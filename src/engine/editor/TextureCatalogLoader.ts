/**
 * Browser side of the texture catalog: loads the packages that hold textures
 * or shader scripts (skipping ones already loaded), reads their shader scripts
 * and the gamepack's tag file, and builds the catalog from them.
 */

import shaderTagsXml from "../../../editor/gamepacks/washoi.game/shadertags.xml?raw";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { parseShaderFile } from "../loader/shader/Q3ShaderParser";
import type { Q3Shader } from "../loader/shader/Q3ShaderTypes";
import { buildTextureCatalog, IMAGE_EXTENSIONS, parseShaderTags, type TextureEntry } from "./TextureCatalog";

let pending: Promise<TextureEntry[]> | null = null;

/** The catalog, built once per page; later calls share the same promise. */
export function loadTextureCatalog(): Promise<TextureEntry[]> {
  pending ??= build().catch((error) => {
    pending = null; // let a later call retry after a failed load
    throw error;
  });
  return pending;
}

async function build(): Promise<TextureEntry[]> {
  const index = PK3Index.getInstance();
  const loader = PK3Loader.getInstance();
  // Every package with shader scripts or images: shaders draw images from outside textures/ too.
  const patterns = ["scripts/*.shader", ...IMAGE_EXTENSIONS.map((ext) => `*.${ext}`)];
  const wanted = new Set(patterns.flatMap((pattern) => index.findByPattern(pattern)).map((hit) => hit.pk3));
  const loaded = new Set(loader.getPackageInfo().map((pkg) => pkg.filename));
  await Promise.all(
    [...wanted]
      .filter((pk3) => !loaded.has(pk3))
      .map((pk3) =>
        loader.loadPK3(pk3).catch((error) => {
          console.warn(`[TextureCatalog] ${pk3} not loaded: ${error instanceof Error ? error.message : error}`);
        }),
      ),
  );
  const files = loader.listFiles();
  const shaders: Q3Shader[] = [];
  for (const script of files.filter((file) => /^scripts\/.+\.shader$/i.test(file))) {
    const data = await loader.getFile(script);
    if (data) shaders.push(...parseShaderFile(new TextDecoder().decode(data)));
  }
  return buildTextureCatalog({ files, shaders, tags: parseShaderTags(shaderTagsXml) });
}
