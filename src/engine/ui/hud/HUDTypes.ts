/**
 * HUD System Type Definitions
 */

// ============================================================================
// Layout Types
// ============================================================================

export type HUDPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface HUDCustomPosition {
  anchor: HUDPosition;
  offset: { x: number | string; y: number | string };
  pivot?: { x: number; y: number };
}

// ============================================================================
// Element Types
// ============================================================================

export type HUDElementType =
  | "pill"
  | "pill-progress"
  | "pill-group"
  | "button"
  | "accordion"
  | "list"
  | "progress-bar"
  | "custom";

export interface HUDElementConfig {
  type: HUDElementType;
  icon?: string;
  format?: string;
  clickable?: boolean;
  tooltip?: string;
  platforms?: ("mobile" | "desktop")[];
  visible?: boolean;
}

export interface HUDPillConfig extends HUDElementConfig {
  type: "pill";
}

export interface HUDPillProgressConfig extends HUDElementConfig {
  type: "pill-progress";
  progressBinding?: string;
}

export interface HUDPillGroupConfig extends HUDElementConfig {
  type: "pill-group";
  children: HUDPillGroupChild[];
}

export interface HUDPillGroupChild {
  id: string;
  type?: "value" | "icon" | "button";
  format?: string;
  style?: "normal" | "bold" | "muted";
  icon?: string;
  platforms?: ("mobile" | "desktop")[];
}

export interface HUDButtonConfig extends HUDElementConfig {
  type: "button";
  variant?: "default" | "primary" | "danger";
}

export interface HUDAccordionConfig extends HUDElementConfig {
  type: "accordion";
  title: string;
  badgeBinding?: string;
  collapsed?: boolean;
  content: HUDListConfig | HUDCustomContentConfig;
}

export interface HUDListConfig {
  type: "list";
  itemTemplate: string;
  emptyText?: string;
  maxVisible?: number;
}

export interface HUDCustomContentConfig {
  type: "custom";
  contentProvider: string;
}

export interface HUDProgressBarConfig extends HUDElementConfig {
  type: "progress-bar";
  label?: string;
  color?: string;
  showValue?: boolean;
}

// ============================================================================
// Item Templates
// ============================================================================

export interface HUDItemTemplate {
  layout: "row" | "column";
  fields: string[];
  clickable?: boolean;
}

// ============================================================================
// Theme
// ============================================================================

export interface HUDTheme {
  "pill-bg": string;
  "pill-border": string;
  "pill-text": string;
  "accordion-bg": string;
  "accordion-header": string;
  "button-bg"?: string;
  "button-text"?: string;
}

// ============================================================================
// Responsive
// ============================================================================

export interface HUDResponsiveConfig {
  hideElements?: string[];
  showElements?: string[];
  moveElements?: { [id: string]: { area: HUDPosition } };
  settings?: Partial<HUDSettings>;
  layout?: Partial<HUDLayoutConfig>;
}

// ============================================================================
// Main Config
// ============================================================================

export interface HUDSettings {
  updateInterval: number;
  animateValueChanges: boolean;
  persistPreferences: boolean;
}

export interface HUDLayoutConfig {
  areas?: Partial<Record<HUDPosition, string[]>>;
  custom?: { [id: string]: HUDCustomPosition };
}

export interface HUDConfig {
  version: number;
  settings: HUDSettings;
  layout: HUDLayoutConfig;
  elements: { [id: string]: HUDElementConfig };
  itemTemplates?: { [name: string]: HUDItemTemplate };
  themes?: { [name: string]: HUDTheme };
  responsive?: {
    mobile?: HUDResponsiveConfig;
    desktop?: HUDResponsiveConfig;
    portrait?: HUDResponsiveConfig;
    landscape?: HUDResponsiveConfig;
  };
}

// ============================================================================
// User Preferences
// ============================================================================

export interface HUDUserPrefs {
  collapsed: string[];
  hidden: string[];
  theme?: string;
  customPositions?: { [id: string]: HUDCustomPosition };
}

// ============================================================================
// Runtime Types
// ============================================================================

export type HUDValueGetter = () => any;
export type HUDClickHandler = () => void;
export type HUDContentProvider = () => HTMLElement;

export interface HUDListBinding {
  data: () => any[];
  renderItem?: (item: any, index: number) => HTMLElement;
}

export interface HUDBinding {
  id: string;
  getter: HUDValueGetter;
  lastValue?: any;
}

// ============================================================================
// Animation Types
// ============================================================================

export type HUDFlashType = "gain" | "loss" | "damage" | "info";
export type HUDAnimationType =
  | "fadeIn"
  | "fadeOut"
  | "slideIn"
  | "slideOut"
  | "scaleIn"
  | "scaleOut"
  | "pulse"
  | "shake"
  | "bounce";
