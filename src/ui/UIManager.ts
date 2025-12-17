import type { BaseDialog, DialogContext } from "./dialogs/BaseDialog";
import { CuringDialog } from "./dialogs/CuringDialog";
import { SeedStoreDialog, ShopDialog, SuppliesStoreDialog } from "./dialogs/ShopDialog";
import { TestDialog } from "./dialogs/TestDialog";

export class UIManager {
  private static instance: UIManager;
  private dialogs: Map<string, BaseDialog> = new Map();
  private activeDialog: BaseDialog | null = null;

  /** Returns true if any dialog is currently open */
  public isDialogOpen(): boolean {
    return this.activeDialog !== null;
  }

  private constructor() {
    // Register Dialogs Here
    this.register(new TestDialog());
    this.register(new ShopDialog());
    this.register(new SeedStoreDialog());
    this.register(new SuppliesStoreDialog());
    this.register(new CuringDialog());
  }

  public static getInstance(): UIManager {
    if (!UIManager.instance) {
      UIManager.instance = new UIManager();
    }
    return UIManager.instance;
  }

  public register(dialog: BaseDialog): void {
    this.dialogs.set(dialog.id, dialog);
  }

  public openDialog(id: string, context: DialogContext = {}): void {
    // Close active dialog if any
    if (this.activeDialog) {
      this.activeDialog.hide();
    }

    const dialog = this.dialogs.get(id);
    if (dialog) {
      dialog.show(context);
      this.activeDialog = dialog;
      console.log(`UI: Opened dialog '${id}'`);
    } else {
      console.warn(`UI: Dialog '${id}' not found in registry.`);
    }
  }

  public closeDialog(id: string): void {
    const dialog = this.dialogs.get(id);
    if (dialog && this.activeDialog === dialog) {
      dialog.hide();
      this.activeDialog = null;
      console.log(`UI: Closed dialog '${id}'`);
    }
  }
}
