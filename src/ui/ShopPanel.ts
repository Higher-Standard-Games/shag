/**
 * ShopPanel - UI for the shop/store
 */

import { ShopSystem, type ShopItem } from "../game/ShopSystem";
import { GameState } from "../game/GameState";
import { UIStyles } from "../engine/ui/UIStyles";
import shopPanelCSS from "./styles/ShopPanel.css?raw";

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
    // Inject styles once
    UIStyles.injectCSS("shop-panel", shopPanelCSS);

    this.container = document.createElement("div");
    this.container.id = "shop-panel";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

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
