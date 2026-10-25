/**
 * How each map texture is encoded in the downloaded `tex_<map>.pk3` packages.
 *
 * The master texture package keeps lossless TGA/PNG sources. Map packaging
 * writes each listed TGA/PNG as WebP with the settings of its class, read from
 * `config/map-texture-encoding.json`. The list is generated once from the
 * master package (`--init`) and then edited by hand; packaging fails on a
 * texture it does not list, so a new image is classified on purpose.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeTGAPixels } from "../engine/loader/texture/TgaDecoder";

export const ENCODING_LIST = "config/map-texture-encoding.json";

/** `keep` leaves the source file as it is. */
export type TextureEncoding = "colour" | "alpha" | "normal" | "gloss" | "sky" | "keep";

/** WebP quality per class; `alpha` also keeps its alpha channel lossless, for cut-out edges. */
export const ENCODING_SETTINGS: Record<Exclude<TextureEncoding, "keep">, sharp.WebpOptions> = {
  colour: { quality: 85, effort: 6 },
  alpha: { quality: 85, alphaQuality: 100, effort: 6 },
  normal: { quality: 92, effort: 6 },
  gloss: { quality: 90, effort: 6 },
  sky: { quality: 95, effort: 6 },
};

export interface EncodingList {
  version: 1;
  textures: Record<string, TextureEncoding>;
}

export const isEncodableTexture = (name: string) => /\.(tga|png)$/i.test(name);
export const webpName = (name: string) => name.replace(/\.(tga|png)$/i, ".webp");

export async function readEncodingList(root = process.cwd()): Promise<EncodingList> {
  const list = JSON.parse(await fs.readFile(path.join(root, ENCODING_LIST), "utf8")) as EncodingList;
  if (list.version !== 1 || typeof list.textures !== "object") throw new Error(`Invalid ${ENCODING_LIST}`);
  return list;
}

/** Top-down RGBA pixels of a TGA or PNG. */
async function pixels(name: string, bytes: Buffer): Promise<{ width: number; height: number; rgba: Buffer }> {
  if (/\.tga$/i.test(name)) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
    const image = decodeTGAPixels(buffer);
    return { width: image.width, height: image.height, rgba: Buffer.from(image.pixels.buffer) };
  }
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

/** Whether any pixel is not fully opaque. */
export async function hasAlpha(name: string, bytes: Buffer): Promise<boolean> {
  const { rgba } = await pixels(name, bytes);
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
}

/** The class a texture gets in a generated list, from its name, its alpha and whether a sky uses it. */
export async function classify(name: string, bytes: Buffer, skies: Set<string>): Promise<TextureEncoding> {
  const stem = name.toLowerCase().replace(/\.(tga|png)$/i, "");
  if (/_(norm|normal|bump)$/.test(stem)) return "normal";
  if (/_(gloss|spec)$/.test(stem)) return "gloss";
  if (skies.has(stem)) return "sky";
  try {
    return (await hasAlpha(name, bytes)) ? "alpha" : "colour";
  } catch {
    return "keep";
  }
}

/**
 * The texture as it goes into a map package: WebP under the same path with a
 * `.webp` extension, or the source unchanged when it is kept or WebP would not
 * be smaller.
 */
export async function encodeTexture(
  name: string,
  bytes: Buffer,
  encoding: TextureEncoding,
): Promise<{ name: string; bytes: Buffer }> {
  if (encoding === "keep") return { name, bytes };
  const { width, height, rgba } = await pixels(name, bytes);
  let image = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (encoding !== "alpha") image = image.removeAlpha();
  const webp = await image.webp(ENCODING_SETTINGS[encoding]).toBuffer();
  return webp.length < bytes.length ? { name: webpName(name), bytes: webp } : { name, bytes };
}
