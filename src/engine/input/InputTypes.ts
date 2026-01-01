/**
 * InputTypes - Type definitions for the input system
 */

// ==================== Input Sources ====================

export type InputSource = "keyboard" | "mouse" | "touch" | "gamepad";

export type MouseButton = "left" | "right" | "middle";

// ==================== Action Types ====================

export type ActionType = "button" | "axis";

export interface ActionState {
  /** Currently held/active */
  active: boolean;
  /** Just pressed this frame */
  pressed: boolean;
  /** Just released this frame */
  released: boolean;
  /** For axis actions (-1 to 1) */
  value: number;
  /** For 2D axes (mouse delta, pan) */
  delta: { x: number; y: number };
}

// ==================== Bindings ====================

export interface InputBinding {
  /** Keyboard key code (e.g., "KeyW", "Space", "ArrowUp") */
  key?: string;
  /** Mouse button */
  mouseButton?: MouseButton;
  /** Touch gesture (future) */
  gesture?: string;
  /** Gamepad button (future) */
  gamepadButton?: number;
  /** Modifier keys required */
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  };
}

export interface ActionDefinition {
  /** Unique action identifier */
  id: string;
  /** Action type */
  type: ActionType;
  /** Human-readable name */
  name?: string;
  /** Description for settings UI */
  description?: string;
  /** Default bindings */
  defaultBindings: InputBinding[];
}

// ==================== Contexts ====================

export interface ContextDefinition {
  /** Unique context identifier */
  id: string;
  /** If true, blocks input to contexts below in stack */
  blocking: boolean;
  /** Actions available in this context */
  actions: string[];
  /** Custom bindings that override defaults (optional) */
  bindings?: Record<string, InputBinding[]>;
}

// ==================== Raw Input State ====================

export interface RawInputState {
  /** Currently pressed keys */
  keys: Set<string>;
  /** Keys pressed this frame */
  keysPressed: Set<string>;
  /** Keys released this frame */
  keysReleased: Set<string>;
  
  /** Mouse state */
  mouse: {
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    buttons: Set<MouseButton>;
    buttonsPressed: Set<MouseButton>;
    buttonsReleased: Set<MouseButton>;
    wheel: number;
  };
  
  /** Touch state */
  touch: {
    points: TouchPoint[];
    pointsStarted: TouchPoint[];
    pointsEnded: TouchPoint[];
  };
}

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

// ==================== Configuration ====================

export interface InputConfig {
  /** Context definitions */
  contexts?: Record<string, Partial<ContextDefinition>>;
  /** Action definitions */
  actions?: Record<string, Partial<ActionDefinition>>;
  /** Global binding overrides */
  bindings?: Record<string, InputBinding[]>;
}
