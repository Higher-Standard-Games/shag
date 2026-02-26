
import JSZip from "jszip";

export interface PK3LoaderConfig {
  basePath: string; // e.g., "games/default/"
  additionalPaths?: string[]; // e.g., ["games/default/maps/"]
}

export interface PK3File {
  filename: string;
  priority: number;
  zip: JSZip;
  files: Set<string>;
}

/**
 * Loads and manages PK3 files (Quake 3 Archives)
 * Supports multiple PK3s with priority ordering (like Quake filesystem)
 */
export class PK3Loader {
  private static instance: PK3Loader;
  private config: PK3LoaderConfig = { basePath: "data/", additionalPaths: [] };
  private packages: Map<string, PK3File> = new Map();
  private fileIndex: Map<string, string> = new Map(); // normalized path -> pk3 filename

  /** O(1) lookup from normalized path to JSZip file object (avoids forEach scan) */
  private zipFileIndex: Map<string, JSZip.JSZipObject> = new Map();

  /** Track Blob URLs created via getFileAsURL() for cleanup */
  private blobUrls: string[] = [];

  private constructor() { }

  public static getInstance(): PK3Loader {
    if (!PK3Loader.instance) {
      PK3Loader.instance = new PK3Loader();
    }
    return PK3Loader.instance;
  }

  /**
   * Initialize service (called by ServiceLocator)
   */
  public async init(): Promise<void> {
    // PK3 data files live in public/data/ (served as /data/)
    const basePath = 'data/';
    this.configure({ basePath });
    console.log(`[PK3Loader] Auto-configured with basePath: ${basePath}`);
  }

  /**
   * Configure the loader
   */
  public configure(config: Partial<PK3LoaderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Add a search path
   */
  public addSearchPath(path: string): void {
    const normalizedPath = path.replace(/\\/g, "/").replace(/\/$/, "") + "/";
    if (!this.config.additionalPaths) {
      this.config.additionalPaths = [];
    }
    if (!this.config.additionalPaths.includes(normalizedPath)) {
      this.config.additionalPaths.push(normalizedPath);
    }
  }

  /**
   * Get all search paths (primary + additional)
   */
  public getSearchPaths(): string[] {
    return [this.config.basePath, ...(this.config.additionalPaths || [])];
  }

  /**
   * Load a PK3 file by full URL path
   * @param url - Full URL to the pk3 file (e.g., "games/default/basewsw/tex_concrete.pk3")
   * @returns Promise that resolves when loaded
   */
  public async loadPK3FromUrl(url: string): Promise<void> {
    // Extract filename from URL
    const filename = url.split('/').pop() || url;

    console.log(`[PK3Loader] Loading ${filename} from ${url}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await this.processPK3ArrayBuffer(filename, arrayBuffer);
  }

  /**
   * Load a PK3 file (searches all paths)
   * @param filename - Name of the pk3 file (e.g., "exwsw.pk3")
   * @returns Promise that resolves when loaded
   */
  public async loadPK3(filename: string): Promise<void> {
    const searchPaths = this.getSearchPaths();
    let loadedFrom: string | null = null;
    let arrayBuffer: ArrayBuffer | null = null;

    // Try each search path until we find the file
    for (const basePath of searchPaths) {
      const url = `${basePath}${filename}`;
      try {
        const response = await fetch(url);
        if (response.ok) {
          arrayBuffer = await response.arrayBuffer();
          loadedFrom = url;
          break;
        }
      } catch {
        // Try next path
      }
    }

    if (!arrayBuffer || !loadedFrom) {
      const pathsStr = searchPaths.join(', ');
      throw new Error(`PK3 not found in any search path: ${filename} (searched: ${pathsStr})`);
    }

    console.log(`[PK3Loader] Loading ${filename} from ${loadedFrom}...`);
    await this.processPK3ArrayBuffer(filename, arrayBuffer);
  }

  /**
   * Process a loaded PK3 ArrayBuffer
   */
  private async processPK3ArrayBuffer(filename: string, arrayBuffer: ArrayBuffer): Promise<void> {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);

      // Determine priority from filename
      const priority = this.getPriorityFromFilename(filename);

      // Collect file list and build zip entry index for O(1) lookups
      const files = new Set<string>();
      zip.forEach((relativePath) => {
        // Normalize path (lowercase, forward slashes)
        const normalizedPath = relativePath.toLowerCase().replace(/\\/g, "/");
        if (!normalizedPath.endsWith("/")) {
          files.add(normalizedPath);
        }
      });

      const pk3File: PK3File = {
        filename,
        priority,
        zip,
        files,
      };

      this.packages.set(filename, pk3File);

      // Rebuild file index + zip entry index
      this.rebuildFileIndex();

      console.log(`[PK3Loader] Loaded ${filename} with ${files.size} files (priority ${priority})`);
    } catch (error) {
      console.error(`[PK3Loader] Failed to load ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Load multiple PK3 files with automatic priority ordering
   * @param filenames - Array of pk3 filenames
   */
  public async loadPK3s(filenames: string[]): Promise<void> {
    // Sort by priority before loading
    const sorted = [...filenames].sort((a, b) => {
      return this.getPriorityFromFilename(a) - this.getPriorityFromFilename(b);
    });

    for (const filename of sorted) {
      await this.loadPK3(filename);
    }
  }

  /**
   * Get priority from filename
   * - package.pk3 -> 0
   * - package_000.pk3 -> 1
   * - package_001.pk3 -> 2
   */
  private getPriorityFromFilename(filename: string): number {
    const match = filename.match(/_(\d+)\.pk3$/i);
    if (match) {
      return parseInt(match[1], 10) + 1;
    }
    return 0;
  }

  /**
   * Rebuild the file index based on priority
   * Higher priority packages override lower priority ones.
   * Also builds O(1) zip entry index to avoid forEach scans in getFile().
   */
  private rebuildFileIndex(): void {
    this.fileIndex.clear();
    this.zipFileIndex.clear();

    // Sort packages by priority (ascending)
    const sortedPackages = Array.from(this.packages.values())
      .sort((a, b) => a.priority - b.priority);

    // Add files from each package (later packages override)
    for (const pkg of sortedPackages) {
      for (const file of pkg.files) {
        this.fileIndex.set(file, pkg.filename);
      }
      // Build zip entry index: normalized path -> JSZip object (O(1) lookup)
      pkg.zip.forEach((relativePath, zipObj) => {
        const normalized = relativePath.toLowerCase().replace(/\\/g, "/");
        if (!normalized.endsWith("/")) {
          this.zipFileIndex.set(normalized, zipObj);
        }
      });
    }
  }

  /**
   * Check if a file exists in any loaded pk3
   * @param path - File path within pk3 (e.g., "textures/exwsw/foo.ktx")
   */
  public hasFile(path: string): boolean {
    const normalizedPath = path.toLowerCase().replace(/\\/g, "/");
    return this.fileIndex.has(normalizedPath);
  }

  /**
   * Get file data from pk3
   * @param path - File path within pk3
   * @returns ArrayBuffer of file contents, or null if not found
   */
  public async getFile(path: string): Promise<ArrayBuffer | null> {
    const normalizedPath = path.toLowerCase().replace(/\\/g, "/");

    // O(1) lookup via pre-built zip entry index
    const zipObj = this.zipFileIndex.get(normalizedPath);
    if (!zipObj) {
      return null;
    }

    return await zipObj.async("arraybuffer");
  }

  /**
   * Get file as Blob URL (useful for image loading)
   * @param path - File path within pk3
   * @param mimeType - MIME type for the blob
   */
  public async getFileAsURL(path: string, mimeType: string): Promise<string | null> {
    const data = await this.getFile(path);
    if (!data) {
      return null;
    }

    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    this.blobUrls.push(url);
    return url;
  }

  /**
   * List all files matching a pattern
   * @param pattern - Glob-like pattern (supports * wildcard)
   */
  public listFiles(pattern?: string): string[] {
    const files = Array.from(this.fileIndex.keys());

    if (!pattern) {
      return files;
    }

    // Simple glob matching (only supports * wildcard)
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      "i"
    );

    return files.filter(f => regex.test(f));
  }

  /**
   * List files in a directory
   * @param directory - Directory path (e.g., "textures/exwsw")
   */
  public listDirectory(directory: string): string[] {
    const normalizedDir = directory.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "") + "/";

    return Array.from(this.fileIndex.keys())
      .filter(f => f.startsWith(normalizedDir))
      .map(f => f.substring(normalizedDir.length).split("/")[0])
      .filter((v, i, a) => a.indexOf(v) === i); // Unique
  }

  /**
   * Get info about loaded packages
   */
  public getPackageInfo(): { filename: string; priority: number; fileCount: number }[] {
    return Array.from(this.packages.values())
      .map(p => ({
        filename: p.filename,
        priority: p.priority,
        fileCount: p.files.size,
      }))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unload all packages
   */
  public unloadAll(): void {
    this.packages.clear();
    this.fileIndex.clear();
    this.zipFileIndex.clear();

    // Revoke all Blob URLs to free memory
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.length = 0;

    console.log("[PK3Loader] All packages unloaded");
  }
}
