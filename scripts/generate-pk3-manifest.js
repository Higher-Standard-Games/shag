/**
 * Generate pk3_manifest.json from the PK3 files in public/data/.
 *
 * Usage: npm run tools:manifest
 *
 * A browser cannot list a directory, so PK3Index discovers packs by fetching
 * this manifest. A pk3 that is on disk but missing from the manifest does not
 * exist as far as the client is concerned: the map inside it is unfindable and
 * the load fails before any BSP is parsed. Re-run this after adding a pk3.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(scriptDir, "../public/data");
const MANIFEST_PATH = join(DATA_DIR, "pk3_manifest.json");

const files = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".pk3"))
  .sort();

writeFileSync(MANIFEST_PATH, `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`[pk3-manifest] ${MANIFEST_PATH}: ${files.length} PK3 files`);
