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

  // ==================== Physics ====================
  sv_gravity: {
    value: 800,
    defaultValue: 800,
    min: 0,
    max: 2000,
    description: 'Gravity strength (units/sec²)',
    category: 'physics',
    developerOnly: true,
  },
  sv_jumpheight: {
    value: 270,
    defaultValue: 270,
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
  sv_aircontrol: {
    value: 0.1,
    defaultValue: 0.1,
    min: 0,
    max: 1.0,
    description: 'Air control factor (0=none, 1=full)',
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

  // ==================== Camera ====================
  cl_sensitivity: {
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
      Cvar.register(name, varConfig.value, {
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
