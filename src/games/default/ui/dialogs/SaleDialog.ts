import { OrderSystem } from "../../OrderSystem";
import { GameState } from "../../GameState";
import { PlantSystem } from "../../PlantSystem";
import { BaseDialog, type DialogContext } from "./BaseDialog";
import { GameHUD } from "../GameHUD";

/**
 * Sale Dialog - Sell cured products to fulfill orders
 * 
 * Features:
 * - Shows available orders and cured inventory
 * - Click order to select, shows matching products
 * - Click product to sell to selected order
 * - Shows award notification on successful sale
 */
export class SaleDialog extends BaseDialog {
  private refreshInterval: number | null = null;
  private selectedOrderId: string | null = null;

  constructor() {
    super("sale_dialog", { title: "💰 Sell Products", width: "800px", maxWidth: "95vw" });
  }

  public getBodyHTML(_context: DialogContext): string {
    const orderSystem = OrderSystem.getInstance();
    const gameState = GameState.getInstance();
    const orders = orderSystem.getActiveOrders();
    const curedProducts = gameState.getItemsByType("harvest");

    // Orders Section
    let ordersHTML = "";
    if (orders.length === 0) {
      ordersHTML = `<div style="color: #666666; text-align: center; padding: 20px;">No active orders</div>`;
    } else {
      ordersHTML = orders.map(order => {
        const isSelected = this.selectedOrderId === order.id;
        const timeRemaining = orderSystem.getTimeRemaining(order.id);
        const timeStr = this.formatTime(timeRemaining);
        const isUrgent = timeRemaining < 60000;
        const canFulfill = orderSystem.canFulfill(order.id);
        
        // Get required items
        const itemsHTML = Object.entries(order.items).map(([itemId, required]) => {
          const item = curedProducts.find(p => p.id === itemId);
          const current = item?.quantity || 0;
          const hasEnough = current >= required;
          
          // Extract strain name
          const strainId = itemId.replace(/^harvest_/, "");
          const strain = PlantSystem.getInstance().getStrain(strainId) || 
                        PlantSystem.getInstance().getStrain(`strain_${strainId}`);
          const strainName = strain?.name ?? strainId.replace(/_/g, " ");
          
          return `
            <div style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 4px 8px;
              background: ${hasEnough ? "#E8F5E9" : "#FFEBEE"};
              border-radius: 4px;
              margin-bottom: 4px;
            ">
              <span style="font-size: 0.8rem; color: #333333;">${strainName}</span>
              <span style="font-size: 0.8rem; font-weight: 600; color: ${hasEnough ? "#4CAF50" : "#D32F2F"};">
                ${current}/${required}g
              </span>
            </div>
          `;
        }).join("");
        
        const reward = Math.floor(order.baseReward * order.tipMultiplier);
        
        return `
          <div class="sale-order selectable-order ${isSelected ? "selected" : ""}" data-order-id="${order.id}" style="
            padding: 12px;
            background: ${isSelected ? "#E3F2FD" : "#FFFFFF"};
            border-radius: 8px;
            margin-bottom: 8px;
            border: 2px solid ${isSelected ? "#2196F3" : "#E0E0E0"};
            cursor: pointer;
            transition: all 0.15s;
          ">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3rem;">${order.customerIcon}</span>
                <div>
                  <div style="font-weight: 600; color: #333333; font-size: 0.9rem;">${order.customerName}</div>
                  <div style="font-size: 0.75rem; color: #666666;">$${reward} + ${order.xpReward}XP</div>
                </div>
              </div>
              <span style="
                font-size: 0.75rem;
                font-weight: 600;
                color: ${isUrgent ? "#D32F2F" : "#666666"};
                padding: 4px 8px;
                background: ${isUrgent ? "#FFEBEE" : "#F5F5F5"};
                border-radius: 4px;
              ">${timeStr}</span>
            </div>
            ${order.dialogue ? `<div style="font-size: 0.8rem; color: #666666; font-style: italic; margin-bottom: 8px;">"${order.dialogue}"</div>` : ""}
            <div style="margin-top: 8px;">
              ${itemsHTML}
            </div>
            ${isSelected ? `
              <div style="margin-top: 8px; text-align: center; color: #1976D2; font-size: 0.8rem; font-weight: 600;">
                ${canFulfill ? "✓ Ready to sell" : "→ Need more products"}
              </div>
            ` : ""}
          </div>
        `;
      }).join("");
    }

    // Cured Products Section
    let productsHTML = "";
    if (curedProducts.length === 0) {
      productsHTML = `<div style="color: #666666; text-align: center; padding: 20px;">No cured products. Cure fresh harvest first!</div>`;
    } else {
      productsHTML = curedProducts.map(product => {
        // Extract strain name
        const strainId = product.id.replace(/^harvest_/, "");
        const strain = PlantSystem.getInstance().getStrain(strainId) || 
                      PlantSystem.getInstance().getStrain(`strain_${strainId}`);
        const strainName = strain?.name ?? strainId.replace(/_/g, " ");
        
        return `
          <div style="
            background: #F0FDF4;
            border: 1px solid #86EFAC;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
          ">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.3rem;">📦</span>
              <div style="flex: 1;">
                <div style="font-weight: 600; color: #166534; font-size: 0.9rem;">${strainName}</div>
                <div style="font-size: 0.85rem; color: #15803D; font-weight: 500;">${product.quantity}g available</div>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }

    // Action button
    let actionHTML = "";
    if (this.selectedOrderId) {
      const order = orderSystem.getOrder(this.selectedOrderId);
      const canFulfill = order && orderSystem.canFulfill(this.selectedOrderId);
      
      if (order && canFulfill) {
        const reward = Math.floor(order.baseReward * order.tipMultiplier);
        
        actionHTML = `
          <div style="
            margin-top: 16px;
            padding: 16px;
            background: #E8F5E9;
            border-radius: 8px;
            border: 1px solid #A5D6A7;
          ">
            <div style="font-weight: 600; color: #333333; margin-bottom: 8px;">
              Ready to Complete Order
            </div>
            <div style="font-size: 0.9rem; color: #666666; margin-bottom: 12px;">
              Customer: ${order.customerName}<br>
              Reward: $${reward} + ${order.xpReward}XP
            </div>
            <button class="complete-sale-btn" style="
              padding: 12px 24px;
              background: #4CAF50;
              border: none;
              border-bottom: 4px solid #3D9140;
              border-radius: 6px;
              color: #fff;
              font-weight: 600;
              cursor: pointer;
              width: 100%;
              font-size: 1rem;
            ">💰 Complete Sale</button>
          </div>
        `;
      }
    }

    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start;">
        <!-- Orders Column -->
        <div style="background: #FAFAFA; border-radius: 10px; padding: 12px; border: 1px solid #E8E8E8;">
          <h3 style="margin: 0 0 10px 0; color: #333333; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            📋 Active Orders
          </h3>
          <div style="max-height: 300px; overflow-y: auto;">
            ${ordersHTML}
          </div>
        </div>
        
        <!-- Cured Products Column -->
        <div style="background: #F0FDF4; border-radius: 10px; padding: 12px; border: 1px solid #BBF7D0;">
          <h3 style="margin: 0 0 10px 0; color: #166534; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            📦 Your Products
          </h3>
          <div style="max-height: 300px; overflow-y: auto;">
            ${productsHTML}
          </div>
        </div>
      </div>
      ${actionHTML}
    `;
  }

  protected onOpen(context: DialogContext): void {
    this.selectedOrderId = null;
    this.setupEventHandlers(context);
    this.startAutoRefresh(context);
  }

  protected onClose(): void {
    this.stopAutoRefresh();
    this.selectedOrderId = null;
  }

  private setupEventHandlers(context: DialogContext): void {
    const orderSystem = OrderSystem.getInstance();
    
    // Use the dialog element as the root for queries
    const dialogBody = this.element?.querySelector(".dialog-body");
    if (!dialogBody) {
      console.warn("[SaleDialog] Dialog body not found");
      return;
    }

    // Order selection
    const orderElements = dialogBody.querySelectorAll(".selectable-order");
    console.log("[SaleDialog] Found", orderElements.length, "selectable orders");
    
    orderElements.forEach(orderEl => {
      orderEl.addEventListener("click", () => {
        const id = (orderEl as HTMLElement).dataset.orderId;
        console.log("[SaleDialog] Order clicked:", id);
        if (id) {
          this.selectedOrderId = this.selectedOrderId === id ? null : id;
          this.refresh(context);
        }
      });
    });

    // Complete sale button
    const saleBtn = dialogBody.querySelector(".complete-sale-btn");
    console.log("[SaleDialog] Sale button found:", !!saleBtn);
    
    saleBtn?.addEventListener("click", () => {
      console.log("[SaleDialog] Complete sale clicked, selectedOrderId:", this.selectedOrderId);
      if (this.selectedOrderId) {
        const order = orderSystem.getOrder(this.selectedOrderId);
        console.log("[SaleDialog] Order found:", !!order, "canFulfill:", order ? orderSystem.canFulfill(this.selectedOrderId) : false);
        if (order && orderSystem.fulfillOrder(this.selectedOrderId)) {
          // Show award notification
          const reward = Math.floor(order.baseReward * order.tipMultiplier);
          GameHUD.getInstance().showGameAward(
            "💰",
            `Sale Complete! +$${reward} +${order.xpReward}XP`
          );
          
          this.selectedOrderId = null;
          this.refresh(context);
        }
      }
    });
  }

  private refresh(context: DialogContext): void {
    if (this.element) {
      const body = this.element.querySelector(".dialog-body");
      if (body) {
        body.innerHTML = this.getBodyHTML(context);
        this.setupEventHandlers(context);
      }
    }
  }

  private startAutoRefresh(context: DialogContext): void {
    this.refreshInterval = window.setInterval(() => {
      this.refresh(context);
    }, 1000);
  }

  private stopAutoRefresh(): void {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
