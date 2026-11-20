/**
 * PublicUrls — where the game's root paths ("/data/...", "/engine/...") point.
 *
 * A build served from its own site leaves them alone: the page's server has
 * every file. A hosted build (an itch.io page) runs on a server we don't own.
 * It ships every public folder except `data/`, which its region's host serves.
 * There `/data/...` (and a page-relative `data/...`) goes to that host, and
 * every other root path stays inside the build, relative to its `index.html`.
 *
 * `installHostedPublicUrls` applies this to Babylon's loaders and to `fetch`,
 * which between them load nearly every file, and UIStyles applies it to the
 * CSS it injects. Code that puts a path into the page itself (an `<img>`, an
 * inline style's `url()`) calls `resolvePublicUrl`.
 */

import { Tools } from "@babylonjs/core/Misc/tools";

interface HostedPaths {
  /** The region's data directory, e.g. `https://eu.washoi.net/data`. */
  dataBase: string;
  /** Where the build's own files are, relative to the page: Vite's `BASE_URL`. */
  buildBase: string;
}

let hosted: HostedPaths | null = null;

/** The `data/...` part of a root or page-relative path, or null for any other URL. */
function dataPath(url: string): string | null {
  const path = url.startsWith("./") ? url.slice(1) : url.startsWith("/") ? url : `/${url}`;
  return path === "/data" || path.startsWith("/data/") || path.startsWith("/data?") ? path.slice(5) : null;
}

/**
 * The URL a root path, or a page-relative `data/...` path, is loaded from.
 * Any other URL is returned as it is.
 */
export function resolvePublicUrl(url: string): string {
  if (!hosted || url.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const data = dataPath(url);
  if (data !== null) return hosted.dataBase + data;
  return url.startsWith("/") ? hosted.buildBase + url.slice(1) : url;
}

/** CSS text with its root `url(...)`s resolved, for styles injected as text rather than built by Vite. */
export function resolveCssUrls(css: string): string {
  if (!hosted) return css;
  return css.replace(
    /url\(\s*(["']?)(\/[^"')]*)\1\s*\)/g,
    (_match, quote: string, path: string) => `url(${quote}${resolvePublicUrl(path)}${quote})`,
  );
}

/** The region's data directory, ending in "/", for the pk3 loader and index. Null outside a hosted build. */
export function hostedDataBase(): string | null {
  return hosted ? `${hosted.dataBase}/` : null;
}

/** Point root paths at the region's host and the build, for the rest of the page's life. */
export function installHostedPublicUrls(paths: HostedPaths): void {
  const first = hosted === null;
  hosted = {
    dataBase: paths.dataBase.replace(/\/+$/, ""),
    buildBase: paths.buildBase.endsWith("/") ? paths.buildBase : `${paths.buildBase}/`,
  };
  if (!first) return;
  Tools.PreprocessUrl = resolvePublicUrl;
  const pageFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    pageFetch(typeof input === "string" ? resolvePublicUrl(input) : input, init);
}

/** Forget the hosted paths, for tests. Babylon's hook and `fetch` stay wrapped; they pass paths through. */
export function resetPublicUrlsForTests(): void {
  hosted = null;
}
