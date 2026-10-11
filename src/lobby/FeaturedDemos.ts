/** Honest server picks from recorded demo metadata; no name-to-account inference. */
import type { DemoInfo, FeaturedDemoInfo } from "./types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 60_000;

export interface FeaturedDemosQuery {
  gametype?: string;
  map?: string;
  limit: number;
}

/** Newest eligible multiplayer recordings from the last seven days. */
export function selectFeaturedDemos(
  archive: readonly DemoInfo[],
  query: FeaturedDemosQuery,
  now = Date.now(),
): FeaturedDemoInfo[] {
  const seen = new Set<string>();
  return archive
    .filter((demo) => {
      if (demo.private === true) return false;
      if (seen.has(demo.filename)) return false;
      seen.add(demo.filename);
      const mode = demo.gametype === "deathmatch" ? "ffa" : demo.gametype;
      if (query.gametype && query.gametype !== "all" && mode !== query.gametype) return false;
      if (query.map && query.map !== "all" && demo.map !== query.map) return false;
      if (!Number.isSafeInteger(demo.date) || demo.date < now - WEEK_MS || demo.date > now) return false;
      if (!Number.isSafeInteger(demo.durationMs) || demo.durationMs < MIN_DURATION_MS) return false;
      return new Set(demo.players.map((name) => name.trim().toLocaleLowerCase()).filter(Boolean)).size >= 2;
    })
    .sort((a, b) => b.date - a.date || a.filename.localeCompare(b.filename))
    .slice(0, query.limit)
    .map((demo, index) => ({ demo, rank: index + 1, reason: "Recent multiplayer recording" }));
}
