/**
 * Engine UI System
 * 
 * Data-driven UI components for game interfaces.
 */

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
