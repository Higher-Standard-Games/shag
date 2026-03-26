/**
 * PlayerProfile — Local player identity and preferences
 *
 * Stores player name, keybindings, and settings as a JSON-serializable blob.
 * Persisted to localStorage. Designed to be syncable to a lobby server API in the future.
 *
 * Usage:
 *   const profile = PlayerProfile.load();   // Load from localStorage or create default
 *   profile.name = 'Sundflux';
 *   profile.save();                          // Persist to localStorage
 *   const json = profile.toJSON();           // Clean JSON for API sync
 */

import type { InputBinding } from "../input/InputTypes";

// ============================================================================
// Types
// ============================================================================

/** SSO provider type (future) */
export type AuthProvider = "steam" | "google" | "native";

/** Link to an authenticated account — populated when auth is implemented */
export interface AccountLink {
  provider: AuthProvider;
  /** Provider-specific ID (Steam ID, Google sub, native UUID) */
  providerId: string;
  /** Our canonical account UUID (same across all providers) */
  accountId: string;
  /** If set, this display name is reserved exclusively for this account */
  reservedName?: string;
  /** ISO timestamp of when the link was created */
  linkedAt: string;
}

/** Serialized profile format (for JSON / localStorage / API) */
export interface PlayerProfileData {
  id: string;
  name: string;
  account?: AccountLink;
  keybindings: Record<string, InputBinding[]>;
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  crosshairStyle: string;
  uiScale: number;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = "shag_player_profile";
const LEGACY_KEYBINDINGS_KEY = "shag_keybindings";

// ============================================================================
// PlayerProfile
// ============================================================================

export class PlayerProfile {
  /** Globally unique profile ID (UUID v4) */
  id: string;
  /** Display name — free choice, editable via `name` console command */
  name: string;
  /** Account link (null until auth is implemented) */
  account?: AccountLink;
  /** Keybinding overrides (action ID → bindings) */
  keybindings: Record<string, InputBinding[]>;
  /** Mouse sensitivity */
  mouseSensitivity: number;
  /** Invert Y axis */
  invertY: boolean;
  /** Field of view (degrees) */
  fov: number;
  /** Crosshair style identifier */
  crosshairStyle: string;
  /** UI scale multiplier */
  uiScale: number;

  private constructor(data: PlayerProfileData) {
    this.id = data.id;
    this.name = data.name;
    this.account = data.account;
    this.keybindings = data.keybindings;
    this.mouseSensitivity = data.mouseSensitivity;
    this.invertY = data.invertY;
    this.fov = data.fov;
    this.crosshairStyle = data.crosshairStyle;
    this.uiScale = data.uiScale;
  }

  // ── Serialization ──────────────────────────────────────────

  /** Export as clean JSON (for API sync, clipboard, etc.) */
  toJSON(): PlayerProfileData {
    return {
      id: this.id,
      name: this.name,
      account: this.account,
      keybindings: this.keybindings,
      mouseSensitivity: this.mouseSensitivity,
      invertY: this.invertY,
      fov: this.fov,
      crosshairStyle: this.crosshairStyle,
      uiScale: this.uiScale,
    };
  }

  /** Create from JSON data */
  static fromJSON(data: PlayerProfileData): PlayerProfile {
    return new PlayerProfile(data);
  }

  // ── Persistence ────────────────────────────────────────────

  /** Save profile to localStorage */
  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
    } catch {
      // localStorage might be unavailable (incognito, full, server-side)
    }
  }

  /**
   * Load profile from localStorage, or create a default.
   * On first load, migrates any existing `shag_keybindings` into the profile.
   */
  static load(): PlayerProfile {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored) as Partial<PlayerProfileData>;
        // Merge with defaults to handle schema upgrades
        return new PlayerProfile({
          ...PlayerProfile.defaults(),
          ...data,
        });
      }
    } catch {
      // Corrupted or unavailable — fall through to create default
    }

    // First launch — create default profile
    const profile = new PlayerProfile(PlayerProfile.defaults());

    // Migrate legacy keybindings if they exist
    profile.migrateLegacyKeybindings();

    profile.save();
    return profile;
  }

  // ── Defaults ───────────────────────────────────────────────

  /** Generate default profile data */
  private static defaults(): PlayerProfileData {
    return {
      id: PlayerProfile.generateId(),
      name: PlayerProfile.generateDefaultName(),
      keybindings: {},
      mouseSensitivity: 0.002,
      invertY: false,
      fov: 110,
      crosshairStyle: "default",
      uiScale: 1.0,
    };
  }

  /** Generate a UUID v4 */
  private static generateId(): string {
    // Use native crypto.randomUUID if available
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback: manual UUID v4
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** Generate a random default name for first-time players */
  private static generateDefaultName(): string {
    const suffix = Math.random().toString(36).substring(2, 6);
    return `Player_${suffix}`;
  }

  // ── Migration ──────────────────────────────────────────────

  /** Import keybindings from legacy `shag_keybindings` localStorage key */
  private migrateLegacyKeybindings(): void {
    try {
      const legacy = localStorage.getItem(LEGACY_KEYBINDINGS_KEY);
      if (legacy) {
        const data = JSON.parse(legacy) as Record<string, InputBinding[]>;
        this.keybindings = data;
        console.log("[PlayerProfile] Migrated legacy keybindings into profile");
      }
    } catch {
      // Ignore corrupt legacy data
    }
  }
}
