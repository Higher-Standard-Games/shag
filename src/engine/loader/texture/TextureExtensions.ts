/**
 * Texture names and the files behind them.
 *
 * Shaders and models name textures with their source extension (`foo.tga`),
 * as Quake does, but a texture may be stored as any image format. Map texture
 * packages carry their TGA/PNG sources as WebP under the same name, so the
 * WebP form of a name is looked for before any other.
 */

/** The packaged form of a TGA/PNG texture, tried before the named file. */
export const PACKAGED_TEXTURE_EXTENSION = ".webp";

/** Any image extension a texture name may carry. */
export const TEXTURE_EXTENSION_PATTERN = /\.(webp|ktx|tga|png|jpe?g)$/i;

/** The texture name without its image extension. */
export function stripTextureExtension(path: string): string {
  return path.replace(TEXTURE_EXTENSION_PATTERN, "");
}

/** The packaged WebP path for a texture name, with or without an extension. */
export function packagedTexturePath(path: string): string {
  return stripTextureExtension(path) + PACKAGED_TEXTURE_EXTENSION;
}
