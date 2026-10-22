/** A mounted companion bank replaces only the listed peer banks, not user overrides. */
export interface PK3PackageScope {
  package: string;
  files: ReadonlySet<string>;
  shaders: ReadonlySet<string>;
  excludedPackages: ReadonlySet<string>;
  sidecarExcludedPrefixes?: readonly string[];
}
