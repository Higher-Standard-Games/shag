/**
 * DemoMapName — normalize a recorded demo's map name into the bare key
 * the BSP / MapLoader expects (e.g. "wdm7").
 *
 * Demos today record a bare lowercased key (the dev-spawn path lowercases the
 * map before spawning), but hand-authored or older demos may carry a path
 * ("maps/WDM7.bsp") or mixed case. Normalizing defensively keeps local map
 * rendering from silently failing onto an empty scene.
 */
export function normalizeDemoMapName(raw: string | null | undefined): string {
  if (!raw) return "";
  // Strip any directory prefix (handles both / and \ separators).
  const base = raw.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  // Strip a trailing .bsp/.pk3 extension, then lowercase.
  return base
    .replace(/\.(bsp|pk3)$/i, "")
    .trim()
    .toLowerCase();
}
