/**
 * Cvar - Console Variable System (Quake-style)
 *
 * Unified system for engine/game configuration variables.
 * Features:
 * - Type-safe get/set with validation
 * - Automatic persistence to localStorage
 * - Change callbacks for reactive updates
 * - Console integration (auto-registers as commands)
 * - Autocomplete support
 *
 * Naming conventions:
 * - r_*   Render/graphics (r_bloom, r_wireframe)
 * - s_*   Sound/audio (s_volume, s_musicenabled)
 * - ui_*  UI settings (ui_scale, ui_theme)
 * - cam_* Camera (cam_height, cam_fov)
 * - g_*   Game settings (g_timescale, g_autosave)
 * - con_* Console (con_size, con_debug)
 * - cl_*  Client (future)
 * - sv_*  Server (future)
 */

import { writePreference } from "./PreferenceStorage";

const CVAR_STORAGE_KEY = "engine_cvars";
// Production browser clients keep development tools off; Node tools retain them.
const DEVELOPER_LOCKED = import.meta.env?.PROD === true && import.meta.env?.SSR === false;

export type CvarType = "bool" | "int" | "float" | "string";

export type CvarValue = boolean | number | string;

export interface CvarFlags {
  /** Save to localStorage (default: true) */
  persist?: boolean;
  /** Read-only, cannot be changed via console */
  readonly?: boolean;
  /** Requires cheats enabled to change (future) */
  cheat?: boolean;
  /** Hidden from cvarlist (internal use) */
  hidden?: boolean;
}

export interface CvarOptions extends CvarFlags {
  /** Type (auto-detected from default if not specified) */
  type?: CvarType;
  /** Minimum value (for numbers) */
  min?: number;
  /** Maximum value (for numbers) */
  max?: number;
  /** Description shown in console */
  description?: string;
  /** Called when value changes */
  onChange?: (value: CvarValue, oldValue: CvarValue) => void;
}

export interface CvarInstance {
  name: string;
  type: CvarType;
  value: CvarValue;
  defaultValue: CvarValue;
  min?: number;
  max?: number;
  description: string;
  flags: CvarFlags;
  onChange?: (value: CvarValue, oldValue: CvarValue) => void;
}

export class Cvar {
  private static cvars: Map<string, CvarInstance> = new Map();
  private static initialized = false;
  private static consoleIntegration: ((cvar: CvarInstance) => void) | null = null;

  /**
   * Initialize the cvar system (loads persisted values)
   */
  static init(): void {
    if (Cvar.initialized) return;
    Cvar.initialized = true;
    Cvar.loadFromStorage();
    console.log(`[Cvar] Initialized with ${Cvar.cvars.size} cvars`);
  }

  /**
   * Set console integration callback (called when cvars are registered)
   * This allows ConsoleCommandRegistry to auto-register cvars as commands
   */
  static setConsoleIntegration(callback: (cvar: CvarInstance) => void): void {
    Cvar.consoleIntegration = callback;
    // Register existing cvars
    for (const cvar of Cvar.cvars.values()) {
      callback(cvar);
    }
  }

  /**
   * Register a new cvar
   */
  static register(name: string, defaultValue: CvarValue, options: CvarOptions = {}): CvarInstance {
    const lowerName = name.toLowerCase();
    const locked = lowerName === "developer" && DEVELOPER_LOCKED;
    if (locked) {
      defaultValue = 0;
      options = { ...options, type: "int", readonly: true, persist: false };
    }

    // Detect type from default value if not specified
    const type = options.type ?? Cvar.detectType(defaultValue);

    // Validate default value matches type
    const validatedDefault = Cvar.coerceValue(defaultValue, type, options.min, options.max);

    const cvar: CvarInstance = {
      name: lowerName,
      type,
      value: validatedDefault,
      defaultValue: validatedDefault,
      min: options.min,
      max: options.max,
      description: options.description ?? "",
      flags: {
        persist: options.persist ?? true,
        readonly: options.readonly ?? false,
        cheat: options.cheat ?? false,
        hidden: options.hidden ?? false,
      },
      onChange: options.onChange,
    };

    // Check if we have a persisted value
    const existing = Cvar.cvars.get(lowerName);
    if (!locked && existing && Cvar.validValue(existing.value, type)) {
      // Keep the persisted/current value, held to the type and bounds this
      // registration declares — storage kept it before either was known.
      cvar.value = Cvar.coerceValue(existing.value, type, options.min, options.max);
    }

    Cvar.cvars.set(lowerName, cvar);

    // Notify console integration
    if (Cvar.consoleIntegration) {
      Cvar.consoleIntegration(cvar);
    }

    return cvar;
  }

  /**
   * Get a cvar's current value
   */
  static get(name: string): CvarValue | undefined {
    if (name.toLowerCase() === "developer" && DEVELOPER_LOCKED) return 0;
    return Cvar.cvars.get(name.toLowerCase())?.value;
  }

  /**
   * Get as string
   */
  static getString(name: string): string {
    const value = Cvar.get(name);
    if (value === undefined) return "";
    return String(value);
  }

  /**
   * Get as number
   */
  static getNumber(name: string): number {
    const value = Cvar.get(name);
    if (value === undefined) return 0;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return value;
    return parseFloat(value) || 0;
  }

  /**
   * Get as boolean
   */
  static getBool(name: string): boolean {
    const value = Cvar.get(name);
    if (value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return value.toLowerCase() !== "0" && value.toLowerCase() !== "false" && value !== "";
  }

  /**
   * Get as integer
   */
  static getInt(name: string): number {
    return Math.round(Cvar.getNumber(name));
  }

  /**
   * Set a cvar's value
   */
  static set(name: string, value: CvarValue): boolean {
    if (name.toLowerCase() === "developer" && DEVELOPER_LOCKED) return false;
    if (!Cvar.validValue(value)) return false;
    const cvar = Cvar.cvars.get(name.toLowerCase());
    if (!cvar) {
      console.warn(`[Cvar] Unknown cvar: ${name}`);
      return false;
    }

    if (cvar.flags.readonly) {
      console.warn(`[Cvar] ${name} is read-only`);
      return false;
    }

    // A numeric cvar refuses text rather than reading it as zero: "r_bloom abc"
    // is a typo, and silently turning bloom off is worse than saying no.
    if ((cvar.type === "int" || cvar.type === "float") && typeof value === "string") {
      const text = value.trim();
      if (text === "" || !Number.isFinite(Number(text))) {
        console.warn(`[Cvar] ${name} takes a number, not "${value}"`);
        return false;
      }
    }

    const oldValue = cvar.value;
    const newValue = Cvar.coerceValue(value, cvar.type, cvar.min, cvar.max);

    if (oldValue === newValue) {
      return true; // No change needed
    }

    cvar.value = newValue;

    // Trigger onChange callback
    if (cvar.onChange) {
      try {
        cvar.onChange(newValue, oldValue);
      } catch (e) {
        console.error(`[Cvar] onChange error for ${name}:`, e);
      }
    }

    // Persist if enabled
    if (cvar.flags.persist) {
      Cvar.saveToStorage();
    }

    return true;
  }

  /**
   * Toggle a boolean cvar
   */
  static toggle(name: string): boolean {
    const cvar = Cvar.cvars.get(name.toLowerCase());
    if (!cvar) {
      console.warn(`[Cvar] Unknown cvar: ${name}`);
      return false;
    }

    if (cvar.type !== "bool") {
      // For non-bool, toggle between 0 and 1
      const current = Cvar.getNumber(name);
      return Cvar.set(name, current === 0 ? 1 : 0);
    }

    return Cvar.set(name, !Cvar.getBool(name));
  }

  /**
   * Reset a cvar to its default value
   */
  static reset(name: string): boolean {
    const cvar = Cvar.cvars.get(name.toLowerCase());
    if (!cvar) {
      console.warn(`[Cvar] Unknown cvar: ${name}`);
      return false;
    }

    return Cvar.set(name, cvar.defaultValue);
  }

  /**
   * Reset all cvars to defaults
   */
  static resetAll(): void {
    for (const cvar of Cvar.cvars.values()) {
      if (!cvar.flags.readonly) {
        Cvar.set(cvar.name, cvar.defaultValue);
      }
    }
  }

  /**
   * Get cvar instance (for detailed info)
   */
  static getCvar(name: string): CvarInstance | undefined {
    return Cvar.cvars.get(name.toLowerCase());
  }

  /**
   * List all cvars (optionally filtered by prefix)
   */
  static list(filter?: string): CvarInstance[] {
    const result: CvarInstance[] = [];
    const filterLower = filter?.toLowerCase();

    for (const cvar of Cvar.cvars.values()) {
      if (cvar.flags.hidden) continue;
      if (filterLower && !cvar.name.startsWith(filterLower)) continue;
      result.push(cvar);
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all cvar names (for autocomplete)
   */
  static getNames(): string[] {
    return Array.from(Cvar.cvars.keys())
      .filter((name) => !Cvar.cvars.get(name)?.flags.hidden)
      .sort();
  }

  /**
   * Check if a cvar exists
   */
  static exists(name: string): boolean {
    return Cvar.cvars.has(name.toLowerCase());
  }

  /**
   * Format cvar info for console display
   */
  static formatInfo(name: string): string {
    const cvar = Cvar.cvars.get(name.toLowerCase());
    if (!cvar) return `Unknown cvar: ${name}`;

    let info = `"${cvar.name}" is "${cvar.value}"`;
    if (cvar.value !== cvar.defaultValue) {
      info += ` (default: "${cvar.defaultValue}")`;
    }
    if (cvar.min !== undefined || cvar.max !== undefined) {
      info += ` [${cvar.min ?? ""}..${cvar.max ?? ""}]`;
    }
    if (cvar.description) {
      info += `\n  ${cvar.description}`;
    }
    if (cvar.flags.readonly) {
      info += " [readonly]";
    }
    return info;
  }

  // ==================== Persistence ====================

  /**
   * Load cvars from localStorage
   */
  private static loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(CVAR_STORAGE_KEY);
      if (!stored) return;

      const data: unknown = JSON.parse(stored);
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      for (const [name, value] of Object.entries(data)) {
        if (name.toLowerCase() === "developer" && DEVELOPER_LOCKED) continue;
        const cvar = Cvar.cvars.get(name);
        if (!Cvar.validValue(value, cvar?.type)) continue;
        if (cvar?.flags.persist) {
          cvar.value = Cvar.coerceValue(value, cvar.type, cvar.min, cvar.max);
        } else if (!cvar) {
          // Pre-load value for cvars not yet registered
          Cvar.cvars.set(name, {
            name,
            type: Cvar.detectType(value),
            value,
            defaultValue: value,
            description: "",
            flags: { persist: true },
          });
        }
      }
      console.log(`[Cvar] Loaded ${Object.keys(data).length} cvars from storage`);
    } catch (e) {
      console.warn("[Cvar] Failed to load from storage:", e);
    }
  }

  /**
   * Save cvars to localStorage
   */
  private static saveToStorage(): void {
    try {
      const data: Record<string, CvarValue> = {};
      for (const cvar of Cvar.cvars.values()) {
        if (cvar.flags.persist && cvar.value !== cvar.defaultValue) {
          data[cvar.name] = cvar.value;
        }
      }
      writePreference(CVAR_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("[Cvar] Failed to save to storage:", e);
    }
  }

  // ==================== Helpers ====================

  private static validValue(value: unknown, type?: CvarType): value is CvarValue {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    if (typeof value !== "string") return false;
    if (type === "int" || type === "float") return value.trim() !== "" && Number.isFinite(Number(value));
    return true;
  }

  /**
   * Detect type from value
   */
  private static detectType(value: CvarValue): CvarType {
    if (typeof value === "boolean") return "bool";
    if (typeof value === "number") {
      return Number.isInteger(value) ? "int" : "float";
    }
    return "string";
  }

  /**
   * Coerce value to correct type with bounds checking
   */
  private static coerceValue(value: CvarValue, type: CvarType, min?: number, max?: number): CvarValue {
    let result: CvarValue;

    switch (type) {
      case "bool":
        if (typeof value === "boolean") {
          result = value;
        } else if (typeof value === "number") {
          result = value !== 0;
        } else {
          const lower = value.toLowerCase();
          result = lower !== "0" && lower !== "false" && lower !== "";
        }
        break;

      case "int":
        if (typeof value === "boolean") {
          result = value ? 1 : 0;
        } else if (typeof value === "number") {
          result = Math.round(value);
        } else {
          result = Math.round(parseFloat(value) || 0);
        }
        // Apply bounds
        if (min !== undefined) result = Math.max(min, result as number);
        if (max !== undefined) result = Math.min(max, result as number);
        break;

      case "float":
        if (typeof value === "boolean") {
          result = value ? 1 : 0;
        } else if (typeof value === "number") {
          result = value;
        } else {
          result = parseFloat(value) || 0;
        }
        // Apply bounds
        if (min !== undefined) result = Math.max(min, result as number);
        if (max !== undefined) result = Math.min(max, result as number);
        break;
      default:
        result = String(value);
        break;
    }

    return result;
  }

  // ==================== Batch Operations ====================

  /**
   * Register multiple cvars at once
   */
  static registerMany(cvars: Array<[string, CvarValue, CvarOptions?]>): void {
    for (const [name, defaultValue, options] of cvars) {
      Cvar.register(name, defaultValue, options);
    }
  }

  /**
   * Export all non-default cvars as config string
   */
  static exportConfig(): string {
    const lines: string[] = [];
    for (const cvar of Cvar.cvars.values()) {
      if (cvar.value !== cvar.defaultValue && !cvar.flags.hidden) {
        lines.push(`${cvar.name} ${JSON.stringify(String(cvar.value))}`);
      }
    }
    return lines.sort().join("\n");
  }

  /**
   * Execute a config string (set multiple cvars)
   */
  static execConfig(config: string): { accepted: number; rejected: Array<{ line: number; reason: string }> } {
    const result = { accepted: 0, rejected: [] as Array<{ line: number; reason: string }> };
    const lines = config.split("\n");
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

      // Parse: name "value" or name value
      const match = trimmed.match(/^(\S+)\s+("(?:[^"\\]|\\.)*"|[^"\s]+)$/);
      if (!match) {
        result.rejected.push({ line: index + 1, reason: "Expected a setting name and value" });
        continue;
      }
      const name = match[1];
      let value = match[2];
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value) as string;
        } catch {
          // Legacy quoted strings allowed literal backslashes (e.g. asset paths).
          value = value.slice(1, -1);
        }
      }
      const cvar = Cvar.getCvar(name);
      const reason = !cvar ? "Unknown setting" : cvar.flags.readonly ? "Read-only setting" : null;
      if (reason || !Cvar.set(name, value)) {
        result.rejected.push({ line: index + 1, reason: reason ?? "Invalid value" });
      } else result.accepted++;
    }
    return result;
  }
}
