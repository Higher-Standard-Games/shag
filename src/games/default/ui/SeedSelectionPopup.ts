/**
 * SeedSelectionPopup - UI for selecting which seed to plant in an empty pot
 * 
 * Shows available seeds from inventory with strain info (grow time, yield, etc.)
 * Uses the new ModalPanel engine component for consistent UI styling.
 */

import { ModalPanel } from "../../../engine/ui/ModalPanel";
import { GameState } from "../GameState";
import { PlantSystem, StrainDefinition } from "../PlantSystem";
import { GameHUD } from "./GameHUD";
import { UIStyles } from "../../../engine/ui/UIStyles";
import seedSelectionPopupCSS from "./styles/SeedSelectionPopup.css?raw";

export interface SeedSelectionResult {
  strainId: string;
  seedItemId: string;
}

export class SeedSelectionPopup {
  private static styleInjected: boolean = false;
  private static modal: ModalPanel | null = null;
  private static currentPotPosition: { x: number; y: number; z: number } | null = null;
  private static currentMapId: string | null = null;
  private static currentOnSelect: ((result: SeedSelectionResult) => void) | undefined;

  /**
   * Show seed selection popup for an empty pot
   * @param potPosition Position of the pot (for planting)
   * @param mapId Current map ID
   * @param onSelect Callback when seed is selected
   * @param onCancel Callback when cancelled
   */
  public static show(
    potPosition: { x: number; y: number; z: number },
    mapId: string,
    onSelect?: (result: SeedSelectionResult) => void,
    onCancel?: () => void
  ): void {
    this.injectStyles();
    
    // Store context for click handlers
    this.currentPotPosition = potPosition;
    this.currentMapId = mapId;
    this.currentOnSelect = onSelect;
    
    console.log("SeedSelectionPopup.show() - stored context:", {
      potPosition: this.currentPotPosition,
      mapId: this.currentMapId
    });

    // Create modal if not exists
    if (!this.modal) {
      this.modal = new ModalPanel(
        {
          id: "seed_selection",
          title: "Select a Seed to Plant",
          icon: "🌱",
          width: 400,
          showClose: true,
          closeOnBackdrop: true,
        },
        {
          onClose: () => {
            if (onCancel) onCancel();
          },
          renderContent: () => this.buildContent(),
        }
      );
    }

    // Refresh content before showing (in case inventory changed)
    this.modal.refresh();
    this.modal.show();
    
    // Attach click handlers after modal is shown and rendered
    // Use longer timeout to ensure DOM is fully rendered
    setTimeout(() => this.attachSeedClickHandlers(), 100);
  }

  /**
   * Close the seed selection popup
   */
  public static close(): void {
    if (this.modal) {
      this.modal.hide();
    }
  }

  private static buildContent(): string {
    const gameState = GameState.getInstance();
    const plantSystem = PlantSystem.getInstance();
    const allStrains = plantSystem.getAllStrains();
    const playerLevel = gameState.getPlayer().level;

    // Group seeds by availability
    const availableSeeds: { strain: StrainDefinition; count: number }[] = [];
    const lockedSeeds: { strain: StrainDefinition; reason: string }[] = [];
    const noStockSeeds: { strain: StrainDefinition }[] = [];

    for (const strain of allStrains) {
      const seedCount = gameState.getItemCount(strain.seedId);
      
      if (strain.unlockLevel > playerLevel) {
        lockedSeeds.push({ strain, reason: `Requires Level ${strain.unlockLevel}` });
      } else if (seedCount === 0) {
        noStockSeeds.push({ strain });
      } else {
        availableSeeds.push({ strain, count: seedCount });
      }
    }

    let html = "";

    // Available seeds
    if (availableSeeds.length > 0) {
      html += `<div class="seed-section">`;
      for (const { strain, count } of availableSeeds) {
        html += this.renderSeedItem(strain, count, true);
      }
      html += `</div>`;
    }

    // No stock seeds
    if (noStockSeeds.length > 0) {
      html += `<div class="seed-section seed-section-dimmed">
        <div class="seed-section-label">No Seeds Available</div>`;
      for (const { strain } of noStockSeeds) {
        html += this.renderSeedItem(strain, 0, false, "Buy seeds from the shop");
      }
      html += `</div>`;
    }

    // Locked seeds
    if (lockedSeeds.length > 0) {
      html += `<div class="seed-section seed-section-locked">
        <div class="seed-section-label">🔒 Locked Strains</div>`;
      for (const { strain, reason } of lockedSeeds) {
        html += this.renderSeedItem(strain, 0, false, reason);
      }
      html += `</div>`;
    }

    // Empty state
    if (availableSeeds.length === 0 && noStockSeeds.length === 0 && lockedSeeds.length === 0) {
      html = `
        <div class="seed-empty">
          <div class="seed-empty-icon">🌱</div>
          <div class="seed-empty-text">No strains registered</div>
        </div>
      `;
    }

    // Tip
    if (availableSeeds.length === 0 && noStockSeeds.length > 0) {
      html += `
        <div class="seed-tip">
          💡 Visit the <strong>Seed Shop</strong> to buy seeds!
        </div>
      `;
    }

    return html;
  }

  private static renderSeedItem(
    strain: StrainDefinition,
    count: number,
    available: boolean,
    disabledReason?: string
  ): string {
    const growTimeMin = Math.round(strain.growthTime / 60000);
    const yieldStr = `${strain.baseYield}g`;
    const valueStr = `$${strain.valuePerGram}/g`;

    return `
      <div class="seed-item ${available ? "seed-item-available" : "seed-item-disabled"}" 
           data-strain-id="${strain.id}"
           ${available ? "" : `title="${disabledReason || "Not available"}"`}>
        <div class="seed-item-icon">🌱</div>
        <div class="seed-item-info">
          <div class="seed-item-name">${strain.name}</div>
          <div class="seed-item-stats">
            <span class="seed-stat">⏱️ ${growTimeMin}min</span>
            <span class="seed-stat">📦 ${yieldStr}</span>
            <span class="seed-stat">💰 ${valueStr}</span>
          </div>
          ${disabledReason ? `<div class="seed-item-reason">${disabledReason}</div>` : ""}
        </div>
        <div class="seed-item-count">
          ${available ? `<span class="seed-count">${count}</span>` : ""}
        </div>
      </div>
    `;
  }

  private static clickHandlerAttached = false;

  private static attachSeedClickHandlers(): void {
    // Find the modal container (not backdrop)
    const modalContainer = document.getElementById("modal-seed_selection");
    if (!modalContainer) {
      console.warn("SeedSelectionPopup: Modal container not found");
      return;
    }

    // Only attach the handler once, it will read current values from static properties
    if (this.clickHandlerAttached) return;
    this.clickHandlerAttached = true;

    // Use event delegation on the modal container
    modalContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const seedItem = target.closest(".seed-item-available") as HTMLElement;
      
      if (!seedItem) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // Read current values from static properties (not closure)
      const potPosition = SeedSelectionPopup.currentPotPosition;
      const mapId = SeedSelectionPopup.currentMapId;
      const onSelect = SeedSelectionPopup.currentOnSelect;

      console.log("SeedSelectionPopup click - reading context:", {
        potPosition,
        mapId,
        hasOnSelect: !!onSelect
      });

      if (!potPosition) {
        console.warn("SeedSelectionPopup: Missing pot position at click time");
        return;
      }
      
      // mapId can be empty string - use as-is (don't convert to "default")
      const effectiveMapId = mapId ?? "";
      
      const strainId = seedItem.dataset.strainId;
      console.log(`SeedSelectionPopup: Clicked strain ${strainId}`);
      if (!strainId) return;

      const strain = PlantSystem.getInstance().getStrain(strainId);
      
      // Visual feedback - use strain name, not ID
      GameHUD.getInstance().showNotification(`Planting ${strain?.name ?? strainId}...`);
      if (!strain) {
        console.warn(`SeedSelectionPopup: Strain ${strainId} not found`);
        return;
      }

      // Plant the seed
      const plant = PlantSystem.getInstance().plantSeed(
        strainId,
        potPosition,
        effectiveMapId
      );

      console.log(`SeedSelectionPopup: Plant result:`, plant);
      if (plant) {
        SeedSelectionPopup.close();
        if (onSelect) {
          onSelect({ strainId, seedItemId: strain.seedId });
        }
      }
    });
  }

  private static injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;
    UIStyles.injectCSS("seed-selection-popup", seedSelectionPopupCSS);
  }
}
