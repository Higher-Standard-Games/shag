/**
 * shared/ layering guard (QA-3 / QA-WO8).
 *
 * shared/ is the deterministic core: it must never import upward into engine/
 * (or games/, or Babylon). This scans every .ts file under src/shared and fails
 * on any upward or Babylon import — the wire cluster (net/), collision
 * contract, and gametype types all live in shared now, so there is no
 * legitimate reason left.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SHARED_ROOT = path.resolve(__dirname, "..");

const FORBIDDEN = [
  /from\s+["'][^"']*\/engine\//, // relative ../../engine/...
  /from\s+["']@engine\//, // alias
  /from\s+["'][^"']*\/games\//, // relative into games/
  /from\s+["']@games?\//, // alias
  /from\s+["']@babylonjs\//, // runtime Babylon in the deterministic core
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("shared/ imports only downward", () => {
  it("no file under src/shared imports engine/, games/, or Babylon", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SHARED_ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        const match = source.match(pattern);
        if (match) {
          offenders.push(`${path.relative(SHARED_ROOT, file)}: ${match[0]}`);
          break;
        }
      }
    }
    expect(offenders, `shared/ must not import upward:\n${offenders.join("\n")}`).toEqual([]);
  });
});
