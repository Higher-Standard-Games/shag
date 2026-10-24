import type { PK3IndexData, PK3IndexEntry } from "./PK3Index";

export const PK3_INDEX_VERSION = 2;
const PACKAGE_NAME = /^[a-z0-9][a-z0-9_.-]*\.pk3$/i;

/** Cache consistency fingerprint, not a signature or archive integrity check. */
export function pk3IndexHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasPublishedIndex(manifest: unknown): manifest is { files: unknown[]; indexHash: string } {
  return record(manifest) && Array.isArray(manifest.files) && typeof manifest.indexHash === "string";
}

/** Validate the whole snapshot before replacing live lookup data; never trust its package URLs. */
export function parsePublishedIndex(text: string, manifest: unknown, basePath: string): PK3IndexData | null {
  if (!hasPublishedIndex(manifest) || pk3IndexHash(text) !== manifest.indexHash) return null;
  const names = new Set<string>();
  for (const filename of manifest.files) {
    if (typeof filename !== "string" || !PACKAGE_NAME.test(filename) || names.has(filename)) return null;
    names.add(filename);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !record(data) ||
    data.version !== PK3_INDEX_VERSION ||
    !Array.isArray(data.packages) ||
    typeof data.listChecksum !== "string" ||
    typeof data.lastUpdated !== "number" ||
    !Number.isFinite(data.lastUpdated) ||
    data.lastUpdated < 0
  )
    return null;

  const packages: PK3IndexEntry[] = [];
  const indexed = new Set<string>();
  for (const entry of data.packages) {
    if (
      !record(entry) ||
      typeof entry.pk3 !== "string" ||
      !names.has(entry.pk3) ||
      indexed.has(entry.pk3) ||
      typeof entry.size !== "number" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.fileCount !== "number" ||
      !Number.isSafeInteger(entry.fileCount) ||
      entry.fileCount < 0
    )
      return null;
    if (entry.sha256 !== undefined && (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)))
      return null;
    indexed.add(entry.pk3);
    packages.push({
      ...(entry.sha256 ? { sha256: entry.sha256 as string } : {}),
      pk3: entry.pk3,
      size: entry.size,
      fileCount: entry.fileCount,
      path: `${basePath}${entry.pk3}`,
    });
  }
  if (indexed.size !== names.size) return null;
  const checksum = pk3IndexHash(
    packages
      .map((entry) => `${entry.pk3}:${entry.size}`)
      .sort()
      .join("|"),
  );
  if (data.listChecksum !== checksum) return null;

  const dictionaries: Record<string, string>[] = [];
  for (const value of [data.files, data.shaders, data.maps]) {
    if (!record(value)) return null;
    const dictionary: Record<string, string> = Object.create(null);
    for (const [name, owner] of Object.entries(value)) {
      if (!name || name !== name.toLowerCase().replace(/\\/g, "/") || typeof owner !== "string" || !names.has(owner))
        return null;
      dictionary[name] = owner;
    }
    dictionaries.push(dictionary);
  }
  const [files, shaders, maps] = dictionaries;
  for (const [map, owner] of Object.entries(maps)) if (files[`maps/${map}.bsp`] !== owner) return null;
  return {
    version: PK3_INDEX_VERSION,
    listChecksum: checksum,
    files,
    shaders,
    maps,
    packages,
    lastUpdated: data.lastUpdated,
  };
}

/** Search paths retain their precedence; later paths/packages win lookup ownership. */
export function mergePublishedIndexes(snapshots: PK3IndexData[]): PK3IndexData {
  const files: Record<string, string> = Object.create(null);
  const shaders: Record<string, string> = Object.create(null);
  const maps: Record<string, string> = Object.create(null);
  const packages: PK3IndexEntry[] = [];
  for (const snapshot of snapshots) {
    Object.assign(files, snapshot.files);
    Object.assign(shaders, snapshot.shaders);
    Object.assign(maps, snapshot.maps);
    packages.push(...snapshot.packages);
  }
  return {
    version: PK3_INDEX_VERSION,
    listChecksum: pk3IndexHash(
      packages
        .map((entry) => `${entry.pk3}:${entry.size}`)
        .sort()
        .join("|"),
    ),
    files,
    shaders,
    maps,
    packages,
    lastUpdated: Math.max(0, ...snapshots.map((snapshot) => snapshot.lastUpdated)),
  };
}
