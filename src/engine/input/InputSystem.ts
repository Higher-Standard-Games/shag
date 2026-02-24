/**
 * InputSystem - Central input management for the engine
 * 
 * Provides unified input handling with:
 * - Context stacking (gameplay, menu, dialog, etc.)
 * - Action-based input (query "interact" not "KeyE")
 * - Configurable bindings (keyboard, mouse, touch, gamepad)
 * - Frame-based state (wasPressed, wasReleased, isActive)
 * 
 * @example
 * ```typescript
 * const input = InputSystem.getInstance();
 * 
 * // Query actions
 * if (input.wasPressed("interact")) { ... }
 * if (input.isActive("move_forward")) { ... }
 * 
 * // Context management
 * input.pushContext("menu");
 * input.popContext();
 * ```
 */

import { Scene } from "@babylonjs/core/scene";
import { EventBus } from "../core/EventBus";
import {
  ActionDefinition,
  ActionState,
  ContextDefinition,
  InputBinding,
  InputConfig,
  MouseButton,
  RawInputState,
  TouchPoint,
} from "./InputTypes";

// ==================== Default Engine Actions ====================

const DEFAULT_ACTIONS: ActionDefinition[] = [
  // Camera actions
  { id: "camera_pan", type: "button", name: "Camera Pan", defaultBindings: [{ mouseButton: "left" }] },
  { id: "camera_zoom_in", type: "button", name: "Zoom In", defaultBindings: [{ key: "Equal" }] },
  { id: "camera_zoom_out", type: "button", name: "Zoom Out", defaultBindings: [{ key: "Minus" }] },

  // Movement actions
  { id: "move_forward", type: "button", name: "Move Forward", defaultBindings: [{ key: "KeyW" }, { key: "ArrowUp" }] },
  { id: "move_back", type: "button", name: "Move Back", defaultBindings: [{ key: "KeyS" }, { key: "ArrowDown" }] },
  { id: "move_left", type: "button", name: "Move Left", defaultBindings: [{ key: "KeyA" }, { key: "ArrowLeft" }] },
  { id: "move_right", type: "button", name: "Move Right", defaultBindings: [{ key: "KeyD" }, { key: "ArrowRight" }] },
  { id: "move_up", type: "button", name: "Move Up", defaultBindings: [{ key: "Space" }] },
  { id: "move_down", type: "button", name: "Move Down", defaultBindings: [{ key: "ShiftLeft" }] },

  // Rotation actions (for FPS-style)
  { id: "rotate_left", type: "button", name: "Rotate Left", defaultBindings: [{ key: "KeyQ" }] },
  { id: "rotate_right", type: "button", name: "Rotate Right", defaultBindings: [{ key: "KeyE" }] },

  // Common game actions
  { id: "interact", type: "button", name: "Interact", defaultBindings: [{ key: "KeyE" }, { mouseButton: "left" }] },
  { id: "cancel", type: "button", name: "Cancel", defaultBindings: [{ key: "Escape" }] },
  { id: "confirm", type: "button", name: "Confirm", defaultBindings: [{ key: "Enter" }, { key: "Space" }] },

  // UI actions
  { id: "menu_up", type: "button", name: "Menu Up", defaultBindings: [{ key: "ArrowUp" }, { key: "KeyW" }] },
  { id: "menu_down", type: "button", name: "Menu Down", defaultBindings: [{ key: "ArrowDown" }, { key: "KeyS" }] },
  { id: "menu_left", type: "button", name: "Menu Left", defaultBindings: [{ key: "ArrowLeft" }, { key: "KeyA" }] },
  { id: "menu_right", type: "button", name: "Menu Right", defaultBindings: [{ key: "ArrowRight" }, { key: "KeyD" }] },
];

// ==================== Default Contexts ====================

const DEFAULT_CONTEXTS: ContextDefinition[] = [
  {
    id: "gameplay",
    blocking: false,
    actions: [
      "camera_pan", "camera_zoom_in", "camera_zoom_out",
      "move_forward", "move_back", "move_left", "move_right", "move_up", "move_down",
      "rotate_left", "rotate_right",
      "interact", "cancel",
    ],
  },
  {
    id: "menu",
    blocking: true,
    actions: ["menu_up", "menu_down", "menu_left", "menu_right", "confirm", "cancel"],
  },
  {
    id: "dialog",
    blocking: true,
    actions: ["confirm", "cancel"],
  },
];

// ==================== InputSystem Class ====================

export class InputSystem {
  private static instance: InputSystem;

  // Scene reference (stored for future gesture/raycast support)
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // Definitions
  private actions: Map<string, ActionDefinition> = new Map();
  private contexts: Map<string, ContextDefinition> = new Map();

  // Runtime state
  private contextStack: string[] = ["gameplay"];
  private actionStates: Map<string, ActionState> = new Map();
  private rawState: RawInputState;

  // Binding overrides (from game config)
  private bindingOverrides: Map<string, InputBinding[]> = new Map();

  // Event listeners (for cleanup)
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundContextMenu: (e: Event) => void;

  private constructor() {
    // Initialize raw state
    this.rawState = this.createEmptyRawState();

    // Bind event handlers
    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundKeyUp = this.onKeyUp.bind(this);
    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundWheel = this.onWheel.bind(this);
    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);
    this.boundContextMenu = (e: Event) => e.preventDefault();

    // Register default actions and contexts
    this.registerDefaults();
  }

  static getInstance(): InputSystem {
    if (!InputSystem.instance) {
      InputSystem.instance = new InputSystem();
    }
    return InputSystem.instance;
  }

  // ==================== Initialization ====================

  private _initialized = false;

  /**
   * Initialize the input system with a scene and canvas.
   * Idempotent — safe to call multiple times.
   */
  init(scene: Scene, canvas: HTMLCanvasElement): void {
    if (this._initialized) return;
    this._initialized = true;

    this.scene = scene;
    this.canvas = canvas;

    // Add event listeners
    document.addEventListener("keydown", this.boundKeyDown);
    document.addEventListener("keyup", this.boundKeyUp);
    canvas.addEventListener("mousedown", this.boundMouseDown);
    canvas.addEventListener("mouseup", this.boundMouseUp);
    canvas.addEventListener("mousemove", this.boundMouseMove);
    canvas.addEventListener("wheel", this.boundWheel);
    canvas.addEventListener("touchstart", this.boundTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.boundTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.boundTouchEnd);
    canvas.addEventListener("contextmenu", this.boundContextMenu);

    // Update action states BEFORE render (so controllers can query them)
    scene.onBeforeRenderObservable.add(() => this.updateActionStates());

    // Clear per-frame state AFTER render
    scene.onAfterRenderObservable.add(() => this.clearPerFrameState());

    console.log("[InputSystem] Initialized");
  }

  /**
   * Load configuration from game config
   */
  loadConfig(config: InputConfig): void {
    // Register custom actions
    if (config.actions) {
      for (const [id, partial] of Object.entries(config.actions)) {
        const existing = this.actions.get(id);
        if (existing) {
          // Merge with existing
          this.actions.set(id, { ...existing, ...partial, id });
        } else {
          // Create new action
          this.registerAction({
            id,
            type: partial.type || "button",
            name: partial.name,
            description: partial.description,
            defaultBindings: partial.defaultBindings || [],
          });
        }
      }
    }

    // Register custom contexts
    if (config.contexts) {
      for (const [id, partial] of Object.entries(config.contexts)) {
        const existing = this.contexts.get(id);
        if (existing) {
          this.contexts.set(id, { ...existing, ...partial, id } as ContextDefinition);
        } else {
          this.registerContext({
            id,
            blocking: partial.blocking ?? false,
            actions: partial.actions || [],
            bindings: partial.bindings,
          });
        }
      }
    }

    // Apply binding overrides
    if (config.bindings) {
      for (const [actionId, bindings] of Object.entries(config.bindings)) {
        this.bindingOverrides.set(actionId, bindings);
      }
    }

    console.log("[InputSystem] Loaded config");
  }

  // ==================== Action Registration ====================

  /**
   * Register a new action
   */
  registerAction(action: ActionDefinition): void {
    this.actions.set(action.id, action);
    this.actionStates.set(action.id, this.createEmptyActionState());
  }

  /**
   * Register a new context
   */
  registerContext(context: ContextDefinition): void {
    this.contexts.set(context.id, context);
  }

  // ==================== Context Management ====================

  /**
   * Push a context onto the stack
   */
  pushContext(contextId: string): void {
    if (!this.contexts.has(contextId)) {
      console.warn(`[InputSystem] Unknown context: ${contextId}`);
      return;
    }
    this.contextStack.push(contextId);
    EventBus.emit("input:context_changed", { context: contextId, action: "push" });
  }

  /**
   * Pop the top context from the stack
   */
  popContext(): string | undefined {
    if (this.contextStack.length <= 1) {
      console.warn("[InputSystem] Cannot pop last context");
      return undefined;
    }
    const popped = this.contextStack.pop();
    EventBus.emit("input:context_changed", {
      context: this.getActiveContext(),
      action: "pop",
      previous: popped,
    });
    return popped;
  }

  /**
   * Get the active (topmost) context
   */
  getActiveContext(): string {
    return this.contextStack[this.contextStack.length - 1];
  }

  /**
   * Check if a context is active (on the stack)
   */
  isContextActive(contextId: string): boolean {
    return this.contextStack.includes(contextId);
  }

  /**
   * Replace the entire context stack
   */
  setContext(contextId: string): void {
    this.contextStack = [contextId];
    EventBus.emit("input:context_changed", { context: contextId, action: "set" });
  }

  // ==================== Action Queries ====================

  /**
   * Check if an action is currently active (held)
   */
  isActive(actionId: string): boolean {
    return this.actionStates.get(actionId)?.active ?? false;
  }

  /**
   * Check if an action was just pressed this frame
   */
  wasPressed(actionId: string): boolean {
    return this.actionStates.get(actionId)?.pressed ?? false;
  }

  /**
   * Check if an action was just released this frame
   */
  wasReleased(actionId: string): boolean {
    return this.actionStates.get(actionId)?.released ?? false;
  }

  /**
   * Get axis value for an action (-1 to 1)
   */
  getAxisValue(actionId: string): number {
    return this.actionStates.get(actionId)?.value ?? 0;
  }

  /**
   * Get delta for 2D actions (mouse movement, pan)
   */
  getDelta(actionId: string): { x: number; y: number } {
    return this.actionStates.get(actionId)?.delta ?? { x: 0, y: 0 };
  }

  // ==================== Raw State Access ====================

  /**
   * Get raw keyboard state (for advanced use)
   */
  isKeyDown(key: string): boolean {
    return this.rawState.keys.has(key);
  }

  /**
   * Get raw mouse position
   */
  getMousePosition(): { x: number; y: number } {
    return { x: this.rawState.mouse.x, y: this.rawState.mouse.y };
  }

  /**
   * Get raw mouse delta this frame
   */
  getMouseDelta(): { x: number; y: number } {
    return { x: this.rawState.mouse.deltaX, y: this.rawState.mouse.deltaY };
  }

  /**
   * Get touch points
   */
  getTouchPoints(): TouchPoint[] {
    return [...this.rawState.touch.points];
  }

  // ==================== Private Methods ====================

  private registerDefaults(): void {
    for (const action of DEFAULT_ACTIONS) {
      this.registerAction(action);
    }
    for (const context of DEFAULT_CONTEXTS) {
      this.registerContext(context);
    }
  }

  private createEmptyRawState(): RawInputState {
    return {
      keys: new Set(),
      keysPressed: new Set(),
      keysReleased: new Set(),
      mouse: {
        x: 0, y: 0, deltaX: 0, deltaY: 0,
        buttons: new Set(),
        buttonsPressed: new Set(),
        buttonsReleased: new Set(),
        wheel: 0,
      },
      touch: {
        points: [],
        pointsStarted: [],
        pointsEnded: [],
      },
    };
  }

  private createEmptyActionState(): ActionState {
    return {
      active: false,
      pressed: false,
      released: false,
      value: 0,
      delta: { x: 0, y: 0 },
    };
  }

  /**
   * Clear per-frame state after all systems have had a chance to query
   */
  private clearPerFrameState(): void {
    // Clear raw per-frame state
    this.rawState.keysPressed.clear();
    this.rawState.keysReleased.clear();
    this.rawState.mouse.buttonsPressed.clear();
    this.rawState.mouse.buttonsReleased.clear();
    this.rawState.mouse.deltaX = 0;
    this.rawState.mouse.deltaY = 0;
    this.rawState.mouse.wheel = 0;
    this.rawState.touch.pointsStarted = [];
    this.rawState.touch.pointsEnded = [];

    // Clear pressed/released on action states (keep active)
    for (const state of this.actionStates.values()) {
      state.pressed = false;
      state.released = false;
      state.delta = { x: 0, y: 0 };
    }
  }

  private updateActionStates(): void {
    const activeContext = this.contexts.get(this.getActiveContext());
    if (!activeContext) return;

    // Check each action in the active context
    for (const actionId of activeContext.actions) {
      const action = this.actions.get(actionId);
      const state = this.actionStates.get(actionId);
      if (!action || !state) continue;

      // Get bindings (overrides take priority)
      const bindings = this.bindingOverrides.get(actionId)
        || activeContext.bindings?.[actionId]
        || action.defaultBindings;

      // Check if any binding is active
      let isActive = false;
      let wasPressed = false;
      let wasReleased = false;

      for (const binding of bindings) {
        // Check modifiers first
        if (binding.modifiers) {
          if (binding.modifiers.ctrl && !this.rawState.keys.has("ControlLeft") && !this.rawState.keys.has("ControlRight")) continue;
          if (binding.modifiers.shift && !this.rawState.keys.has("ShiftLeft") && !this.rawState.keys.has("ShiftRight")) continue;
          if (binding.modifiers.alt && !this.rawState.keys.has("AltLeft") && !this.rawState.keys.has("AltRight")) continue;
        }

        // Check keyboard
        if (binding.key) {
          if (this.rawState.keys.has(binding.key)) isActive = true;
          if (this.rawState.keysPressed.has(binding.key)) wasPressed = true;
          if (this.rawState.keysReleased.has(binding.key)) wasReleased = true;
        }

        // Check mouse button
        if (binding.mouseButton) {
          if (this.rawState.mouse.buttons.has(binding.mouseButton)) isActive = true;
          if (this.rawState.mouse.buttonsPressed.has(binding.mouseButton)) wasPressed = true;
          if (this.rawState.mouse.buttonsReleased.has(binding.mouseButton)) wasReleased = true;
        }

        // Check scroll wheel direction (impulse — fires as pressed for one frame)
        if (binding.scrollDirection) {
          const wheel = this.rawState.mouse.wheel;
          if ((binding.scrollDirection === "down" && wheel > 0) ||
            (binding.scrollDirection === "up" && wheel < 0)) {
            isActive = true;
            wasPressed = true;
          }
        }
      }

      state.active = isActive;
      state.pressed = wasPressed;
      state.released = wasReleased;

      // For pan action, also track delta
      if (actionId === "camera_pan" && isActive) {
        state.delta = { x: this.rawState.mouse.deltaX, y: this.rawState.mouse.deltaY };
      }
    }
  }

  // ==================== Event Handlers ====================

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;

    // Alt+Enter → toggle fullscreen
    if (e.altKey && e.code === 'Enter') {
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
      } else {
        document.documentElement.requestFullscreen().catch(() => { });
      }
      return;
    }

    this.rawState.keys.add(e.code);
    this.rawState.keysPressed.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.rawState.keys.delete(e.code);
    this.rawState.keysReleased.add(e.code);
  }

  private onMouseDown(e: MouseEvent): void {
    const button = this.getMouseButton(e.button);
    this.rawState.mouse.buttons.add(button);
    this.rawState.mouse.buttonsPressed.add(button);
  }

  private onMouseUp(e: MouseEvent): void {
    const button = this.getMouseButton(e.button);
    this.rawState.mouse.buttons.delete(button);
    this.rawState.mouse.buttonsReleased.add(button);
  }

  private onMouseMove(e: MouseEvent): void {
    this.rawState.mouse.deltaX += e.movementX;
    this.rawState.mouse.deltaY += e.movementY;
    this.rawState.mouse.x = e.clientX;
    this.rawState.mouse.y = e.clientY;
  }

  private onWheel(e: WheelEvent): void {
    this.rawState.mouse.wheel += e.deltaY;
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const point: TouchPoint = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        deltaX: 0,
        deltaY: 0,
      };
      this.rawState.touch.points.push(point);
      this.rawState.touch.pointsStarted.push(point);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const point = this.rawState.touch.points.find(p => p.id === touch.identifier);
      if (point) {
        point.deltaX = touch.clientX - point.x;
        point.deltaY = touch.clientY - point.y;
        point.x = touch.clientX;
        point.y = touch.clientY;
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const index = this.rawState.touch.points.findIndex(p => p.id === touch.identifier);
      if (index !== -1) {
        const point = this.rawState.touch.points.splice(index, 1)[0];
        this.rawState.touch.pointsEnded.push(point);
      }
    }
  }

  private getMouseButton(button: number): MouseButton {
    switch (button) {
      case 0: return "left";
      case 1: return "middle";
      case 2: return "right";
      default: return "left";
    }
  }

  // ==================== Binding Queries & Rebinding ====================

  /**
   * Get the scroll wheel delta this frame (positive = scroll down, negative = scroll up).
   */
  getScrollDelta(): number {
    return this.rawState.mouse.wheel;
  }

  /**
   * Get the current bindings for an action (overrides > context > defaults).
   */
  getBindingsForAction(actionId: string): InputBinding[] {
    // Check overrides first
    const overrides = this.bindingOverrides.get(actionId);
    if (overrides) return overrides;

    // Check active context bindings
    const ctx = this.contexts.get(this.getActiveContext());
    if (ctx?.bindings?.[actionId]) return ctx.bindings[actionId];

    // Fall back to action defaults
    const action = this.actions.get(actionId);
    return action?.defaultBindings ?? [];
  }

  /**
   * Rebind an action at runtime. Persists to localStorage.
   */
  rebind(actionId: string, bindings: InputBinding[]): void {
    this.bindingOverrides.set(actionId, bindings);
    this.saveBindingsToStorage();
  }

  /**
   * Reset an action to its default bindings.
   */
  resetBinding(actionId: string): void {
    this.bindingOverrides.delete(actionId);
    this.saveBindingsToStorage();
  }

  /**
   * Reset ALL bindings to defaults.
   */
  resetAllBindings(): void {
    this.bindingOverrides.clear();
    this.saveBindingsToStorage();
  }

  /**
   * Load saved binding overrides from localStorage.
   */
  loadBindingsFromStorage(): void {
    try {
      const saved = localStorage.getItem('shag_keybindings');
      if (!saved) return;
      const data = JSON.parse(saved) as Record<string, InputBinding[]>;
      for (const [actionId, bindings] of Object.entries(data)) {
        this.bindingOverrides.set(actionId, bindings);
      }
      console.log(`[InputSystem] Loaded ${Object.keys(data).length} binding overrides`);
    } catch {
      // Silently ignore corrupt data
    }
  }

  private saveBindingsToStorage(): void {
    try {
      const data: Record<string, InputBinding[]> = {};
      for (const [actionId, bindings] of this.bindingOverrides) {
        data[actionId] = bindings;
      }
      localStorage.setItem('shag_keybindings', JSON.stringify(data));
    } catch {
      // localStorage might be unavailable
    }
  }

  /**
   * Export all binding overrides as a JSON-serializable object.
   * Use for PlayerAPI sync or settings export.
   */
  exportBindings(): Record<string, InputBinding[]> {
    const data: Record<string, InputBinding[]> = {};
    for (const [actionId, bindings] of this.bindingOverrides) {
      data[actionId] = bindings;
    }
    return data;
  }

  /**
   * Import binding overrides from a JSON object (e.g. from PlayerAPI or settings import).
   * Replaces all current overrides and persists to localStorage.
   */
  importBindings(data: Record<string, InputBinding[]>): void {
    this.bindingOverrides.clear();
    for (const [actionId, bindings] of Object.entries(data)) {
      this.bindingOverrides.set(actionId, bindings);
    }
    this.saveBindingsToStorage();
    console.log(`[InputSystem] Imported ${Object.keys(data).length} binding overrides`);
  }

  // ==================== Accessors ====================

  /** Get scene reference (for future gesture/raycast support) */
  getScene(): Scene | null {
    return this.scene;
  }

  // ==================== Cleanup ====================

  dispose(): void {
    if (this.canvas) {
      document.removeEventListener("keydown", this.boundKeyDown);
      document.removeEventListener("keyup", this.boundKeyUp);
      this.canvas.removeEventListener("mousedown", this.boundMouseDown);
      this.canvas.removeEventListener("mouseup", this.boundMouseUp);
      this.canvas.removeEventListener("mousemove", this.boundMouseMove);
      this.canvas.removeEventListener("wheel", this.boundWheel);
      this.canvas.removeEventListener("touchstart", this.boundTouchStart);
      this.canvas.removeEventListener("touchmove", this.boundTouchMove);
      this.canvas.removeEventListener("touchend", this.boundTouchEnd);
      this.canvas.removeEventListener("contextmenu", this.boundContextMenu);
    }
    this.scene = null;
    this.canvas = null;
    this._initialized = false;
  }
}
