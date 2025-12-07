# Dialog System

UI dialogs for menus, conversations, and in-game interfaces.

---

## Overview

The dialog system provides:

- **Modal dialogs** - Overlay windows with backdrop blur
- **Consistent styling** - Standard header, close button, animations
- **Event handling** - Close on Escape, backdrop click
- **Extensible** - Create custom dialogs by extending `BaseDialog`

---

## Quick Start

### 1. Create a Dialog

```typescript
import { BaseDialog, DialogContext } from "./ui/dialogs/BaseDialog";

export class MyDialog extends BaseDialog {
  constructor() {
    super({
      title: "My Dialog",
      width: "600px",
      height: "400px",
    });
  }

  protected getBodyHTML(context: DialogContext): string {
    return `
      <div style="padding: 20px;">
        <h2>Hello!</h2>
        <p>Context value: ${context.someValue || "none"}</p>
        <button id="my-button">Click Me</button>
      </div>
    `;
  }

  protected onOpen(context: DialogContext): void {
    const button = this.element.querySelector("#my-button");
    button?.addEventListener("click", () => {
      console.log("Button clicked!");
      this.close();
    });
  }
}
```

### 2. Register Dialog

```typescript
import { UIManager } from "./ui/UIManager";
import { MyDialog } from "./ui/dialogs/MyDialog";

UIManager.getInstance().registerDialog("my_dialog", new MyDialog());
```

### 3. Open from Trigger

In your map file:

```
{
"classname" "trigger_multiple"
"windowTarget" "my_dialog"
"someValue" "Hello from trigger!"
{
// trigger brush
}
}
```

### 4. Open from Code

```typescript
UIManager.getInstance().openDialog("my_dialog", {
  someValue: "Hello from code!",
});
```

---

## BaseDialog

All dialogs extend `BaseDialog` which provides:

### Visual Features

- **Backdrop** - Dark overlay with blur effect
- **Drop shadow** - Subtle shadow for depth
- **Gradient background** - Modern dark gradient
- **Header** - Title and close button
- **Animations** - Fade in/out, scale

### Behavior

- **Close on Escape** - Press Escape to close
- **Close on backdrop click** - Click outside to close
- **Event isolation** - Clicks inside don't close dialog
- **Timing protection** - Prevents immediate close after open

### Constructor Options

```typescript
interface DialogOptions {
  title?: string;      // Header title (default: "Dialog")
  width?: string;      // CSS width (default: "70vw")
  height?: string;     // CSS height (default: "70vh")
}
```

### Methods to Override

```typescript
abstract class BaseDialog {
  // Required: Return dialog body HTML
  protected abstract getBodyHTML(context: DialogContext): string;
  
  // Optional: Called after dialog opens
  protected onOpen(context: DialogContext): void {}
  
  // Optional: Called before dialog closes
  protected onClose(): void {}
}
```

---

## Dialog Context

Context is passed when opening a dialog:

```typescript
type DialogContext = Record<string, unknown>;
```

From triggers, all entity properties are passed as context:

```
{
"classname" "trigger_multiple"
"windowTarget" "shop_dialog"
"shopName" "Blacksmith"
"discount" "10"
}
```

```typescript
protected getBodyHTML(context: DialogContext): string {
  const shopName = context.shopName as string;
  const discount = context.discount as string;
  return `<h2>Welcome to ${shopName}!</h2><p>${discount}% off today!</p>`;
}
```

---

## UIManager

Singleton that manages all dialogs.

### Methods

```typescript
class UIManager {
  static getInstance(): UIManager;
  
  // Register a dialog with an ID
  registerDialog(id: string, dialog: BaseDialog): void;
  
  // Open a dialog by ID
  openDialog(id: string, context?: DialogContext): void;
  
  // Close the active dialog
  closeActiveDialog(): void;
  
  // Check if any dialog is open
  isDialogOpen(): boolean;
}
```

### Example

```typescript
const ui = UIManager.getInstance();

// Register dialogs at startup
ui.registerDialog("main_menu", new MainMenuDialog());
ui.registerDialog("settings", new SettingsDialog());
ui.registerDialog("inventory", new InventoryDialog());

// Open with context
ui.openDialog("inventory", { 
  items: playerInventory,
  gold: playerGold 
});

// Check state
if (ui.isDialogOpen()) {
  // Pause game logic
}
```

---

## Styling

### Default Styles

Dialogs use inline styles for portability:

- **Backdrop:** `rgba(0,0,0,0.7)` with `backdrop-filter: blur(8px)`
- **Dialog:** Dark gradient `#1a1a2e` to `#16213e`
- **Header:** Darker background `#0f0f1a`
- **Text:** White `#ffffff`
- **Border:** Subtle `rgba(255,255,255,0.1)`

### Custom Styling

Override in your dialog's `getBodyHTML`:

```typescript
protected getBodyHTML(context: DialogContext): string {
  return `
    <style>
      .my-dialog-content {
        padding: 20px;
        color: #00ff00;
      }
      .my-dialog-content button {
        background: #00ff00;
        color: black;
        border: none;
        padding: 10px 20px;
        cursor: pointer;
      }
    </style>
    <div class="my-dialog-content">
      <p>Custom styled content!</p>
      <button>Green Button</button>
    </div>
  `;
}
```

---

## Examples

### Simple Message Dialog

```typescript
export class MessageDialog extends BaseDialog {
  constructor() {
    super({ title: "Message", width: "400px", height: "200px" });
  }

  protected getBodyHTML(context: DialogContext): string {
    return `
      <div style="padding: 30px; text-align: center;">
        <p style="font-size: 18px; margin-bottom: 20px;">
          ${context.message || "No message"}
        </p>
        <button id="ok-btn" style="
          padding: 10px 30px;
          background: #4CAF50;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        ">OK</button>
      </div>
    `;
  }

  protected onOpen(): void {
    this.element.querySelector("#ok-btn")?.addEventListener("click", () => {
      this.close();
    });
  }
}
```

### Confirmation Dialog

```typescript
export class ConfirmDialog extends BaseDialog {
  private onConfirm?: () => void;
  private onCancel?: () => void;

  constructor() {
    super({ title: "Confirm", width: "400px", height: "200px" });
  }

  protected getBodyHTML(context: DialogContext): string {
    this.onConfirm = context.onConfirm as () => void;
    this.onCancel = context.onCancel as () => void;
    
    return `
      <div style="padding: 30px; text-align: center;">
        <p>${context.message || "Are you sure?"}</p>
        <div style="margin-top: 20px;">
          <button id="yes-btn" style="margin-right: 10px; padding: 10px 20px;">Yes</button>
          <button id="no-btn" style="padding: 10px 20px;">No</button>
        </div>
      </div>
    `;
  }

  protected onOpen(): void {
    this.element.querySelector("#yes-btn")?.addEventListener("click", () => {
      this.onConfirm?.();
      this.close();
    });
    this.element.querySelector("#no-btn")?.addEventListener("click", () => {
      this.onCancel?.();
      this.close();
    });
  }
}

// Usage
UIManager.getInstance().openDialog("confirm", {
  message: "Delete this item?",
  onConfirm: () => deleteItem(),
  onCancel: () => console.log("Cancelled"),
});
```

### Game Menu Dialog

```typescript
export class GameMenuDialog extends BaseDialog {
  constructor() {
    super({ title: "Game Menu", width: "300px", height: "400px" });
  }

  protected getBodyHTML(): string {
    return `
      <div style="display: flex; flex-direction: column; gap: 15px; padding: 20px;">
        <button class="menu-btn" data-action="resume">Resume</button>
        <button class="menu-btn" data-action="settings">Settings</button>
        <button class="menu-btn" data-action="save">Save Game</button>
        <button class="menu-btn" data-action="load">Load Game</button>
        <button class="menu-btn" data-action="quit">Quit to Menu</button>
      </div>
      <style>
        .menu-btn {
          padding: 15px;
          font-size: 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .menu-btn:hover {
          transform: scale(1.05);
        }
      </style>
    `;
  }

  protected onOpen(): void {
    this.element.querySelectorAll(".menu-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = (e.target as HTMLElement).dataset.action;
        this.handleAction(action);
      });
    });
  }

  private handleAction(action?: string): void {
    switch (action) {
      case "resume":
        this.close();
        break;
      case "settings":
        UIManager.getInstance().openDialog("settings");
        break;
      // ... handle other actions
    }
  }
}
```

---

## Best Practices

1. **Keep dialogs focused** - One purpose per dialog

2. **Use context for data** - Pass data through context, not globals

3. **Clean up in onClose** - Remove event listeners, timers, etc.

4. **Handle Escape key** - Already built-in, but consider custom behavior

5. **Test on different sizes** - Use responsive CSS or viewport units

6. **Provide close affordance** - Always have a way to close (X button, Cancel, etc.)
