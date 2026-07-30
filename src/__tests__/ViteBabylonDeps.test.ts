/**
 * Every Babylon module the source imports must be pre-declared in vite.config.
 *
 * Vite discovers dependencies the first time a code path importing them
 * actually RUNS, and a newly optimized dependency forces a full page reload. In
 * a game that means being thrown back to the loading screen mid-match, with the
 * server logging close code 1005 — socket gone, no close frame — and nothing
 * anywhere explaining it, because nothing went wrong: the page navigated.
 *
 * It bites hardest on rarely-reached code, so the reload lands during whatever
 * was written most recently and nowhere else, which makes it read as a bug in
 * that feature.
 *
 * The list was hand-generated once with a `from "..."` grep and immediately
 * rotted: side-effect imports and dynamic `import(...)` have no `from`, so
 * `edgesRenderer` and thirty others were missed and the reload came straight
 * back. Hence a test rather than a comment asking people to remember.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Any quoted @babylonjs specifier, whatever import form it appears in. */
const SPECIFIER = /["'](@babylonjs\/[^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

function importedModules(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles("src")) {
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const specifier = match[1];
      // `?url` and `.wasm` are assets Vite copies, not modules it pre-bundles.
      if (specifier.includes("?") || specifier.endsWith(".wasm")) continue;
      found.add(specifier);
    }
  }
  return found;
}

function declaredModules(): Set<string> {
  const config = readFileSync("vite.config.ts", "utf8");
  const start = config.indexOf("    include: [");
  const end = config.indexOf("    ],", start);
  const block = config.slice(start, end);
  return new Set([...block.matchAll(SPECIFIER)].map((m) => m[1]));
}

describe("vite optimizeDeps", () => {
  it("declares every Babylon module the source imports", () => {
    const missing = [...importedModules()].filter((m) => !declaredModules().has(m)).sort();
    expect(missing, `Run: npm run deps:babylon\nMissing from vite.config.ts:\n${missing.join("\n")}`).toEqual([]);
  });

  it("declares nothing the source no longer imports", () => {
    // Stale entries are harmless at runtime but make the list untrustworthy,
    // and an untrustworthy list is one nobody regenerates.
    const imported = importedModules();
    const stale = [...declaredModules()].filter((m) => !imported.has(m)).sort();
    expect(stale, `Run: npm run deps:babylon\nStale entries in vite.config.ts:\n${stale.join("\n")}`).toEqual([]);
  });
});
