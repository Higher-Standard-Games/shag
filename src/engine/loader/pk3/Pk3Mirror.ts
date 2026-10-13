/**
 * Pk3Mirror — download pk3 packages from an HTTP mirror instead of the server
 * that serves the game, when the mirror has them.
 *
 * The mirror holds a copy of the `data/` directory: `data/map_wdm2.pk3` is
 * `<mirror>/map_wdm2.pk3`. One mirror is configured, at build time, with
 * `VITE_PK3_MIRROR_URL`; a mirror that wants to spread load redirects, and
 * fetch follows. The mirror must allow this site's origin (CORS).
 *
 * The origin stays the source of truth. Each mirrored download is matched
 * against a HEAD request to the origin, made at the same time: a file the
 * origin doesn't have is not taken from the mirror, and a mirror copy whose
 * size differs from the origin's (stale, or half uploaded) is not used. In
 * either case, and whenever the mirror fails, the file comes from the origin.
 */

import { fetchAsset } from "./AssetRequest";

/** The mirror's base URL, ending in "/", or null when no mirror is configured. */
export function pk3MirrorBase(configured: string | undefined = import.meta.env.VITE_PK3_MIRROR_URL): string | null {
  const value = configured?.trim();
  if (!value) return null;
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * The mirror URL for a pk3 the game would fetch from `originUrl`, or null when
 * the file is not under `data/` or is not a pk3.
 */
export function mirrorUrlFor(originUrl: string, mirrorBase: string): string | null {
  const path = originUrl.replace(/^\.?\//, "");
  if (!path.startsWith("data/") || !/\.pk3$/i.test(path)) return null;
  const rest = path.slice("data/".length);
  if (!rest || rest.split("/").some((part) => part === ".." || part === "")) return null;
  return `${mirrorBase}${rest}`;
}

/** Why a download came from the origin although a mirror is configured; for the log. */
export type MirrorMiss = "not_on_origin" | "not_on_mirror" | "size_differs" | "mirror_error";

export interface Pk3Download {
  response: Response;
  /** Where the bytes come from. */
  source: "mirror" | "origin";
  miss?: MirrorMiss;
}

let announced = false;

/**
 * Fetch a pk3: from the mirror when it has the origin's copy, else from the
 * origin. `fetchImpl` is for tests.
 */
export async function fetchPk3(
  originUrl: string,
  mirrorBase: string | null = pk3MirrorBase(),
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<Pk3Download> {
  const mirrorUrl = mirrorBase ? mirrorUrlFor(originUrl, mirrorBase) : null;
  if (!mirrorUrl) return { response: await fetchAsset(originUrl, {}, fetchImpl), source: "origin" };

  if (!announced) {
    announced = true;
    console.log(`[Pk3Mirror] Downloading pk3 packages from ${mirrorBase} when it has them`);
  }

  const [mirror, head] = await Promise.all([
    fetchAsset(mirrorUrl, {}, fetchImpl).catch(() => null),
    fetchAsset(originUrl, { method: "HEAD" }, fetchImpl).catch(() => null),
  ]);

  const miss = judgeMirror(mirror, head);
  if (!miss && mirror) return { response: mirror, source: "mirror" };

  void mirror?.body?.cancel().catch(() => undefined);
  // A file the origin doesn't have is answered as the origin answers it, without a warning
  if (miss !== "not_on_origin") console.warn(`[Pk3Mirror] ${originUrl} from the origin: ${miss}`);
  return { response: await fetchAsset(originUrl, {}, fetchImpl), source: "origin", miss };
}

const isWebPage = (response: Response) => (response.headers.get("content-type") ?? "").includes("text/html");

function judgeMirror(mirror: Response | null, head: Response | null): MirrorMiss | undefined {
  // The dev server answers a missing file with its index page
  if (head && (!head.ok || isWebPage(head))) return "not_on_origin";
  if (!mirror) return "mirror_error";
  if (!mirror.ok) return "not_on_mirror";
  // A mirror that answers a missing file with a web page is not a mirror of it
  if (isWebPage(mirror)) return "not_on_mirror";
  const mirrorSize = mirror.headers.get("content-length");
  const originSize = head?.headers.get("content-length");
  if (mirrorSize && originSize && mirrorSize !== originSize) return "size_differs";
  return undefined;
}

/** Forget that the mirror was announced, for tests. */
export function resetPk3MirrorForTests(): void {
  announced = false;
}
