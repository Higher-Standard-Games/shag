/**
 * UIConfig - JSON-driven UI configuration system
 * 
 * Loads UI configuration from JSON files for data-driven UI components.
 * This allows easy modification of build menus, inventory, and other UI
 * elements without code changes.
 */

export interface BuildMenuItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: string;
  levelRequired: number;
  prefab: string;
  zoneType: string;
}

export interface BuildMenuCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  items: BuildMenuItem[];
}

export interface BuildMenuConfig {
  categories: BuildMenuCategory[];
}

export interface InventoryConfig {
  slots: number;
  defaultItems: string[];
}

export interface BottomBarConfig {
  height: number;
  collapsedHeight: number;
  animationDuration: number;
}

export interface UIConfigData {
  buildMenu: BuildMenuConfig;
  inventory: InventoryConfig;
  bottomBar: BottomBarConfig;
}

export class UIConfig {
  private static instance: UIConfig;
  private config: UIConfigData | null = null;
  private configPath: string = "/data/ui-config.json";

  private constructor() {}

  public static getInstance(): UIConfig {
    if (!UIConfig.instance) {
      UIConfig.instance = new UIConfig();
    }
    return UIConfig.instance;
  }

  public async load(path?: string): Promise<UIConfigData> {
    if (path) {
      this.configPath = path;
    }

    try {
      const response = await fetch(this.configPath);
      if (!response.ok) {
        throw new Error(`Failed to load UI config: ${response.statusText}`);
      }
      this.config = await response.json();
      console.log("UI config loaded:", this.configPath);
      return this.config!;
    } catch (error) {
      console.error("Error loading UI config:", error);
      // Return default config
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  public getConfig(): UIConfigData | null {
    return this.config;
  }

  public getBuildMenu(): BuildMenuConfig | null {
    return this.config?.buildMenu ?? null;
  }

  public getCategory(categoryId: string): BuildMenuCategory | null {
    return this.config?.buildMenu.categories.find(c => c.id === categoryId) ?? null;
  }

  public getItem(itemId: string): BuildMenuItem | null {
    for (const category of this.config?.buildMenu.categories ?? []) {
      const item = category.items.find(i => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  public getItemsForLevel(level: number): BuildMenuItem[] {
    const items: BuildMenuItem[] = [];
    for (const category of this.config?.buildMenu.categories ?? []) {
      items.push(...category.items.filter(i => i.levelRequired <= level));
    }
    return items;
  }

  public getCategoriesForLevel(level: number): BuildMenuCategory[] {
    return (this.config?.buildMenu.categories ?? []).map(category => ({
      ...category,
      items: category.items.filter(i => i.levelRequired <= level)
    })).filter(c => c.items.length > 0);
  }

  private getDefaultConfig(): UIConfigData {
    return {
      buildMenu: {
        categories: [
          {
            id: "plants",
            name: "Plants",
            icon: "🌱",
            color: "#4CAF50",
            items: [
              {
                id: "basic_pot",
                name: "Basic Pot",
                description: "A simple pot for growing plants",
                cost: 50,
                icon: "icons/pot_basic.png",
                levelRequired: 1,
                prefab: "pot_basic",
                zoneType: "plant"
              }
            ]
          }
        ]
      },
      inventory: {
        slots: 8,
        defaultItems: []
      },
      bottomBar: {
        height: 200,
        collapsedHeight: 60,
        animationDuration: 200
      }
    };
  }
}
