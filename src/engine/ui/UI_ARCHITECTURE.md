# UI System Architecture Specification

## Overview

This document defines the unified UI system architecture for the game engine.
All UI components should follow these patterns to ensure consistency, maintainability,
and proper layering.

---

## Directory Structure

```
src/engine/ui/
├── UI_ARCHITECTURE.md    # This spec document
├── UIManager.ts          # Central UI lifecycle, z-index registry, overlay stack
├── UITheme.ts            # Styles, colors, fonts, shared animations
├── UIConfig.ts           # Constants, breakpoints
├── components/
│   ├── Overlay.ts        # Reusable backdrop/blur overlay
│   ├── Dialog.ts         # Base dialog component (uses Overlay)
│   ├── ConfirmDialog.ts  # Reusable confirmation dialog
│   └── Button.ts         # Styled button factory
├── SidePanel.ts          # Collapsible side panels
├── ModalPanel.ts         # Centered modal (uses Overlay)
├── BottomBar.ts          # Bottom toolbar
└── index.ts              # Public exports
```

---

## Z-Index Registry

All z-index values are managed centrally to prevent conflicts.

| Layer | Z-Index | Usage |
|-------|---------|-------|
| GAME_UI | 100 | Side panels, bottom bar, HUD |
| TOOLTIP | 200 | Tooltips, hover info |
| DROPDOWN | 300 | Dropdowns, select menus |
| MODAL | 500 | Modal panels, dialogs |
| OVERLAY | 800 | Backdrop overlays |
| DIALOG | 900 | Dialogs on top of overlay |
| PAUSE_MENU | 1000 | Pause menu overlay |
| SETTINGS | 1200 | Settings panel |
| CONFIRM | 1500 | Confirmation dialogs (topmost) |
| LOADING | 2000 | Loading screen |

---

## Core Components

### 1. Overlay (`components/Overlay.ts`)

Reusable backdrop component with optional blur effect.

```typescript
interface OverlayConfig {
  id: string;
  blur?: number;           // Blur amount in px (default: 0)
  opacity?: number;        // Background opacity 0-1 (default: 0.6)
  color?: string;          // Background color (default: '#000000')
  zIndex?: number;         // Z-index (default: from UIManager)
  closeOnClick?: boolean;  // Close when clicking overlay (default: true)
  animate?: boolean;       // Fade in/out animation (default: true)
}

class Overlay {
  constructor(config: OverlayConfig, onClose?: () => void);
  show(): void;
  hide(): void;
  getElement(): HTMLDivElement;
  isVisible(): boolean;
}
```

**Usage:**
```typescript
const overlay = new Overlay({
  id: 'pause-overlay',
  blur: 8,
  opacity: 0.6,
  closeOnClick: false
});
overlay.show();
```

---

### 2. Button (`components/Button.ts`)

Factory for creating consistently styled buttons.

```typescript
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonConfig {
  text: string;
  variant?: ButtonVariant;  // default: 'secondary'
  size?: ButtonSize;        // default: 'medium'
  icon?: string;            // Optional icon HTML/emoji
  disabled?: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}

function createButton(config: ButtonConfig): HTMLButtonElement;
```

**Button Styles:**
- `primary`: Green background, white text (main actions)
- `secondary`: Transparent with border (default)
- `danger`: Red tint (destructive actions)
- `ghost`: No border, subtle hover (minimal)

---

### 3. ConfirmDialog (`components/ConfirmDialog.ts`)

Reusable confirmation dialog. Mobile-friendly (no browser `confirm()`).

```typescript
interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;     // default: 'Confirm'
  cancelText?: string;      // default: 'Cancel'
  confirmVariant?: ButtonVariant;  // default: 'danger'
  onConfirm: () => void;
  onCancel?: () => void;
}

class ConfirmDialog {
  static show(options: ConfirmOptions): void;
  static hide(): void;
}
```

**Usage:**
```typescript
ConfirmDialog.show({
  title: 'Return to Main Menu?',
  message: 'Any unsaved progress will be lost.',
  onConfirm: () => this.returnToMainMenu()
});
```

---

### 4. Dialog (`components/Dialog.ts`)

Base dialog component that uses Overlay.

```typescript
interface DialogConfig {
  id: string;
  title: string;
  width?: string;           // default: '400px'
  maxWidth?: string;        // default: '90vw'
  showClose?: boolean;      // default: true
  closeOnOverlay?: boolean; // default: true
  zIndex?: number;          // default: from UIManager
}

abstract class Dialog {
  constructor(config: DialogConfig);
  abstract renderContent(): string;
  show(): void;
  hide(): void;
  protected onShow(): void;   // Override for setup
  protected onHide(): void;   // Override for cleanup
}
```

---

## UIManager

Central manager for UI lifecycle and z-index allocation.

```typescript
class UIManager {
  static getInstance(): UIManager;
  
  // Z-index management
  getZIndex(layer: ZIndexLayer): number;
  
  // Overlay stack (for ESC key routing)
  pushOverlay(id: string, onClose: () => void): void;
  popOverlay(): void;
  getTopOverlay(): string | null;
  
  // Global UI state
  isAnyOverlayOpen(): boolean;
  closeAllOverlays(): void;
}
```

---

## UITheme Additions

Add shared animations to `UITheme.ts`:

```typescript
// Shared keyframe animations
const ANIMATIONS = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  
  @keyframes slideInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes slideInDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.05); }
  }
  
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
`;
```

---

## Migration Path

### Phase 1: Core Components
1. Create `components/Overlay.ts`
2. Create `components/Button.ts`
3. Create `components/ConfirmDialog.ts`
4. Update `UIManager.ts` with z-index registry
5. Add shared animations to `UITheme.ts`

### Phase 2: Migrate Existing Code
1. `MenuSystem.ts` → Use Overlay, Button, ConfirmDialog
2. `SettingsPanel.ts` → Use Overlay, Button
3. `ModalPanel.ts` → Use Overlay
4. `BaseDialog.ts` → Use Overlay (or extend Dialog)

### Phase 3: Cleanup
1. Remove duplicate animation definitions
2. Remove inline button styling
3. Ensure consistent z-index usage
4. Test all UI flows

---

## Design Principles

1. **Single Responsibility**: Each component does one thing well
2. **Composition over Inheritance**: Prefer composing Overlay + content over deep class hierarchies
3. **Consistent Styling**: All buttons, overlays, dialogs look unified
4. **Mobile-First**: Large touch targets, no browser dialogs
5. **Engine-Agnostic**: UI components don't depend on game logic
6. **Testable**: Components can be shown/hidden independently

---

## Color Palette (from UITheme)

```typescript
const COLORS = {
  // Backgrounds
  bgDark: '#000000',
  bgPanel: 'rgba(25, 25, 25, 0.98)',
  bgPanelLight: 'rgba(40, 40, 40, 0.98)',
  
  // Accents
  primary: '#4CAF50',        // Green
  primaryHover: '#66BB6A',
  danger: '#F44336',         // Red
  dangerHover: '#EF5350',
  
  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#666666',
  
  // Borders
  border: 'rgba(255, 255, 255, 0.1)',
  borderHover: 'rgba(255, 255, 255, 0.2)',
};
```

---

## Notes

- All UI components should be singletons or managed by UIManager
- ESC key should close the topmost overlay (managed by UIManager)
- Overlays stack on top of each other with increasing z-index
- Game should NOT pause when overlays are shown (just visual overlay)
