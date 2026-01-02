/**
 * PK3Index - Index PK3 contents for fast lookup without loading
 * 
 * Scans PK3 files from game paths, indexes their contents to localStorage,
 * and provides quick lookup to find which PK3 contains a specific file.
 */

import JSZip from "jszip";

const STORAGE_KEY = 'pk3_index';
const INDEX_VERSION = 1;

export interface PK3IndexEntry {
  /** PK3 filename */
  pk3: string;
  /** Full path where PK3 was found */
  path: string;
  /** File count */
  fileCount: number;
  /** Last modified timestamp (if available) */
  timestamp?: number;
}

export interface PK3IndexData {
  version: number;
  /** Map of normalized file path -> PK3 filename */
  files: Record<string, string>;
  /** List of indexed PK3s */
  packages: PK3IndexEntry[];
  /** When the index was last updated */
  lastUpdated: number;
}

export class PK3Index {
  private static instance: PK3Index;
  
  private index: PK3IndexData | null = null;
  private searchPaths: string[] = ['game/'];

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
    this.searchPaths = paths.map(p => p.endsWith('/') ? p : p + '/');
  }

  /**
   * Add a search path
   */
  addSearchPath(path: string): void {
    const normalized = path.endsWith('/') ? path : path + '/';
    if (!this.searchPaths.includes(normalized)) {
      this.searchPaths.push(normalized);
    }
  }

  /**
   * Load index from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored) as PK3IndexData;
        if (data.version === INDEX_VERSION) {
          this.index = data;
          console.log(`[PK3Index] Loaded index from storage: ${Object.keys(data.files).length} files from ${data.packages.length} packages`);
        } else {
          console.log('[PK3Index] Index version mismatch, will rebuild');
        }
      }
    } catch (e) {
      console.warn('[PK3Index] Failed to load index from storage:', e);
    }
  }

  /**
   * Save index to localStorage
   */
  private saveToStorage(): void {
    if (!this.index) return;
    try {
      const json = JSON.stringify(this.index);
      localStorage.setItem(STORAGE_KEY, json);
      console.log(`[PK3Index] Saved index to storage (${(json.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.warn('[PK3Index] Failed to save index to storage:', e);
    }
  }

  /**
   * Discover PK3 files in a directory by fetching a manifest or scanning
   * Since we can't list directories in browser, we need a manifest file
   */
  async discoverPK3s(basePath: string): Promise<string[]> {
    const manifestUrl = `${basePath}pk3_manifest.json`;
    try {
      const response = await fetch(manifestUrl);
      if (response.ok) {
        const manifest = await response.json();
        if (Array.isArray(manifest.files)) {
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
      'basewsw.pk3',
      'data0_21pure.pk3', 'data1_21pure.pk3', 'data2_21pure.pk3',
      'exwsw.pk3', 'exwsw_000.pk3', 'exwsw_001.pk3',
    ];
    
    for (const pattern of patterns) {
      try {
        const response = await fetch(`${basePath}${pattern}`, { method: 'HEAD' });
        if (response.ok) {
          detected.push(pattern);
        }
      } catch {
        // Not found
      }
    }
    
    return detected;
  }

  /**
   * Index a single PK3 file (fetch headers only to get file list)
   */
  async indexPK3(basePath: string, filename: string): Promise<PK3IndexEntry | null> {
    const url = `${basePath}${filename}`;
    
    try {
      console.log(`[PK3Index] Indexing ${url}...`);
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      const files: string[] = [];
      zip.forEach((relativePath) => {
        const normalized = relativePath.toLowerCase().replace(/\\/g, '/');
        if (!normalized.endsWith('/')) {
          files.push(normalized);
        }
      });
      
      // Add files to index
      if (!this.index) {
        this.index = {
          version: INDEX_VERSION,
          files: {},
          packages: [],
          lastUpdated: Date.now(),
        };
      }
      
      for (const file of files) {
        // Later packages override earlier ones
        this.index.files[file] = filename;
      }
      
      const entry: PK3IndexEntry = {
        pk3: filename,
        path: url,
        fileCount: files.length,
      };
      
      // Update or add package entry
      const existingIdx = this.index.packages.findIndex(p => p.pk3 === filename && p.path === url);
      if (existingIdx >= 0) {
        this.index.packages[existingIdx] = entry;
      } else {
        this.index.packages.push(entry);
      }
      
      console.log(`[PK3Index] Indexed ${filename}: ${files.length} files`);
      return entry;
    } catch (e) {
      console.warn(`[PK3Index] Failed to index ${url}:`, e);
      return null;
    }
  }

  /**
   * Build/rebuild the entire index from all search paths
   */
  async buildIndex(progressCallback?: (msg: string) => void): Promise<number> {
    this.index = {
      version: INDEX_VERSION,
      files: {},
      packages: [],
      lastUpdated: Date.now(),
    };
    
    let totalFiles = 0;
    
    for (const basePath of this.searchPaths) {
      progressCallback?.(`Discovering PK3s in ${basePath}...`);
      const pk3Files = await this.discoverPK3s(basePath);
      
      progressCallback?.(`Found ${pk3Files.length} PK3s in ${basePath}`);
      
      for (const pk3 of pk3Files) {
        progressCallback?.(`Indexing ${pk3}...`);
        const entry = await this.indexPK3(basePath, pk3);
        if (entry) {
          totalFiles += entry.fileCount;
        }
      }
    }
    
    this.index.lastUpdated = Date.now();
    this.saveToStorage();
    
    progressCallback?.(`Index complete: ${totalFiles} files from ${this.index.packages.length} packages`);
    return totalFiles;
  }

  /**
   * Find which PK3 contains a file
   */
  findFile(path: string): string | null {
    if (!this.index) return null;
    const normalized = path.toLowerCase().replace(/\\/g, '/');
    return this.index.files[normalized] || null;
  }

  /**
   * Find which PK3s contain files matching a pattern
   */
  findByPattern(pattern: string): { file: string; pk3: string }[] {
    if (!this.index) return [];
    
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i'
    );
    
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
    
    for (const texPath of texturePaths) {
      // Try multiple extensions
      const extensions = ['', '.tga', '.jpg', '.png', '.ktx'];
      const basePath = texPath.toLowerCase().replace(/\.(tga|jpg|png|ktx)$/i, '');
      
      for (const ext of extensions) {
        const pk3 = this.findFile(basePath + ext);
        if (pk3) {
          pk3s.add(pk3);
          break;
        }
        // Also check textures/ prefix
        const withPrefix = 'textures/' + basePath + ext;
        const pk3WithPrefix = this.findFile(withPrefix);
        if (pk3WithPrefix) {
          pk3s.add(pk3WithPrefix);
          break;
        }
      }
    }
    
    return pk3s;
  }

  /**
   * Get index stats
   */
  getStats(): { fileCount: number; packageCount: number; lastUpdated: Date | null } {
    if (!this.index) {
      return { fileCount: 0, packageCount: 0, lastUpdated: null };
    }
    return {
      fileCount: Object.keys(this.index.files).length,
      packageCount: this.index.packages.length,
      lastUpdated: new Date(this.index.lastUpdated),
    };
  }

  /**
   * Get list of indexed packages
   */
  getPackages(): PK3IndexEntry[] {
    return this.index?.packages || [];
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index = null;
    localStorage.removeItem(STORAGE_KEY);
    console.log('[PK3Index] Index cleared');
  }

  /**
   * Check if index exists
   */
  hasIndex(): boolean {
    return this.index !== null && Object.keys(this.index.files).length > 0;
  }
}
