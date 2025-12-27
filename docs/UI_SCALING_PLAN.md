# UI Scaling System - Design Plan

## Current Problems

### 1. **Inconsistent Scaling**
- UI uses mix of `px`, `%`, `vw/vh`, and hardcoded values
- No unified scaling factor for different screen sizes
- Elements don't scale proportionally on mobile vs desktop

### 2. **No Reference Resolution**
- No "design resolution" to scale from
- Can't predict how UI will look on different devices
- Manual breakpoints scattered across CSS files

### 3. **Touch Target Issues**
- Some buttons too small on mobile
- Some elements too large on desktop
- No minimum touch target enforcement

### 4. **Layout Problems**
- Bottom bar can overflow on small screens
- Side panels don't adapt well to portrait mode
- HUD elements overlap on narrow screens

---

## Proposed Solution: UIScale System

### Core Concept

Design UI at a **reference resolution** (e.g., 1920x1080), then scale everything proportionally based on actual viewport size.

```typescript
// Reference design resolution
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

// Calculate scale factor
const scaleX = window.innerWidth / DESIGN_WIDTH;
const scaleY = window.innerHeight / DESIGN_HEIGHT;

// Use minimum to maintain aspect ratio, or average for balanced scaling
const scale = Math.min(scaleX, scaleY);
```

### UIScale Class

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

## Implementation Plan

### Phase 1: Core UIScale System
1. Create `UIScale.ts` with scale calculation
2. Add CSS variable injection
3. Add resize event handling
4. Add mobile/portrait detection

### Phase 2: Migrate Bottom Bar
1. Update `BottomBar.css` to use CSS variables
2. Test on multiple screen sizes
3. Add mobile-specific layout adjustments

### Phase 3: Migrate Other Components
1. Update `SidePanel.css`
2. Update `ModalPanel.css`
3. Update dialog styles
4. Update HUD elements

### Phase 4: Testing & Polish
1. Test on mobile devices (Android via Capacitor)
2. Test on various desktop resolutions
3. Add CLI commands for debugging (`ui scale`, `ui debug`)
4. Document the system

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

---

## Migration Strategy

1. **Non-breaking**: New system is opt-in via CSS variables
2. **Gradual**: Migrate components one at a time
3. **Fallback**: CSS variables have fallback values
4. **Testing**: Each component tested before moving to next

---

## Success Criteria

- [ ] UI looks consistent across 720p to 4K displays
- [ ] Touch targets are always >= 44px on mobile
- [ ] No overlapping elements on any screen size
- [ ] Smooth resize handling (no flicker)
- [ ] Works on Android via Capacitor
- [ ] Easy to use for new components
