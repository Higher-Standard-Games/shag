import type { BaseDialog, DialogContext } from "./dialogs/BaseDialog";
import { CuringDialog } from "./dialogs/CuringDialog";
import { DealerDialog } from "./dialogs/DealerDialog";
import { SaleDialog } from "./dialogs/SaleDialog";
import { SeedStoreDialog, ShopDialog, SuppliesStoreDialog } from "./dialogs/ShopDialog";
import { TestDialog } from "./dialogs/TestDialog";

// Dialog factory functions for lazy instantiation
type DialogFactory = () => BaseDialog;

/**
 * UIManager - Centralized dialog management
 * 
 * Dialogs are lazily instantiated on first use to improve startup performance.
 * Register dialogs using registerFactory() for lazy loading, or register() for eager loading.
 */
export class UIManager {
  private static instance: UIManager;
  private dialogs: Map<string, BaseDialog> = new Map();
  private dialogFactories: Map<string, DialogFactory> = new Map();
  private activeDialog: BaseDialog | null = null;

  /** Returns true if any dialog is currently open */
  public isDialogOpen(): boolean {
    return this.activeDialog !== null;
  }

  private constructor() {
    // Register dialog factories for lazy instantiation
    // Dialogs are only created when first opened, not at startup
    this.registerFactory("test_dialog", () => new TestDialog());
    this.registerFactory("shop_dialog", () => new ShopDialog());
    this.registerFactory("seed_store_dialog", () => new SeedStoreDialog());
    this.registerFactory("seed_store", () => new SeedStoreDialog());  // Alias for map triggers
    this.registerFactory("supplies_store_dialog", () => new SuppliesStoreDialog());
    this.registerFactory("supplies_store", () => new SuppliesStoreDialog());  // Alias for map triggers
    this.registerFactory("curing_dialog", () => new CuringDialog());
    this.registerFactory("curing", () => new CuringDialog());  // Alias for map triggers
    this.registerFactory("sale_dialog", () => new SaleDialog());
    this.registerFactory("dealer", () => new DealerDialog());  // Alias for map triggers
    this.registerFactory("dealer_dialog", () => new DealerDialog());
  }

  public static getInstance(): UIManager {
    if (!UIManager.instance) {
      UIManager.instance = new UIManager();
    }
    return UIManager.instance;
  }

  /**
   * Register a dialog factory for lazy instantiation
   */
  public registerFactory(id: string, factory: DialogFactory): void {
    this.dialogFactories.set(id, factory);
  }

  /**
   * Register an already-instantiated dialog (eager loading)
   */
  public register(dialog: BaseDialog): void {
    this.dialogs.set(dialog.id, dialog);
  }

  /**
   * Get or create a dialog instance
   */
  private getDialog(id: string): BaseDialog | null {
    // Check if already instantiated
    let dialog = this.dialogs.get(id);
    if (dialog) return dialog;

    // Check for factory
    const factory = this.dialogFactories.get(id);
    if (factory) {
      dialog = factory();
      this.dialogs.set(id, dialog);
      return dialog;
    }

    return null;
  }

  public openDialog(id: string, context: DialogContext = {}): void {
    // Close active dialog if any
    if (this.activeDialog) {
      this.activeDialog.hide();
    }

    const dialog = this.getDialog(id);
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
