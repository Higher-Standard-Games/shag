import { CuringSystem } from "../../game/CuringSystem";
import { PlantSystem } from "../../game/PlantSystem";
import { BaseDialog, type DialogContext } from "./BaseDialog";

/**
 * Curing Dialog - Manages fresh storage and curing barrels
 */
export class CuringDialog extends BaseDialog {
  private refreshInterval: number | null = null;

  constructor() {
    super("curing_dialog", { title: "🛢️ Curing Station", width: "600px", maxWidth: "95vw" });
  }

  public getBodyHTML(_context: DialogContext): string {
    const curingSystem = CuringSystem.getInstance();
    const freshItems = curingSystem.getFreshStorage();
    const barrels = curingSystem.getOwnedBarrels();

    // Fresh Storage Section
    let freshHTML = "";
    if (freshItems.length === 0) {
      freshHTML = `<div style="color: #888; text-align: center; padding: 20px;">No fresh harvest in storage</div>`;
    } else {
      freshHTML = freshItems.map(item => {
        const strain = PlantSystem.getInstance().getStrain(item.strainId);
        const decayStatus = curingSystem.getDecayStatus(item.id);
        const decayPercent = decayStatus?.percentRemaining ?? 100;
        const decayColor = decayPercent > 50 ? "#4ade80" : decayPercent > 25 ? "#fbbf24" : "#ef4444";
        
        return `
          <div class="fresh-item" data-id="${item.id}" style="
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            margin-bottom: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          ">
            <div style="font-size: 1.5rem;">🌿</div>
            <div style="flex: 1;">
              <div style="font-weight: 500; color: #fff;">
                ${strain?.name ?? item.strainId} <span style="color: #888;">(${item.amount}g)</span>
              </div>
              <div style="font-size: 0.85rem; color: #aaa;">
                Quality: ${item.quality}% | Value: $${item.valuePerGram}/g
              </div>
              <div style="margin-top: 4px;">
                <div style="
                  height: 4px;
                  background: rgba(255,255,255,0.1);
                  border-radius: 2px;
                  overflow: hidden;
                ">
                  <div style="
                    width: ${decayPercent}%;
                    height: 100%;
                    background: ${decayColor};
                    transition: width 0.3s;
                  "></div>
                </div>
                <div style="font-size: 0.75rem; color: ${decayColor}; margin-top: 2px;">
                  ${decayPercent > 0 ? `Freshness: ${Math.round(decayPercent)}%` : "SPOILED!"}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }

    // Barrels Section
    let barrelsHTML = "";
    if (barrels.length === 0) {
      barrelsHTML = `<div style="color: #888; text-align: center; padding: 20px;">No curing barrels owned. Buy one from the Supplies Store!</div>`;
    } else {
      barrelsHTML = barrels.map(barrel => {
        const slot = barrel.slot;
        let statusHTML = "";
        
        if (slot) {
          const progress = curingSystem.getCuringProgress(slot.id);
          const strain = PlantSystem.getInstance().getStrain(slot.strainId);
          const isComplete = progress?.isComplete ?? false;
          
          statusHTML = `
            <div style="margin-top: 8px;">
              <div style="font-size: 0.9rem; color: #fff;">
                Curing: ${strain?.name ?? slot.strainId} (${slot.amount}g)
              </div>
              <div style="margin-top: 4px;">
                <div style="
                  height: 6px;
                  background: rgba(255,255,255,0.1);
                  border-radius: 3px;
                  overflow: hidden;
                ">
                  <div style="
                    width: ${progress?.progress ?? 0}%;
                    height: 100%;
                    background: ${isComplete ? "#4ade80" : "#60a5fa"};
                    transition: width 0.3s;
                  "></div>
                </div>
              </div>
              ${isComplete ? `
                <button class="collect-btn" data-slot-id="${slot.id}" style="
                  margin-top: 8px;
                  padding: 6px 16px;
                  background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                  border: none;
                  border-radius: 4px;
                  color: #000;
                  font-weight: 500;
                  cursor: pointer;
                ">Collect Cured Product</button>
              ` : `
                <div style="font-size: 0.8rem; color: #888; margin-top: 4px;">
                  ${Math.round(progress?.progress ?? 0)}% complete
                </div>
              `}
            </div>
          `;
        } else {
          // Empty barrel - show available fresh items to cure
          const canCure = freshItems.length > 0;
          statusHTML = `
            <div style="margin-top: 8px; color: ${canCure ? "#4ade80" : "#888"};">
              ${canCure ? "Ready to cure" : "Empty - harvest plants first"}
            </div>
            ${canCure ? `
              <select class="cure-select" data-barrel-id="${barrel.id}" style="
                margin-top: 8px;
                padding: 6px 12px;
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 4px;
                color: #fff;
                width: 100%;
              ">
                <option value="">Select harvest to cure...</option>
                ${freshItems.map(item => {
                  const strain = PlantSystem.getInstance().getStrain(item.strainId);
                  const fits = item.amount <= barrel.template.capacity;
                  return `<option value="${item.id}" ${!fits ? "disabled" : ""}>
                    ${strain?.name ?? item.strainId} (${item.amount}g) ${!fits ? "- Too large!" : ""}
                  </option>`;
                }).join("")}
              </select>
              <button class="start-cure-btn" data-barrel-id="${barrel.id}" style="
                margin-top: 8px;
                padding: 6px 16px;
                background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
                border: none;
                border-radius: 4px;
                color: #fff;
                font-weight: 500;
                cursor: pointer;
              ">Start Curing</button>
            ` : ""}
          `;
        }

        return `
          <div class="barrel-item" style="
            padding: 16px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            margin-bottom: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          ">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="font-size: 2rem;">🛢️</div>
              <div style="flex: 1;">
                <div style="font-weight: 500; color: #fff;">${barrel.template.name}</div>
                <div style="font-size: 0.85rem; color: #888;">
                  Capacity: ${barrel.template.capacity}g | 
                  Speed: ${barrel.template.speedMultiplier === 1 ? "Normal" : `${Math.round((1 / barrel.template.speedMultiplier) * 100 - 100)}% faster`}
                </div>
              </div>
            </div>
            ${statusHTML}
          </div>
        `;
      }).join("");
    }

    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <h3 style="margin: 0 0 12px 0; color: #fff; font-size: 1rem;">🌿 Fresh Storage</h3>
          <div style="max-height: 350px; overflow-y: auto;">
            ${freshHTML}
          </div>
          <div style="margin-top: 8px; font-size: 0.8rem; color: #888;">
            ⚠️ Fresh harvest decays! Cure it before it spoils.
          </div>
        </div>
        <div>
          <h3 style="margin: 0 0 12px 0; color: #fff; font-size: 1rem;">🛢️ Curing Barrels</h3>
          <div style="max-height: 350px; overflow-y: auto;">
            ${barrelsHTML}
          </div>
        </div>
      </div>
    `;
  }

  protected onOpen(context: DialogContext): void {
    this.setupEventHandlers(context);
    this.startAutoRefresh(context);
  }

  protected onClose(): void {
    this.stopAutoRefresh();
  }

  private setupEventHandlers(context: DialogContext): void {
    const curingSystem = CuringSystem.getInstance();

    // Start curing buttons
    document.querySelectorAll(".start-cure-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const target = e.target as HTMLButtonElement;
        const barrelId = target.dataset.barrelId;
        const select = document.querySelector(`.cure-select[data-barrel-id="${barrelId}"]`) as HTMLSelectElement;
        const freshItemId = select?.value;

        if (barrelId && freshItemId) {
          const freshItem = curingSystem.getFreshItem(freshItemId);
          if (freshItem) {
            const strain = PlantSystem.getInstance().getStrain(freshItem.strainId);
            const curingTime = strain?.curingTime ?? 2 * 60 * 1000; // Default 2 min for testing
            
            if (curingSystem.startCuring(freshItemId, barrelId, curingTime)) {
              this.refresh(context);
            }
          }
        }
      });
    });

    // Collect buttons
    document.querySelectorAll(".collect-btn").forEach(btn => {
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
    }, 1000); // Refresh every second
  }

  private stopAutoRefresh(): void {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}
