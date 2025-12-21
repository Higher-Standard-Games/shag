/**
 * OrderPanel - UI for displaying customer orders
 */

import { OrderSystem, type Order } from "../game/OrderSystem";
import { GameState } from "../game/GameState";

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
    this.container = document.createElement("div");
    this.container.id = "order-panel";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    const style = document.createElement("style");
    style.textContent = this.getStyles();
    this.container.appendChild(style);

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

  private getStyles(): string {
    return `
      #order-panel {
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 100;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .order-panel-container {
        background: #FAFAFA;
        border-radius: 12px;
        min-width: 280px;
        max-width: 320px;
        border: 1px solid #E0E0E0;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }

      .order-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        border-bottom: 1px solid #E0E0E0;
        background: #F5F5F5;
        border-radius: 12px 12px 0 0;
      }

      .order-title {
        color: #333333;
        font-size: 16px;
        font-weight: 600;
      }

      .order-toggle {
        background: #E8E8E8;
        border: none;
        border-bottom: 2px solid #CCCCCC;
        color: #666666;
        font-size: 16px;
        cursor: pointer;
        padding: 4px 10px;
        border-radius: 6px;
        transition: all 0.1s ease;
      }

      .order-toggle:hover {
        background: #F5F5F5;
      }

      .order-list {
        max-height: 400px;
        overflow-y: auto;
      }

      .order-list.collapsed {
        display: none;
      }

      .order-card {
        padding: 12px 15px;
        border-bottom: 1px solid #E8E8E8;
        background: #FFFFFF;
        transition: background 0.15s ease;
      }

      .order-card:hover {
        background: #F5F5F5;
      }

      .order-card:last-child {
        border-bottom: none;
        border-radius: 0 0 12px 12px;
      }

      .order-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .order-customer {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .customer-icon {
        font-size: 24px;
      }

      .customer-name {
        color: #333333;
        font-weight: 500;
      }

      .order-timer {
        color: #F57C00;
        font-size: 12px;
        font-weight: 600;
        background: #FFF8E1;
        padding: 2px 8px;
        border-radius: 4px;
      }

      .order-timer.urgent {
        color: #D32F2F;
        background: #FFEBEE;
        animation: pulse 1s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .order-items {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 8px;
      }

      .order-item {
        background: #F5F5F5;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        color: #333333;
        border: 1px solid #E0E0E0;
      }

      .order-item.has-item {
        background: #E8F5E9;
        border: 1px solid #4CAF50;
        color: #2E7D32;
      }

      .order-item.missing {
        background: #FFEBEE;
        border: 1px solid #EF9A9A;
        color: #D32F2F;
      }

      .order-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .order-reward {
        color: #2E7D32;
        font-weight: 600;
      }

      .order-fulfill {
        background: #4CAF50;
        border: none;
        border-bottom: 3px solid #3D9140;
        color: white;
        padding: 6px 15px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.1s ease;
        position: relative;
        top: 0;
      }

      .order-fulfill:hover {
        background: #5CBF60;
        top: -1px;
      }

      .order-fulfill:active {
        top: 3px;
        border-bottom-width: 0;
      }

      .order-fulfill:disabled {
        background: #E0E0E0;
        border-bottom-color: #CCCCCC;
        color: #999999;
        cursor: not-allowed;
        top: 0;
      }

      .order-dialogue {
        color: #666666;
        font-size: 11px;
        font-style: italic;
        margin-bottom: 8px;
      }

      .no-orders {
        color: #888888;
        text-align: center;
        padding: 20px;
        font-size: 14px;
        background: #FFFFFF;
        border-radius: 0 0 12px 12px;
      }
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
      const current = item?.quantity || 0;
      return `
        <span class="order-item ${hasEnough ? 'has-item' : 'missing'}">
          ${itemId.replace('harvest_', '')} ${current}/${qty}
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
          <button class="order-fulfill" ${canFulfill ? '' : 'disabled'} data-order-id="${order.id}">
            ${canFulfill ? 'Fulfill' : 'Need Items'}
          </button>
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
      const list = this.container?.querySelector("#order-list");
      const btn = this.container?.querySelector("#order-toggle");
      if (list && btn) {
        list.classList.toggle("collapsed");
        btn.textContent = list.classList.contains("collapsed") ? "+" : "−";
      }
    });

    // Fulfill buttons
    this.container.querySelector("#order-list")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".order-fulfill") as HTMLElement;
      if (btn && !btn.hasAttribute("disabled")) {
        const orderId = btn.dataset.orderId;
        if (orderId) {
          OrderSystem.getInstance().fulfillOrder(orderId);
          this.update();
        }
      }
    });

    // Listen for order events
    OrderSystem.getInstance().onOrderEvent((event) => {
      if (["order_created", "order_completed", "order_expired", "order_cancelled"].includes(event)) {
        this.update();
      }
    });
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
