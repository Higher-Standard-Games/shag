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

import { readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const CONFIG = "vite.config.ts";
/** Any quoted @babylonjs specifier, whatever import form it appears in. */
const SPECIFIER = /["'](@babylonjs\/[^"']+)["']/g;

const project = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (project.error) throw new Error(ts.flattenDiagnosticMessageText(project.error.messageText, "\n"));
const sources = ts.parseJsonConfigFileContent(project.config, ts.sys, process.cwd()).fileNames;

const local = '.shag-application.json';
const selection = process.env.SHAG_APP ?? (existsSync(local) ? JSON.parse(readFileSync(local, 'utf8').replace(/^\uFEFF/, '')).application : 'engine');
const applicationRoot = selection === 'engine' ? null : path.resolve(selection);
const gameRoot = path.resolve('src/games');
const within = (file, directory) => path.resolve(file).startsWith(directory + path.sep);

const found = new Set();
const applicationModules = new Set();
for (const file of sources) {
  const isApplication = applicationRoot && within(file, applicationRoot);
  if (within(file, gameRoot) && !isApplication) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1];
    // `?url` and `.wasm` are assets Vite copies, not modules it pre-bundles.
    if (specifier.includes("?") || specifier.endsWith(".wasm")) continue;
    (isApplication ? applicationModules : found).add(specifier);
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
const updated = `${config.slice(0, start)}    include: [\n${entries}\n      ...application.optimizeDeps,\n${config.slice(end)}`;

if (updated === config) {
  console.log(`[babylon-deps] up to date — ${modules.length} modules`);
} else {
  writeFileSync(CONFIG, updated);
  console.log(`[babylon-deps] wrote ${modules.length} modules to ${CONFIG}`);
}

if (applicationRoot) {
  const filename = path.join(applicationRoot, 'browser.json');
  const manifest = JSON.parse(readFileSync(filename, 'utf8'));
  manifest.optimizeDeps = [...applicationModules].filter(module => !found.has(module)).sort();
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (readFileSync(filename, 'utf8') !== text) writeFileSync(filename, text);
  console.log(`[babylon-deps] application declares ${manifest.optimizeDeps.length} additional modules`);
}
