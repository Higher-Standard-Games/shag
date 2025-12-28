# HUD System Design

A generic, cross-platform HUD system for game UI elements.

## Goals

1. **Declarative** - Define HUD layout in JSON, behavior in code
2. **Cross-Platform** - Scales properly on mobile, desktop, tablets
3. **Flexible** - Grid-based layout with custom positioning support
4. **Performant** - Fixed update interval, dirty checking
5. **Extensible** - Built-in components + custom renderers

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    HUD System                           │
├─────────────────────────────────────────────────────────┤
│  hud-config.json          │  Game Code                  │
│  ─────────────────        │  ─────────────────          │
│  • Element definitions    │  • Value bindings           │
│  • Layout/positions       │  • Click handlers           │
│  • Icons, formats         │  • List data providers      │
│  • Themes                 │  • Dynamic show/hide        │
│  • Responsive rules       │  • Animation triggers       │
├─────────────────────────────────────────────────────────┤
│                    HUDManager                           │
│  ─────────────────────────────────────────────────────  │
│  • Loads config + merges with code bindings             │
│  • Creates component instances                          │
│  • Manages layout containers                            │
│  • Fixed-interval update loop (default 100ms)           │
│  • Integrates with UIScale                              │
│  • Persists user preferences                            │
├─────────────────────────────────────────────────────────┤
│                    Components                           │
│  ─────────────────────────────────────────────────────  │
│  HUDPill │ HUDButton │ HUDAccordion │ HUDList │ ...     │
│  • Self-contained rendering                             │
│  • Value change animations                              │
│  • Emits events (click, hover)                          │
├─────────────────────────────────────────────────────────┤
│                    UIScale                              │
│  ─────────────────────────────────────────────────────  │
│  • CSS variables for scaling                            │
│  • Safe area insets                                     │
│  • Touch target enforcement (44px min)                  │
└─────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/engine/ui/hud/
├── HUDManager.ts           # Core manager, layout engine, update loop
├── HUDConfig.ts            # Config loader, schema validation
├── HUDElement.ts           # Base element class
├── HUDAnimations.ts        # Animation utilities
├── components/
│   ├── HUDPill.ts          # Icon + value pill
│   ├── HUDPillProgress.ts  # Pill with progress bar
│   ├── HUDPillGroup.ts     # Container for multiple pills
│   ├── HUDButton.ts        # Icon button
│   ├── HUDAccordion.ts     # Collapsible panel
│   ├── HUDList.ts          # Data-driven list
│   ├── HUDProgressBar.ts   # Standalone progress bar
│   └── HUDNotifications.ts # Toast notification system
├── styles/
│   └── HUD.css             # All HUD styles (uses UIScale variables)
└── index.ts                # Public exports

public/data/
└── hud-config.json         # Layout and element definitions
```

---

## JSON Configuration

### `hud-config.json`

```json
{
  "version": 1,
  
  "settings": {
    "updateInterval": 100,
    "animateValueChanges": true,
    "persistPreferences": true
  },
  
  "layout": {
    "areas": {
      "top-left": ["money", "level", "stock", "inventory"],
      "top-right": ["time"],
      "left": ["quests", "orders", "events"]
    }
  },
  
  "elements": {
    "money": {
      "type": "pill",
      "icon": "💰",
      "format": "$%d",
      "clickable": true
    },
    
    "level": {
      "type": "pill-progress",
      "icon": "⭐",
      "format": "Lv.%d",
      "progressBinding": "xpProgress"
    },
    
    "stock": {
      "type": "pill",
      "icon": "🌿",
      "format": "%dg",
      "clickable": true
    },
    
    "inventory": {
      "type": "pill",
      "icon": "🎒",
      "format": "%d",
      "clickable": true
    },
    
    "time": {
      "type": "pill-group",
      "children": [
        { "id": "day", "format": "Day %d", "style": "bold" },
        { "id": "clock", "format": "%s" },
        { "id": "period", "type": "icon" },
        { "id": "speed-btn", "type": "button" },
        { "id": "fullscreen-btn", "type": "button", "platforms": ["desktop"] }
      ]
    },
    
    "quests": {
      "type": "accordion",
      "icon": "📜",
      "title": "Quests",
      "badgeBinding": "activeQuestCount",
      "content": {
        "type": "list",
        "itemTemplate": "quest-item",
        "emptyText": "No active quests"
      }
    },
    
    "orders": {
      "type": "accordion",
      "icon": "📦",
      "title": "Orders",
      "badgeBinding": "activeOrderCount",
      "content": {
        "type": "list",
        "itemTemplate": "order-item",
        "emptyText": "No pending orders"
      }
    },
    
    "events": {
      "type": "accordion",
      "icon": "🔔",
      "title": "Events",
      "content": {
        "type": "list",
        "itemTemplate": "event-item",
        "emptyText": "No active events"
      }
    }
  },
  
  "itemTemplates": {
    "quest-item": {
      "layout": "row",
      "fields": ["icon", "title", "progress", "reward"]
    },
    "order-item": {
      "layout": "row",
      "fields": ["customer", "items", "timer", "status"]
    },
    "event-item": {
      "layout": "row",
      "fields": ["icon", "title", "description"]
    }
  },
  
  "themes": {
    "default": {
      "pill-bg": "#FAFAFA",
      "pill-border": "#CCCCCC",
      "pill-text": "#333333",
      "accordion-bg": "#FAFAFA",
      "accordion-header": "#F5F5F5"
    },
    "dark": {
      "pill-bg": "rgba(30, 30, 30, 0.9)",
      "pill-border": "#444444",
      "pill-text": "#FFFFFF",
      "accordion-bg": "rgba(30, 30, 30, 0.9)",
      "accordion-header": "rgba(40, 40, 40, 0.9)"
    }
  },
  
  "responsive": {
    "mobile": {
      "hideElements": ["fullscreen-btn"],
      "settings": {
        "updateInterval": 150
      }
    },
    "portrait": {
      "layout": {
        "areas": {
          "top-left": ["money", "level"],
          "top-center": ["stock", "inventory"],
          "top-right": ["time"]
        }
      }
    }
  }
}
```

---

## Code API

### Initialization

```typescript
import { HUD } from '@engine/ui/hud';

// Load config and initialize
await HUD.init('data/hud-config.json');
```

### Value Bindings

```typescript
// Simple value binding
HUD.bind('money', () => GameState.getInstance().getMoney());
HUD.bind('level', () => GameState.getInstance().getLevel());
HUD.bind('xpProgress', () => GameState.getInstance().getXPProgress());

// Formatted values (format string in JSON)
HUD.bind('stock', () => GameState.getInstance().getTotalStock());

// Time components
HUD.bind('day', () => GameClock.getInstance().getDay());
HUD.bind('clock', () => GameClock.getInstance().getTimeString());
HUD.bind('period', () => GameClock.getInstance().getPeriodIcon());
```

### List Bindings

```typescript
// Bind list data - HUD iterates using itemTemplate from config
HUD.bindList('quests', () => QuestSystem.getInstance().getActiveQuests());
HUD.bindList('orders', () => OrderSystem.getInstance().getPendingOrders());
HUD.bindList('events', () => EventSystem.getInstance().getActiveEvents());

// Custom item renderer (overrides template)
HUD.bindList('custom-list', {
  data: () => myItems,
  renderItem: (item, index) => {
    const el = document.createElement('div');
    el.className = 'custom-item';
    el.innerHTML = `<span>${item.icon}</span> ${item.name}`;
    el.onclick = () => item.action();
    return el;
  }
});
```

### Click Handlers

```typescript
HUD.onClick('money', () => ShopPanel.open());
HUD.onClick('stock', () => StockPanel.open());
HUD.onClick('inventory', () => InventoryPanel.open());
HUD.onClick('speed-btn', () => GameClock.getInstance().toggleSpeed());
HUD.onClick('fullscreen-btn', () => toggleFullscreen());
```

### Visibility Control

```typescript
HUD.show('tutorial-hint');
HUD.hide('tutorial-hint');
HUD.toggle('minimap');

// Check visibility
if (HUD.isVisible('quests')) { ... }
```

### Animations & Feedback

```typescript
// Flash effect (value change feedback)
HUD.flash('money', 'gain');   // Green flash
HUD.flash('money', 'loss');   // Red flash
HUD.flash('health', 'damage'); // Red shake

// Pulse (attention)
HUD.pulse('quests');

// Badge updates (auto-animates)
HUD.setBadge('quests', 3);    // Shows "3" badge, pulses on change
HUD.clearBadge('quests');

// Manual refresh (immediate, don't wait for interval)
HUD.refresh('money');
HUD.refreshAll();
```

### Layout Control

```typescript
// Move element to different area
HUD.moveTo('minimap', 'bottom-right');

// Custom absolute positioning
HUD.setPosition('tooltip', {
  anchor: 'center',
  offset: { x: 0, y: -100 }
});

// Accordion control
HUD.collapse('orders');
HUD.expand('quests');
HUD.collapseAll();
```

### Theme Control

```typescript
HUD.setTheme('dark');
HUD.setTheme('default');
```

---

## Component Types

### Pill
Simple icon + value display.

```json
{
  "type": "pill",
  "icon": "💰",
  "format": "$%d",
  "clickable": true
}
```

### Pill Progress
Pill with integrated progress bar.

```json
{
  "type": "pill-progress",
  "icon": "⭐",
  "format": "Lv.%d",
  "progressBinding": "xpProgress"
}
```

### Pill Group
Container for multiple related elements.

```json
{
  "type": "pill-group",
  "children": [
    { "id": "day", "format": "Day %d" },
    { "id": "clock", "format": "%s" }
  ]
}
```

### Button
Icon button with optional tooltip.

```json
{
  "type": "button",
  "icon": "▶️",
  "tooltip": "Play/Pause",
  "platforms": ["desktop"]
}
```

### Accordion
Collapsible panel with header and content.

```json
{
  "type": "accordion",
  "icon": "📜",
  "title": "Quests",
  "badgeBinding": "activeQuestCount",
  "collapsed": false,
  "content": { ... }
}
```

### List
Data-driven list with item templates.

```json
{
  "type": "list",
  "itemTemplate": "quest-item",
  "emptyText": "No items",
  "maxVisible": 5
}
```

### Progress Bar
Standalone progress indicator.

```json
{
  "type": "progress-bar",
  "label": "Health",
  "color": "#4CAF50",
  "showValue": true
}
```

---

## Update Loop

```typescript
class HUDManager {
  private updateInterval = 100;  // ms
  private bindings = new Map<string, () => any>();
  private lastValues = new Map<string, any>();
  private intervalId: number | null = null;

  start() {
    this.intervalId = window.setInterval(() => this.update(), this.updateInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setInterval(ms: number) {
    this.updateInterval = ms;
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }

  private update() {
    for (const [id, getter] of this.bindings) {
      try {
        const newValue = getter();
        const oldValue = this.lastValues.get(id);

        // Dirty check - only update if changed
        if (!this.equals(newValue, oldValue)) {
          this.lastValues.set(id, this.clone(newValue));
          this.updateElement(id, newValue, oldValue);
        }
      } catch (e) {
        console.warn(`[HUD] Binding error for '${id}':`, e);
      }
    }
  }

  private updateElement(id: string, newValue: any, oldValue: any) {
    const component = this.components.get(id);
    if (!component) return;

    component.setValue(newValue);

    // Auto-animate numeric changes
    if (this.config.animateValueChanges) {
      if (typeof newValue === 'number' && typeof oldValue === 'number') {
        const delta = newValue - oldValue;
        if (delta > 0) component.flash('gain');
        if (delta < 0) component.flash('loss');
      }
    }
  }

  // Deep equality for arrays (lists)
  private equals(a: any, b: any): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  }

  private clone(value: any): any {
    if (Array.isArray(value)) return [...value];
    if (typeof value === 'object') return { ...value };
    return value;
  }
}
```

---

## User Preferences Persistence

```typescript
interface HUDUserPrefs {
  collapsed: string[];           // Collapsed accordion IDs
  hidden: string[];              // User-hidden elements
  theme?: 'default' | 'dark';    // Theme preference
}

// Stored in localStorage: 'hud-user-prefs'
// Loaded on init, merged with defaults
// Saved on any preference change
```

---

## CLI Commands

```
hud info              - Show HUD status and element count
hud interval <ms>     - Set update interval (default: 100)
hud show <id>         - Show element
hud hide <id>         - Hide element
hud toggle <id>       - Toggle element visibility
hud refresh           - Force refresh all elements
hud theme <name>      - Switch theme
hud reset             - Reset to default layout/prefs
hud debug             - Toggle debug overlay (shows element bounds)
```

---

## Animations

### Value Change
- Numbers animate counting up/down over 300ms
- Flash effect: green for gain, red for loss

### Entrance/Exit
- `fadeIn` - Opacity 0→1 over 200ms
- `fadeOut` - Opacity 1→0 over 200ms
- `slideIn` - Slide from edge + fade
- `slideOut` - Slide to edge + fade
- `scaleIn` - Scale 0.9→1 + fade
- `scaleOut` - Scale 1→0.9 + fade

### Attention
- `pulse` - Scale 1→1.05→1 over 500ms
- `shake` - Horizontal shake for 300ms
- `bounce` - Vertical bounce

### Accordion
- `expand` - Height 0→auto over 200ms
- `collapse` - Height auto→0 over 200ms

---

## Future Enhancements (v2+)

### Mobile Gestures
- Swipe from left edge → toggle left accordions
- Swipe from right edge → toggle right panel
- Long-press on pill → show tooltip/details
- Swipe down on accordion header → collapse all

### Drag & Drop
- Allow users to reposition elements
- Persist custom positions

### Notifications
- Toast notification system
- Queue management
- Priority levels

### Minimap Integration
- HUD slot for minimap component
- Zoom/pan controls

### Keyboard Shortcuts
- Configurable hotkeys for toggle/actions
- Desktop-only feature

---

## Migration Path

### Phase 1: Core System
1. Implement HUDManager with layout containers
2. Implement HUDPill component
3. Load basic config, render pills
4. Add update loop with bindings

### Phase 2: Components
5. Implement HUDPillProgress, HUDPillGroup
6. Implement HUDButton
7. Implement HUDAccordion
8. Implement HUDList with templates

### Phase 3: Features
9. Add animations system
10. Add theme support
11. Add user preferences persistence
12. Add CLI commands

### Phase 4: Migration
13. Create hud-config.json for current game
14. Add bindings in game init
15. Remove old GameHUD code
16. Test on all platforms

---

## Example: Full Game Integration

```typescript
// src/game/GameHUDSetup.ts

import { HUD } from '@engine/ui/hud';
import { GameState } from './GameState';
import { GameClock } from './GameClock';
import { QuestSystem } from './QuestSystem';
import { OrderSystem } from './OrderSystem';

export async function setupGameHUD(): Promise<void> {
  // Initialize HUD system
  await HUD.init('data/hud-config.json');

  // Bind values
  HUD.bind('money', () => GameState.getInstance().getMoney());
  HUD.bind('level', () => GameState.getInstance().getLevel());
  HUD.bind('xpProgress', () => GameState.getInstance().getXPProgress());
  HUD.bind('stock', () => GameState.getInstance().getTotalStock());
  HUD.bind('inventory', () => GameState.getInstance().getInventoryCount());
  
  HUD.bind('day', () => GameClock.getInstance().getDay());
  HUD.bind('clock', () => GameClock.getInstance().getTimeString());
  HUD.bind('period', () => GameClock.getInstance().getPeriodIcon());
  
  HUD.bind('activeQuestCount', () => QuestSystem.getInstance().getActiveCount());
  HUD.bind('activeOrderCount', () => OrderSystem.getInstance().getPendingCount());

  // Bind lists
  HUD.bindList('quests', () => QuestSystem.getInstance().getActiveQuests());
  HUD.bindList('orders', () => OrderSystem.getInstance().getPendingOrders());

  // Click handlers
  HUD.onClick('money', () => ShopPanel.open());
  HUD.onClick('stock', () => StockPanel.open());
  HUD.onClick('inventory', () => InventoryPanel.open());
  HUD.onClick('speed-btn', () => GameClock.getInstance().cycleSpeed());
  HUD.onClick('fullscreen-btn', () => document.fullscreenElement 
    ? document.exitFullscreen() 
    : document.documentElement.requestFullscreen()
  );

  // Start update loop
  HUD.start();
}
```
