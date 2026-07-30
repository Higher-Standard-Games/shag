#!/usr/bin/env node
/**
 * Regenerate `optimizeDeps.include` in vite.config.ts from the source tree.
 *
 * Vite discovers dependencies the first time a code path importing them
 * actually RUNS, and a newly optimized dependency forces a full page reload —
 * which in a game means being thrown back to the loading screen mid-match, with
 * the server seeing close code 1005 and no error anywhere to explain it.
 *
 * Matching every QUOTED specifier is the whole point. A `from "..."` grep
 * misses the two forms that bit us:
 *
 *   import "@babylonjs/core/Rendering/edgesRenderer";   // side effect, no `from`
 *   await import("@babylonjs/core/Culling/ray");        // dynamic, no `from`
 *
 * Run after adding any Babylon import:  npm run deps:babylon
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const CONFIG = "vite.config.ts";
/** Any quoted @babylonjs specifier, whatever import form it appears in. */
const SPECIFIER = /["'](@babylonjs\/[^"']+)["']/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const found = new Set();
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1];
    // `?url` and `.wasm` are assets Vite copies, not modules it pre-bundles.
    if (specifier.includes("?") || specifier.endsWith(".wasm")) continue;
    found.add(specifier);
  }
}

const modules = [...found].sort();
const config = readFileSync(CONFIG, "utf8");
const start = config.indexOf("    include: [");
const end = config.indexOf("    ],", start);
if (start < 0 || end < 0) {
  console.error(`[babylon-deps] could not find optimizeDeps.include in ${CONFIG}`);
  process.exit(1);
}

const entries = modules.map((m) => `      '${m}',`).join("\n");
const updated = `${config.slice(0, start)}    include: [\n${entries}\n${config.slice(end)}`;

if (updated === config) {
  console.log(`[babylon-deps] up to date — ${modules.length} modules`);
} else {
  writeFileSync(CONFIG, updated);
  console.log(`[babylon-deps] wrote ${modules.length} modules to ${CONFIG}`);
}
