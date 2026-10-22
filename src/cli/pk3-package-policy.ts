import { readFileSync } from "node:fs";

export interface PK3PackagePolicy {
  ignoredPackages: string[];
  sharedTexturePackages: Record<string, { prefixes: string[]; dynamic: boolean }>;
}

/** Build policy uses exact basenames, never paths or globs. */
export function parsePackagePolicy(value: unknown): PK3PackagePolicy {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "ignoredPackages" && key !== "sharedTexturePackages") ||
    !("ignoredPackages" in value) ||
    !Array.isArray(value.ignoredPackages) ||
    value.ignoredPackages.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9_.-]*\.pk3$/i.test(name))
  ) {
    throw new Error("Invalid PK3 package policy: expected ignoredPackages with exact PK3 basenames");
  }
  const ignoredPackages = value.ignoredPackages.map((name: string) => name.toLowerCase());
  if (new Set(ignoredPackages).size !== ignoredPackages.length) throw new Error("Duplicate ignored PK3 package");
  const sharedTexturePackages: PK3PackagePolicy["sharedTexturePackages"] = {};
  if ("sharedTexturePackages" in value) {
    const shared = value.sharedTexturePackages;
    if (!shared || typeof shared !== "object" || Array.isArray(shared))
      throw new Error("Invalid shared texture packages");
    const prefixes: string[] = [];
    for (const [name, options] of Object.entries(shared)) {
      if (
        !/^[a-z0-9][a-z0-9_.-]*\.pk3$/i.test(name) ||
        ignoredPackages.includes(name.toLowerCase()) ||
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => key !== "prefixes" && key !== "dynamic") ||
        !("prefixes" in options) ||
        !Array.isArray(options.prefixes) ||
        options.prefixes.length === 0 ||
        ("dynamic" in options && typeof options.dynamic !== "boolean")
      )
        throw new Error("Invalid shared texture package policy");
      const normalized: string[] = [];
      for (const prefix of options.prefixes) {
        if (
          typeof prefix !== "string" ||
          !/^[a-z0-9][a-z0-9_./-]*\/$/i.test(prefix) ||
          prefix.split("/").some((part) => part === ".." || part === ".")
        )
          throw new Error("Invalid shared texture prefix");
        const lower = prefix.toLowerCase();
        if (prefixes.some((existing) => existing.startsWith(lower) || lower.startsWith(existing)))
          throw new Error("Overlapping shared texture prefixes");
        prefixes.push(lower);
        normalized.push(lower);
      }
      if (sharedTexturePackages[name.toLowerCase()]) throw new Error("Duplicate shared texture package");
      sharedTexturePackages[name.toLowerCase()] = {
        prefixes: normalized,
        dynamic: "dynamic" in options && options.dynamic === true,
      };
    }
  }
  return { ignoredPackages, sharedTexturePackages };
}

export function sharedPackageForPath(path: string, policy: PK3PackagePolicy): string | null {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  return (
    Object.entries(policy.sharedTexturePackages).find(([, entry]) =>
      entry.prefixes.some((prefix) => normalized.startsWith(prefix)),
    )?.[0] ?? null
  );
}

export function readPackagePolicy(): PK3PackagePolicy {
  return parsePackagePolicy(
    JSON.parse(readFileSync(new URL("../../config/pk3-packages.json", import.meta.url), "utf8")),
  );
}

export function publishedPackageNames(names: string[], policy: PK3PackagePolicy): string[] {
  const ignored = new Set(policy.ignoredPackages);
  return names.filter((name) => /\.pk3$/i.test(name) && !ignored.has(name.toLowerCase())).sort();
}
