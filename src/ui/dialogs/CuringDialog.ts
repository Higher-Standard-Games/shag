import { CuringSystem } from "../../game/CuringSystem";
import { PlantSystem } from "../../game/PlantSystem";
import { GameState } from "../../game/GameState";
import { BaseDialog, type DialogContext } from "./BaseDialog";

/**
 * Curing Dialog - Manages fresh storage and curing barrels
 * 
 * Features:
 * - List view selection (mobile-friendly, no dropdowns)
 * - Auto-splits large harvests to fit barrel capacity
 * - One strain per barrel (no mixing)
 */
export class CuringDialog extends BaseDialog {
  private refreshInterval: number | null = null;
  private selectedFreshItemId: string | null = null;
  private selectedBarrelId: string | null = null;

  constructor() {
    super("curing_dialog", { title: "🛢️ Curing Station", width: "900px", maxWidth: "95vw" });
  }

  public getBodyHTML(_context: DialogContext): string {
    const curingSystem = CuringSystem.getInstance();
    const freshItems = curingSystem.getFreshStorage();
    const barrels = curingSystem.getOwnedBarrels();

    // Fresh Storage Section - clickable list items
    let freshHTML = "";
    if (freshItems.length === 0) {
      freshHTML = `<div style="color: #666666; text-align: center; padding: 20px;">No fresh harvest in storage</div>`;
    } else {
      freshHTML = freshItems.map(item => {
        const strain = PlantSystem.getInstance().getStrain(item.strainId);
        const decayStatus = curingSystem.getDecayStatus(item.id);
        const decayPercent = decayStatus?.percentRemaining ?? 100;
        const decayColor = decayPercent > 50 ? "#4ade80" : decayPercent > 25 ? "#fbbf24" : "#ef4444";
        const isSelected = this.selectedFreshItemId === item.id;
        
        return `
          <div class="fresh-item selectable-item ${isSelected ? "selected" : ""}" data-id="${item.id}" style="
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            background: ${isSelected ? "#E8F5E9" : "#FFFFFF"};
            border-radius: 6px;
            margin-bottom: 6px;
            border: 2px solid ${isSelected ? "#4CAF50" : "#E0E0E0"};
            cursor: pointer;
            transition: all 0.15s;
          ">
            <div style="font-size: 1.2rem;">🌿</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; color: #333333; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${strain?.name ?? item.strainId} (${item.amount}g)
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <div style="
                  flex: 1;
                  height: 4px;
                  background: #E0E0E0;
                  border-radius: 2px;
                  overflow: hidden;
                ">
                  <div style="
                    width: ${decayPercent}%;
                    height: 100%;
                    background: ${decayColor};
                  "></div>
                </div>
                <span style="font-size: 0.7rem; color: ${decayColor}; font-weight: 500;">${Math.round(decayPercent)}%</span>
              </div>
            </div>
            ${isSelected ? `<div style="color: #4CAF50; font-size: 1rem;">✓</div>` : ""}
          </div>
        `;
      }).join("");
    }

    // Barrels Section - clickable list items
    let barrelsHTML = "";
    if (barrels.length === 0) {
      barrelsHTML = `<div style="color: #666666; text-align: center; padding: 20px;">No curing barrels owned. Buy one from the Supplies Store!</div>`;
    } else {
      barrelsHTML = barrels.map(barrel => {
        const slot = barrel.slot;
        const isSelected = this.selectedBarrelId === barrel.id;
        
        if (slot) {
          // Barrel is in use - show progress
          const progress = curingSystem.getCuringProgress(slot.id);
          const strain = PlantSystem.getInstance().getStrain(slot.strainId);
          const isComplete = progress?.isComplete ?? false;
          
          return `
            <div class="barrel-item" style="
              padding: 10px;
              background: #FFFFFF;
              border-radius: 6px;
              margin-bottom: 6px;
              border: 1px solid #E0E0E0;
            ">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="font-size: 1.3rem;">🛢️</div>
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 600; color: #333333; font-size: 0.85rem;">${barrel.template.name}</div>
                  <div style="font-size: 0.75rem; color: #666666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${strain?.name ?? slot.strainId} (${slot.amount}g)
                  </div>
                </div>
              </div>
              <div style="margin-top: 6px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <div style="
                    flex: 1;
                    height: 5px;
                    background: #E0E0E0;
                    border-radius: 3px;
                    overflow: hidden;
                  ">
                    <div style="
                      width: ${progress?.progress ?? 0}%;
                      height: 100%;
                      background: ${isComplete ? "#4ade80" : "#60a5fa"};
                    "></div>
                  </div>
                  <span style="font-size: 0.7rem; color: #666666; font-weight: 500;">${Math.round(progress?.progress ?? 0)}%</span>
                </div>
                ${isComplete ? `
                  <button class="collect-btn" data-slot-id="${slot.id}" style="
                    margin-top: 6px;
                    padding: 6px 12px;
                    background: #4CAF50;
                    border: none;
                    border-bottom: 2px solid #3D9140;
                    border-radius: 5px;
                    color: #fff;
                    font-weight: 600;
                    font-size: 0.8rem;
                    cursor: pointer;
                    width: 100%;
                  ">✓ Collect</button>
                ` : ""}
              </div>
            </div>
          `;
        } else {
          // Empty barrel - selectable for curing
          return `
            <div class="barrel-item selectable-barrel ${isSelected ? "selected" : ""}" data-barrel-id="${barrel.id}" style="
              padding: 10px;
              background: ${isSelected ? "#E3F2FD" : "#FFFFFF"};
              border-radius: 6px;
              margin-bottom: 6px;
              border: 2px solid ${isSelected ? "#2196F3" : "#E0E0E0"};
              cursor: pointer;
              transition: all 0.15s;
            ">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="font-size: 1.3rem;">🛢️</div>
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 600; color: #333333; font-size: 0.85rem;">${barrel.template.name}</div>
                  <div style="font-size: 0.7rem; color: #666666;">
                    ${barrel.template.capacity}g | ${barrel.template.speedMultiplier === 1 ? "Normal" : "Fast"}
                  </div>
                </div>
                ${isSelected ? `<div style="color: #2196F3; font-size: 1rem;">✓</div>` : ""}
              </div>
              <div style="margin-top: 4px; color: ${isSelected ? "#1976D2" : "#4CAF50"}; font-size: 0.75rem; font-weight: 500;">
                ${isSelected ? "→ Select harvest" : "Empty - tap to use"}
              </div>
            </div>
          `;
        }
      }).join("");
    }

    // Action button (shown when both are selected)
    let actionHTML = "";
    if (this.selectedFreshItemId && this.selectedBarrelId) {
      const freshItem = curingSystem.getFreshItem(this.selectedFreshItemId);
      const barrel = barrels.find(b => b.id === this.selectedBarrelId);
      
      if (freshItem && barrel) {
        const strain = PlantSystem.getInstance().getStrain(freshItem.strainId);
        const capacity = barrel.template.capacity;
        const willSplit = freshItem.amount > capacity;
        const amountToCure = Math.min(freshItem.amount, capacity);
        const remaining = freshItem.amount - amountToCure;
        
        actionHTML = `
          <div style="
            margin-top: 16px;
            padding: 16px;
            background: #E3F2FD;
            border-radius: 8px;
            border: 1px solid #BBDEFB;
          ">
            <div style="font-weight: 600; color: #333333; margin-bottom: 8px;">
              Ready to Cure
            </div>
            <div style="font-size: 0.9rem; color: #666666; margin-bottom: 12px;">
              ${strain?.name ?? freshItem.strainId}: ${amountToCure}g → ${barrel.template.name}
              ${willSplit ? `<br><span style="color: #E65100;">⚠️ ${remaining}g will remain in storage</span>` : ""}
            </div>
            <button class="start-cure-action-btn" style="
              padding: 10px 24px;
              background: #2196F3;
              border: none;
              border-bottom: 4px solid #1565C0;
              border-radius: 6px;
              color: #fff;
              font-weight: 600;
              cursor: pointer;
              width: 100%;
              font-size: 1rem;
            ">🛢️ Start Curing ${amountToCure}g</button>
          </div>
        `;
      }
    }

    // Cured Products Inventory
    const curedProducts = GameState.getInstance().getItemsByType("harvest");
    let curedHTML = "";
    if (curedProducts.length === 0) {
      curedHTML = `<div style="color: #666666; text-align: center; padding: 16px; font-size: 0.9rem;">No cured products yet. Cure fresh harvest to sell!</div>`;
    } else {
      const totalGrams = curedProducts.reduce((sum, p) => sum + p.quantity, 0);
      curedHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${curedProducts.map(product => {
            // Extract strain name from harvest_strainId format
            const strainId = product.id.replace(/^harvest_/, "");
            const strain = PlantSystem.getInstance().getStrain(strainId) || 
                          PlantSystem.getInstance().getStrain(`strain_${strainId}`);
            const strainName = strain?.name ?? strainId.replace(/_/g, " ");
            
            return `
              <div style="
                background: #F0FDF4;
                border: 1px solid #86EFAC;
                border-radius: 8px;
                padding: 10px 14px;
                display: flex;
                align-items: center;
                gap: 8px;
              ">
                <span style="font-size: 1.2rem;">📦</span>
                <div>
                  <div style="font-weight: 600; color: #166534; font-size: 0.9rem;">${strainName}</div>
                  <div style="font-size: 0.85rem; color: #15803D; font-weight: 500;">${product.quantity}g</div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
        <div style="margin-top: 10px; text-align: right; font-size: 0.85rem; color: #666666;">
          Total: <strong style="color: #166534;">${totalGrams}g</strong> ready to sell
        </div>
      `;
    }

    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; align-items: start;">
        <!-- Fresh Storage Column -->
        <div style="background: #FAFAFA; border-radius: 10px; padding: 12px; border: 1px solid #E8E8E8;">
          <h3 style="margin: 0 0 10px 0; color: #333333; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            🌿 Fresh Storage
          </h3>
          <div style="max-height: 200px; overflow-y: auto;">
            ${freshHTML}
          </div>
          ${freshItems.length > 0 ? `
            <div style="margin-top: 8px; font-size: 0.75rem; color: #888888; text-align: center;">
              ⚠️ Decays over time
            </div>
          ` : ""}
        </div>
        
        <!-- Barrels Column -->
        <div style="background: #FAFAFA; border-radius: 10px; padding: 12px; border: 1px solid #E8E8E8;">
          <h3 style="margin: 0 0 10px 0; color: #333333; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            🛢️ Barrels
          </h3>
          <div style="max-height: 200px; overflow-y: auto;">
            ${barrelsHTML}
          </div>
        </div>
        
        <!-- Cured Products Column -->
        <div style="background: #F0FDF4; border-radius: 10px; padding: 12px; border: 1px solid #BBF7D0;">
          <h3 style="margin: 0 0 10px 0; color: #166534; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            📦 Ready to Sell
          </h3>
          <div style="max-height: 200px; overflow-y: auto;">
            ${curedHTML}
          </div>
        </div>
      </div>
      ${actionHTML}
    `;
  }

  protected onOpen(context: DialogContext): void {
    this.selectedFreshItemId = null;
    this.selectedBarrelId = null;
    this.setupEventHandlers(context);
    this.startAutoRefresh(context);
  }

  protected onClose(): void {
    this.stopAutoRefresh();
    this.selectedFreshItemId = null;
    this.selectedBarrelId = null;
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
            // Split the fresh item first
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
        const target = e.target as HTMLButtonElement;
        const slotId = target.dataset.slotId;
        
        if (slotId) {
          const result = curingSystem.collectCured(slotId);
          if (result.success) {
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
}
