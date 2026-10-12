/**
 * Generate pk3_manifest.json and pk3_index.json from public/data/.
 *
 * Usage: npm run tools:manifest
 *
 * A browser cannot list a directory, so PK3Index discovers packs by fetching
 * this manifest; the matched index supplies lookups without archive downloads.
 * A pk3 that is on disk but missing from the manifest does not
 * exist as far as the client is concerned: the map inside it is unfindable and
 * the load fails before any BSP is parsed. Re-run this after adding a pk3.
 */

// Keep the familiar command, but publish lookup metadata together with discovery.
import "./generate-pk3-index.mjs";
