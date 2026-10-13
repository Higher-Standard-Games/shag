import { fetchAsset, readAssetBuffer, readAssetJson, readAssetText } from "./AssetRequest";
/**
 * PK3Index - Index PK3 contents for fast lookup without loading
 *
 * Loads published lookup metadata at boot, retaining archive scans for old
 * deployments and explicit rebuilds. Optional localStorage caches the lookups.
 */

import JSZip from "jszip";
import {
  hasPublishedIndex,
  PK3_INDEX_VERSION as INDEX_VERSION,
  mergePublishedIndexes,
  parsePublishedIndex,
  pk3IndexHash as simpleHash,
} from "./PK3PublishedIndex";
import { fetchPk3 } from "./Pk3Mirror";

const STORAGE_KEY = "pk3_index";

export interface PK3IndexEntry {
  /** PK3 filename */
  pk3: string;
  /** Full path where PK3 was found */
  path: string;
  /** File count */
  fileCount: number;
  /** File size in bytes (for checksum) */
  size?: number;
  /** Last modified timestamp (if available) */
  timestamp?: number;
}

export interface PK3IndexData {
  version: number;
  /** Checksum of PK3 file list for cache invalidation */
  listChecksum: string;
  /** Map of normalized file path -> PK3 filename */
  files: Record<string, string>;
  /** Map of shader name -> PK3 filename */
  shaders: Record<string, string>;
  /** Map of map name (without .bsp) -> PK3 filename */
  maps: Record<string, string>;
  /** List of indexed PK3s */
  packages: PK3IndexEntry[];
  /** When the index was last updated */
  lastUpdated: number;
}

/**
 * Extract shader names from .shader file content
 * Shader names are paths followed by { on the same or next line
 */
function extractShaderNames(content: string): string[] {
  const names: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip comments and empty lines
    if (line.startsWith("//") || line === "") continue;

    // Check if this line looks like a shader name (path-like, no spaces before {)
    // Format: "textures/myshader" or "textures/myshader {"
    // Use broader match to catch special characters in shader names
    const match = line.match(/^([^\s{]+)\s*\{?\s*$/);
    if (match) {
      const potentialName = match[1].toLowerCase();
      // Validate it looks like a texture path
      if (potentialName.includes("/") && !potentialName.startsWith("{")) {
        names.push(potentialName);
      }
    }
  }

  return names;
}

export class PK3Index {
  private static instance: PK3Index;

  private index: PK3IndexData | null = null;
  private searchPaths: string[] = ["data/"];

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): PK3Index {
    if (!PK3Index.instance) {
      PK3Index.instance = new PK3Index();
    }
    return PK3Index.instance;
  }

  /**
   * Set search paths for PK3 discovery
   */
  setSearchPaths(paths: string[]): void {
    this.searchPaths = paths.map((p) => (p.endsWith("/") ? p : `${p}/`));
  }

  /**
   * Add a search path
   */
  addSearchPath(path: string): void {
    const normalized = path.endsWith("/") ? path : `${path}/`;
    if (!this.searchPaths.includes(normalized)) {
      this.searchPaths.push(normalized);
    }
  }

  /**
   * Check if localStorage is available (browser only, not Node.js)
   */
  private hasLocalStorage(): boolean {
    try {
      return typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  }

  /**
   * Load index from localStorage
   */
  private loadFromStorage(): void {
    if (!this.hasLocalStorage()) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored) as PK3IndexData;
        if (data.version === INDEX_VERSION) {
          this.index = data;
          console.log(
            `[PK3Index] Loaded index from storage: ${Object.keys(data.files).length} files from ${data.packages.length} packages`,
          );
        } else {
          console.log("[PK3Index] Index version mismatch, will rebuild");
        }
      }
    } catch (e) {
      console.warn("[PK3Index] Failed to load index from storage:", e);
    }
  }

  /**
   * Save index to localStorage
   */
  private saveToStorage(): void {
    if (!this.index || !this.hasLocalStorage()) return;
    try {
      const json = JSON.stringify(this.index);
      localStorage.setItem(STORAGE_KEY, json);
      console.log(`[PK3Index] Saved index to storage (${(json.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.warn("[PK3Index] Failed to save index to storage:", e);
    }
  }

  private updateListChecksumFromPackages(): void {
    if (!this.index) return;
    const parts = this.index.packages.map((entry) => `${entry.pk3}:${entry.size || 0}`).sort();
    this.index.listChecksum = simpleHash(parts.join("|"));
    this.index.lastUpdated = Date.now();
  }

  /**
   * Discover PK3 files in a directory by fetching a manifest or scanning
   * Since we can't list directories in browser, we need a manifest file
   */
  async discoverPK3s(basePath: string): Promise<string[]> {
    const manifestUrl = `${basePath}pk3_manifest.json`;
    try {
      const response = await fetchAsset(manifestUrl);
      if (response.ok) {
        const manifest = await readAssetJson(response);
        if (manifest && typeof manifest === "object" && "files" in manifest && Array.isArray(manifest.files)) {
          return manifest.files as string[];
        }
        if (Array.isArray(manifest)) {
          return manifest as string[];
        }
      }
    } catch {
      // No manifest, try common filenames
    }

    // Fallback: try to detect by fetching known patterns
    const detected: string[] = [];
    const patterns = [
      "basewsw.pk3",
      "data0_21pure.pk3",
      "data1_21pure.pk3",
      "data2_21pure.pk3",
      "exwsw.pk3",
      "exwsw_000.pk3",
      "exwsw_001.pk3",
    ];

    for (const pattern of patterns) {
      try {
        const response = await fetchAsset(`${basePath}${pattern}`, { method: "HEAD" });
        if (response.ok) {
          detected.push(pattern);
        }
      } catch {
        // Not found
      }
    }

    return detected;
  }

  /** Index one newly published package without rebuilding the entire PK3 library. */
  async refreshPackage(filename: string): Promise<boolean> {
    if (!/^[a-z0-9][a-z0-9_.-]*\.pk3$/i.test(filename)) throw new Error("Invalid PK3 filename");
    for (const basePath of this.searchPaths) {
      if (await this.indexPK3(basePath, filename)) {
        this.updateListChecksumFromPackages();
        this.saveToStorage();
        return true;
      }
    }
    return false;
  }

  /** `pk3 refresh foo.pk3` updates the foo*.pk3 family from the manifest. */
  async refreshFamily(input: string): Promise<string[]> {
    const base = input.replace(/\*\.pk3$/i, "").replace(/\.pk3$/i, "");
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(base)) throw new Error("Usage: pk3 refresh <family.pk3>");
    const matches: string[] = [];
    for (const basePath of this.searchPaths) {
      const names = (await this.discoverPK3s(basePath))
        .filter((name) => name.toLowerCase().startsWith(base.toLowerCase()) && name.toLowerCase().endsWith(".pk3"))
        .sort();
      for (const name of names) {
        if (await this.indexPK3(basePath, name)) matches.push(name);
      }
    }
    if (matches.length) {
      this.updateListChecksumFromPackages();
      this.saveToStorage();
    }
    return matches;
  }

  /**
   * Index a single PK3 file - extracts files, shaders, and maps
   */
  async indexPK3(basePath: string, filename: string): Promise<PK3IndexEntry | null> {
    const url = `${basePath}${filename}`;

    try {
      console.log(`[PK3Index] Indexing ${url}...`);
      const { response } = await fetchPk3(url);
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await readAssetBuffer(response);
      const zip = await JSZip.loadAsync(arrayBuffer);

      const files: string[] = [];
      const shaderFiles: string[] = [];
      const mapFiles: string[] = [];

      zip.forEach((relativePath) => {
        const normalized = relativePath.toLowerCase().replace(/\\/g, "/");
        if (!normalized.endsWith("/")) {
          files.push(normalized);

          // Track shader files for extraction
          if (
            normalized.endsWith(".shader") &&
            (normalized.startsWith("scripts/") || normalized.startsWith("shaders/"))
          ) {
            shaderFiles.push(relativePath);
          }

          // Track map files
          if (normalized.startsWith("maps/") && normalized.endsWith(".bsp")) {
            mapFiles.push(normalized);
          }
        }
      });

      // Initialize index if needed
      if (!this.index) {
        this.index = {
          version: INDEX_VERSION,
          listChecksum: "",
          files: {},
          shaders: {},
          maps: {},
          packages: [],
          lastUpdated: Date.now(),
        };
      }

      // Add files to index (later packages override earlier ones)
      for (const file of files) {
        this.index.files[file] = filename;
      }

      // Extract shader names from .shader files
      let shaderCount = 0;
      for (const shaderFile of shaderFiles) {
        try {
          const content = await zip.file(shaderFile)?.async("string");
          if (content) {
            const shaderNames = extractShaderNames(content);
            for (const name of shaderNames) {
              this.index.shaders[name] = filename;
              shaderCount++;
            }
          }
        } catch (e) {
          console.warn(`[PK3Index] Failed to parse shader ${shaderFile}:`, e);
        }
      }

      // Add maps to index
      for (const mapFile of mapFiles) {
        // Extract map name: "maps/wdm1.bsp" -> "wdm1"
        const mapName = mapFile.replace(/^maps\//, "").replace(/\.bsp$/, "");
        this.index.maps[mapName] = filename;
      }

      const entry: PK3IndexEntry = {
        pk3: filename,
        path: url,
        fileCount: files.length,
        size: arrayBuffer.byteLength,
      };

      // Update or add package entry
      const existingIdx = this.index.packages.findIndex((p) => p.pk3 === filename && p.path === url);
      if (existingIdx >= 0) {
        this.index.packages[existingIdx] = entry;
      } else {
        this.index.packages.push(entry);
      }

      const extras = [];
      if (shaderCount > 0) extras.push(`${shaderCount} shaders`);
      if (mapFiles.length > 0) extras.push(`${mapFiles.length} maps`);
      const extraStr = extras.length > 0 ? ` (${extras.join(", ")})` : "";

      console.log(`[PK3Index] Indexed ${filename}: ${files.length} files${extraStr}`);
      return entry;
    } catch (e) {
      console.warn(`[PK3Index] Failed to index ${url}:`, e);
      return null;
    }
  }

  /**
   * Index a PK3 from an in-memory ArrayBuffer (Node/headless-friendly).
   * This bypasses fetch/localStorage and keeps the index in memory.
   */
  async indexPK3ArrayBuffer(
    filename: string,
    arrayBuffer: ArrayBuffer,
    sourcePath?: string,
  ): Promise<PK3IndexEntry | null> {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);

      const files: string[] = [];
      const shaderFiles: string[] = [];
      const mapFiles: string[] = [];

      zip.forEach((relativePath) => {
        const normalized = relativePath.toLowerCase().replace(/\\/g, "/");
        if (!normalized.endsWith("/")) {
          files.push(normalized);

          if (
            normalized.endsWith(".shader") &&
            (normalized.startsWith("scripts/") || normalized.startsWith("shaders/"))
          ) {
            shaderFiles.push(relativePath);
          }

          if (normalized.startsWith("maps/") && normalized.endsWith(".bsp")) {
            mapFiles.push(normalized);
          }
        }
      });

      if (!this.index) {
        this.index = {
          version: INDEX_VERSION,
          listChecksum: "",
          files: {},
          shaders: {},
          maps: {},
          packages: [],
          lastUpdated: Date.now(),
        };
      }

      for (const file of files) {
        this.index.files[file] = filename;
      }

      let shaderCount = 0;
      for (const shaderFile of shaderFiles) {
        try {
          const content = await zip.file(shaderFile)?.async("string");
          if (content) {
            const shaderNames = extractShaderNames(content);
            for (const name of shaderNames) {
              this.index.shaders[name] = filename;
              shaderCount++;
            }
          }
        } catch (e) {
          console.warn(`[PK3Index] Failed to parse shader ${shaderFile}:`, e);
        }
      }

      for (const mapFile of mapFiles) {
        const mapName = mapFile.replace(/^maps\//, "").replace(/\.bsp$/, "");
        this.index.maps[mapName] = filename;
      }

      const entry: PK3IndexEntry = {
        pk3: filename,
        path: sourcePath || filename,
        fileCount: files.length,
        size: arrayBuffer.byteLength,
      };

      const existingIdx = this.index.packages.findIndex((p) => p.pk3 === filename && p.path === entry.path);
      if (existingIdx >= 0) {
        this.index.packages[existingIdx] = entry;
      } else {
        this.index.packages.push(entry);
      }

      const extras = [];
      if (shaderCount > 0) extras.push(`${shaderCount} shaders`);
      if (mapFiles.length > 0) extras.push(`${mapFiles.length} maps`);
      const extraStr = extras.length > 0 ? ` (${extras.join(", ")})` : "";

      console.log(`[PK3Index] Indexed ${filename}: ${files.length} files${extraStr}`);
      return entry;
    } catch (e) {
      console.warn(`[PK3Index] Failed to index ArrayBuffer for ${filename}:`, e);
      return null;
    }
  }

  /**
   * Build/rebuild the entire index from all search paths
   */
  async buildIndex(progressCallback?: (msg: string) => void): Promise<number> {
    this.index = {
      version: INDEX_VERSION,
      listChecksum: "",
      files: {},
      shaders: {},
      maps: {},
      packages: [],
      lastUpdated: Date.now(),
    };

    let totalFiles = 0;
    const checksumParts: string[] = [];

    for (const basePath of this.searchPaths) {
      progressCallback?.(`Discovering PK3s in ${basePath}...`);
      const pk3Files = await this.discoverPK3s(basePath);

      progressCallback?.(`Found ${pk3Files.length} PK3s in ${basePath}`);

      for (const pk3 of pk3Files) {
        progressCallback?.(`Indexing ${pk3}...`);
        const entry = await this.indexPK3(basePath, pk3);
        if (entry) {
          totalFiles += entry.fileCount;
          // Add to checksum: filename:size
          checksumParts.push(`${pk3}:${entry.size || 0}`);
        }
      }
    }

    // Compute checksum from sorted list of pk3:size pairs
    checksumParts.sort();
    this.index.listChecksum = simpleHash(checksumParts.join("|"));

    this.index.lastUpdated = Date.now();
    this.saveToStorage();

    const shaderCount = Object.keys(this.index.shaders).length;
    const mapCount = Object.keys(this.index.maps).length;
    progressCallback?.(
      `Index complete: ${totalFiles} files, ${shaderCount} shaders, ${mapCount} maps from ${this.index.packages.length} packages`,
    );
    return totalFiles;
  }

  /**
   * Find which PK3 contains a file
   */
  findFile(path: string): string | null {
    if (!this.index) return null;
    const normalized = path.toLowerCase().replace(/\\/g, "/");
    return this.index.files[normalized] || null;
  }

  /**
   * Find which PK3 contains a shader definition
   */
  findShader(shaderName: string): string | null {
    if (!this.index) return null;
    const normalized = shaderName.toLowerCase();
    return this.index.shaders[normalized] || null;
  }

  /**
   * Find which PK3 contains a map
   */
  findMap(mapName: string): string | null {
    if (!this.index) return null;
    const normalized = mapName.toLowerCase();
    return this.index.maps[normalized] || null;
  }

  /**
   * Get all indexed map names
   */
  getMapNames(): string[] {
    if (!this.index) return [];
    return Object.keys(this.index.maps);
  }

  /**
   * Get all indexed shader names
   */
  getShaderNames(): string[] {
    if (!this.index) return [];
    return Object.keys(this.index.shaders);
  }

  /**
   * Find which PK3s contain files matching a pattern
   */
  findByPattern(pattern: string): { file: string; pk3: string }[] {
    if (!this.index) return [];

    // Escape the pattern first, then reopen only the two glob wildcards: a path
    // pattern is full of regex metacharacters — "maps/*.bsp" would otherwise let
    // its dot match anything, and a bracket or parenthesis in a texture name
    // throws.
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const source = escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
    const regex = new RegExp(`^${source}$`, "i");

    const results: { file: string; pk3: string }[] = [];
    for (const [file, pk3] of Object.entries(this.index.files)) {
      if (regex.test(file)) {
        results.push({ file, pk3 });
      }
    }
    return results;
  }

  /**
   * Find which PK3s are needed for a list of texture paths
   * Returns unique PK3 filenames
   */
  findPK3sForTextures(texturePaths: string[]): Set<string> {
    const pk3s = new Set<string>();
    const shaderDirsToCheck = new Set<string>();

    for (const texPath of texturePaths) {
      // Try multiple extensions
      const extensions = ["", ".tga", ".jpg", ".png", ".ktx"];
      const basePath = texPath.toLowerCase().replace(/\.(tga|jpg|png|ktx)$/i, "");

      let found = false;
      for (const ext of extensions) {
        const pk3 = this.findFile(basePath + ext);
        if (pk3) {
          pk3s.add(pk3);
          found = true;
          break;
        }
        // Also check textures/ prefix
        const withPrefix = `textures/${basePath}${ext}`;
        const pk3WithPrefix = this.findFile(withPrefix);
        if (pk3WithPrefix) {
          pk3s.add(pk3WithPrefix);
          found = true;
          break;
        }
      }

      // If no texture file found, collect shader directories to check
      // e.g., textures/sky/stormydays -> look for scripts/sky.shader
      if (!found) {
        const parts = basePath.replace(/^textures\//, "").split("/");
        if (parts.length > 0) {
          shaderDirsToCheck.add(parts[0]); // e.g., "sky"
        }
      }
    }

    // Look for shader PK3s based on texture directory names
    for (const dir of shaderDirsToCheck) {
      const shaderPath = `scripts/${dir}.shader`;
      const pk3 = this.findFile(shaderPath);
      if (pk3) {
        pk3s.add(pk3);
      }
    }

    return pk3s;
  }

  /**
   * Get index stats
   */
  getStats(): {
    fileCount: number;
    shaderCount: number;
    mapCount: number;
    packageCount: number;
    checksum: string;
    lastUpdated: Date | null;
  } {
    if (!this.index) {
      return { fileCount: 0, shaderCount: 0, mapCount: 0, packageCount: 0, checksum: "", lastUpdated: null };
    }
    return {
      fileCount: Object.keys(this.index.files).length,
      shaderCount: Object.keys(this.index.shaders).length,
      mapCount: Object.keys(this.index.maps).length,
      packageCount: this.index.packages.length,
      checksum: this.index.listChecksum,
      lastUpdated: new Date(this.index.lastUpdated),
    };
  }

  /**
   * Get list of indexed packages
   */
  getPackages(): PK3IndexEntry[] {
    return this.index?.packages || [];
  }

  /** Portable build-time metadata from the same file/shader/map indexer as runtime. */
  exportSnapshot(): PK3IndexData {
    this.updateListChecksumFromPackages();
    const data = this.index ?? mergePublishedIndexes([]);
    return {
      ...data,
      files: { ...data.files },
      shaders: { ...data.shaders },
      maps: { ...data.maps },
      packages: data.packages.map((entry) => ({ ...entry, path: entry.pk3 })),
    };
  }

  /**
   * Get the full URL path for a PK3 filename
   * Returns the path where it was indexed from (prefers entries with files)
   */
  getPK3Path(pk3Filename: string): string | null {
    if (!this.index) return null;
    // Find all matching entries
    const entries = this.index.packages.filter((p) => p.pk3 === pk3Filename);
    if (entries.length === 0) return null;
    // Prefer entries that actually have files indexed (fileCount > 0)
    const validEntry = entries.find((e) => e.fileCount > 0) || entries[0];
    return validEntry?.path || null;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index = null;
    if (this.hasLocalStorage()) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* Cache storage is optional. */
      }
    }
    console.log("[PK3Index] Index cleared");
  }

  /**
   * Check if index exists
   */
  hasIndex(): boolean {
    return this.index !== null && Object.keys(this.index.files).length > 0;
  }

  /**
   * Compute checksum of current PK3 files (without loading them)
   * Uses HEAD requests to get file sizes for quick comparison
   */
  private async computeCurrentChecksum(): Promise<string> {
    const checksumParts: string[] = [];

    for (const basePath of this.searchPaths) {
      const pk3Files = await this.discoverPK3s(basePath);

      for (const pk3 of pk3Files) {
        const url = `${basePath}${pk3}`;
        try {
          const response = await fetchAsset(url, { method: "HEAD" });
          if (response.ok) {
            const size = response.headers.get("content-length") || "0";
            checksumParts.push(`${pk3}:${size}`);
          }
        } catch {
          // File not accessible, skip
        }
      }
    }

    checksumParts.sort();
    return simpleHash(checksumParts.join("|"));
  }

  /** All configured paths must validate before any published lookup is adopted. */
  private async loadPublishedIndex(): Promise<PK3IndexData | null> {
    const snapshots: PK3IndexData[] = [];
    if (this.searchPaths.length === 0) return null;
    try {
      for (const basePath of this.searchPaths) {
        // Revalidate both small metadata files on deploy; archives stay lazy.
        const manifestResponse = await fetchAsset(`${basePath}pk3_manifest.json`, { cache: "no-cache" });
        if (!manifestResponse.ok) return null;
        const manifest: unknown = await readAssetJson(manifestResponse);
        if (!hasPublishedIndex(manifest)) return null;
        const response = await fetchAsset(`${basePath}pk3_index.json`, { cache: "no-cache" });
        if (!response.ok) return null;
        const snapshot = parsePublishedIndex(await readAssetText(response), manifest, basePath);
        if (!snapshot) {
          console.warn(`[PK3Index] Published index is stale or invalid in ${basePath}; using archive validation`);
          return null;
        }
        snapshots.push(snapshot);
      }
      return mergePublishedIndexes(snapshots);
    } catch {
      // Old deployments, offline metadata and SPA fallbacks retain the scan path.
      return null;
    }
  }

  /** Load published metadata, or validate/rebuild the legacy cache. True when lookups changed. */
  async ensureIndex(progressCallback?: (msg: string) => void): Promise<boolean> {
    progressCallback?.("Loading published PK3 index...");
    const published = await this.loadPublishedIndex();
    if (published) {
      const replaced =
        !this.hasIndex() ||
        this.index?.listChecksum !== published.listChecksum ||
        this.index?.lastUpdated !== published.lastUpdated;
      this.index = published;
      this.saveToStorage();
      const stats = this.getStats();
      progressCallback?.(`Index ready: ${stats.fileCount} files, ${stats.shaderCount} shaders, ${stats.mapCount} maps`);
      return replaced;
    }
    // 1. If no cached index, build fresh
    if (!this.hasIndex()) {
      progressCallback?.("Building PK3 index...");
      await this.buildIndex(progressCallback);
      return true;
    }

    // 2. Quick check: discover PK3s and compare checksum
    progressCallback?.("Validating PK3 index...");
    const currentChecksum = await this.computeCurrentChecksum();

    if (currentChecksum === this.index?.listChecksum) {
      const stats = this.getStats();
      progressCallback?.(`Index valid: ${stats.fileCount} files, ${stats.shaderCount} shaders, ${stats.mapCount} maps`);
      return false; // Used cache
    }

    // 3. Checksum mismatch - rebuild
    progressCallback?.("PK3 files changed, rebuilding index...");
    await this.buildIndex(progressCallback);
    return true;
  }
}
