/**
 * BuildMenu - Bottom bar UI for building/placing items
 */

import { BuildingSystem } from "../game/BuildingSystem";
import { GameState } from "../game/GameState";

export class BuildMenu {
  private static instance: BuildMenu;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;
  private currentCategory: string = "plant";

  private constructor() {}

  public static getInstance(): BuildMenu {
    if (!BuildMenu.instance) {
      BuildMenu.instance = new BuildMenu();
    }
    return BuildMenu.instance;
  }

  public show(): void {
    if (this.isVisible) return;

    this.createMenu();
    this.setupEventListeners();
    this.isVisible = true;
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.container?.remove();
    this.container = null;
    this.isVisible = false;
  }

  private createMenu(): void {
    this.container = document.createElement("div");
    this.container.id = "build-menu";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    const style = document.createElement("style");
    style.textContent = this.getStyles();
    this.container.appendChild(style);

    this.updateItems();
  }

  private getHTML(): string {
    return `
      <div class="build-menu-container">
        <div class="build-categories">
          <button class="build-category active" data-category="plant">🪴 Plants</button>
          <button class="build-category" data-category="growlight">💡 Lights</button>
          <button class="build-category" data-category="equipment">⚙️ Equipment</button>
          <button class="build-category" data-category="decoration">🎨 Decor</button>
        </div>
        <div class="build-items" id="build-items">
          <!-- Items populated dynamically -->
        </div>
        <div class="build-status" id="build-status">
          <span class="status-text">Select an item to build</span>
          <button class="cancel-build" id="cancel-build" style="display: none;">✕ Cancel</button>
        </div>
      </div>
    `;
  }

  private getStyles(): string {
    return `
      #build-menu {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 101;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .build-menu-container {
        background: #FAFAFA;
        border-radius: 12px;
        padding: 12px;
        border: 1px solid #E0E0E0;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      }

      .build-categories {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
        border-bottom: 1px solid #E0E0E0;
        padding-bottom: 12px;
      }

      .build-category {
        background: #F5F5F5;
        border: none;
        border-bottom: 3px solid #CCCCCC;
        color: #333333;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.1s ease;
        position: relative;
        top: 0;
      }

      .build-category:hover {
        background: #FFFFFF;
        top: -1px;
      }

      .build-category:active {
        top: 3px;
        border-bottom-width: 0;
      }

      .build-category.active {
        background: #4CAF50;
        border-bottom-color: #3D9140;
        color: #FFFFFF;
      }

      .build-category.active:hover {
        background: #5CBF60;
      }

      .build-items {
        display: flex;
        gap: 10px;
        min-width: 400px;
        max-width: 600px;
        overflow-x: auto;
        padding: 5px 0;
      }

      .build-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: #FFFFFF;
        border: 2px solid #E0E0E0;
        border-radius: 10px;
        padding: 10px 15px;
        cursor: pointer;
        transition: all 0.15s ease;
        min-width: 80px;
      }

      .build-item:hover {
        background: #F5F5F5;
        border-color: #CCCCCC;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }

      .build-item.selected {
        border-color: #4CAF50;
        background: #E8F5E9;
      }

      .build-item.locked {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .build-item.locked:hover {
        transform: none;
        box-shadow: none;
      }

      .build-item-icon {
        font-size: 28px;
        margin-bottom: 5px;
      }

      .build-item-name {
        color: #333333;
        font-size: 12px;
        font-weight: 500;
        text-align: center;
        white-space: nowrap;
      }

      .build-item-cost {
        color: #2E7D32;
        font-size: 11px;
        font-weight: 600;
        margin-top: 3px;
      }

      .build-item-level {
        color: #D32F2F;
        font-size: 10px;
        margin-top: 2px;
      }

      .build-status {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #E0E0E0;
      }

      .status-text {
        color: #666666;
        font-size: 13px;
      }

      .status-text.active {
        color: #2E7D32;
        font-weight: 500;
      }

      .cancel-build {
        background: #FFEBEE;
        border: none;
        border-bottom: 3px solid #EF9A9A;
        color: #D32F2F;
        padding: 6px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.1s ease;
        position: relative;
        top: 0;
      }

      .cancel-build:hover {
        background: #FFCDD2;
        top: -1px;
      }

      .cancel-build:active {
        top: 3px;
        border-bottom-width: 0;
      }
    `;
  }

  private updateItems(): void {
    const container = this.container?.querySelector("#build-items");
    if (!container) return;

    const buildingSystem = BuildingSystem.getInstance();
    const items = buildingSystem.getItemsByZoneType(this.currentCategory);
    const playerLevel = GameState.getInstance().getPlayer().level;
    const selectedItem = buildingSystem.selectedItem;

    container.innerHTML = items.map(item => {
      const isLocked = item.requiredLevel > playerLevel;
      const isSelected = selectedItem?.id === item.id;
      
      return `
        <div class="build-item ${isLocked ? 'locked' : ''} ${isSelected ? 'selected' : ''}" 
             data-item-id="${item.id}" 
             ${isLocked ? 'title="Level ' + item.requiredLevel + ' required"' : ''}>
          <span class="build-item-icon">${item.icon}</span>
          <span class="build-item-name">${item.name}</span>
          <span class="build-item-cost">$${item.cost}</span>
          ${isLocked ? `<span class="build-item-level">Lv.${item.requiredLevel}</span>` : ''}
        </div>
      `;
    }).join("");

    // Update status
    this.updateStatus();
  }

  private updateStatus(): void {
    const statusText = this.container?.querySelector(".status-text");
    const cancelBtn = this.container?.querySelector("#cancel-build") as HTMLElement;
    const buildingSystem = BuildingSystem.getInstance();

    if (statusText) {
      if (buildingSystem.inBuildMode && buildingSystem.selectedItem) {
        statusText.textContent = `Click a green zone to place ${buildingSystem.selectedItem.name}`;
        statusText.classList.add("active");
        if (cancelBtn) cancelBtn.style.display = "block";
      } else {
        statusText.textContent = "Select an item to build";
        statusText.classList.remove("active");
        if (cancelBtn) cancelBtn.style.display = "none";
      }
    }
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    // Category buttons
    this.container.querySelectorAll(".build-category").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const category = (e.target as HTMLElement).dataset.category;
        if (category) {
          this.setCategory(category);
        }
      });
    });

    // Item clicks
    this.container.querySelector("#build-items")?.addEventListener("click", (e) => {
      const itemEl = (e.target as HTMLElement).closest(".build-item") as HTMLElement;
      if (itemEl && !itemEl.classList.contains("locked")) {
        const itemId = itemEl.dataset.itemId;
        if (itemId) {
          this.selectItem(itemId);
        }
      }
    });

    // Cancel button
    this.container.querySelector("#cancel-build")?.addEventListener("click", () => {
      BuildingSystem.getInstance().exitBuildMode();
      this.updateItems();
    });

    // Listen for build events
    BuildingSystem.getInstance().onBuildEvent((event, _data) => {
      if (event === "built" || event === "exit_build_mode") {
        this.updateItems();
      }
    });
  }

  private setCategory(category: string): void {
    this.currentCategory = category;

    // Update active button
    this.container?.querySelectorAll(".build-category").forEach(btn => {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.category === category);
    });

    // Exit build mode when switching categories
    BuildingSystem.getInstance().exitBuildMode();

    this.updateItems();
  }

  private selectItem(itemId: string): void {
    const buildingSystem = BuildingSystem.getInstance();
    const item = buildingSystem.getItem(itemId);
    
    if (item) {
      // Check if can afford
      if (!GameState.getInstance().canAfford(item.cost)) {
        console.log("Cannot afford this item!");
        return;
      }

      buildingSystem.selectItem(itemId);
      this.updateItems();
    }
  }

  public refresh(): void {
    this.updateItems();
  }
}
