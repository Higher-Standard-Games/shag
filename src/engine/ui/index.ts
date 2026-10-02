/**
 * Engine UI System
 *
 * Data-driven UI components for game interfaces.
 * See UI_ARCHITECTURE.md for design documentation.
 */

export type {
  BottomBarCallbacks,
  InventorySlot,
} from "./BottomBar";
export { BottomBar } from "./BottomBar";
export {
  type ButtonConfig,
  type ButtonSize,
  type ButtonVariant,
  createButton,
  createButtonRow,
} from "./components/Button";
export { ConfirmDialog, type ConfirmOptions } from "./components/ConfirmDialog";
// UI Components
export { Overlay, type OverlayConfig } from "./components/Overlay";
export { LoadingAnimation, type LoadingAnimationConfig } from "./LoadingAnimation";
export { FIRE_PALETTE, ICE_PALETTE, MONO_PALETTE, type PaletteColor, SHAG_PALETTE } from "./LoadingPalettes";
// Loading screens
export { LoadingScreen } from "./LoadingScreen";
export { MapLoadingOverlay, type MapLoadingOverlayConfig, type MapLoadingView } from "./MapLoadingOverlay";
export { mapTitle, rememberMapTitle } from "./MapTitles";
export type {
  ModalAction,
  ModalCallbacks,
  ModalConfig,
} from "./ModalPanel";
export { ModalPanel } from "./ModalPanel";
export { GameDialogPanel, type GameDialogPanelOptions } from "./panels/GameDialogPanel";
export type {
  SidePanelCallbacks,
  SidePanelConfig,
  SidePanelItem,
} from "./SidePanel";
export { SidePanel } from "./SidePanel";
export { TransferLoadingView } from "./TransferLoadingView";
export type {
  BottomBarConfig,
  BuildMenuCategory,
  BuildMenuConfig,
  BuildMenuItem,
  InventoryConfig,
  UIConfigData,
} from "./UIConfig";
export { UIConfig } from "./UIConfig";
// Core UI Manager
export { UIManager, type ZIndexLayer } from "./UIManager";
export { UIStyles } from "./UIStyles";
export type { UIThemeConfig } from "./UITheme";
export { UITheme } from "./UITheme";
