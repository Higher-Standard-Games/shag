import { CuringSystem, type CuringBarrel } from "../../CuringSystem";
import { PlantSystem } from "../../PlantSystem";
import { GameState } from "../../GameState";
import { BaseDialog, type DialogContext } from "./BaseDialog";

/**
 * Curing Dialog - Manages fresh storage and curing barrels
 * 
 * Features:
 * - Two-panel layout: left for selection, right for details
 * - Static bottom action bar (always visible)
 * - Barrel durability and condition display
 * - Burping mechanic for basic barrels
 * - Purchase barrels directly from dialog
 */
export class CuringDialog extends BaseDialog {
  private refreshInterval: number | null = null;
  private selectedFreshItemId: string | null = null;
  private selectedBarrelId: string | null = null;
  private showPurchasePanel: boolean = false;

  constructor() {
    super("curing_dialog", { title: "🏺 Curing Station", width: "800px", maxWidth: "95vw" });
  }

  public getBodyHTML(_context: DialogContext): string {
    if (this.showPurchasePanel) {
      return this.getPurchasePanelHTML();
    }
    return this.getMainPanelHTML();
  }

  private getMainPanelHTML(): string {
    const curingSystem = CuringSystem.getInstance();
    const freshItems = curingSystem.getFreshStorage();
    const barrels = curingSystem.getOwnedBarrels();

    // Build left panel - Fresh Harvest
    const leftPanelHTML = this.buildFreshHarvestPanel(freshItems, curingSystem);
    
    // Build right panel - Curing Devices
    const rightPanelHTML = this.buildCuringDevicesPanel(barrels, curingSystem);
    
    // Build bottom action bar
    const actionBarHTML = this.buildActionBar(freshItems, barrels, curingSystem);

    return `
      <div style="display: flex; flex-direction: column; height: 100%; min-height: 400px;">
        <!-- Main content area - Two columns side by side -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1; overflow: hidden;">
          <!-- Left Panel: Fresh Harvest -->
          <div style="display: flex; flex-direction: column; overflow-y: auto; padding-right: 4px;">
            ${leftPanelHTML}
          </div>
          
          <!-- Right Panel: Curing Devices -->
          <div style="display: flex; flex-direction: column; overflow-y: auto; padding-right: 4px;">
            ${rightPanelHTML}
          </div>
        </div>
        
        <!-- Bottom Action Bar (always visible) -->
        <div style="
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid #E0E0E0;
          flex-shrink: 0;
        ">
          ${actionBarHTML}
        </div>
      </div>
    `;
  }

  private buildFreshHarvestPanel(freshItems: ReturnType<typeof CuringSystem.prototype.getFreshStorage>, curingSystem: CuringSystem): string {
    let html = `
      <div style="background: #FAFAFA; border-radius: 10px; padding: 12px; border: 1px solid #E8E8E8; height: 100%;">
        <h3 style="margin: 0 0 12px 0; color: #333333; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
          🌿 Fresh Harvest <span style="color: #888; font-weight: normal;">(${freshItems.length})</span>
        </h3>
    `;

    if (freshItems.length === 0) {
      html += `
        <div style="color: #888; text-align: center; padding: 32px 16px; font-size: 0.85rem;">
          <div style="font-size: 2rem; margin-bottom: 8px; opacity: 0.5;">🌱</div>
          No fresh harvest
          <div style="font-size: 0.75rem; margin-top: 4px;">Harvest plants to get fresh product</div>
        </div>
      `;
    } else {
      html += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
      for (const item of freshItems) {
        const strain = PlantSystem.getInstance().getStrain(item.strainId);
        const decayStatus = curingSystem.getDecayStatus(item.id);
        const decayPercent = decayStatus?.percentRemaining ?? 100;
        const decayColor = decayPercent > 50 ? "#4ade80" : decayPercent > 25 ? "#fbbf24" : "#ef4444";
        const isSelected = this.selectedFreshItemId === item.id;
        
        html += `
          <div class="fresh-item selectable-item" data-id="${item.id}" style="
            display: flex; align-items: center; gap: 10px; padding: 12px;
            background: ${isSelected ? "#E8F5E9" : "#fff"};
            border: 2px solid ${isSelected ? "#4CAF50" : "#E8E8E8"};
            border-radius: 8px; cursor: pointer; transition: all 0.15s;
          ">
            <div style="font-size: 1.5rem;">🌿</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; color: #333; font-size: 0.9rem;">${strain?.name ?? item.strainId}</div>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
                <span style="font-size: 0.9rem; color: #666; font-weight: 600;">${item.amount}g</span>
                <div style="flex: 1; height: 5px; background: #E0E0E0; border-radius: 3px; overflow: hidden;">
                  <div style="width: ${decayPercent}%; height: 100%; background: ${decayColor};"></div>
                </div>
                <span style="font-size: 0.75rem; color: ${decayColor}; font-weight: 500;">${Math.round(decayPercent)}%</span>
              </div>
            </div>
            ${isSelected ? `<div style="color: #4CAF50; font-size: 1.3rem;">✓</div>` : ""}
          </div>
        `;
      }
      html += `</div>`;
    }
    html += `</div>`;

    return html;
  }

  private buildCuringDevicesPanel(barrels: ReturnType<typeof CuringSystem.prototype.getOwnedBarrels>, curingSystem: CuringSystem): string {
    let html = `
      <div style="background: #FAFAFA; border-radius: 10px; padding: 12px; border: 1px solid #E8E8E8; height: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; color: #333333; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            🏺 Curing Devices <span style="color: #888; font-weight: normal;">(${barrels.length})</span>
          </h3>
          <button class="buy-barrel-btn" style="
            padding: 5px 12px; background: #4CAF50; border: none;
            border-radius: 4px; color: #fff; font-size: 0.8rem;
            font-weight: 600; cursor: pointer;
          ">+ Buy</button>
        </div>
    `;

    if (barrels.length === 0) {
      html += `
        <div style="color: #888; text-align: center; padding: 32px 16px; font-size: 0.85rem;">
          <div style="font-size: 2rem; margin-bottom: 8px; opacity: 0.5;">🏺</div>
          No curing devices
          <div style="font-size: 0.75rem; margin-top: 4px;">Click "+ Buy" to purchase one</div>
        </div>
      `;
    } else {
      html += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
      for (const barrel of barrels) {
        html += this.buildBarrelItem(barrel, curingSystem);
      }
      html += `</div>`;
    }
    html += `</div>`;

    return html;
  }

  private buildBarrelItem(barrel: ReturnType<typeof CuringSystem.prototype.getOwnedBarrels>[0], curingSystem: CuringSystem): string {
    const slot = barrel.slot;
    const isSelected = this.selectedBarrelId === barrel.id;
    const condition = curingSystem.getBarrelCondition(barrel.id);
    const conditionColor = condition?.status === "critical" ? "#ef4444" : 
                          condition?.status === "worn" ? "#fbbf24" : 
                          condition?.status === "good" ? "#4ade80" : "#60a5fa";

    if (slot) {
      // Barrel is in use - show progress
      const progress = curingSystem.getCuringProgress(slot.id);
      const strain = PlantSystem.getInstance().getStrain(slot.strainId);
      const isComplete = progress?.isComplete ?? false;
      const needsBurp = progress?.needsBurp ?? false;
      
      return `
        <div class="barrel-item ${isComplete ? "barrel-complete" : ""} ${needsBurp ? "barrel-needs-burp" : ""}" 
             data-slot-id="${slot.id}" style="
          padding: 10px 12px;
          background: ${needsBurp ? "#FFF3E0" : isComplete ? "#E8F5E9" : "#fff"};
          border: 2px solid ${needsBurp ? "#FF9800" : isComplete ? "#4CAF50" : "#E8E8E8"};
          border-radius: 8px;
        ">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="font-size: 1.3rem;">${barrel.template.icon}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; color: #333; font-size: 0.85rem;">${barrel.template.name}</div>
              <div style="font-size: 0.8rem; color: #666;">${strain?.name ?? slot.strainId} • ${slot.amount}g</div>
            </div>
            ${needsBurp ? `<button class="burp-btn" data-slot-id="${slot.id}" style="
              padding: 6px 12px; background: #FF9800; border: none;
              border-radius: 4px; color: #fff; font-size: 0.75rem;
              font-weight: 600; cursor: pointer; animation: pulse 1s infinite;
            ">💨 Burp!</button>` : ""}
          </div>
          <div style="margin-top: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1; height: 6px; background: #E0E0E0; border-radius: 3px; overflow: hidden;">
                <div style="width: ${progress?.progress ?? 0}%; height: 100%; background: ${isComplete ? "#4CAF50" : "#2196F3"}; transition: width 0.3s;"></div>
              </div>
              <span style="font-size: 0.75rem; color: #666; font-weight: 500; min-width: 35px;">${Math.round(progress?.progress ?? 0)}%</span>
            </div>
            ${slot.burpsRequired > 0 ? `
              <div style="margin-top: 4px; font-size: 0.7rem; color: #888;">
                Burps: ${slot.burpsCompleted}/${slot.burpsRequired} ${slot.burpMissed ? `<span style="color: #ef4444;">⚠️ Missed!</span>` : ""}
              </div>
            ` : ""}
            ${isComplete ? `
              <button class="collect-btn" data-slot-id="${slot.id}" style="
                margin-top: 8px; padding: 8px 16px; background: #4CAF50;
                border: none; border-bottom: 3px solid #388E3C;
                border-radius: 6px; color: #fff; font-weight: 600;
                font-size: 0.85rem; cursor: pointer; width: 100%;
              ">✓ Collect ${slot.amount}g</button>
            ` : ""}
          </div>
        </div>
      `;
    } else {
      // Empty barrel - selectable
      return `
        <div class="barrel-item selectable-barrel" data-barrel-id="${barrel.id}" style="
          display: flex; align-items: center; gap: 10px; padding: 10px 12px;
          background: ${isSelected ? "#E3F2FD" : "#fff"};
          border: 2px solid ${isSelected ? "#2196F3" : "#E8E8E8"};
          border-radius: 8px; cursor: pointer; transition: all 0.15s;
        ">
          <div style="font-size: 1.3rem;">${barrel.template.icon}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; color: #333; font-size: 0.85rem;">${barrel.template.name}</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <span style="font-size: 0.75rem; color: #666;">${barrel.template.capacity}g max</span>
              <span style="font-size: 0.7rem; color: ${conditionColor};">●</span>
              <span style="font-size: 0.7rem; color: #888;">${condition?.condition ?? 100}%</span>
            </div>
          </div>
          ${isSelected ? `<div style="color: #2196F3; font-size: 1.2rem;">✓</div>` : 
            `<div style="color: #4CAF50; font-size: 0.75rem; font-weight: 500;">Empty</div>`}
        </div>
      `;
    }
  }


  private buildActionBar(freshItems: ReturnType<typeof CuringSystem.prototype.getFreshStorage>, barrels: ReturnType<typeof CuringSystem.prototype.getOwnedBarrels>, curingSystem: CuringSystem): string {
    const canStartCuring = this.selectedFreshItemId && this.selectedBarrelId;
    const freshItem = this.selectedFreshItemId ? curingSystem.getFreshItem(this.selectedFreshItemId) : null;
    const barrel = this.selectedBarrelId ? barrels.find(b => b.id === this.selectedBarrelId) : null;
    
    if (canStartCuring && freshItem && barrel && !barrel.slot) {
      const strain = PlantSystem.getInstance().getStrain(freshItem.strainId);
      const capacity = barrel.template.capacity;
      const amountToCure = Math.min(freshItem.amount, capacity);
      const willSplit = freshItem.amount > capacity;
      
      return `
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #333; font-size: 0.9rem;">
              ${strain?.name ?? freshItem.strainId}: ${amountToCure}g → ${barrel.template.name}
            </div>
            ${willSplit ? `<div style="font-size: 0.8rem; color: #E65100;">⚠️ ${freshItem.amount - amountToCure}g will remain in storage</div>` : ""}
            ${barrel.template.burpsRequired > 0 ? `<div style="font-size: 0.8rem; color: #666;">Requires ${barrel.template.burpsRequired} burps during curing</div>` : ""}
          </div>
          <button class="start-cure-action-btn" style="
            padding: 12px 32px; background: #4CAF50;
            border: none; border-bottom: 4px solid #388E3C;
            border-radius: 8px; color: #fff; font-weight: 700;
            font-size: 1rem; cursor: pointer; white-space: nowrap;
          ">🏺 Start Curing</button>
        </div>
      `;
    }

    // Default state - show instructions
    const hasEmptyBarrels = barrels.some(b => !b.slot);
    const hasFresh = freshItems.length > 0;
    
    let message = "";
    if (!hasFresh && !hasEmptyBarrels) {
      message = "Harvest plants to get fresh product, then buy a curing device";
    } else if (!hasFresh) {
      message = "Harvest plants to get fresh product to cure";
    } else if (!hasEmptyBarrels) {
      message = "All devices are in use or you need to buy one";
    } else {
      message = "Select a fresh harvest and an empty curing device";
    }

    return `
      <div style="text-align: center; color: #888; font-size: 0.9rem; padding: 8px;">
        ${message}
      </div>
    `;
  }

  private getPurchasePanelHTML(): string {
    const curingSystem = CuringSystem.getInstance();
    // Get all barrels including locked ones by accessing templates
    const barrelTemplates = (curingSystem as any).barrelTemplates as Map<string, CuringBarrel>;
    const allBarrelsIncludingLocked: CuringBarrel[] = Array.from(barrelTemplates.values());
    const playerMoney = GameState.getInstance().getPlayer().money;
    const playerLevel = GameState.getInstance().getPlayer().level;

    let html = `
      <div style="padding: 8px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <button class="back-to-main-btn" style="
            padding: 8px 16px; background: #f5f5f5; border: 1px solid #ddd;
            border-radius: 6px; cursor: pointer; font-size: 0.9rem;
          ">← Back</button>
          <h3 style="margin: 0; color: #333; font-size: 1rem;">🛒 Buy Curing Device</h3>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
    `;

    for (const barrel of allBarrelsIncludingLocked) {
      const canAfford = playerMoney >= barrel.cost;
      const meetsLevel = playerLevel >= barrel.unlockLevel;
      const canBuy = canAfford && meetsLevel;
      
      html += `
        <div style="
          background: #fff; border: 2px solid ${canBuy ? "#4CAF50" : "#E0E0E0"};
          border-radius: 10px; padding: 16px; opacity: ${meetsLevel ? 1 : 0.6};
        ">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div style="font-size: 2rem;">${barrel.icon}</div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #333; font-size: 1rem;">${barrel.name}</div>
              <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">
                <div>📦 Capacity: ${barrel.capacity}g</div>
                <div>⚡ Speed: ${barrel.speedMultiplier === 1 ? "Normal" : `${Math.round((1 - barrel.speedMultiplier) * 100)}% faster`}</div>
                <div>🔧 Durability: ${barrel.minUses}-${barrel.maxUses} uses</div>
                ${barrel.burpsRequired > 0 ? `<div>💨 Requires ${barrel.burpsRequired} burps</div>` : `<div>✨ No burping needed</div>`}
                ${barrel.qualityBonus > 0 ? `<div>⭐ +${barrel.qualityBonus}% quality bonus</div>` : ""}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color: ${canAfford ? "#4CAF50" : "#ef4444"}; font-size: 1.1rem;">$${barrel.cost}</div>
              ${!meetsLevel ? `<div style="font-size: 0.75rem; color: #888;">Level ${barrel.unlockLevel} required</div>` : ""}
              <button class="purchase-barrel-btn" data-template-id="${barrel.id}" 
                ${!canBuy ? "disabled" : ""} style="
                margin-top: 8px; padding: 8px 20px;
                background: ${canBuy ? "#4CAF50" : "#ccc"};
                border: none; border-bottom: 3px solid ${canBuy ? "#388E3C" : "#999"};
                border-radius: 6px; color: #fff; font-weight: 600;
                font-size: 0.85rem; cursor: ${canBuy ? "pointer" : "not-allowed"};
              ">Buy</button>
            </div>
          </div>
        </div>
      `;
    }

    html += `
        </div>
        <div style="margin-top: 16px; text-align: center; color: #888; font-size: 0.85rem;">
          Your balance: <strong style="color: #4CAF50;">$${playerMoney}</strong>
        </div>
      </div>
    `;

    return html;
  }

  protected onOpen(context: DialogContext): void {
    this.selectedFreshItemId = null;
    this.selectedBarrelId = null;
    this.showPurchasePanel = false;
    this.setupEventHandlers(context);
    this.startAutoRefresh(context);
  }

  protected onClose(): void {
    this.stopAutoRefresh();
    this.selectedFreshItemId = null;
    this.selectedBarrelId = null;
    this.showPurchasePanel = false;
  }

  private setupEventHandlers(context: DialogContext): void {
    const curingSystem = CuringSystem.getInstance();
    
    // Use the dialog element as the root for queries
    const dialogBody = this.element?.querySelector(".dialog-body");
    if (!dialogBody) return;

    // Fresh item selection
    dialogBody.querySelectorAll(".fresh-item.selectable-item").forEach(item => {
      item.addEventListener("click", () => {
        const id = (item as HTMLElement).dataset.id;
        if (id) {
          this.selectedFreshItemId = this.selectedFreshItemId === id ? null : id;
          this.refresh(context);
        }
      });
    });

    // Barrel selection
    dialogBody.querySelectorAll(".selectable-barrel").forEach(barrel => {
      barrel.addEventListener("click", () => {
        const id = (barrel as HTMLElement).dataset.barrelId;
        if (id) {
          this.selectedBarrelId = this.selectedBarrelId === id ? null : id;
          this.refresh(context);
        }
      });
    });

    // Start curing action button
    dialogBody.querySelector(".start-cure-action-btn")?.addEventListener("click", () => {
      if (this.selectedFreshItemId && this.selectedBarrelId) {
        const freshItem = curingSystem.getFreshItem(this.selectedFreshItemId);
        const barrels = curingSystem.getOwnedBarrels();
        const barrel = barrels.find(b => b.id === this.selectedBarrelId);
        
        if (freshItem && barrel) {
          const strain = PlantSystem.getInstance().getStrain(freshItem.strainId);
          const curingTime = strain?.curingTime ?? 2 * 60 * 1000;
          const capacity = barrel.template.capacity;
          
          // Split if needed
          if (freshItem.amount > capacity) {
            curingSystem.splitFreshItem(this.selectedFreshItemId, capacity);
          }
          
          // Start curing
          if (curingSystem.startCuring(this.selectedFreshItemId, this.selectedBarrelId, curingTime)) {
            this.selectedFreshItemId = null;
            this.selectedBarrelId = null;
            this.refresh(context);
          }
        }
      }
    });

    // Collect buttons
    dialogBody.querySelectorAll(".collect-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = e.target as HTMLButtonElement;
        const slotId = target.dataset.slotId;
        
        if (slotId) {
          const result = curingSystem.collectCured(slotId);
          if (result.success) {
            // Show notification if barrel broke
            if (result.barrelBroke) {
              // TODO: Show barrel broke notification
              console.log("Barrel broke!");
            }
            this.refresh(context);
          }
        }
      });
    });

    // Burp buttons
    dialogBody.querySelectorAll(".burp-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = e.target as HTMLButtonElement;
        const slotId = target.dataset.slotId;
        
        if (slotId) {
          if (curingSystem.burpBarrel(slotId)) {
            this.refresh(context);
          }
        }
      });
    });

    // Buy barrel button
    dialogBody.querySelector(".buy-barrel-btn")?.addEventListener("click", () => {
      this.showPurchasePanel = true;
      this.refresh(context);
    });

    // Back to main button (from purchase panel)
    dialogBody.querySelector(".back-to-main-btn")?.addEventListener("click", () => {
      this.showPurchasePanel = false;
      this.refresh(context);
    });

    // Purchase barrel buttons
    dialogBody.querySelectorAll(".purchase-barrel-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const templateId = (btn as HTMLButtonElement).dataset.templateId;
        if (templateId) {
          const barrelId = curingSystem.purchaseBarrel(templateId);
          if (barrelId) {
            this.showPurchasePanel = false;
            this.refresh(context);
          }
        }
      });
    });
  }

  private refresh(context: DialogContext): void {
    if (this.element) {
      const body = this.element.querySelector(".dialog-body");
      if (body) {
        // Preserve scroll positions before refresh
        const leftPanel = body.querySelector('[style*="overflow-y: auto"]') as HTMLElement;
        const rightPanel = body.querySelectorAll('[style*="overflow-y: auto"]')[1] as HTMLElement;
        const leftScroll = leftPanel?.scrollTop ?? 0;
        const rightScroll = rightPanel?.scrollTop ?? 0;
        
        body.innerHTML = this.getBodyHTML(context);
        this.setupEventHandlers(context);
        
        // Restore scroll positions after refresh
        const newLeftPanel = body.querySelector('[style*="overflow-y: auto"]') as HTMLElement;
        const newRightPanel = body.querySelectorAll('[style*="overflow-y: auto"]')[1] as HTMLElement;
        if (newLeftPanel) newLeftPanel.scrollTop = leftScroll;
        if (newRightPanel) newRightPanel.scrollTop = rightScroll;
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
}
