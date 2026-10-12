import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PK3Index } from "../engine/loader/pk3/PK3Index";
import { pk3IndexHash } from "../engine/loader/pk3/PK3PublishedIndex";

/** Publish a matched manifest/index pair only after every local archive indexed successfully. */
export async function generatePk3Index(directory: string) {
  const dataDir = resolve(directory);
  await mkdir(dataDir, { recursive: true });
  const files = (await readdir(dataDir)).filter((name) => /\.pk3$/i.test(name)).sort();
  if (files.some((name) => !/^[a-z0-9][a-z0-9_.-]*\.pk3$/i.test(name)))
    throw new Error("Invalid PK3 filename in data directory");
  const index = PK3Index.getInstance();
  index.clear();
  let archiveBytes = 0;
  const sourceStats = new Map<string, { size: number; mtimeMs: number }>();
  try {
    for (const filename of files) {
      const source = join(dataDir, filename);
      const before = await stat(source);
      const buffer = await readFile(source);
      const after = await stat(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || buffer.byteLength !== before.size)
        throw new Error(`Package changed while indexing: ${filename}`);
      const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      if (!(await index.indexPK3ArrayBuffer(filename, bytes, filename)))
        throw new Error(`Cannot index package: ${filename}`);
      sourceStats.set(filename, { size: before.size, mtimeMs: before.mtimeMs });
      archiveBytes += buffer.byteLength;
    }
    const currentFiles = (await readdir(dataDir)).filter((name) => /\.pk3$/i.test(name)).sort();
    if (JSON.stringify(currentFiles) !== JSON.stringify(files))
      throw new Error("Package list changed while indexing; retry generation");
    for (const filename of files) {
      const current = await stat(join(dataDir, filename));
      const before = sourceStats.get(filename)!;
      if (current.size !== before.size || current.mtimeMs !== before.mtimeMs)
        throw new Error(`Package changed while indexing: ${filename}`);
    }
    const snapshot = index.exportSnapshot();
    const text = `${JSON.stringify(snapshot)}\n`;
    const manifest = `${JSON.stringify({ files, indexHash: pk3IndexHash(text) }, null, 2)}\n`;
    const suffix = `${process.pid}-${Date.now()}.tmp`;
    const indexTemp = join(dataDir, `pk3_index.${suffix}`);
    const manifestTemp = join(dataDir, `pk3_manifest.${suffix}`);
    try {
      await writeFile(indexTemp, text, { encoding: "utf8", flag: "wx" });
      await writeFile(manifestTemp, manifest, { encoding: "utf8", flag: "wx" });
      await rename(indexTemp, join(dataDir, "pk3_index.json"));
      await rename(manifestTemp, join(dataDir, "pk3_manifest.json"));
    } finally {
      await rm(indexTemp, { force: true });
      await rm(manifestTemp, { force: true });
    }
    return { directory: dataDir, ...index.getStats(), indexBytes: Buffer.byteLength(text), archiveBytes };
  } finally {
    index.clear();
  }
}
