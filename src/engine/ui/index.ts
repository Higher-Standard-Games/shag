/**
 * Engine UI System
 * 
 * Data-driven UI components for game interfaces.
 * See UI_ARCHITECTURE.md for design documentation.
 */

// Core UI Manager
export { UIManager, type ZIndexLayer } from "./UIManager";

// UI Components
export { Overlay, type OverlayConfig } from "./components/Overlay";
export { createButton, createButtonRow, type ButtonConfig, type ButtonVariant, type ButtonSize } from "./components/Button";
export { ConfirmDialog, type ConfirmOptions } from "./components/ConfirmDialog";

export { UIConfig } from "./UIConfig";
export type {
  BuildMenuItem,
  BuildMenuCategory,
  BuildMenuConfig,
  InventoryConfig,
  BottomBarConfig,
  UIConfigData,
} from "./UIConfig";

export { BottomBar } from "./BottomBar";
export type {
  BottomBarCallbacks,
  InventorySlot,
} from "./BottomBar";

export { SidePanel } from "./SidePanel";
export type {
  SidePanelConfig,
  SidePanelCallbacks,
  SidePanelItem,
} from "./SidePanel";

export { ModalPanel } from "./ModalPanel";
export type {
  ModalConfig,
  ModalCallbacks,
  ModalAction,
} from "./ModalPanel";

export { UITheme } from "./UITheme";
export type { UIThemeConfig } from "./UITheme";
