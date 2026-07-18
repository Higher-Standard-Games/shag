#!/usr/bin/env node
/**
 * relocate-sourcemaps — move Vite's hidden source maps OUT of the served build.
 *
 * vite.config sets `build.sourcemap: 'hidden'`: .map files are emitted (for
 * error symbolication) but the bundles carry no sourceMappingURL. Those maps
 * must NOT ship publicly — `dist/` is served on the web AND copied wholesale
 * into the Capacitor (webDir:'dist') and Electron packages, so a stray .map
 * hands out the full original TypeScript source (QA-15 review finding).
 *
 * Runs as npm `postbuild`, after every `vite build`, and relocates
 * dist/**\/*.map into sourcemaps/ (same relative layout) so:
 *   - dist/ ships with zero maps, on every target, with no per-deploy discipline
 *   - the maps still exist (in sourcemaps/, gitignored) for symbolication
 *
 * Idempotent and a no-op when there are no maps (e.g. a dev build). Only touches
 * dist/ — dist-electron/ maps (main/preload) are handled by electron:compile.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const DIST = "dist";
const OUT = "sourcemaps";

if (!existsSync(DIST)) {
  console.log("[relocate-sourcemaps] no dist/ — nothing to do");
  process.exit(0);
}

/** Recursively collect *.map file paths under a directory. */
function collectMaps(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...collectMaps(full));
    } else if (name.endsWith(".map")) {
      found.push(full);
    }
  }
  return found;
}

const maps = collectMaps(DIST);
if (maps.length === 0) {
  console.log("[relocate-sourcemaps] no source maps in dist/ (dev build?) — nothing to do");
  process.exit(0);
}

for (const map of maps) {
  const dest = join(OUT, relative(DIST, map));
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(map, dest);
}

console.log(`[relocate-sourcemaps] moved ${maps.length} .map file(s) out of ${DIST}/ into ${OUT}/`);
