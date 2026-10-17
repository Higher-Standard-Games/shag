import { createHash } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { type BuildQuality, buildRecipe } from "./BuildRecipe";
import type { CompilerConfig } from "./CompilerConfig";

const memo = new Map<string, { stamp: string; hash: string }>();

async function digest(file: string): Promise<string> {
  try {
    const info = await stat(file, { bigint: true });
    const stamp = `${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.ino}`;
    const cached = memo.get(file);
    if (cached?.stamp === stamp) return cached.hash;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(new Uint8Array(chunk));
    const result = hash.digest("hex");
    memo.set(file, { stamp, hash: result });
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function filesBelow(root: string, media: boolean, excluded: readonly string[] = []): Promise<string[]> {
  const result: string[] = [],
    visited = new Set<string>();
  async function visit(directory: string) {
    let entries: Dirent[];
    try {
      const resolved = await realpath(directory);
      if (visited.has(resolved)) return;
      visited.add(resolved);
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(directory, entry.name);
      if (excluded.some((exclude) => file === exclude || file.startsWith(`${exclude}${path.sep}`))) continue;
      const relative = path.relative(root, file).replace(/\\/g, "/");
      if (media && (relative === "maps" || /^(?:pk3_index|pk3_manifest|shagged_.*)\.json$/i.test(relative))) continue;
      const info = entry.isSymbolicLink() ? await stat(file) : entry;
      if (info.isDirectory()) await visit(file);
      else if (info.isFile()) {
        // Publisher-generated packages contain only a BSP and must not make
        // every successful build invalidate all subsequent compile requests.
        if (media && /^map_.+_\d{5,}\.pk3$/i.test(entry.name)) {
          const zip = await JSZip.loadAsync(Uint8Array.from(await readFile(file)));
          const names = Object.values(zip.files)
            .filter((e) => !e.dir)
            .map((e) => e.name);
          if (names.length === 1 && /^maps\/[^/]+\.bsp$/i.test(names[0])) continue;
        }
        result.push(file);
      }
    }
  }
  await visit(root);
  return result.sort();
}

/** Content identity of recipe, tools, profiles, runtime DLLs and compile media. */
export async function buildFingerprint(
  config: CompilerConfig,
  quality: BuildQuality,
  excluded: readonly string[] = [],
): Promise<string> {
  const files = new Set(
    await filesBelow(
      config.mediaRoot,
      true,
      excluded.map((file) => path.resolve(file)),
    ),
  );
  for (const binary of [config.makebspBin, config.makelightBin]) {
    if (!binary) continue;
    files.add(binary);
    for (const file of await filesBelow(path.join(path.dirname(binary), "makebspdata"), false)) files.add(file);
    let adjacent: string[] = [];
    try {
      adjacent = await readdir(path.dirname(binary));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of adjacent.filter((name) => /\.(?:dll|so|dylib)$/i.test(name)))
      files.add(path.join(path.dirname(binary), name));
  }
  if (config.toolchainRoot)
    for (const file of await filesBelow(path.join(config.toolchainRoot, "makebspdata"), false)) files.add(file);
  const hash = createHash("sha256").update(
    JSON.stringify({ version: 1, recipe: buildRecipe(quality, config.mediaRoot, "<map>.map"), config }),
  );
  for (const file of [...files].sort()) hash.update(JSON.stringify([path.resolve(file), await digest(file)]));
  return hash.digest("hex");
}
