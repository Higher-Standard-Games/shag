/**
 * BuildMenu - Bottom bar UI for building/placing items
 */

import { BuildingSystem } from "../game/BuildingSystem";
import { GameState } from "../game/GameState";
import { UIStyles } from "../engine/ui/UIStyles";
import buildMenuCSS from "./styles/BuildMenu.css?raw";

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
    // Inject styles once
    UIStyles.injectCSS("build-menu", buildMenuCSS);

    this.container = document.createElement("div");
    this.container.id = "build-menu";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

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
