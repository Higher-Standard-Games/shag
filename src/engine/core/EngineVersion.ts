/**
 * EngineVersion - Centralized version management
 * 
 * Reads version from version.txt at build time via Vite's ?raw import.
 */

import versionText from '../version.txt?raw';

class EngineVersion {
  private static instance: EngineVersion;
  private version: string;

  private constructor() {
    this.version = versionText.trim();
  }

  public static getInstance(): EngineVersion {
    if (!EngineVersion.instance) {
      EngineVersion.instance = new EngineVersion();
    }
    return EngineVersion.instance;
  }

  /**
   * Get the engine version string (e.g., "0.2.0")
   */
  public getVersion(): string {
    return this.version;
  }

  /**
   * Get the full version string with prefix (e.g., "v0.2.0")
   */
  public getVersionString(): string {
    return `v${this.version}`;
  }

  /**
   * Get the engine name with version (e.g., "IWM Engine v0.2.0")
   */
  public getFullVersionString(): string {
    return `IWM Engine v${this.version}`;
  }
}

export { EngineVersion };
