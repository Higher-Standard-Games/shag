import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { validateMapName } from "./MapStore";

export interface PublishedBuild {
  mapName: string;
  package: string;
  buildId: string;
  sourceRevision: number;
  sourceHash: string;
  bspHash: string;
  quality: string;
}

export const publishedBuildFile = (name: string): string => {
  validateMapName(name);
  return `shagged_${name}.json`;
};

async function atomicWrite(file: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

export async function readPublishedBuild(dataRoot: string, name: string): Promise<PublishedBuild | null> {
  try {
    const build = JSON.parse(await readFile(path.join(dataRoot, publishedBuildFile(name)), "utf8")) as PublishedBuild;
    if (
      build.mapName !== name ||
      !new RegExp(`^map_${name}_[0-9]{5,}\\.pk3$`).test(build.package) ||
      !/^[a-f0-9]{64}$/.test(build.bspHash)
    )
      throw new Error(`Invalid published build pointer for ${name}`);
    return build;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The current pointer is written last. An interrupted publish leaves the previous build playable. */
export async function publishBuild(
  dataRoot: string,
  input: Omit<PublishedBuild, "package" | "bspHash">,
  bsp: Uint8Array,
): Promise<PublishedBuild> {
  validateMapName(input.mapName);
  await mkdir(dataRoot, { recursive: true });
  // The manifest is shared across maps, so serialize the complete publication.
  const lockPath = path.join(dataRoot, ".shagged_publish.lock");
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      lock = await open(lockPath, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!lock) throw new Error(`Timed out waiting to publish ${input.mapName}`);
  try {
    const names = await readdir(dataRoot);
    const prefix = `map_${input.mapName}_`;
    const numbers = names
      .filter((name) => name.startsWith(prefix) && /^\d+\.pk3$/.test(name.slice(prefix.length)))
      .map((name) => Number(name.slice(prefix.length, -4)));
    const next = Math.max(0, ...numbers) + 1;
    const packageName = `${prefix}${String(next).padStart(5, "0")}.pk3`;
    const bspHash = createHash("sha256").update(bsp).digest("hex");
    const zip = new JSZip();
    zip.file(`maps/${input.mapName}.bsp`, bsp);
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const check = await JSZip.loadAsync(archive);
    const checked = await check.file(`maps/${input.mapName}.bsp`)?.async("uint8array");
    if (!checked || createHash("sha256").update(checked).digest("hex") !== bspHash)
      throw new Error("Published PK3 verification failed");
    await atomicWrite(path.join(dataRoot, packageName), archive);

    const manifestPath = path.join(dataRoot, "pk3_manifest.json");
    let files: string[] = [];
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files?: string[] };
      if (Array.isArray(manifest.files)) files = manifest.files.filter((name) => typeof name === "string");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files = names.filter((name) => name.endsWith(".pk3"));
    }
    files = [...new Set([...files, packageName])].sort();
    await atomicWrite(manifestPath, `${JSON.stringify({ files }, null, 2)}\n`);
    const build: PublishedBuild = { ...input, package: packageName, bspHash };
    await atomicWrite(path.join(dataRoot, publishedBuildFile(input.mapName)), `${JSON.stringify(build, null, 2)}\n`);
    return build;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
