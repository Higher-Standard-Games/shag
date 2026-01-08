import { GameState } from "../../GameState";
import { ShopSystem } from "../../ShopSystem";
import { BaseDialog, type DialogContext } from "./BaseDialog";

/**
 * Shop dialog that displays purchasable items.
 * Can be filtered by category via context.category
 */
export class ShopDialog extends BaseDialog {
  private categoryFilter: string | null = null;

  constructor(id: string = "shop_dialog", title: string = "Shop") {
    super(id, { title, width: "500px", maxWidth: "90vw" });
  }

  protected getTitle(context: DialogContext): string {
    if (context.shopName) return context.shopName as string;
    if (context.category === "seeds") return "🌱 Seed Store";
    if (context.category === "supplies") return "🧪 Supplies Store";
    return this.options.title;
  }

  public getBodyHTML(context: DialogContext): string {
    this.categoryFilter = (context.category as string) || null;
    
    const shopSystem = ShopSystem.getInstance();
    const gameState = GameState.getInstance();
    const playerLevel = gameState.getPlayer().level;
    const playerMoney = gameState.getPlayer().money;

    // Get items, optionally filtered by category
    let items = shopSystem.getAvailableItems();
    if (this.categoryFilter) {
      items = items.filter(item => item.category === this.categoryFilter);
    }

    if (items.length === 0) {
      return `
        <div style="text-align: center; padding: 40px; color: #888;">
          <p style="font-size: 1.2rem;">No items available</p>
          <p style="font-size: 0.9rem;">Check back later!</p>
        </div>
      `;
    }

    const itemsHTML = items.map(item => {
      const canAfford = playerMoney >= item.price;
      const meetsLevel = playerLevel >= item.requiredLevel;
      const inStock = item.stock === -1 || item.stock > 0;
      const canBuy = canAfford && meetsLevel && inStock;

      return `
        <div class="shop-item" style="
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #FFFFFF;
          border-radius: 8px;
          margin-bottom: 8px;
          border: 1px solid #E0E0E0;
          ${!canBuy || !inStock ? 'opacity: 0.6;' : ''}
        ">
          <div style="font-size: 2rem; width: 48px; text-align: center;">${item.icon}</div>
          <div style="flex: 1;">
            <div style="font-weight: 500; color: #333333; margin-bottom: 4px;">
              ${item.name}
              ${item.quantity > 1 ? `<span style="color: #666666; font-size: 0.85rem;">(x${item.quantity})</span>` : ''}
            </div>
            <div style="font-size: 0.85rem; color: #666666;">${item.description}</div>
            ${!meetsLevel ? `<div style="font-size: 0.8rem; color: #D32F2F; margin-top: 4px;">Requires Level ${item.requiredLevel}</div>` : ''}
            ${!inStock ? `<div style="font-size: 0.8rem; color: #D32F2F; margin-top: 4px;">Out of Stock</div>` : ''}
          </div>
          <div style="text-align: right;">
            <div style="color: ${canAfford ? '#2E7D32' : '#D32F2F'}; font-weight: 600; margin-bottom: 8px;">
              $${item.price}
            </div>
            <button 
              class="shop-buy-btn" 
              data-item-id="${item.id}"
              ${!canBuy || !inStock ? 'disabled' : ''}
              style="
                padding: 6px 16px;
                font-size: 0.85rem;
                font-weight: 600;
                border: none;
                border-radius: 6px;
                cursor: ${canBuy && inStock ? 'pointer' : 'not-allowed'};
                background: ${canBuy && inStock ? '#4CAF50' : '#E0E0E0'};
                border-bottom: ${canBuy && inStock ? '3px solid #3D9140' : '3px solid #CCCCCC'};
                color: ${canBuy && inStock ? '#fff' : '#999'};
                transition: all 0.15s ease;
              "
            >Buy</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
        <span style="color: #666666;">Your Money:</span>
        <span style="color: #2E7D32; font-weight: 600; font-size: 1.1rem;">$${playerMoney}</span>
      </div>
      <div class="shop-items" style="max-height: 400px; overflow-y: auto;">
        ${itemsHTML}
      </div>
    `;
  }

  protected onOpen(context: DialogContext): void {
    // Setup buy button handlers - scope to dialog element
    const dialogBody = this.element?.querySelector('.dialog-body');
    if (!dialogBody) return;
    
    const buyButtons = dialogBody.querySelectorAll('.shop-buy-btn');
    buyButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const itemId = target.dataset.itemId;
        if (itemId) {
          this.handlePurchase(itemId, context);
        }
      });
    });
  }

  private handlePurchase(itemId: string, context: DialogContext): void {
    const shopSystem = ShopSystem.getInstance();
    const result = shopSystem.purchase(itemId);
    
    if (result) {
      // Refresh the dialog to show updated state
      if (this.element) {
        const body = this.element.querySelector('.dialog-body');
        if (body) {
          body.innerHTML = this.getBodyHTML(context);
          this.onOpen(context);
        }
      }
    }
  }
}

/**
 * Seed Store - only shows seeds category
 */
export class SeedStoreDialog extends ShopDialog {
  constructor() {
    super("seed_store", "🌱 Seed Store");
  }

  public getBodyHTML(context: DialogContext): string {
    return super.getBodyHTML({ ...context, category: "seeds" });
  }
}

/**
 * Supplies Store - only shows supplies category
 */
export class SuppliesStoreDialog extends ShopDialog {
  constructor() {
    super("supplies_store", "🧪 Supplies Store");
  }

  public getBodyHTML(context: DialogContext): string {
    return super.getBodyHTML({ ...context, category: "supplies" });
  }
}
