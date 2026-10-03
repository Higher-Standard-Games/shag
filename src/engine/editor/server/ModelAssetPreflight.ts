import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

/** Read entity epairs at brace depth one; brush and patch contents are skipped. */
export function modelPathsInMap(source: string): string[] {
  const paths = new Set<string>();
  let depth = 0;
  let key: string | null = null;
  let entity: Record<string, string> = {};
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) break;
    } else if (char === '"') {
      let value = "";
      while (++i < source.length) {
        if (source[i] === "\\" && i + 1 < source.length) value += source[++i];
        else if (source[i] === '"') break;
        else value += source[i];
      }
      if (depth === 1) {
        if (key === null) key = value;
        else {
          entity[key] = value;
          key = null;
        }
      }
    } else if (char === "{") {
      if (depth === 0) entity = {};
      depth++;
      key = null;
    } else if (char === "}") {
      if (depth === 1 && entity.classname === "misc_model") paths.add(entity.model ?? "");
      depth = Math.max(0, depth - 1);
      key = null;
    }
  }
  return [...paths];
}

function validAssetPath(value: string): boolean {
  return (
    /^models\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+$/.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}

/** Fail before MakeBSP when a referenced prop cannot be found in its VFS root. */
export async function checkModelAssets(source: string, mediaRoot: string): Promise<void> {
  const references = modelPathsInMap(source);
  if (!references.length) return;
  const invalid = references.filter((reference) => !validAssetPath(reference));
  if (invalid.length) throw new Error(`Invalid misc_model asset path: ${invalid.join(", ")}`);

  const missing = new Set(references.map((reference) => reference.toLowerCase()));
  for (const reference of references) {
    try {
      await access(path.join(mediaRoot, ...reference.split("/")));
      missing.delete(reference.toLowerCase());
    } catch {
      // This path may be in a PK3.
    }
  }
  if (!missing.size) return;

  const archives = (await readdir(mediaRoot)).filter((name) => name.toLowerCase().endsWith(".pk3"));
  for (const archive of archives) {
    const zip = await JSZip.loadAsync(Uint8Array.from(await readFile(path.join(mediaRoot, archive))));
    for (const entry of Object.keys(zip.files)) missing.delete(entry.replace(/\\/g, "/").toLowerCase());
    if (!missing.size) return;
  }
  throw new Error(
    `misc_model asset missing from media root ${mediaRoot}: ${references.filter((reference) => missing.has(reference.toLowerCase())).join(", ")}`,
  );
}
