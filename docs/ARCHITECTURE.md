# Engine Architecture Guide

This document describes the architectural patterns and conventions used in the IWM Engine.

## Directory Structure

```
src/
├── engine/           # Reusable engine code (game-agnostic)
│   ├── core/         # Core systems (EventBus, Subsystem, etc.)
│   ├── ui/           # UI framework (themes, styles)
│   │   ├── hud/      # Generic HUD system
│   │   │   ├── components/  # HUD components (Pill, Accordion, etc.)
│   │   │   └── styles/      # HUD CSS styles
│   │   ├── UIScale.ts       # Cross-platform scaling
│   │   └── UIStyles.ts      # Style injection
│   ├── loader/       # Asset loading
│   ├── camera/       # Camera systems
│   ├── lighting/     # Lighting systems
│   └── sprites/      # Billboard sprites
├── game/             # Game-specific logic
│   ├── *System.ts    # Game subsystems
│   └── GameData.ts   # Game configuration
├── ui/               # Game UI
│   ├── dialogs/      # Dialog implementations
│   └── GameHUDSetup.ts  # Game-specific HUD bindings
└── data/             # JSON configuration files
```

## Core Patterns

### 1. Subsystem Pattern

All major game systems should implement the `Subsystem` interface for consistent state management:

```typescript
import { Subsystem } from "../engine/core/Subsystem";

interface MySystemState {
  items: Item[];
  settings: Settings;
}

class MySystem implements Subsystem<MySystemState> {
  private static instance: MySystem;
  
  public static getInstance(): MySystem {
    if (!MySystem.instance) {
      MySystem.instance = new MySystem();
    }
    return MySystem.instance;
  }

  getState(): MySystemState {
    return { items: [...this.items], settings: { ...this.settings } };
  }

  loadState(state: Partial<MySystemState>): void {
    if (state.items) this.items = state.items;
    if (state.settings) this.settings = { ...this.settings, ...state.settings };
  }

  clear(): void {
    this.items = [];
    this.settings = defaultSettings;
  }

  dispose(): void {
    // Cancel timers, remove event listeners
    GameTimer.getInstance().cancelTask(this.taskId);
    this.clear();
  }
}
```

### 2. Event Communication

Use `EventBus` for cross-system communication:

```typescript
import { EventBus } from "../engine/core/EventBus";

// Emitting events (use "system:event" naming convention)
EventBus.emit("curing:barrel_purchased", { barrelId, template });
EventBus.emit("order:completed", { orderId, reward });

// Listening to events
EventBus.on("plant:harvested", (data) => {
  console.log(`Harvested ${data.yield}g`);
});

// One-time listener
EventBus.once("player:levelup", (data) => {
  showCelebration(data.newLevel);
});
```

### 3. Dialog System

Dialogs extend `BaseDialog` and are registered with `UIManager`:

```typescript
import { BaseDialog, DialogContext } from "./BaseDialog";

export class MyDialog extends BaseDialog {
  constructor() {
    super("my_dialog", { title: "My Dialog" });
  }

  getBodyHTML(context: DialogContext): string {
    return `<div>Dialog content here</div>`;
  }

  protected onOpen(context: DialogContext): void {
    // Setup event handlers
  }

  protected onClose(): void {
    // Cleanup
  }
}

// Register in UIManager constructor:
this.registerFactory("my_dialog", () => new MyDialog());

// Open from anywhere:
UIManager.getInstance().openDialog("my_dialog", { someData: value });
```

### 4. Timer/Scheduled Tasks

Use `GameTimer` for game-time based scheduling:

```typescript
const timer = GameTimer.getInstance();

// Schedule a repeating task
timer.scheduleTask("my_update_task", 1000, () => {
  this.update();
});

// Cancel when done
timer.cancelTask("my_update_task");

// One-shot timer
timer.setTimer("delayed_action", 5000, () => {
  doSomething();
});
```

### 5. Save/Load Integration

Systems are saved via `SaveManager` which coordinates with `GameState`:

```typescript
// In SaveManager.collectSubsystemStates():
const mySystemState = MySystem.getInstance().getState();
gameState.setCustomData("mySystem", mySystemState);

// In SaveManager.loadSubsystemStates():
const mySystemState = gameState.getCustomData<MySystemState>("mySystem");
if (mySystemState) {
  MySystem.getInstance().loadState(mySystemState);
}
```

## Data-Driven Configuration

Game data should be loaded from JSON files in `src/data/`:

- `newgame.json` - Starting values for new games
- `defaultPlaylist.json` - Default music playlist
- `strains.json` - Plant strain definitions

Schemas are in `src/data/schemas/` for validation.

## Naming Conventions

- **Systems**: `*System.ts` (e.g., `CuringSystem.ts`, `OrderSystem.ts`)
- **Dialogs**: `*Dialog.ts` (e.g., `CuringDialog.ts`)
- **Events**: `system:action` (e.g., `curing:barrel_purchased`)
- **Task IDs**: `system_taskname` (e.g., `curing_update`)

## Best Practices

1. **Singleton Pattern**: Use for systems that need global access
2. **Lazy Initialization**: Dialogs are created on first use, not at startup
3. **State Immutability**: Return copies from `getState()`, not references
4. **Graceful Degradation**: Handle missing/partial state in `loadState()`
5. **Cleanup**: Always implement `dispose()` to prevent memory leaks
6. **EventBus over Callbacks**: Prefer EventBus for loose coupling

## UI System

### UIScale

Cross-platform UI scaling system that provides CSS variables for consistent sizing:

```typescript
import { UIScale } from "../engine/ui/UIScale";

// Initialize early in app lifecycle
UIScale.getInstance().init();

// CSS variables available:
// --ui-scale: Current scale factor (e.g., 1.5)
// --ui-space-xs/sm/md/lg/xl: Scaled spacing
// --ui-font-xs/sm/md/lg/xl: Scaled font sizes
// --ui-radius-sm/md/lg/xl: Scaled border radii
// --ui-touch-min: Minimum touch target (44px scaled)
// --ui-safe-top/bottom/left/right: Safe area insets
```

### HUD System

Declarative HUD with JSON configuration and code bindings:

```typescript
import { HUD } from "../engine/ui/hud";

// Initialize with config
await HUD.init("data/hud-config.json");

// Bind values
HUD.bind("money", () => GameState.getInstance().getPlayer().money);
HUD.bind("level", () => GameState.getInstance().getPlayer().level);

// Bind lists
HUD.bindList("quests", {
  data: () => QuestSystem.getInstance().getActiveQuests()
});

// Click handlers
HUD.onClick("money", () => ShopPanel.open());

// Start update loop
HUD.start();
```

See [HUD_SYSTEM_DESIGN.md](./HUD_SYSTEM_DESIGN.md) for full documentation.
