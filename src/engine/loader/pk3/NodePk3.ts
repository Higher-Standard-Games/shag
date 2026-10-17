/**
 * NodePk3 — headless (Node) PK3 asset loading that routes through the SAME
 * PK3Loader + PK3Index the game/browser uses, instead of ad-hoc filesystem path
 * searches. Lets servers and CLIs resolve maps (and any pk3 file) the same way
 * the client does.
 *
 * The browser builds the index via fetch()/localStorage; Node can't, so these
 * helpers read pk3s off disk and feed them to `PK3Loader.processPK3ArrayBuffer`
 * + `PK3Index.indexPK3ArrayBuffer` (both in-memory, Node-friendly).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readPublishedBuild } from "../../editor/server/PublishedBuild";
import { PK3Index } from "./PK3Index";
import { PK3Loader } from "./PK3Loader";

// processPK3ArrayBuffer is private on PK3Loader; the Node bootstrap path needs it
// (there's no fetch()). Same access pattern as headless-game.ts.
type Ingestable = { processPK3ArrayBuffer: (filename: string, buf: ArrayBuffer) => Promise<void> };

function readArrayBuffer(fullPath: string): ArrayBuffer {
  const buf = fs.readFileSync(fullPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Load one pk3 from disk into both PK3Loader (file access) and PK3Index (lookup).
 * Returns false if the file doesn't exist.
 */
export async function ingestPk3File(dir: string, pk3File: string, loader = PK3Loader.getInstance()): Promise<boolean> {
  const full = path.join(dir, pk3File);
  if (!fs.existsSync(full)) return false;
  const ab = readArrayBuffer(full);
  await (loader as unknown as Ingestable).processPK3ArrayBuffer(pk3File, ab);
  await PK3Index.getInstance().indexPK3ArrayBuffer(pk3File, ab, full);
  return true;
}

/**
 * Load every *.pk3 in a directory into PK3Loader + PK3Index. Used by full
 * headless bootstraps (e.g. headless-game) that need all assets. Returns the
 * count successfully ingested.
 */
export async function ingestPk3Dir(dir: string): Promise<number> {
  if (!fs.existsSync(dir)) return 0;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".pk3"))
    .sort();
  let count = 0;
  for (const f of files) {
    try {
      if (await ingestPk3File(dir, f)) count++;
    } catch (e) {
      console.warn(`[NodePk3] Failed to load ${f}:`, e instanceof Error ? e.message : e);
    }
  }
  return count;
}

/**
 * Resolve a map's BSP bytes through the PK3 index, loading pk3s from the given
 * directories lazily: the conventional `map_<name>.pk3` first, then any other
 * `map_*.pk3` in the dirs, until the index knows the map. Only the pk3s needed
 * are read — no full-library load.
 *
 * @returns the BSP ArrayBuffer, or null if the map can't be found.
 */
export async function resolveMapBspViaIndex(
  dirs: string[],
  mapName: string,
  loader = PK3Loader.getInstance(),
): Promise<ArrayBuffer | null> {
  const index = PK3Index.getInstance();
  const name = mapName.toLowerCase();
  const hasMap = () => !!index.findMap(name) && loader.hasFile(`maps/${name}.bsp`);
  const ingest = async (dir: string, filename: string) => {
    const loaded = await ingestPk3File(dir, filename, loader);
    // A private map-only owner need not retain unrelated fallback archives.
    // The shared metadata index remains available for subsequent resolutions.
    if (loader !== PK3Loader.getInstance() && !loader.hasFile(`maps/${name}.bsp`)) loader.unloadAll();
    return loaded;
  };

  // SHAGGED publishes immutable numbered packages. Resolve its current pointer
  // before the conventional first-match scan, which would otherwise pick an old build.
  for (const dir of dirs) {
    const build = await readPublishedBuild(dir, name);
    if (!build) continue;
    if (!(await ingest(dir, build.package))) throw new Error(`Published map package is missing: ${build.package}`);
    const bsp = await loader.getFile(`maps/${name}.bsp`);
    if (!bsp || createHash("sha256").update(new Uint8Array(bsp)).digest("hex") !== build.bspHash)
      throw new Error(`Published map build mismatch: ${build.buildId}`);
    return bsp;
  }

  // 1. Fast path: the conventional map pk3 in each dir.
  for (const dir of dirs) {
    if (hasMap()) break;
    await ingest(dir, `map_${name}.pk3`).catch(() => false);
  }

  // Metadata may outlive a transient archive owner. Re-open the indexed package
  // from the supplied search roots before doing a broader package scan.
  const indexedPackage = index.findMap(name);
  if (!hasMap() && indexedPackage) {
    for (const dir of dirs) {
      await ingest(dir, indexedPackage).catch(() => false);
      if (hasMap()) break;
    }
  }

  // 2. Fallback: scan every map_*.pk3 in each dir until the map appears.
  if (!hasMap()) {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith("map_") || !f.endsWith(".pk3")) continue;
        await ingest(dir, f).catch(() => false);
        if (hasMap()) break;
      }
      if (hasMap()) break;
    }
  }

  if (!hasMap()) return null;
  return loader.getFile(`maps/${name}.bsp`);
}
