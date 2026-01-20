/**
 * EngineVersion - Centralized version management
 * 
 * Reads version from version.txt at build time via Vite's ?raw import.
 */

import versionText from '../version.txt?raw';
import { GamePaths } from './GamePaths';

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
   * Get the engine name with version (e.g., "SHAG Engine v0.2.0")
   */
  public getFullVersionString(): string {
    return `SHAG Engine v${this.version}`;
  }

  /**
   * Get the full engine name (Standards, High And Games)
   */
  public getEngineName(): string {
    return 'SHAG Engine';
  }

  /**
   * Get a random funny quote for debug console (uses SHAG acronym taglines)
   */
  public getRandomQuote(): string {
    return this.getEngineTagline();
  }

  /**
   * Set the browser document title.
   * Uses game title from config if set, otherwise "SHAG Engine v<version>"
   * Includes a random tagline for fun!
   */
  public setDocumentTitle(): void {
    if (typeof document !== 'undefined') {
      const gamePaths = GamePaths.getInstance();
      const gameTitle = gamePaths.isInitialized() ? gamePaths.getGameTitle() : null;
      const tagline = this.getEngineTagline();

      if (gameTitle) {
        document.title = `${gameTitle} - ${tagline}`;
      } else {
        document.title = `SHAG Engine - ${tagline}`;
      }
    }
  }

  /**
   * Get the engine tagline
   */
  public getEngineTagline(): string {
    const taglines = [
      "Simulated Hallucination Architecture Grid",
      "Smoked Heavily And Generated",
      "Somehow Holding A Game",
      "State of Higher Awareness Gaming",
      "Spaghetti Hiding All Glitches",
      "Seeing Hyper-dimensional Abstract Geometry",
      "Still Hasn't Any Graphics",
      "Software High As Galaxy",
      "Secretly Hiding All Garbage",
      "System Has Ascended Gravity",
      "Super Hazy Algorithm Guesses",
      "Solo Human Attempting Greatness",
      "Source Has Archaic Garbage",
      "Start Hallucinating A Game",
      "Scary Hacks And Glue",
      "Software Highly Augmented by Grass",
      "Sensory Highs And Glitches",
      "Sativa Helped Assemble Geometry",
      "Sleep Has Abandoned Group",
      "Stoned Human Arranging Glyphs",
      "Sublime Hallucinations Are Guaranteed",
      "Simply High And Gaming",
      "Someone Hide All Gins",
      "Sadly Highly AI Generated"
    ];
    return taglines[Math.floor(Math.random() * taglines.length)];
  }
}

export { EngineVersion };
