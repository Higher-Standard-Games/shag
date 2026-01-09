/**
 * DealerDialog - UI for selling products to dealers
 * 
 * Shows available dealers, sellable products, and handles transactions
 */

import { DealerSystem, type Dealer } from "../../DealerSystem";
import { GameHUD } from "../GameHUD";
import { BaseDialog, type DialogContext } from "./BaseDialog";

export class DealerDialog extends BaseDialog {
  private selectedDealer: Dealer | null = null;
  private selectedProducts: Map<string, number> = new Map(); // itemId -> quantity

  constructor() {
    super("dealer_dialog", { title: "💰 Sell Products", width: "650px", maxWidth: "95vw" });
  }

  public getBodyHTML(_context: DialogContext): string {
    const dealerSystem = DealerSystem.getInstance();
    const availableDealers = dealerSystem.getAvailableDealers();
    const allDealers = Array.from((dealerSystem as any).dealers?.values() || []) as Dealer[];
    const sellableProducts = dealerSystem.getSellableProducts();
    const heat = dealerSystem.getHeat();
    const heatLevel = dealerSystem.getHeatLevel();

    // Heat indicator
    const heatColor = heatLevel === "cool" ? "#4ade80" : 
                      heatLevel === "warm" ? "#fbbf24" : 
                      heatLevel === "hot" ? "#f97316" : "#ef4444";

    let html = `
      <div class="dealer-container">
        <!-- Heat Indicator -->
        <div class="dealer-heat" style="
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #F0F0F0;
          border-radius: 8px;
          margin-bottom: 16px;
          border: 1px solid #E0E0E0;
        ">
          <span style="font-size: 1.2rem;">🔥</span>
          <div style="flex: 1;">
            <div style="font-size: 0.85rem; color: #666666;">Heat Level</div>
            <div style="
              height: 6px;
              background: #E0E0E0;
              border-radius: 3px;
              overflow: hidden;
              margin-top: 4px;
            ">
              <div style="
                width: ${heat}%;
                height: 100%;
                background: ${heatColor};
                transition: width 0.3s;
              "></div>
            </div>
          </div>
          <span style="color: ${heatColor}; font-weight: 500; text-transform: capitalize;">${heatLevel}</span>
        </div>

        <!-- Dealer Selection -->
        <div class="dealer-section">
          <div class="dealer-section-title">Select Dealer</div>
          <div class="dealer-list" style="
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
          ">
    `;

    // Show all dealers (available and locked)
    for (const dealer of allDealers) {
      const isAvailable = availableDealers.some(d => d.id === dealer.id);
      const isSelected = this.selectedDealer?.id === dealer.id;
      const rep = dealerSystem.getReputation(dealer.id);

      html += `
        <div class="dealer-card ${isAvailable ? 'dealer-available' : 'dealer-locked'} ${isSelected ? 'dealer-selected' : ''}"
             data-dealer-id="${dealer.id}"
             style="
               padding: 12px;
               background: ${isSelected ? '#E3F2FD' : '#FFFFFF'};
               border: 1px solid ${isSelected ? '#2196F3' : '#E0E0E0'};
               border-radius: 8px;
               cursor: ${isAvailable ? 'pointer' : 'not-allowed'};
               opacity: ${isAvailable ? '1' : '0.5'};
               min-width: 140px;
               text-align: center;
               transition: all 0.15s ease;
             ">
          <div style="font-size: 2rem;">${dealer.icon}</div>
          <div style="font-weight: 500; color: #333333; margin-top: 4px;">${dealer.name}</div>
          <div style="font-size: 0.8rem; color: #666666;">${dealer.title}</div>
          ${dealer.priceMultiplier > 1 ? `<div style="font-size: 0.75rem; color: #2E7D32;">+${Math.round((dealer.priceMultiplier - 1) * 100)}% prices</div>` : ''}
          ${dealer.priceMultiplier < 1 ? `<div style="font-size: 0.75rem; color: #E65100;">${Math.round((1 - dealer.priceMultiplier) * 100)}% less</div>` : ''}
          ${rep ? `<div style="font-size: 0.7rem; color: #666666; margin-top: 4px;">Rep: ${rep.level}/100</div>` : ''}
          ${!isAvailable ? `<div style="font-size: 0.7rem; color: #D32F2F; margin-top: 4px;">Lvl ${dealer.requiredLevel} req</div>` : ''}
        </div>
      `;
    }

    html += `
          </div>
        </div>
    `;

    // Products section (only if dealer selected)
    if (this.selectedDealer) {
      html += `
        <div class="dealer-section">
          <div class="dealer-section-title">Your Products</div>
      `;

      if (sellableProducts.length === 0) {
        html += `<div style="color: #666666; text-align: center; padding: 20px;">No products to sell. Harvest and cure some plants first!</div>`;
      } else {
        html += `<div class="product-list" style="display: flex; flex-direction: column; gap: 8px;">`;
        
        for (const product of sellableProducts) {
          const selectedQty = this.selectedProducts.get(product.itemId) || 0;
          const priceInfo = dealerSystem.calculatePrice(
            this.selectedDealer.id,
            product.itemId,
            selectedQty || 1,
            product.quality
          );

          html += `
            <div class="product-item" data-item-id="${product.itemId}" style="
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 12px;
              background: #FFFFFF;
              border-radius: 8px;
              border: 1px solid ${selectedQty > 0 ? '#2196F3' : '#E0E0E0'};
            ">
              <div style="font-size: 1.5rem;">${product.category === 'cured' ? '🧪' : '🌿'}</div>
              <div style="flex: 1;">
                <div style="font-weight: 500; color: #333333;">${product.name}</div>
                <div style="font-size: 0.85rem; color: #666666;">
                  ${product.quantity}g available | Quality: ${product.quality}%
                </div>
                <div style="font-size: 0.85rem; color: #2E7D32;">
                  $${priceInfo?.pricePerUnit || product.basePrice}/g
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button class="qty-btn qty-minus" data-item-id="${product.itemId}" style="
                  width: 28px; height: 28px;
                  border: none; border-radius: 6px;
                  background: #E0E0E0;
                  color: #333333; cursor: pointer;
                  font-size: 1.2rem;
                ">-</button>
                <input type="number" class="qty-input" data-item-id="${product.itemId}" 
                       value="${selectedQty}" min="0" max="${product.quantity}"
                       style="
                         width: 60px; height: 28px;
                         border: 1px solid #CCCCCC;
                         border-radius: 4px;
                         background: #FFFFFF;
                         color: #333333;
                         text-align: center;
                         font-size: 0.9rem;
                       ">
                <button class="qty-btn qty-plus" data-item-id="${product.itemId}" style="
                  width: 28px; height: 28px;
                  border: none; border-radius: 6px;
                  background: #E0E0E0;
                  color: #333333; cursor: pointer;
                  font-size: 1.2rem;
                ">+</button>
                <button class="qty-btn qty-all" data-item-id="${product.itemId}" data-max="${product.quantity}" style="
                  padding: 4px 8px;
                  border: none; border-radius: 4px;
                  background: #E3F2FD;
                  color: #1976D2; cursor: pointer;
                  font-size: 0.75rem;
                ">ALL</button>
              </div>
            </div>
          `;
        }
        html += `</div>`;
      }

      // Sale summary
      const totalInfo = this.calculateTotalSale();
      html += `
        <div class="sale-summary" style="
          margin-top: 16px;
          padding: 16px;
          background: #F0F0F0;
          border-radius: 8px;
          border: 1px solid #E0E0E0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <div style="font-size: 0.85rem; color: #666666;">Total Sale</div>
            <div style="font-size: 1.5rem; font-weight: 600; color: #2E7D32;">$${totalInfo.total}</div>
            <div style="font-size: 0.8rem; color: #666666;">${totalInfo.quantity}g total</div>
          </div>
          <button id="btn-sell" ${totalInfo.quantity === 0 ? 'disabled' : ''} style="
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            background: ${totalInfo.quantity > 0 ? '#4CAF50' : '#E0E0E0'};
            border-bottom: ${totalInfo.quantity > 0 ? '4px solid #3D9140' : '4px solid #CCCCCC'};
            color: ${totalInfo.quantity > 0 ? '#fff' : '#999'};
            font-weight: 600;
            font-size: 1rem;
            cursor: ${totalInfo.quantity > 0 ? 'pointer' : 'not-allowed'};
          ">
            💰 Sell Now
          </button>
        </div>
      `;

      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  private calculateTotalSale(): { total: number; quantity: number } {
    if (!this.selectedDealer) return { total: 0, quantity: 0 };

    const dealerSystem = DealerSystem.getInstance();
    let total = 0;
    let quantity = 0;

    for (const [itemId, qty] of this.selectedProducts) {
      if (qty <= 0) continue;
      
      const products = dealerSystem.getSellableProducts();
      const product = products.find(p => p.itemId === itemId);
      if (!product) continue;

      const priceInfo = dealerSystem.calculatePrice(
        this.selectedDealer.id,
        itemId,
        qty,
        product.quality
      );

      if (priceInfo) {
        total += priceInfo.totalPrice;
        quantity += qty;
      }
    }

    return { total, quantity };
  }

  public setupEventListeners(container: HTMLElement): void {
    // Dealer selection
    container.querySelectorAll('.dealer-available').forEach(card => {
      card.addEventListener('click', () => {
        const dealerId = (card as HTMLElement).dataset.dealerId;
        if (dealerId) {
          const dealer = DealerSystem.getInstance().getDealer(dealerId);
          if (dealer) {
            this.selectedDealer = dealer;
            this.selectedProducts.clear();
            this.refresh();
          }
        }
      });
    });

    // Quantity buttons
    container.querySelectorAll('.qty-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.itemId!;
        const current = this.selectedProducts.get(itemId) || 0;
        this.selectedProducts.set(itemId, Math.max(0, current - 1));
        this.refresh();
      });
    });

    container.querySelectorAll('.qty-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.itemId!;
        const products = DealerSystem.getInstance().getSellableProducts();
        const product = products.find(p => p.itemId === itemId);
        if (!product) return;

        const current = this.selectedProducts.get(itemId) || 0;
        this.selectedProducts.set(itemId, Math.min(product.quantity, current + 1));
        this.refresh();
      });
    });

    container.querySelectorAll('.qty-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.itemId!;
        const max = parseInt((btn as HTMLElement).dataset.max || '0');
        this.selectedProducts.set(itemId, max);
        this.refresh();
      });
    });

    container.querySelectorAll('.qty-input').forEach(input => {
      input.addEventListener('change', () => {
        const itemId = (input as HTMLInputElement).dataset.itemId!;
        const value = parseInt((input as HTMLInputElement).value) || 0;
        const products = DealerSystem.getInstance().getSellableProducts();
        const product = products.find(p => p.itemId === itemId);
        if (!product) return;

        this.selectedProducts.set(itemId, Math.max(0, Math.min(product.quantity, value)));
        this.refresh();
      });
    });

    // Sell button
    container.querySelector('#btn-sell')?.addEventListener('click', () => {
      this.executeSale();
    });
  }

  private executeSale(): void {
    if (!this.selectedDealer) return;

    const dealerSystem = DealerSystem.getInstance();
    const items: Array<{ itemId: string; quantity: number; quality?: number }> = [];

    for (const [itemId, qty] of this.selectedProducts) {
      if (qty <= 0) continue;
      
      const products = dealerSystem.getSellableProducts();
      const product = products.find(p => p.itemId === itemId);
      if (!product) continue;

      items.push({
        itemId,
        quantity: qty,
        quality: product.quality,
      });
    }

    if (items.length === 0) return;

    const result = dealerSystem.sell(this.selectedDealer.id, items);

    if (result.success) {
      GameHUD.getInstance().showNotification(
        `Sold for $${result.totalEarnings}! (+${result.xpGained} XP)`,
        "success"
      );
      this.selectedProducts.clear();
      this.refresh();
    } else {
      GameHUD.getInstance().showNotification(
        result.reason || "Sale failed",
        "error"
      );
    }
  }

  private refresh(): void {
    const container = document.querySelector(`#${this.id}`);
    if (container) {
      const body = container.querySelector('.dialog-body');
      if (body) {
        body.innerHTML = this.getBodyHTML({});
        this.setupEventListeners(container as HTMLElement);
      }
    }
  }
}
