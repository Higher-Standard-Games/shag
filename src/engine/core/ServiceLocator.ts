/**
 * ServiceLocator - Centralized service management with explicit initialization order
 * 
 * Provides dependency injection for engine services, ensuring proper initialization
 * order and making dependencies explicit rather than implicit.
 * 
 * Benefits:
 * - Explicit initialization order prevents race conditions
 * - Easy to mock services for testing
 * - Clear dependency graph
 * - Proper cleanup on shutdown
 * 
 * Usage:
 *   // During startup
 *   await ServiceLocator.getInstance().initEngine(scene);
 *   
 *   // Anywhere in code
 *   const textures = ServiceLocator.get<TextureManager>('textures');
 *   
 *   // During shutdown
 *   ServiceLocator.getInstance().dispose();
 */

import type { Scene } from "@babylonjs/core/scene";

/**
 * Service lifecycle interface
 * Services can optionally implement init/dispose for lifecycle management
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Service {
  /** Optional async initialization */
  init?(...args: unknown[]): void | Promise<void>;
  /** Optional cleanup */
  dispose?(): void;
}

/** Any object that can be used as a service */
export type AnyService = Service | object;

/**
 * Service registration info
 */
interface ServiceInfo {
  instance: AnyService;
  initialized: boolean;
  dependencies: string[];
}

/**
 * Initialization phase - controls when services are initialized
 */
export type InitPhase = 'core' | 'scene' | 'game';

/**
 * Service registration options
 */
export interface ServiceRegistration {
  /** Unique service name */
  name: string;
  /** Factory function to create the service (usually getInstance) */
  factory: () => AnyService;
  /** Services that must be initialized before this one */
  dependencies?: string[];
  /** When this service should be initialized */
  phase?: InitPhase;
}

/**
 * ServiceLocator singleton for managing engine services
 */
export class ServiceLocator {
  private static instance: ServiceLocator;
  
  private services: Map<string, ServiceInfo> = new Map();
  private registrations: Map<string, ServiceRegistration> = new Map();
  private initOrder: string[] = [];
  private currentPhase: InitPhase | null = null;
  
  private constructor() {}
  
  public static getInstance(): ServiceLocator {
    if (!ServiceLocator.instance) {
      ServiceLocator.instance = new ServiceLocator();
    }
    return ServiceLocator.instance;
  }
  
  /**
   * Reset instance (for testing)
   */
  public static resetInstance(): void {
    if (ServiceLocator.instance) {
      ServiceLocator.instance.dispose();
    }
    ServiceLocator.instance = null as unknown as ServiceLocator;
  }
  
  /**
   * Register a service for later initialization
   */
  public register(registration: ServiceRegistration): void {
    if (this.registrations.has(registration.name)) {
      console.warn(`[ServiceLocator] Service '${registration.name}' already registered, skipping`);
      return;
    }
    
    this.registrations.set(registration.name, {
      ...registration,
      dependencies: registration.dependencies ?? [],
      phase: registration.phase ?? 'core',
    });
  }
  
  /**
   * Register multiple services at once
   */
  public registerAll(registrations: ServiceRegistration[]): void {
    for (const reg of registrations) {
      this.register(reg);
    }
  }
  
  /**
   * Get a service by name (type-safe)
   */
  public static get<T extends Service>(name: string): T {
    const locator = ServiceLocator.getInstance();
    const info = locator.services.get(name);
    
    if (!info) {
      throw new Error(`[ServiceLocator] Service '${name}' not found. Did you forget to register it?`);
    }
    
    if (!info.initialized) {
      console.warn(`[ServiceLocator] Service '${name}' accessed before initialization`);
    }
    
    return info.instance as T;
  }
  
  /**
   * Try to get a service (returns undefined if not found)
   */
  public static tryGet<T extends Service>(name: string): T | undefined {
    const locator = ServiceLocator.getInstance();
    const info = locator.services.get(name);
    return info?.instance as T | undefined;
  }
  
  /**
   * Check if a service is registered and initialized
   */
  public static has(name: string): boolean {
    const locator = ServiceLocator.getInstance();
    const info = locator.services.get(name);
    return info?.initialized ?? false;
  }
  
  /**
   * Initialize all services for a given phase
   */
  public async initPhase(phase: InitPhase, ...args: unknown[]): Promise<void> {
    this.currentPhase = phase;
    console.log(`[ServiceLocator] Initializing ${phase} phase...`);
    
    // Get services for this phase in dependency order
    const phaseServices = this.getServicesForPhase(phase);
    
    for (const name of phaseServices) {
      await this.initService(name, ...args);
    }
    
    console.log(`[ServiceLocator] ${phase} phase complete (${phaseServices.length} services)`);
  }
  
  /**
   * Initialize core services (no scene required)
   * Call this early in startup
   */
  public async initCore(): Promise<void> {
    await this.initPhase('core');
  }
  
  /**
   * Initialize scene-dependent services
   * Call this after creating the Babylon scene
   */
  public async initScene(scene: Scene): Promise<void> {
    await this.initPhase('scene', scene);
  }
  
  /**
   * Initialize game-specific services
   * Call this after scene services are ready
   */
  public async initGame(): Promise<void> {
    await this.initPhase('game');
  }
  
  /**
   * Get services for a phase in topologically sorted order
   */
  private getServicesForPhase(phase: InitPhase): string[] {
    const phaseRegs = Array.from(this.registrations.entries())
      .filter(([_, reg]) => reg.phase === phase)
      .map(([name, _]) => name);
    
    // Topological sort based on dependencies
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`[ServiceLocator] Circular dependency detected involving '${name}'`);
      }
      
      visiting.add(name);
      
      const reg = this.registrations.get(name);
      if (reg) {
        for (const dep of reg.dependencies ?? []) {
          // Only visit deps in the same or earlier phase
          const depReg = this.registrations.get(dep);
          if (depReg && this.phaseOrder(depReg.phase!) <= this.phaseOrder(phase)) {
            visit(dep);
          }
        }
      }
      
      visiting.delete(name);
      visited.add(name);
      
      if (phaseRegs.includes(name)) {
        sorted.push(name);
      }
    };
    
    for (const name of phaseRegs) {
      visit(name);
    }
    
    return sorted;
  }
  
  /**
   * Get phase order for sorting
   */
  private phaseOrder(phase: InitPhase): number {
    switch (phase) {
      case 'core': return 0;
      case 'scene': return 1;
      case 'game': return 2;
      default: return 0;
    }
  }
  
  /**
   * Initialize a single service
   */
  private async initService(name: string, ...args: unknown[]): Promise<void> {
    const existing = this.services.get(name);
    if (existing?.initialized) {
      return; // Already initialized
    }
    
    const reg = this.registrations.get(name);
    if (!reg) {
      throw new Error(`[ServiceLocator] Service '${name}' not registered`);
    }
    
    // Create instance if not exists
    let info: ServiceInfo;
    if (existing) {
      info = existing;
    } else {
      const instance = reg.factory();
      info = {
        instance,
        initialized: false,
        dependencies: reg.dependencies ?? [],
      };
      this.services.set(name, info);
    }
    
    // Initialize (cast to Service to access optional methods)
    const service = info.instance as Service;
    if (service.init) {
      console.log(`[ServiceLocator] Initializing '${name}'...`);
      await service.init(...args);
      console.log(`[ServiceLocator] Initialized '${name}'`);
    } else {
      console.log(`[ServiceLocator] Service '${name}' has no init method`);
    }
    
    info.initialized = true;
    this.initOrder.push(name);
  }
  
  /**
   * Manually set a service instance (useful for testing/mocking)
   */
  public set<T extends Service>(name: string, instance: T, initialized = true): void {
    this.services.set(name, {
      instance,
      initialized,
      dependencies: [],
    });
  }
  
  /**
   * Get initialization order (for debugging)
   */
  public getInitOrder(): string[] {
    return [...this.initOrder];
  }
  
  /**
   * Check if all services are initialized
   */
  public isFullyInitialized(): boolean {
    for (const [name] of this.registrations) {
      const info = this.services.get(name);
      if (!info?.initialized) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Dispose all services in reverse initialization order
   */
  public dispose(): void {
    console.log('[ServiceLocator] Disposing services...');
    
    // Dispose in reverse order
    const reversed = [...this.initOrder].reverse();
    for (const name of reversed) {
      const info = this.services.get(name);
      const service = info?.instance as Service | undefined;
      if (service?.dispose) {
        console.log(`[ServiceLocator] Disposing '${name}'...`);
        service.dispose();
      }
    }
    
    this.services.clear();
    this.initOrder = [];
    this.currentPhase = null;
  }
  
  /**
   * Get current initialization phase (for debugging)
   */
  public getCurrentPhase(): InitPhase | null {
    return this.currentPhase;
  }
  
  /**
   * Get debug info about registered services
   */
  public getDebugInfo(): { name: string; phase: InitPhase; initialized: boolean; dependencies: string[] }[] {
    return Array.from(this.registrations.entries()).map(([name, reg]) => ({
      name,
      phase: reg.phase!,
      initialized: this.services.get(name)?.initialized ?? false,
      dependencies: reg.dependencies ?? [],
    }));
  }
}
