# UI Scaling System

Cross-platform UI scaling system for consistent sizing across desktop and mobile.

## Overview

The `UIScale` class (`src/engine/ui/UIScale.ts`) provides:
- **Reference resolution scaling** - Design at 1920x1080, auto-scale to any viewport
- **CSS variables** - Inject scaled values for use in CSS
- **Platform detection** - Mobile, portrait, touch device detection
- **Minimum touch targets** - Enforce 44px minimum for accessibility

## UIScale Class

```typescript
interface UIScaleConfig {
  designWidth: number;      // Reference width (default: 1920)
  designHeight: number;     // Reference height (default: 1080)
  minScale: number;         // Minimum scale factor (default: 0.5)
  maxScale: number;         // Maximum scale factor (default: 2.0)
  scaleMode: 'fit' | 'fill' | 'width' | 'height';
  minTouchTarget: number;   // Minimum touch target in design pixels (default: 44)
}

class UIScale {
  private static instance: UIScale;
  private config: UIScaleConfig;
  private currentScale: number = 1;
  private listeners: Set<() => void> = new Set();
  
  // Get scaled value in actual pixels
  public px(designPixels: number): number;
  
  // Get scaled value as CSS string
  public css(designPixels: number): string;
  
  // Get current scale factor
  public getScale(): number;
  
  // Check if in mobile/portrait mode
  public isMobile(): boolean;
  public isPortrait(): boolean;
  
  // Subscribe to scale changes
  public onResize(callback: () => void): void;
  
  // Apply CSS custom properties to document
  public applyToCSSVariables(): void;
}
```

### CSS Custom Properties

The system injects CSS variables that components can use:

```css
:root {
  /* Scale factors */
  --ui-scale: 1;
  --ui-scale-x: 1;
  --ui-scale-y: 1;
  
  /* Scaled spacing */
  --ui-space-xs: 4px;   /* 4 * scale */
  --ui-space-sm: 8px;   /* 8 * scale */
  --ui-space-md: 16px;  /* 16 * scale */
  --ui-space-lg: 24px;  /* 24 * scale */
  --ui-space-xl: 32px;  /* 32 * scale */
  
  /* Scaled font sizes */
  --ui-font-xs: 12px;
  --ui-font-sm: 14px;
  --ui-font-md: 16px;
  --ui-font-lg: 20px;
  --ui-font-xl: 24px;
  --ui-font-2xl: 32px;
  
  /* Scaled touch targets */
  --ui-touch-min: 44px;
  --ui-touch-comfortable: 48px;
  
  /* Layout breakpoints */
  --ui-is-mobile: 0;      /* 1 if mobile */
  --ui-is-portrait: 0;    /* 1 if portrait */
}
```

### Component Usage

Components use CSS variables instead of hardcoded values:

```css
/* Before */
.bottom-bar-tab {
  padding: 12px 20px;
  font-size: 15px;
}

/* After */
.bottom-bar-tab {
  padding: var(--ui-space-md) var(--ui-space-lg);
  font-size: var(--ui-font-md);
  min-height: var(--ui-touch-min);
}
```

---

## Scale Modes

### `fit` (Default)
Scale to fit entirely within viewport. May have letterboxing.
```
scale = Math.min(viewportWidth / designWidth, viewportHeight / designHeight)
```

### `fill`
Scale to fill viewport. May crop edges.
```
scale = Math.max(viewportWidth / designWidth, viewportHeight / designHeight)
```

### `width`
Scale based on width only. Good for horizontal games.
```
scale = viewportWidth / designWidth
```

### `height`
Scale based on height only. Good for vertical games.
```
scale = viewportHeight / designHeight
```

---

## Mobile Considerations

### Portrait Mode
- Stack side panels vertically or hide
- Bottom bar becomes full-width
- Reduce number of visible items
- Larger touch targets

### Landscape Mode
- Similar to desktop but scaled
- Side panels on edges
- Bottom bar centered

### Safe Areas
- Respect notch/home indicator
- Use `env(safe-area-inset-*)` CSS

---

## Debug Tools

Add console commands:
```
ui scale           # Show current scale info
ui scale 1.5       # Force scale factor
ui scale auto      # Return to automatic
ui debug           # Toggle debug overlay showing safe areas
```

