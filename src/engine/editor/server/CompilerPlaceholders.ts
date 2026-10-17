import { readFile } from "node:fs/promises";
import { type BspFile, BspLoader } from "../../loader/bsp/BspLoader";

export function assertNoVisiblePlaceholder(bsp: Pick<BspFile, "textures" | "faces">): void {
  if (bsp.faces.some((face) => bsp.textures[face.textureIndex]?.name.toLowerCase() === "noshader"))
    throw new Error("Native noshader placeholder is used by a draw surface; publication blocked");
}

/** Native non-axis brush bevels may use bare noshader only on collision sides. */
export async function verifyCompilerPlaceholders(file: string): Promise<void> {
  const bytes = new Uint8Array(await readFile(file));
  assertNoVisiblePlaceholder(BspLoader.load(bytes.buffer));
}
