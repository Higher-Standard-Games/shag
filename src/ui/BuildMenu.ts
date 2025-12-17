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
        background: rgba(0, 0, 0, 0.85);
        border-radius: 15px;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      }

      .build-categories {
        display: flex;
        gap: 5px;
        margin-bottom: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 10px;
      }

      .build-category {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: white;
        padding: 8px 15px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .build-category:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .build-category.active {
        background: linear-gradient(135deg, #4CAF50, #45a049);
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
        background: rgba(255, 255, 255, 0.1);
        border: 2px solid transparent;
        border-radius: 10px;
        padding: 10px 15px;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 80px;
      }

      .build-item:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: translateY(-3px);
      }

      .build-item.selected {
        border-color: #4CAF50;
        background: rgba(76, 175, 80, 0.3);
      }

      .build-item.locked {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .build-item.locked:hover {
        transform: none;
      }

      .build-item-icon {
        font-size: 28px;
        margin-bottom: 5px;
      }

      .build-item-name {
        color: white;
        font-size: 12px;
        text-align: center;
        white-space: nowrap;
      }

      .build-item-cost {
        color: #ffd700;
        font-size: 11px;
        margin-top: 3px;
      }

      .build-item-level {
        color: #ff6b6b;
        font-size: 10px;
        margin-top: 2px;
      }

      .build-status {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .status-text {
        color: rgba(255, 255, 255, 0.7);
        font-size: 13px;
      }

      .status-text.active {
        color: #4CAF50;
      }

      .cancel-build {
        background: rgba(244, 67, 54, 0.3);
        border: 1px solid #f44336;
        color: white;
        padding: 5px 15px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }

      .cancel-build:hover {
        background: rgba(244, 67, 54, 0.5);
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
