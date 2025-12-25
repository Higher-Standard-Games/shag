/**
 * OrderPanel - UI for displaying customer orders
 */

import { EventBus } from "../engine/core/EventBus";
import { OrderSystem, type Order } from "../game/OrderSystem";
import { GameState } from "../game/GameState";
import { PlantSystem } from "../game/PlantSystem";
import { UIStyles } from "../engine/ui/UIStyles";
import orderPanelCSS from "./styles/OrderPanel.css?raw";
import { UIManager } from "./UIManager";

export class OrderPanel {
  private static instance: OrderPanel;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  public static getInstance(): OrderPanel {
    if (!OrderPanel.instance) {
      OrderPanel.instance = new OrderPanel();
    }
    return OrderPanel.instance;
  }

  public show(): void {
    if (this.isVisible) return;

    this.createPanel();
    this.setupEventListeners();
    this.startUpdateLoop();
    this.isVisible = true;
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.stopUpdateLoop();
    this.container?.remove();
    this.container = null;
    this.isVisible = false;
  }

  private createPanel(): void {
    // Inject styles once
    UIStyles.injectCSS("order-panel", orderPanelCSS);

    this.container = document.createElement("div");
    this.container.id = "order-panel";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    this.update();
  }

  private getHTML(): string {
    return `
      <div class="order-panel-container">
        <div class="order-panel-header">
          <span class="order-title">📋 Orders</span>
          <button class="order-toggle" id="order-toggle">−</button>
        </div>
        <div class="order-list" id="order-list">
          <!-- Orders populated dynamically -->
        </div>
      </div>
    `;
  }

  private update(): void {
    const listEl = this.container?.querySelector("#order-list");
    if (!listEl) return;

    const orders = OrderSystem.getInstance().getActiveOrders();

    if (orders.length === 0) {
      listEl.innerHTML = `<div class="no-orders">No orders yet. Keep growing!</div>`;
      return;
    }

    listEl.innerHTML = orders.map(order => this.renderOrder(order)).join("");
  }

  private renderOrder(order: Order): string {
    const timeRemaining = OrderSystem.getInstance().getTimeRemaining(order.id);
    const timeStr = this.formatTime(timeRemaining);
    const isUrgent = timeRemaining < 60000; // Less than 1 minute
    const canFulfill = OrderSystem.getInstance().canFulfill(order.id);
    const inventory = GameState.getInstance().getInventory();

    const itemsHtml = Object.entries(order.items).map(([itemId, qty]) => {
      const item = inventory.items.find(i => i.id === itemId);
      const hasEnough = item && item.quantity >= qty;
      
      // Look up strain name from harvest item ID
      const strain = PlantSystem.getInstance().getStrainByHarvestId(itemId);
      const displayName = strain?.name ?? itemId.replace(/^harvest_/, "").replace(/_/g, " ");
      
      return `
        <span class="order-item ${hasEnough ? 'has-item' : 'missing'}">
          ${qty}x ${displayName}
        </span>
      `;
    }).join("");

    const reward = Math.floor(order.baseReward * order.tipMultiplier);

    return `
      <div class="order-card" data-order-id="${order.id}">
        <div class="order-header">
          <div class="order-customer">
            <span class="customer-icon">${order.customerIcon}</span>
            <span class="customer-name">${order.customerName}</span>
          </div>
          <span class="order-timer ${isUrgent ? 'urgent' : ''}">${timeStr}</span>
        </div>
        ${order.dialogue ? `<div class="order-dialogue">"${order.dialogue}"</div>` : ''}
        <div class="order-items">${itemsHtml}</div>
        <div class="order-footer">
          <span class="order-reward">$${reward} +${order.xpReward}XP</span>
          <span class="order-status" style="font-size: 0.8rem; color: ${canFulfill ? '#4CAF50' : '#666666'}; font-weight: 600;">
            ${canFulfill ? '✓ Ready' : 'Need Items'}
          </span>
        </div>
      </div>
    `;
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    // Toggle collapse
    this.container.querySelector("#order-toggle")?.addEventListener("click", () => {
      this.toggleCollapse();
    });
    
    // Clicking the header also toggles
    this.container.querySelector(".order-panel-header")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id !== "order-toggle") {
        this.toggleCollapse();
      }
    });

    // Order card clicks - open sale dialog
    this.container.querySelector("#order-list")?.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest(".order-card") as HTMLElement;
      if (card) {
        // Open sale dialog
        UIManager.getInstance().openDialog("sale_dialog", {});
      }
    });

    // Listen for order events via EventBus
    const orderEvents = ["order:order_created", "order:order_completed", "order:order_expired", "order:order_cancelled"];
    orderEvents.forEach(event => {
      EventBus.on(event, () => this.update());
    });
    
    // Accordion behavior: collapse when another panel opens
    EventBus.on<{ panel: string }>("ui:panel_expanded", ({ panel }) => {
      if (panel !== "order") {
        this.collapse();
      }
    });
  }
  
  private toggleCollapse(): void {
    const list = this.container?.querySelector("#order-list");
    const btn = this.container?.querySelector("#order-toggle");
    if (list && btn) {
      const wasCollapsed = list.classList.contains("collapsed");
      list.classList.toggle("collapsed");
      btn.textContent = list.classList.contains("collapsed") ? "+" : "−";
      
      // Emit event when expanding (for accordion behavior)
      if (wasCollapsed) {
        EventBus.emit("ui:panel_expanded", { panel: "order" });
      }
    }
  }
  
  private collapse(): void {
    const list = this.container?.querySelector("#order-list");
    const btn = this.container?.querySelector("#order-toggle");
    if (list && btn && !list.classList.contains("collapsed")) {
      list.classList.add("collapsed");
      btn.textContent = "+";
    }
  }

  private startUpdateLoop(): void {
    // Update every second for timer
    this.updateInterval = setInterval(() => {
      this.update();
    }, 1000);
  }

  private stopUpdateLoop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}
