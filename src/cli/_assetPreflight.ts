/**
 * Node asset preflight for headless CLIs (QA-WO11 step 3 / QA-23).
 *
 * Headless runs resolved the game asset directory, warned if it was missing,
 * and continued — so a run with no PK3 data could still exit 0. These helpers
 * make asset presence an explicit, exit-code-observable check:
 * `resolveGameAssetDir()` mirrors headless-game's resolution exactly, and
 * `preflightGameAssets()` reports whether the resolved directory holds the PK3
 * data that map/BSP commands require. Pure `node:fs` — no browser dependency,
 * so this lives in the CLI layer rather than in browser-shared `GamePaths`.
 */
import * as fs from "node:fs";

export interface AssetPreflightResult {
  ok: boolean;
  gamePath: string;
  pk3Count: number;
  /** Human-readable problems (empty when ok). */
  problems: string[];
}

/**
 * Resolve the headless game asset directory the same way headless-game does:
 * `GAME_PATH` env override (or its default `./public/game`), falling back to the
 * legacy `./public/games/default/basewsw` when the primary path is absent.
 */
export function resolveGameAssetDir(): string {
  let gamePath = process.env.GAME_PATH || "./public/game";
  if (!fs.existsSync(gamePath) && fs.existsSync("./public/games/default/basewsw")) {
    gamePath = "./public/games/default/basewsw";
  }
  return gamePath;
}

/** Count top-level `*.pk3` files in a directory (0 if it doesn't exist). Mirrors `ingestPk3Dir`. */
export function countPk3Files(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".pk3")).length;
  } catch {
    return 0;
  }
}

/**
 * Check that the resolved game asset directory exists and contains at least one
 * PK3. Does not throw — the caller decides how to surface `ok: false` (headless
 * surfaces it as a failed `assets` command, which gates the exit code).
 */
export function preflightGameAssets(gamePath: string = resolveGameAssetDir()): AssetPreflightResult {
  const problems: string[] = [];

  if (!fs.existsSync(gamePath)) {
    problems.push(`Game asset directory not found: ${gamePath} (set GAME_PATH or populate ./public/game)`);
    return { ok: false, gamePath, pk3Count: 0, problems };
  }

  const pk3Count = countPk3Files(gamePath);
  if (pk3Count === 0) {
    problems.push(`No .pk3 files found in ${gamePath} — map/BSP commands cannot resolve assets`);
  }

  return { ok: problems.length === 0, gamePath, pk3Count, problems };
}

/** Format a preflight result as a human-readable report. */
export function formatPreflight(result: AssetPreflightResult): string {
  if (result.ok) {
    return `Asset preflight OK — ${result.pk3Count} PK3 file(s) in ${result.gamePath}`;
  }
  return [`Asset preflight FAILED (${result.gamePath}):`, ...result.problems.map((p) => `  - ${p}`)].join("\n");
}
