import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";

export interface BrowserPublishedBuild {
  mapName: string;
  package: string;
  buildId: string;
  bspHash: string;
}

/** Refresh just the published map package before a browser gameplay launch. */
export async function preparePublishedMap(
  name: string,
  expectedBuildId?: string,
): Promise<BrowserPublishedBuild | null> {
  if (typeof window === "undefined" || !/^[a-z][a-z0-9_]{0,47}$/.test(name)) return null;
  const response = await fetch(`data/shagged_${name}.json`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not read published build for ${name}: HTTP ${response.status}`);
  let build: BrowserPublishedBuild;
  try {
    build = (await response.json()) as BrowserPublishedBuild;
  } catch {
    // Some SPA hosts serve index.html for an absent static JSON file.
    if (!expectedBuildId) return null;
    throw new Error(`Published build record is invalid for ${name}`);
  }
  if (
    build.mapName !== name ||
    !new RegExp(`^map_${name}_[0-9]{5,}\\.pk3$`).test(build.package) ||
    !/^[a-f0-9]{64}$/.test(build.bspHash)
  )
    throw new Error(`Invalid published build for ${name}`);
  if (expectedBuildId && build.buildId !== expectedBuildId)
    throw new Error(`The published build of ${name} changed; compile status is stale`);
  if (!(await PK3Index.getInstance().refreshPackage(build.package)))
    throw new Error(`PK3 is not served: ${build.package}`);
  const loader = PK3Loader.getInstance();
  await loader.loadPK3(build.package);
  const bsp = await loader.getFile(`maps/${name}.bsp`);
  if (!bsp) throw new Error(`Published BSP is missing: ${name}`);
  const digest = await crypto.subtle.digest("SHA-256", bsp);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== build.bspHash) throw new Error(`Browser resolved the wrong build of ${name}`);
  return build;
}
