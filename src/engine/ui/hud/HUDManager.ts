/**
 * HUDManager - Core HUD system manager
 * 
 * Handles:
 * - Loading configuration
 * - Creating and managing HUD elements
 * - Layout containers
 * - Update loop with bindings
 * - User preferences persistence
 */

import type {
  HUDConfig,
  HUDSettings,
  HUDPosition,
  HUDElementConfig,
  HUDUserPrefs,
  HUDValueGetter,
  HUDClickHandler,
  HUDListBinding,
  HUDContentProvider,
  HUDFlashType,
} from './HUDTypes';
import { HUDElement } from './HUDElement';
import { HUDPill } from './components/HUDPill';
import { HUDPillProgress } from './components/HUDPillProgress';
import { HUDPillGroup } from './components/HUDPillGroup';
import { HUDButton } from './components/HUDButton';
import { HUDAccordion } from './components/HUDAccordion';
import { UIStyles } from '../UIStyles';

// Import CSS
import hudStyles from './styles/HUD.css?raw';

const STORAGE_KEY = 'hud-user-prefs';
const DEFAULT_UPDATE_INTERVAL = 100;

export class HUDManager {
  private static instance: HUDManager | null = null;

  private config: HUDConfig | null = null;
  private settings: HUDSettings = {
    updateInterval: DEFAULT_UPDATE_INTERVAL,
    animateValueChanges: true,
    persistPreferences: true,
  };
  private userPrefs: HUDUserPrefs = {
    collapsed: [],
    hidden: [],
  };

  // Layout containers
  private container: HTMLElement | null = null;
  private areaContainers: Map<HUDPosition, HTMLElement> = new Map();

  // Components
  private elements: Map<string, HUDElement> = new Map();

  // Bindings
  private bindings: Map<string, HUDValueGetter> = new Map();
  private listBindings: Map<string, HUDListBinding> = new Map();
  private clickHandlers: Map<string, HUDClickHandler> = new Map();
  private contentProviders: Map<string, HUDContentProvider> = new Map();
  private lastValues: Map<string, any> = new Map();

  // Update loop
  private intervalId: number | null = null;
  private running: boolean = false;

  // Theme
  private currentTheme: string = 'default';

  private constructor() {}

  public static getInstance(): HUDManager {
    if (!HUDManager.instance) {
      HUDManager.instance = new HUDManager();
    }
    return HUDManager.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the HUD system with a config file
   */
  public async init(configPath: string): Promise<void> {
    console.log('[HUD] Initializing...');

    // Inject styles
    UIStyles.injectCSS('hud-system', hudStyles);

    // Load config
    await this.loadConfig(configPath);

    // Load user preferences
    this.loadUserPrefs();

    // Create layout containers
    this.createLayoutContainers();

    // Create elements from config
    this.createElementsFromConfig();

    // Apply user preferences
    this.applyUserPrefs();

    console.log(`[HUD] Initialized with ${this.elements.size} elements`);
  }

  /**
   * Load configuration from JSON file
   */
  private async loadConfig(configPath: string): Promise<void> {
    try {
      const response = await fetch(configPath);
      if (!response.ok) {
        throw new Error(`Failed to load HUD config: ${response.status}`);
      }
      this.config = await response.json();

      // Merge settings
      if (this.config?.settings) {
        this.settings = { ...this.settings, ...this.config.settings };
      }

      console.log(`[HUD] Config loaded from ${configPath}`);
    } catch (error) {
      console.error('[HUD] Failed to load config:', error);
      // Use empty config
      this.config = {
        version: 1,
        settings: this.settings,
        layout: { areas: {} },
        elements: {},
      };
    }
  }

  /**
   * Load user preferences from localStorage
   */
  private loadUserPrefs(): void {
    if (!this.settings.persistPreferences) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.userPrefs = { ...this.userPrefs, ...JSON.parse(stored) };
        console.log('[HUD] User preferences loaded');
      }
    } catch (error) {
      console.warn('[HUD] Failed to load user preferences:', error);
    }
  }

  /**
   * Save user preferences to localStorage
   */
  private saveUserPrefs(): void {
    if (!this.settings.persistPreferences) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userPrefs));
    } catch (error) {
      console.warn('[HUD] Failed to save user preferences:', error);
    }
  }

  /**
   * Apply user preferences (collapsed, hidden, theme)
   */
  private applyUserPrefs(): void {
    // Apply collapsed state
    for (const id of this.userPrefs.collapsed) {
      const element = this.elements.get(id);
      if (element && 'collapse' in element) {
        (element as HUDAccordion).collapse();
      }
    }

    // Apply hidden state
    for (const id of this.userPrefs.hidden) {
      const element = this.elements.get(id);
      if (element) {
        element.hide();
      }
    }

    // Apply theme
    if (this.userPrefs.theme) {
      this.setTheme(this.userPrefs.theme);
    }
  }

  // ============================================================================
  // Layout
  // ============================================================================

  /**
   * Create the main HUD container and area containers
   */
  private createLayoutContainers(): void {
    // Main container
    this.container = document.createElement('div');
    this.container.id = 'hud-container';
    this.container.className = 'hud-container';
    document.body.appendChild(this.container);

    // Create area containers for each position
    const positions: HUDPosition[] = [
      'top-left', 'top-center', 'top-right',
      'left', 'center', 'right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ];

    for (const position of positions) {
      const area = document.createElement('div');
      area.className = `hud-area hud-area-${position}`;
      area.dataset.position = position;
      this.container.appendChild(area);
      this.areaContainers.set(position, area);
    }
  }

  /**
   * Create elements from config and add to layout
   */
  private createElementsFromConfig(): void {
    if (!this.config) return;

    const { layout, elements } = this.config;

    // Create elements for each area
    if (layout.areas) {
      for (const [position, elementIds] of Object.entries(layout.areas)) {
        const area = this.areaContainers.get(position as HUDPosition);
        if (!area) continue;

        for (const id of elementIds as string[]) {
          const elementConfig = elements[id];
          if (!elementConfig) {
            console.warn(`[HUD] Element '${id}' not found in config`);
            continue;
          }

          const element = this.createComponent(id, elementConfig);
          if (element) {
            this.elements.set(id, element);
            area.appendChild(element.getElement());
          }
        }
      }
    }
  }

  /**
   * Create a component instance from config
   */
  private createComponent(id: string, config: HUDElementConfig): HUDElement | null {
    switch (config.type) {
      case 'pill':
        return new HUDPill(id, config as any);

      case 'pill-progress':
        return new HUDPillProgress(id, config as any);

      case 'pill-group':
        return new HUDPillGroup(id, config as any, this);

      case 'button':
        return new HUDButton(id, config as any);

      case 'accordion':
        return new HUDAccordion(id, config as any, this);

      default:
        console.warn(`[HUD] Unknown element type: ${config.type}`);
        return null;
    }
  }

  // ============================================================================
  // Bindings API
  // ============================================================================

  /**
   * Bind a value getter to an element
   */
  public bind(id: string, getter: HUDValueGetter): void {
    this.bindings.set(id, getter);
  }

  /**
   * Bind a list data source to an element
   */
  public bindList(id: string, binding: HUDListBinding | (() => any[])): void {
    if (typeof binding === 'function') {
      this.listBindings.set(id, { data: binding });
    } else {
      this.listBindings.set(id, binding);
    }
  }

  /**
   * Set click handler for an element
   */
  public onClick(id: string, handler: HUDClickHandler): void {
    this.clickHandlers.set(id, handler);

    // Apply immediately if element exists
    const element = this.elements.get(id);
    if (element) {
      element.setClickHandler(handler);
    }
  }

  /**
   * Set content provider for custom content
   */
  public setContentProvider(id: string, provider: HUDContentProvider): void {
    this.contentProviders.set(id, provider);
  }

  /**
   * Get a binding value
   */
  public getBindingValue(id: string): any {
    const getter = this.bindings.get(id);
    return getter ? getter() : undefined;
  }

  /**
   * Get a list binding
   */
  public getListBinding(id: string): HUDListBinding | undefined {
    return this.listBindings.get(id);
  }

  /**
   * Get a content provider
   */
  public getContentProvider(id: string): HUDContentProvider | undefined {
    return this.contentProviders.get(id);
  }

  /**
   * Get a click handler
   */
  public getClickHandler(id: string): HUDClickHandler | undefined {
    return this.clickHandlers.get(id);
  }

  // ============================================================================
  // Update Loop
  // ============================================================================

  /**
   * Start the update loop
   */
  public start(): void {
    if (this.running) return;

    this.running = true;
    this.intervalId = window.setInterval(
      () => this.update(),
      this.settings.updateInterval
    );
    console.log(`[HUD] Update loop started (${this.settings.updateInterval}ms interval)`);
  }

  /**
   * Stop the update loop
   */
  public stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[HUD] Update loop stopped');
  }

  /**
   * Set update interval
   */
  public setInterval(ms: number): void {
    this.settings.updateInterval = ms;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get current update interval
   */
  public getInterval(): number {
    return this.settings.updateInterval;
  }

  /**
   * Main update loop - check bindings and update elements
   */
  private update(): void {
    // Update value bindings
    for (const [id, getter] of this.bindings) {
      try {
        const newValue = getter();
        const oldValue = this.lastValues.get(id);

        if (!this.equals(newValue, oldValue)) {
          this.lastValues.set(id, this.clone(newValue));
          this.updateElement(id, newValue, oldValue);
        }
      } catch (error) {
        console.warn(`[HUD] Binding error for '${id}':`, error);
      }
    }

    // Update list bindings
    for (const [id, binding] of this.listBindings) {
      try {
        const newData = binding.data();
        const oldData = this.lastValues.get(`list:${id}`);

        if (!this.equals(newData, oldData)) {
          this.lastValues.set(`list:${id}`, this.clone(newData));
          this.updateListElement(id, newData);
        }
      } catch (error) {
        console.warn(`[HUD] List binding error for '${id}':`, error);
      }
    }
  }

  /**
   * Update a single element with new value
   */
  private updateElement(id: string, newValue: any, oldValue: any): void {
    const element = this.elements.get(id);
    if (!element) return;

    element.setValue(newValue);

    // Auto-animate numeric changes
    if (this.settings.animateValueChanges) {
      if (typeof newValue === 'number' && typeof oldValue === 'number') {
        const delta = newValue - oldValue;
        if (delta > 0) element.flash('gain');
        if (delta < 0) element.flash('loss');
      }
    }
  }

  /**
   * Update a list element with new data
   */
  private updateListElement(id: string, data: any[]): void {
    const element = this.elements.get(id);
    if (!element) return;

    // Accordions handle list updates internally
    if ('updateList' in element) {
      (element as HUDAccordion).updateList(data);
    }
  }

  /**
   * Force refresh a specific element or all elements
   */
  public refresh(id?: string): void {
    if (id) {
      const getter = this.bindings.get(id);
      if (getter) {
        const value = getter();
        this.lastValues.set(id, this.clone(value));
        const element = this.elements.get(id);
        if (element) {
          element.setValue(value);
        }
      }
    } else {
      // Refresh all
      this.lastValues.clear();
      this.update();
    }
  }

  /**
   * Deep equality check
   */
  private equals(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return JSON.stringify(a) === JSON.stringify(b);
    }
    if (typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }

  /**
   * Clone a value for comparison
   */
  private clone(value: any): any {
    if (value == null) return value;
    if (Array.isArray(value)) return [...value];
    if (typeof value === 'object') return { ...value };
    return value;
  }

  // ============================================================================
  // Visibility API
  // ============================================================================

  /**
   * Show an element
   */
  public show(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      element.show();
      // Remove from hidden prefs
      this.userPrefs.hidden = this.userPrefs.hidden.filter(h => h !== id);
      this.saveUserPrefs();
    }
  }

  /**
   * Hide an element
   */
  public hide(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      element.hide();
      // Add to hidden prefs
      if (!this.userPrefs.hidden.includes(id)) {
        this.userPrefs.hidden.push(id);
        this.saveUserPrefs();
      }
    }
  }

  /**
   * Toggle element visibility
   */
  public toggle(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      if (element.isVisible()) {
        this.hide(id);
      } else {
        this.show(id);
      }
    }
  }

  /**
   * Check if element is visible
   */
  public isVisible(id: string): boolean {
    const element = this.elements.get(id);
    return element ? element.isVisible() : false;
  }

  // ============================================================================
  // Animation API
  // ============================================================================

  /**
   * Flash an element
   */
  public flash(id: string, type: HUDFlashType): void {
    const element = this.elements.get(id);
    if (element) {
      element.flash(type);
    }
  }

  /**
   * Pulse an element
   */
  public pulse(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      element.pulse();
    }
  }

  /**
   * Set badge on an element
   */
  public setBadge(id: string, value: number | null): void {
    const element = this.elements.get(id);
    if (element) {
      element.setBadge(value);
    }
  }

  // ============================================================================
  // Accordion API
  // ============================================================================

  /**
   * Collapse an accordion
   */
  public collapse(id: string): void {
    const element = this.elements.get(id);
    if (element && 'collapse' in element) {
      (element as HUDAccordion).collapse();
      if (!this.userPrefs.collapsed.includes(id)) {
        this.userPrefs.collapsed.push(id);
        this.saveUserPrefs();
      }
    }
  }

  /**
   * Expand an accordion
   */
  public expand(id: string): void {
    const element = this.elements.get(id);
    if (element && 'expand' in element) {
      (element as HUDAccordion).expand();
      this.userPrefs.collapsed = this.userPrefs.collapsed.filter(c => c !== id);
      this.saveUserPrefs();
    }
  }

  /**
   * Collapse all accordions
   */
  public collapseAll(): void {
    for (const [id, element] of this.elements) {
      if ('collapse' in element) {
        (element as HUDAccordion).collapse();
        if (!this.userPrefs.collapsed.includes(id)) {
          this.userPrefs.collapsed.push(id);
        }
      }
    }
    this.saveUserPrefs();
  }

  // ============================================================================
  // Theme API
  // ============================================================================

  /**
   * Set the current theme
   */
  public setTheme(themeName: string): void {
    if (!this.config?.themes?.[themeName]) {
      console.warn(`[HUD] Theme '${themeName}' not found`);
      return;
    }

    const theme = this.config.themes[themeName];
    this.currentTheme = themeName;

    // Apply theme as CSS variables
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme)) {
      root.style.setProperty(`--hud-${key}`, value);
    }

    // Save preference
    this.userPrefs.theme = themeName;
    this.saveUserPrefs();

    console.log(`[HUD] Theme set to '${themeName}'`);
  }

  /**
   * Get current theme name
   */
  public getTheme(): string {
    return this.currentTheme;
  }

  // ============================================================================
  // Layout API
  // ============================================================================

  /**
   * Move an element to a different area
   */
  public moveTo(id: string, position: HUDPosition): void {
    const element = this.elements.get(id);
    const area = this.areaContainers.get(position);

    if (element && area) {
      area.appendChild(element.getElement());
    }
  }

  // ============================================================================
  // Debug API
  // ============================================================================

  /**
   * Get debug info
   */
  public getDebugInfo(): string {
    const lines = [
      `HUD System`,
      `──────────────────`,
      `Elements: ${this.elements.size}`,
      `Bindings: ${this.bindings.size}`,
      `List bindings: ${this.listBindings.size}`,
      `Update interval: ${this.settings.updateInterval}ms`,
      `Running: ${this.running}`,
      `Theme: ${this.currentTheme}`,
    ];
    return lines.join('\n');
  }

  /**
   * Get element count
   */
  public getElementCount(): number {
    return this.elements.size;
  }

  /**
   * Check if running
   */
  public isRunning(): boolean {
    return this.running;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Destroy the HUD system
   */
  public destroy(): void {
    this.stop();

    for (const element of this.elements.values()) {
      element.destroy();
    }
    this.elements.clear();
    this.bindings.clear();
    this.listBindings.clear();
    this.clickHandlers.clear();
    this.contentProviders.clear();
    this.lastValues.clear();

    if (this.container) {
      this.container.remove();
      this.container = null;
    }

    this.areaContainers.clear();

    console.log('[HUD] Destroyed');
  }

  /**
   * Reset to default state
   */
  public reset(): void {
    this.userPrefs = { collapsed: [], hidden: [] };
    this.saveUserPrefs();

    // Re-apply config defaults
    for (const element of this.elements.values()) {
      element.show();
    }

    console.log('[HUD] Reset to defaults');
  }
}

// Convenience export
export const HUD = HUDManager.getInstance();
