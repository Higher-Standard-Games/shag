# Map Loading Overlay - Design Document

**Status:** Draft
**Author:** Claude
**Date:** 2026-01-19
**Branch:** `feature/loading-screen-improvements`

## Overview

This document outlines the design for a reusable in-game loading overlay system that displays loading progress when switching maps. The system must work across multiple games with different visual styles while providing sensible defaults.

## Problem Statement

Currently, when loading a map via the `map` console command:
1. Loading progress only appears in console logs
2. Users see rendering artifacts as textures/shaders load
3. No visual feedback that loading is in progress
4. No graceful transition when loading completes

The startup `LoadingScreen` handles initial engine loading well, but is tightly coupled to:
- Engine branding/logo display
- "Tap to start" interaction (for browser audio unlock)
- One-time initialization flow

We need a separate system for in-game map transitions that:
- Hides rendering during load
- Shows progress/status messages
- Fades out gracefully when complete
- Is customizable per-game

## Requirements

### Functional Requirements

| ID | Requirement |
|----|-------------|
| F1 | Display opaque overlay that hides rendering during map load |
| F2 | Show loading status messages (console-style, text only) |
| F3 | Display animated background (smoke effect) |
| F4 | Fade out automatically when loading completes (no user interaction) |
| F5 | Support both success and error states |
| F6 | Work in headless mode (no-op) |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF1 | Customizable appearance per-game (colors, logo, fonts) |
| NF2 | Default styling matches engine LoadingScreen |
| NF3 | Minimum display time to prevent flash on fast loads |
| NF4 | No memory leaks (proper cleanup) |
| NF5 | Decoupled from MapLoader implementation |
| NF6 | Games can fully replace with custom implementation |

## Architecture Decision: EventBus vs Direct API

### Option A: Direct API

```typescript
// In MapCommand.ts
MapLoadingOverlay.show(mapName);
const result = await mapLoader.loadMap(mapName, scene, (progress) => {
  MapLoadingOverlay.setProgress(progress);
});
MapLoadingOverlay.complete(result.success);
```

**Pros:**
- Simple, explicit control flow
- Easy to understand
- No event subscription management

**Cons:**
- Couples MapCommand to MapLoadingOverlay
- Games wanting custom UI must modify MapCommand or disable+replace
- Single consumer only
- Not reusable for other loading scenarios (asset packs, save games, etc.)

### Option B: EventBus (Recommended)

```typescript
// MapLoader emits events (doesn't know about UI)
EventBus.emit('loading:start', { type: 'map', id: mapName });
EventBus.emit('loading:progress', { type: 'map', phase: 'shaders', detail: 'Loading 23/47', percent: 49 });
EventBus.emit('loading:complete', { type: 'map', success: true });

// MapLoadingOverlay subscribes (opt-in, can be disabled)
// Games can subscribe their own UI instead
```

**Pros:**
- Complete decoupling - MapLoader doesn't know about UI
- Games can easily substitute their own loading UI
- Multiple consumers possible (UI + logging + analytics)
- Reusable for any loading scenario (maps, assets, saves, network)
- Follows engine's existing EventBus patterns
- MapLoader becomes pure data/loading, UI is just one consumer

**Cons:**
- Slightly more complex setup
- Event naming conventions needed
- Must handle subscription lifecycle

### Decision: Option B (EventBus)

For a multi-game engine, decoupling is essential. The EventBus approach:
1. Lets games completely ignore default overlay and build their own
2. Makes loading events useful beyond UI (debugging, telemetry)
3. Follows separation of concerns
4. Scales to other loading scenarios

## Event Design

### Event Names

Use hierarchical naming with `loading:` prefix:

| Event | Payload | Description |
|-------|---------|-------------|
| `loading:start` | `{ type, id, meta? }` | Loading operation begins |
| `loading:progress` | `{ type, phase, detail?, percent? }` | Progress update |
| `loading:complete` | `{ type, success, error?, duration }` | Loading finished |

### Event Payload Types

```typescript
// Loading types - extensible for different scenarios
type LoadingType = 'map' | 'assets' | 'save' | 'network' | 'generic' | string;

interface LoadingStartEvent {
  type: LoadingType;
  id: string;           // e.g., map name, save slot, or custom identifier
  meta?: {
    displayName?: string;  // Human-readable name for UI
    [key: string]: any;    // Game-specific metadata
  };
}

interface LoadingProgressEvent {
  type: LoadingType;
  phase: string;        // e.g., 'parsing', 'shaders', 'textures', 'entities'
  detail?: string;      // e.g., 'Loading texture 23/47'
  percent?: number;     // 0-100, optional
}

interface LoadingCompleteEvent {
  type: LoadingType;
  success: boolean;
  error?: string;
  duration: number;     // ms
}
```

**Note:** The `type` field uses a union with `| string` to allow games to define custom loading types beyond the predefined ones. The `'generic'` type is provided for game-specific loading operations that don't fit other categories.

### Example Flow

```
User: map wdm7

MapLoader:
  emit('loading:start', { type: 'map', id: 'wdm7' })
  emit('loading:progress', { type: 'map', phase: 'parsing', detail: 'Reading BSP...' })
  emit('loading:progress', { type: 'map', phase: 'shaders', detail: 'Compiling 47 shaders', percent: 0 })
  emit('loading:progress', { type: 'map', phase: 'shaders', detail: 'Compiling shaders', percent: 50 })
  emit('loading:progress', { type: 'map', phase: 'textures', detail: 'Loading textures', percent: 75 })
  emit('loading:progress', { type: 'map', phase: 'entities', detail: 'Spawning entities' })
  emit('loading:complete', { type: 'map', success: true, duration: 2340 })

MapLoadingOverlay (listening):
  on 'loading:start' where type='map' → show overlay
  on 'loading:progress' where type='map' → update display
  on 'loading:complete' where type='map' → trigger fade-out
```

## MapLoadingOverlay Design

### Class Structure

```typescript
class MapLoadingOverlay {
  private static instance: MapLoadingOverlay;

  // State
  private state: 'idle' | 'showing' | 'loading' | 'completing' | 'fading';
  private showTime: number;  // When overlay was shown (for min display time)

  // Config
  private config: MapLoadingOverlayConfig;

  // DOM
  private container: HTMLDivElement | null;
  private messageArea: HTMLDivElement | null;
  private logoElement: HTMLImageElement | null;
  private brandingElement: HTMLDivElement | null;

  // Animation
  private smokeAnimation: LoadingAnimation | null;

  // EventBus subscriptions
  private unsubscribers: (() => void)[];

  // Public API
  static getInstance(): MapLoadingOverlay;
  static configure(config: Partial<MapLoadingOverlayConfig>): void;
  static preload(): Promise<void>;  // Preload assets (logo, custom CSS)
  static enable(): void;   // Subscribe to events
  static disable(): void;  // Unsubscribe (for games using custom UI)

  // Lifecycle
  dispose(): void;
}
```

### Configuration

```typescript
interface MapLoadingOverlayConfig {
  // Timing
  minDisplayMs: number;      // Min time before fade can start (default: 800)
  completeHoldMs: number;    // Hold after complete before fade (default: 500)
  fadeDurationMs: number;    // Fade animation duration (default: 500)

  // Appearance
  showLogo: boolean;         // Show engine/game logo (default: true)
  logoUrl: string | null;    // Custom logo URL (default: engine logo)
  showMessages: boolean;     // Show console-style messages (default: true)
  messageCount: number;      // Max visible messages (default: 6)
  showBranding: boolean;     // Show engine branding (default: true)

  // Animation
  animationEnabled: boolean; // Show smoke animation (default: true)
  animationColors: Array<{ bg: string; glow: string }> | null;  // Custom palette

  // Filtering
  loadingTypes: string[];    // Which loading types to show for (default: ['map'])
}
```

### State Machine

```
                    enable()
                       │
                       ▼
┌───────┐  loading:start  ┌─────────┐  animation done  ┌─────────┐
│ IDLE  │────────────────▶│ SHOWING │─────────────────▶│ LOADING │
└───────┘                 └─────────┘                  └─────────┘
    ▲                                                       │
    │                                                 loading:complete
    │                                                       ▼
    │                  ┌─────────┐  fade done    ┌────────────┐
    └──────────────────│ FADING  │◀──────────────│ COMPLETING │
                       └─────────┘   (after min   └────────────┘
                                      display)
```

**State Descriptions:**

| State | Description | Accepts Events |
|-------|-------------|----------------|
| IDLE | Not visible, waiting for loading:start | loading:start |
| SHOWING | Fade-in animation playing | loading:progress |
| LOADING | Visible, updating with progress | loading:progress, loading:complete |
| COMPLETING | Complete received, waiting for min display time | - |
| FADING | Fade-out animation playing | - |

### Minimum Display Time Logic

```typescript
onLoadingComplete(event: LoadingCompleteEvent) {
  const elapsed = Date.now() - this.showTime;
  const remaining = this.config.minDisplayMs - elapsed;

  if (remaining > 0) {
    // Wait for minimum display time
    setTimeout(() => this.startFadeOut(), remaining);
  } else {
    // Already displayed long enough, hold briefly then fade
    setTimeout(() => this.startFadeOut(), this.config.completeHoldMs);
  }
}
```

## Customization Layers

Games can customize at multiple levels:

### Level 1: CSS Variables (Simplest)

Override in game stylesheet:

```css
:root {
  --map-loading-bg: #1a0a0a;
  --map-loading-accent: #ff4444;
  --map-loading-text: #ffcccc;
}
```

### Level 2: Configuration API

```typescript
// In game init
MapLoadingOverlay.configure({
  logoUrl: 'games/mygame/ui/loading-logo.png',
  showBranding: false,
  messageCount: 8,
});
```

### Level 3: Auto-Load Game CSS

Engine checks for and loads:
```
public/games/{game}/ui/map-loading.css
```

Loaded during `MapLoadingOverlay.preload()`.

### Level 4: Full Replacement

```typescript
// Disable default overlay
MapLoadingOverlay.disable();

// Game listens to same events with custom UI
EventBus.on('loading:start', (e) => {
  if (e.type === 'map') MyCustomLoader.show(e.id);
});
EventBus.on('loading:progress', (e) => {
  if (e.type === 'map') MyCustomLoader.update(e);
});
EventBus.on('loading:complete', (e) => {
  if (e.type === 'map') MyCustomLoader.complete(e.success);
});
```

## CSS Variables Reference

```css
:root {
  /* Background */
  --map-loading-bg: #000000;
  --map-loading-bg-image: none;

  /* Logo */
  --map-loading-logo-size: 200px;
  --map-loading-logo-margin: 32px;

  /* Messages */
  --map-loading-font: 'Share Tech Mono', 'Consolas', monospace;
  --map-loading-text-color: rgba(255, 255, 255, 0.4);
  --map-loading-text-size: 11px;
  --map-loading-message-gap: 4px;

  /* Branding */
  --map-loading-branding-color: rgba(255, 255, 255, 0.3);
  --map-loading-branding-size: 11px;

  /* Smoke Animation (colors set via config, but blur/size tweakable) */
  --map-loading-smoke-blur: 40px;
  --map-loading-smoke-min-size: 40px;
  --map-loading-smoke-max-size: 250px;

  /* Transitions */
  --map-loading-fade-in-duration: 200ms;
  --map-loading-fade-out-duration: 500ms;
}
```

## Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│        ~  *       (animated smoke puffs)      ~             │
│              ~            *                                 │
│                      ┌─────────┐       ~                    │
│          *           │  LOGO   │                            │
│                      └─────────┘    *                       │
│                 ~                                           │
│                                                             │
│    *                      ~                                 │
│                                                             │
│  loading map wdm7...                                        │
│  parsing bsp geometry...                                    │
│  compiling shaders (31/47)...                               │
│  loading textures...                                        │
│                                                             │
│                                           SHAG Engine v0.8  │
└─────────────────────────────────────────────────────────────┘
```

- **Background:** Opaque black with animated smoke puffs (colored, rising)
- **Logo:** Centered, upper area
- **Messages:** Bottom-left, console style (monospace, lowercase), newest at bottom
- **Branding:** Bottom-right (can be hidden via config)
- **No progress bar:** Text messages provide sufficient feedback

## Integration Points

### MapLoader Changes

Add event emissions to `MapLoader.loadMap()`:

```typescript
async loadMap(mapName: string, scene: Scene): Promise<LoadResult> {
  const startTime = Date.now();

  EventBus.emit('loading:start', { type: 'map', id: mapName });

  try {
    // Parse BSP
    EventBus.emit('loading:progress', {
      type: 'map',
      phase: 'parsing',
      detail: 'Reading BSP data...'
    });
    const bsp = await this.parseBsp(mapName);

    // Load shaders
    EventBus.emit('loading:progress', {
      type: 'map',
      phase: 'shaders',
      detail: `Compiling ${shaderCount} shaders...`,
      percent: 25
    });
    await this.loadShaders(bsp);

    // ... more phases ...

    EventBus.emit('loading:complete', {
      type: 'map',
      success: true,
      duration: Date.now() - startTime
    });

    return { success: true };

  } catch (error) {
    EventBus.emit('loading:complete', {
      type: 'map',
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    });

    return { success: false, error: error.message };
  }
}
```

### Initialization

```typescript
// In main.ts or game init
import { MapLoadingOverlay } from './engine/ui/MapLoadingOverlay';

// Preload assets (optional, for custom logo)
await MapLoadingOverlay.preload();

// Enable (subscribes to EventBus)
MapLoadingOverlay.enable();

// Optional: Configure
MapLoadingOverlay.configure({
  logoUrl: 'games/default/ui/loading-logo.png',
});
```

## Edge Cases

### 1. Fast Loads (< 500ms)
- Overlay still shows for minimum display time
- User sees: appear → complete → brief hold → fade
- Total ~1.3 seconds minimum

### 2. Multiple Rapid Map Commands
- If `loading:start` received while already showing:
  - Reset messages
  - Update map name
  - Reset show time (for min display calculation)
  - Stay visible (no flicker)

### 3. Load Failure
- Show error message in message area
- Still fade out after delay
- Message styled differently (error color)

### 4. Console Opened During Load
- Overlay has z-index below console
- Console renders on top
- Loading continues in background

### 5. Headless/CLI Mode
- Check `typeof document === 'undefined'`
- All methods become no-ops
- Events still emitted (useful for CLI progress logging)

### 6. Game Wants No Overlay
- Call `MapLoadingOverlay.disable()` during init
- Events still emitted for game's custom UI

## File Structure

```
src/engine/ui/
├── LoadingScreen.ts        # Startup screen (refactor to use LoadingAnimation)
├── MapLoadingOverlay.ts    # New: in-game loading overlay
├── LoadingAnimation.ts     # New: shared smoke animation component
├── LoadingPalettes.ts      # New: color palette definitions
└── UIStyles.ts             # Add map loading CSS (smoke animation already exists)

src/engine/loader/map/
└── MapLoader.ts            # Add EventBus emissions

public/engine/
└── (engine assets)

public/games/{game}/ui/
└── map-loading.css         # Optional: game CSS overrides
```

## Testing

### Headless Tests

```bash
# Test events are emitted
npm run cli:game -- --command "map wdm7; quit"
# Should see loading:start, loading:progress, loading:complete in logs

# Test fast load handling
npm run cli:game -- --command "map wdm1; map wdm2; quit"
# Verify no crashes with rapid loads
```

### Manual Tests

1. Load map, verify overlay appears
2. Verify messages scroll as loading progresses
3. Verify fade-out after complete
4. Test with console open (should render on top)
5. Test rapid map switches
6. Test with custom CSS variables
7. Test disable + custom UI replacement

## Future Considerations

### Potential Extensions

1. **Save/Load overlay:** Same system, different `type`
2. **Network loading:** Downloading assets from server
3. **Background loading:** Non-blocking, shows subtle indicator
4. **Loading tips:** Rotate game tips during load
5. **Animated backgrounds:** Per-game animated loading screens

### Breaking Changes to Avoid

- Don't change event payload structure without versioning
- Keep CSS variable names stable
- Maintain backwards compatibility in configure() options

## Design Decisions

### 1. Loading Tips
**Decision:** Leave out for now. Keep it simple - games can customize if needed.

### 2. Progress Display
**Decision:** Text-based status messages only (like initial loading screen). No percentage bar.
- Simpler, cleaner look
- Matches startup screen style
- `loading:complete` event signals 100% done
- Games can add percentage display via customization if desired

### 3. Animated Background
**Decision:** Yes! Reuse the smoke/puff animation from startup screen.
- Provides visual interest during loading
- Games can use this artistically
- Requires refactoring animation code to be shared

## Shared Animation System

The startup `LoadingScreen` has a colored smoke puff animation that should be reusable. To avoid code duplication, we'll extract this into a shared component.

### Current Animation (in LoadingScreen)

```typescript
// Smoke effect - colored puffs rising and fading
const LOGO_PALETTE = [
  { bg: '#E85D04', glow: 'rgba(232, 93, 4, 0.6)' },   // Orange
  { bg: '#FAC748', glow: 'rgba(250, 199, 72, 0.6)' }, // Yellow
  { bg: '#2EC4B6', glow: 'rgba(46, 196, 182, 0.6)' }, // Teal
  { bg: '#E040FB', glow: 'rgba(224, 64, 251, 0.6)' }, // Magenta
  { bg: '#4ADE80', glow: 'rgba(74, 222, 128, 0.6)' }, // Green
];
```

### Proposed: LoadingAnimation Component

Extract into a reusable class:

```typescript
// src/engine/ui/LoadingAnimation.ts

interface LoadingAnimationConfig {
  colors: Array<{ bg: string; glow: string }>;
  puffCount: number;       // default: 30
  minSize: number;         // default: 40
  maxSize: number;         // default: 250
  minDuration: number;     // default: 8s
  maxDuration: number;     // default: 25s
}

class LoadingAnimation {
  private container: HTMLDivElement | null = null;

  /**
   * Create and attach smoke animation to a parent element
   */
  create(parent: HTMLElement, config?: Partial<LoadingAnimationConfig>): void;

  /**
   * Start the animation (if paused)
   */
  play(): void;

  /**
   * Pause the animation
   */
  pause(): void;

  /**
   * Remove and cleanup
   */
  destroy(): void;
}
```

### Default Color Palettes

```typescript
// Engine default (SHAG logo colors)
export const SHAG_PALETTE = [
  { bg: '#E85D04', glow: 'rgba(232, 93, 4, 0.6)' },
  { bg: '#FAC748', glow: 'rgba(250, 199, 72, 0.6)' },
  { bg: '#2EC4B6', glow: 'rgba(46, 196, 182, 0.6)' },
  { bg: '#E040FB', glow: 'rgba(224, 64, 251, 0.6)' },
  { bg: '#4ADE80', glow: 'rgba(74, 222, 128, 0.6)' },
];

// Games can define their own
export const FIRE_PALETTE = [
  { bg: '#ff4400', glow: 'rgba(255, 68, 0, 0.6)' },
  { bg: '#ff6600', glow: 'rgba(255, 102, 0, 0.6)' },
  { bg: '#ff8800', glow: 'rgba(255, 136, 0, 0.6)' },
  { bg: '#ffaa00', glow: 'rgba(255, 170, 0, 0.6)' },
];
```

### Usage in Both Screens

```typescript
// LoadingScreen.ts (startup)
private smokeAnimation: LoadingAnimation | null = null;

waitForReady(): Promise<void> {
  // ... existing code ...

  this.smokeAnimation = new LoadingAnimation();
  this.smokeAnimation.create(this.container, {
    colors: SHAG_PALETTE,
    puffCount: 30,
  });
}

// MapLoadingOverlay.ts (in-game)
private smokeAnimation: LoadingAnimation | null = null;

show(): void {
  // ... create container ...

  this.smokeAnimation = new LoadingAnimation();
  this.smokeAnimation.create(this.container, {
    colors: this.config.animationColors ?? SHAG_PALETTE,
  });
}
```

### CSS for Animation (shared)

Move smoke animation CSS from `getLoadingScreen()` to a shared location:

```css
/* In UIStyles - shared animation styles */
.ui-loading-smoke-container { /* ... */ }
.ui-loading-smoke-puff { /* ... */ }
@keyframes ui-smoke-rise { /* ... */ }
```

### Configuration for Games

Games can customize the animation:

```typescript
MapLoadingOverlay.configure({
  animationColors: [
    { bg: '#ff0000', glow: 'rgba(255, 0, 0, 0.6)' },
    { bg: '#cc0000', glow: 'rgba(204, 0, 0, 0.6)' },
  ],
  animationEnabled: true,  // can disable entirely
});
```

Or via CSS variables for simple color tweaks:

```css
:root {
  --map-loading-smoke-color-1: #ff4400;
  --map-loading-smoke-color-2: #ff6600;
  /* etc */
}
```

## Conclusion

The EventBus-based approach provides clean separation between loading logic (MapLoader) and presentation (MapLoadingOverlay), while allowing games to fully customize or replace the UI. The layered customization system (CSS variables → config → full replacement) supports both simple theming and complex custom implementations.

---

## Appendix: Implementation Checklist

### Phase 1: Shared Animation System
- [ ] Create `LoadingAnimation.ts` - extract smoke animation from LoadingScreen
- [ ] Create `LoadingPalettes.ts` - color palette definitions (SHAG_PALETTE, etc.)
- [ ] Refactor `LoadingScreen.ts` to use LoadingAnimation component
- [ ] Verify startup screen still works:
  - [ ] `npm run build` passes
  - [ ] Browser: loading screen appears on startup
  - [ ] Browser: smoke animation plays
  - [ ] Browser: tap dismisses and fades out correctly

### Phase 2: EventBus Integration
- [ ] Define TypeScript interfaces for loading events
- [ ] Add event emissions to MapLoader
- [ ] Test events are emitted in headless mode

### Phase 3: MapLoadingOverlay
- [ ] Create `MapLoadingOverlay.ts` class
- [ ] Implement state machine (idle → showing → loading → completing → fading)
- [ ] Add smoke animation using LoadingAnimation
- [ ] Add message display area
- [ ] Add logo display
- [ ] Add engine branding
- [ ] Implement minimum display time logic
- [ ] Implement fade-out animation
- [ ] Add configuration API
- [ ] Add enable()/disable() methods
- [ ] Handle headless mode (no-op)

### Phase 4: Customization
- [ ] Add CSS variables for theming
- [ ] Support custom logo via config
- [ ] Support custom animation colors via config
- [ ] Document all CSS variables
- [ ] Test game CSS override loading

### Phase 5: Testing & Documentation
- [ ] Test fast loads (< 500ms)
- [ ] Test error states
- [ ] Test with console open
- [ ] Test rapid map switches
- [ ] Test disable + custom UI replacement
- [ ] Update engine README
- [ ] Add usage examples to documentation
