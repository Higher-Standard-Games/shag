/**
 * MovementVars - Movement-related console variables
 * 
 * Provides cl_* and sv_* variables for tuning player movement,
 * physics, and camera behavior. Most are developer-protected.
 */

import { Cvar } from '../core/Cvar';

// ==================== Types ====================

export interface MovementVar {
  name: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  description: string;
  category: 'movement' | 'physics' | 'camera' | 'debug';
  developerOnly: boolean;
  type?: 'int' | 'float';  // Force cvar type (default: auto-detect)
}

// ==================== Constants ====================

const STORAGE_KEY = 'engine.movementVars';

const DEFAULT_VARS: Record<string, Omit<MovementVar, 'name'>> = {
  // ==================== Movement ====================
  cl_speed: {
    value: 320,
    defaultValue: 320,
    min: 50,
    max: 2000,
    description: 'Player movement speed (units/sec)',
    category: 'movement',
    developerOnly: false,
  },
  cl_sprintmult: {
    value: 1.5,
    defaultValue: 1.5,
    min: 1.0,
    max: 3.0,
    description: 'Sprint speed multiplier',
    category: 'movement',
    developerOnly: false,
  },
  cl_crouchmult: {
    value: 0.5,
    defaultValue: 0.5,
    min: 0.1,
    max: 1.0,
    description: 'Crouch speed multiplier',
    category: 'movement',
    developerOnly: false,
  },
  sv_movementSpeed: {
    value: 280,
    defaultValue: 280,
    min: 50,
    max: 2000,
    description: 'Base player movement speed (units/sec)',
    category: 'movement',
    developerOnly: true,
  },
  sv_runSpeed: {
    value: 400,
    defaultValue: 400,
    min: 100,
    max: 3000,
    description: 'Sprint/run movement speed (units/sec)',
    category: 'movement',
    developerOnly: true,
  },

  // ==================== Physics ====================
  sv_gravity: {
    value: 1000,
    defaultValue: 1000,
    min: 0,
    max: 2000,
    description: 'Gravity strength (units/sec²)',
    category: 'physics',
    developerOnly: true,
  },
  sv_jumpheight: {
    value: 280,
    defaultValue: 280,
    min: 0,
    max: 1000,
    description: 'Jump velocity (Quake-style units)',
    category: 'physics',
    developerOnly: true,
  },
  sv_friction: {
    value: 6.0,
    defaultValue: 6.0,
    min: 0,
    max: 20,
    description: 'Ground friction coefficient',
    category: 'physics',
    developerOnly: true,
  },
  sv_accelerate: {
    value: 10.0,
    defaultValue: 10.0,
    min: 1,
    max: 50,
    description: 'Ground acceleration rate (Q3 default: 10)',
    category: 'physics',
    developerOnly: true,
  },
  sv_stopspeed: {
    value: 100,
    defaultValue: 100,
    min: 10,
    max: 500,
    description: 'Speed below which friction uses stopspeed',
    category: 'physics',
    developerOnly: true,
  },
  sv_maxairspeed: {
    value: 30,
    defaultValue: 30,
    min: 0,
    max: 500,
    description: 'Max speed for air input (strafe jumping)',
    category: 'physics',
    developerOnly: true,
  },
  sv_airaccelerate: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 20,
    description: 'Air acceleration rate (Q3 default: 1)',
    category: 'physics',
    developerOnly: true,
  },
  sv_topspeed: {
    value: 1000,
    defaultValue: 1000,
    min: 500,
    max: 2000,
    description: 'Hard speed cap for bunny hopping - acceleration falls off approaching this',
    category: 'physics',
    developerOnly: true,
  },
  sv_aircontrol: {
    value: 150,
    defaultValue: 150,
    min: 0,
    max: 500,
    description: 'Air control multiplier (Warsow default: 150) - turning with +forward only',
    category: 'physics',
    developerOnly: true,
  },
  sv_autohop: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: 'Auto bunny-hop when holding jump (Warsow-style)',
    category: 'physics',
    developerOnly: false,
  },
  sv_aircontrol_power: {
    value: 50,
    defaultValue: 50,
    min: 0,
    max: 500,
    description: 'Air control turning speed when holding +forward (Warsow-style)',
    category: 'physics',
    developerOnly: true,
  },
  sv_stepheight: {
    value: 18,
    defaultValue: 18,
    min: 0,
    max: 48,
    description: 'Max step height for auto-climb',
    category: 'physics',
    developerOnly: true,
  },
  sv_playerheight: {
    value: 56,
    defaultValue: 56,
    min: 32,
    max: 96,
    description: 'Player collision height',
    category: 'physics',
    developerOnly: true,
  },
  sv_eyeoffset: {
    value: 48,
    defaultValue: 48,
    min: 24,
    max: 72,
    description: 'Eye position above feet (camera height)',
    category: 'physics',
    developerOnly: true,
  },

  // ==================== Ledge Grabbing ====================
  sv_ledgegrab: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: 'Enable ledge grabbing (0/1)',
    category: 'physics',
    developerOnly: false,
  },
  sv_ledge_reach: {
    value: 32,
    defaultValue: 32,
    min: 8,
    max: 48,
    description: 'Forward trace distance for ledge detection',
    category: 'physics',
    developerOnly: true,
  },
  sv_ledge_height: {
    value: 64,
    defaultValue: 64,
    min: 32,
    max: 96,
    description: 'Max height above feet to detect ledges',
    category: 'physics',
    developerOnly: true,
  },
  sv_ledge_minfall: {
    value: -50,
    defaultValue: -50,
    min: -200,
    max: 0,
    description: 'Min downward velocity to trigger ledge grab',
    category: 'physics',
    developerOnly: true,
  },
  sv_ledge_timeout: {
    value: 2.0,
    defaultValue: 2.0,
    min: 0.5,
    max: 5.0,
    description: 'Max hang time before auto-drop (seconds)',
    category: 'physics',
    developerOnly: true,
  },
  sv_ledge_pulltime: {
    value: 0.35,
    defaultValue: 0.35,
    min: 0.1,
    max: 1.0,
    description: 'Pull-up animation duration (seconds)',
    category: 'physics',
    developerOnly: true,
  },

  // ==================== Camera ====================
  m_sensitivity: {
    value: 2.0,
    defaultValue: 2.0,
    min: 0.1,
    max: 10.0,
    description: 'Mouse sensitivity multiplier',
    category: 'camera',
    developerOnly: false,
  },
  cl_smoothstairs: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: 'Enable viewport smoothing for stairs',
    category: 'camera',
    developerOnly: false,
  },
  cl_smoothfactor: {
    value: 0.15,
    defaultValue: 0.15,
    min: 0.01,
    max: 1.0,
    description: 'Viewport smoothing interpolation factor',
    category: 'camera',
    developerOnly: true,
  },
  cl_bobbing: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: 'Enable view bobbing while walking',
    category: 'camera',
    developerOnly: false,
  },
  cl_showspeed: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: 'Show player speed on screen',
    category: 'camera',
    developerOnly: false,
  },
  cl_autorun: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: 'Invert run/walk - run by default, walk when holding shift',
    category: 'movement',
    developerOnly: false,
  },

  // ==================== Spectator ====================
  sv_spectator: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: 'Spectator/noclip mode (0=physics, 1=fly)',
    category: 'movement',
    developerOnly: true,
  },
  cl_flyspeed: {
    value: 400,
    defaultValue: 400,
    min: 50,
    max: 5000,
    description: 'Spectator fly speed (units/sec)',
    category: 'movement',
    developerOnly: true,
  },
};

// ==================== MovementVars Class ====================

export class MovementVars {
  private static instance: MovementVars;
  private vars: Map<string, MovementVar> = new Map();
  private constructor() {
    this.initVars();
  }

  static getInstance(): MovementVars {
    if (!MovementVars.instance) {
      MovementVars.instance = new MovementVars();
    }
    return MovementVars.instance;
  }

  private initVars(): void {
    // Load saved values from localStorage
    const saved = this.loadFromStorage();

    // Initialize vars with defaults, applying saved values
    for (const [name, config] of Object.entries(DEFAULT_VARS)) {
      const savedValue = saved[name];
      this.vars.set(name, {
        name,
        ...config,
        value: savedValue !== undefined ? savedValue : config.value,
      });
    }

    // Register with Cvar system
    this.registerCvars();
  }

  private registerCvars(): void {
    for (const [name, varConfig] of this.vars) {
      // Create onChange handler for this var
      const onChange = (newValue: number | boolean | string) => {
        const v = this.vars.get(name);
        if (v && typeof newValue === 'number') {
          v.value = newValue;
          this.saveToStorage();
        }
      };

      // Register cvar with developer flag if needed
      // Always use 'float' type since all movement vars are numeric with potential decimal values
      Cvar.register(name, varConfig.value, {
        type: 'float',
        min: varConfig.min,
        max: varConfig.max,
        description: varConfig.description,
        persist: true,
        onChange,
      });
    }
  }

  // ==================== Public API ====================

  get(name: string): number {
    const v = this.vars.get(name);
    return v?.value ?? 0;
  }

  set(name: string, value: number): boolean {
    const v = this.vars.get(name);
    if (!v) return false;

    const clamped = Math.max(v.min, Math.min(v.max, value));
    v.value = clamped;
    Cvar.set(name, clamped);
    this.saveToStorage();
    return true;
  }

  reset(name: string): boolean {
    const v = this.vars.get(name);
    if (!v) return false;
    return this.set(name, v.defaultValue);
  }

  resetAll(): void {
    for (const v of this.vars.values()) {
      this.set(v.name, v.defaultValue);
    }
  }

  getVar(name: string): MovementVar | undefined {
    return this.vars.get(name);
  }

  getAllVars(): MovementVar[] {
    return Array.from(this.vars.values());
  }

  getByCategory(category: MovementVar['category']): MovementVar[] {
    return this.getAllVars().filter(v => v.category === category);
  }

  // ==================== Storage ====================

  private loadFromStorage(): Record<string, number> {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  private saveToStorage(): void {
    const data: Record<string, number> = {};
    for (const [name, v] of this.vars) {
      if (v.value !== v.defaultValue) {
        data[name] = v.value;
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable
    }
  }

  // ==================== Debug ====================

  getInfo(): string {
    const lines = ['=== Movement Variables ==='];

    const categories = ['movement', 'physics', 'camera', 'debug'] as const;
    for (const cat of categories) {
      const catVars = this.getByCategory(cat);
      if (catVars.length === 0) continue;

      lines.push(`\n[${cat.toUpperCase()}]`);
      for (const v of catVars) {
        const devFlag = v.developerOnly ? ' [DEV]' : '';
        const modified = v.value !== v.defaultValue ? '*' : ' ';
        lines.push(`${modified} ${v.name}: ${v.value} (${v.min}-${v.max})${devFlag}`);
      }
    }

    return lines.join('\n');
  }
}
