/**
 * Maps' display names, as the parts of the app that hear them pass them on: a
 * room's map vote, the live match list, a demo list. The loading screen reads
 * them to show "Proving Grounds" instead of a file name; a map nobody has
 * named yet keeps its file name.
 */

const titles = new Map<string, string>();

export function rememberMapTitle(map: string, title: string | undefined): void {
  if (map && title && title !== map) titles.set(map.toLowerCase(), title);
}

export function mapTitle(map: string): string | undefined {
  return titles.get(map.toLowerCase());
}

/** For tests. */
export function forgetMapTitles(): void {
  titles.clear();
}
