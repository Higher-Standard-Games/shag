/**
 * ShopPanel - UI for the shop/store
 */

import { ShopSystem, type ShopItem } from "../game/ShopSystem";
import { GameState } from "../game/GameState";

export class ShopPanel {
  private static instance: ShopPanel;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;
  private currentCategory: string = "seeds";

  private constructor() {}

  public static getInstance(): ShopPanel {
    if (!ShopPanel.instance) {
      ShopPanel.instance = new ShopPanel();
    }
    return ShopPanel.instance;
  }

  public show(): void {
    if (this.isVisible) return;

    this.createPanel();
    this.setupEventListeners();
    this.isVisible = true;
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.container?.remove();
    this.container = null;
    this.isVisible = false;
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  private createPanel(): void {
    this.container = document.createElement("div");
    this.container.id = "shop-panel";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    const style = document.createElement("style");
    style.textContent = this.getStyles();
    this.container.appendChild(style);

    this.updateItems();
  }

  private getHTML(): string {
    const categories = ShopSystem.getInstance().getCategories();
    
    return `
      <div class="shop-overlay">
        <div class="shop-container">
          <div class="shop-header">
            <span class="shop-title">🛒 Shop</span>
            <span class="shop-money">$${GameState.getInstance().getPlayer().money}</span>
            <button class="shop-close" id="shop-close">✕</button>
          </div>
          <div class="shop-categories">
            ${categories.map(cat => `
              <button class="shop-category ${cat.id === this.currentCategory ? 'active' : ''}" 
                      data-category="${cat.id}">
                ${cat.icon} ${cat.name}
              </button>
            `).join("")}
          </div>
          <div class="shop-items" id="shop-items">
            <!-- Items populated dynamically -->
          </div>
        </div>
      </div>
    `;
  }

  private getStyles(): string {
    return `
      #shop-panel {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 200;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .shop-overlay {
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .shop-container {
        background: rgba(20, 20, 20, 0.95);
        border-radius: 15px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .shop-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 20px;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .shop-title {
        color: white;
        font-size: 20px;
        font-weight: bold;
      }

      .shop-money {
        color: #4CAF50;
        font-size: 18px;
        font-weight: bold;
      }

      .shop-close {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        transition: background 0.2s;
      }

      .shop-close:hover {
        background: rgba(244, 67, 54, 0.5);
      }

      .shop-categories {
        display: flex;
        gap: 5px;
        padding: 10px 15px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        overflow-x: auto;
      }

      .shop-category {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        padding: 8px 15px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        white-space: nowrap;
        transition: all 0.2s;
      }

      .shop-category:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .shop-category.active {
        background: linear-gradient(135deg, #4CAF50, #45a049);
      }

      .shop-items {
        flex: 1;
        overflow-y: auto;
        padding: 15px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 15px;
      }

      .shop-item {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        padding: 15px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.2s;
      }

      .shop-item:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: translateY(-2px);
      }

      .shop-item.locked {
        opacity: 0.5;
      }

      .shop-item-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .shop-item-icon {
        font-size: 32px;
      }

      .shop-item-info {
        flex: 1;
      }

      .shop-item-name {
        color: white;
        font-weight: bold;
        font-size: 14px;
      }

      .shop-item-qty {
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
      }

      .shop-item-desc {
        color: rgba(255, 255, 255, 0.7);
        font-size: 12px;
        margin-bottom: 10px;
        line-height: 1.4;
      }

      .shop-item-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .shop-item-price {
        color: #ffd700;
        font-weight: bold;
        font-size: 16px;
      }

      .shop-item-price.on-sale {
        color: #ff6b6b;
      }

      .shop-item-price .original {
        text-decoration: line-through;
        color: rgba(255, 255, 255, 0.4);
        font-size: 12px;
        margin-right: 5px;
      }

      .shop-item-buy {
        background: linear-gradient(135deg, #4CAF50, #45a049);
        border: none;
        color: white;
        padding: 8px 20px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        transition: all 0.2s;
      }

      .shop-item-buy:hover {
        transform: scale(1.05);
      }

      .shop-item-buy:disabled {
        background: #666;
        cursor: not-allowed;
        transform: none;
      }

      .shop-item-stock {
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        margin-top: 5px;
      }

      .shop-item-level {
        color: #ff6b6b;
        font-size: 11px;
      }

      .sale-badge {
        background: #ff6b6b;
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: bold;
        margin-left: 5px;
      }
    `;
  }

  private updateItems(): void {
    const container = this.container?.querySelector("#shop-items");
    if (!container) return;

    const items = ShopSystem.getInstance().getItemsByCategory(this.currentCategory);
    const playerLevel = GameState.getInstance().getPlayer().level;
    const playerMoney = GameState.getInstance().getPlayer().money;

    container.innerHTML = items.map(item => this.renderItem(item, playerLevel, playerMoney)).join("");

    // Update money display
    const moneyEl = this.container?.querySelector(".shop-money");
    if (moneyEl) {
      moneyEl.textContent = `$${playerMoney}`;
    }
  }

  private renderItem(item: ShopItem, playerLevel: number, playerMoney: number): string {
    const isLocked = item.requiredLevel > playerLevel;
    const effectivePrice = ShopSystem.getInstance().getEffectivePrice(item.id);
    const canAfford = playerMoney >= effectivePrice;
    const canBuy = !isLocked && canAfford && (item.stock === -1 || item.stock > 0);

    return `
      <div class="shop-item ${isLocked ? 'locked' : ''}">
        <div class="shop-item-header">
          <span class="shop-item-icon">${item.icon}</span>
          <div class="shop-item-info">
            <div class="shop-item-name">
              ${item.name}
              ${item.onSale ? `<span class="sale-badge">-${Math.round(item.saleDiscount * 100)}%</span>` : ''}
            </div>
            <div class="shop-item-qty">×${item.quantity}</div>
          </div>
        </div>
        <div class="shop-item-desc">${item.description}</div>
        <div class="shop-item-footer">
          <span class="shop-item-price ${item.onSale ? 'on-sale' : ''}">
            ${item.onSale ? `<span class="original">$${item.price}</span>` : ''}
            $${effectivePrice}
          </span>
          <button class="shop-item-buy" ${canBuy ? '' : 'disabled'} data-item-id="${item.id}">
            ${isLocked ? `Lv.${item.requiredLevel}` : (canAfford ? 'Buy' : 'No $')}
          </button>
        </div>
        ${item.stock !== -1 ? `<div class="shop-item-stock">Stock: ${item.stock}</div>` : ''}
        ${isLocked ? `<div class="shop-item-level">Requires Level ${item.requiredLevel}</div>` : ''}
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    // Close button
    this.container.querySelector("#shop-close")?.addEventListener("click", () => {
      this.hide();
    });

    // Click outside to close
    this.container.querySelector(".shop-overlay")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("shop-overlay")) {
        this.hide();
      }
    });

    // Category buttons
    this.container.querySelectorAll(".shop-category").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const category = (e.target as HTMLElement).dataset.category;
        if (category) {
          this.currentCategory = category;
          this.container?.querySelectorAll(".shop-category").forEach(b => 
            b.classList.toggle("active", (b as HTMLElement).dataset.category === category)
          );
          this.updateItems();
        }
      });
    });

    // Buy buttons
    this.container.querySelector("#shop-items")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".shop-item-buy") as HTMLElement;
      if (btn && !btn.hasAttribute("disabled")) {
        const itemId = btn.dataset.itemId;
        if (itemId) {
          ShopSystem.getInstance().purchase(itemId);
          this.updateItems();
        }
      }
    });

    // Listen for shop events
    ShopSystem.getInstance().onShopEvent((event) => {
      if (event === "purchase_success") {
        this.updateItems();
      }
    });

    // Escape to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.hide();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }
}
