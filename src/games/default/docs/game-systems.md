# Game Systems

Generic engine systems for resource management, timers, building, and entity management.

**Important:** The engine is designed to be generic. All game-specific content (items, strains, costs, etc.) is defined in `GameData.ts`, not hardcoded in the engine systems.

---

## Architecture

```
Engine Systems (Generic)          Game Data (JSON Files)
├── PersistenceManager            ├── strains.json
├── GameState                     ├── items.json (TODO)
├── GameTimer                     ├── quests.json (TODO)
├── GameClock                     ├── npcs.json (TODO)
├── PlantSystem                   ├── achievements.json (TODO)
├── GeneticsSystem                └── world.json (TODO)
├── BuildingSystem                
├── BuildableObjectManager        Game Data (TypeScript)
├── CuringSystem                  ├── BUILDABLE_ITEMS
├── DealerSystem                  ├── OBJECT_TEMPLATES
├── OrderSystem                   ├── CUSTOMERS
├── ShopSystem                    ├── SHOP_ITEMS
├── EquipmentSystem               └── STARTING_*
├── QuestSystem                   
├── AchievementSystem             Game-Level Orchestration
├── NPCSystem                     ├── SaveManager
├── WorldSystem                   └── GameHUD
└── UI Components                 
```

## Overview

The game systems provide:

### Core Systems
- **GameState** - Player resources, inventory, persistence
- **GameTimer** - Time-based events, scheduling
- **GameClock** - Day/night cycle, time-of-day periods
- **SaveManager** - Save/load orchestration for all subsystems
- **PersistenceManager** - Engine-level save slot management

### Plant Systems
- **PlantSystem** - Plant growth, watering, harvesting
- **GeneticsSystem** - Strain genetics, breeding, family trees ([detailed docs](./genetics-system.md))

### World Systems
- **WorldSystem** - Areas, lots, navigation, access control
- **NPCSystem** - NPC spawning, interactions, dialogues
- **BuildingSystem** - Build zones and placement
- **BuildableObjectManager** - Objects with progress/stages

### Economy Systems
- **CuringSystem** - Curing barrels and product processing
- **DealerSystem** - Selling cured products to dealers
- **OrderSystem** - Customer orders and fulfillment
- **ShopSystem** - Item purchasing and stock
- **EquipmentSystem** - Equipment bonuses and automation

### Progression Systems
- **QuestSystem** - Objectives and missions
- **AchievementSystem** - Goals and rewards

---

## GameState

Central state management with persistence.

### Player Resources

```typescript
import { GameState } from "./game";

const state = GameState.getInstance();

// Money
state.addMoney(100);
state.spendMoney(50);  // Returns false if can't afford
state.canAfford(25);   // Check before spending

// XP and Levels
state.addXP(50);
const player = state.getPlayer();
console.log(`Level ${player.level}, ${player.xp} XP`);
console.log(`Progress to next: ${state.getXPProgress() * 100}%`);
```

### Inventory

```typescript
// Add items
state.addItem("seed_basic", "seed", 5);
state.addItem("harvest_og_kush", "harvest", 3);

// Check and use
if (state.hasItem("seed_basic", 1)) {
  state.removeItem("seed_basic", 1);
}

// Query
const seeds = state.getItemsByType("seed");
const count = state.getItemCount("seed_basic");
```

### Item Types

| Type | Description |
|------|-------------|
| `seed` | Plantable seeds |
| `harvest` | Harvested products |
| `equipment` | Tools and machines |
| `consumable` | One-time use items |
| `material` | Crafting materials |

### Persistence

The save system uses a two-tier architecture:

**Engine Level** (`PersistenceManager`):
- Generic save slot management (localStorage abstraction)
- Saveable interface for systems to register save/load/clear methods
- Autosave timer coordination

**Game Level** (`SaveManager`):
- Game-specific subsystem coordination
- Collects state from all game systems
- Handles map transitions and state preservation

```typescript
import { SaveManager } from "./game/SaveManager";

const saveManager = SaveManager.getInstance();

// New game (clears all data for slot)
saveManager.newGame(slotNumber);

// Save to current slot
saveManager.saveGame();

// Load from slot (or autosave with slot -1)
await saveManager.loadGame(slotNumber);
await saveManager.loadAutoSave();

// Check for existing saves
const slots = saveManager.getSaveSlots();
const hasAutosave = saveManager.hasAutosave();
```

Auto-save runs every 30 seconds.

### Save Slot Management

```typescript
// Get all save slot info
const slots = GameState.getInstance().getSaveSlotInfo();
// Returns: { slot: number, exists: boolean, level?: number, money?: number, playTime?: number }[]

// Delete a save slot
GameState.getInstance().deleteSaveSlot(slotNumber);
```

### Events

```typescript
state.on("player", (state) => {
  console.log(`Money: ${state.player.money}`);
});

state.on("inventory", (state) => {
  updateInventoryUI(state.inventory);
});

state.on("levelup", (state) => {
  showLevelUpAnimation(state.player.level);
});
```

---

## GameTimer

Time management with game-time scaling.

### Basic Usage

```typescript
import { GameTimer } from "./game";

const timer = GameTimer.getInstance();

// Must call every frame
timer.update();

// Get current game time
const gameTime = timer.getGameTime(); // milliseconds
console.log(timer.formatTime()); // "5m 30s"
```

### Time Scaling

```typescript
// Real-time (default)
timer.setTimeScale(1);

// 1 minute = 1 second (60x speed)
timer.setTimeScale(60);

// Pause
timer.pause();
timer.resume();
```

### Timers (Game Time)

Affected by time scale:

```typescript
// One-shot timer
timer.setTimer("harvest_ready", 5 * 60 * 1000, () => {
  console.log("Plant ready!");
});

// Convenience methods
timer.setTimerSeconds("quick", 30, callback);
timer.setTimerMinutes("grow", 5, callback);

// Repeating timer
timer.setTimer("tick", 1000, () => {
  console.log("Tick!");
}, 1000); // Repeat every 1000ms game time

// Check timer
const remaining = timer.getTimerRemaining("harvest_ready");
console.log(`Ready in: ${timer.formatTimerRemaining("harvest_ready")}`);

// Cancel
timer.clearTimer("harvest_ready");
```

### Scheduled Tasks (Real Time)

Not affected by time scale:

```typescript
// Update UI every 500ms real-time
timer.scheduleTask("ui_update", 500, () => {
  updateUI();
});

// Cancel
timer.cancelTask("ui_update");
```

### Update Callbacks

```typescript
timer.onUpdate((deltaTime, gameTime) => {
  // Called every frame
  updateAnimations(deltaTime);
});
```

---

## PlantSystem

Complete plant lifecycle management.

### Planting

```typescript
import { PlantSystem } from "./game";

const plants = PlantSystem.getInstance();

// Plant a seed (removes from inventory)
const plant = plants.plantSeed(
  "basic",                    // Strain ID
  { x: 100, y: 0, z: 50 },   // Position
  "farm_map"                  // Map ID
);

if (plant) {
  console.log(`Planted: ${plant.id}`);
}
```

### Watering & Harvesting

```typescript
// Water a plant
plants.waterPlant(plantId);

// Harvest when ready
if (plants.getVisualState(plantId)?.isHarvestable) {
  plants.harvestPlant(plantId);
}

// Remove dead/unwanted plant
plants.removePlant(plantId);
```

### Plant State

```typescript
const visual = plants.getVisualState(plantId);
if (visual) {
  console.log(`Stage: ${visual.stage}`);
  console.log(`Needs water: ${visual.needsWater}`);
  console.log(`Harvestable: ${visual.isHarvestable}`);
  console.log(`Dead: ${visual.isDead}`);
}

// Time remaining
const timeToHarvest = plants.getTimeToHarvest(plantId);
console.log(`Ready in: ${GameTimer.getInstance().formatTime(timeToHarvest)}`);
```

### Strains

| Strain | Grow Time | Stages | Yield | XP | Unlock |
|--------|-----------|--------|-------|-----|--------|
| `basic` | 5 min | 4 | 3 | 10 | Lv.1 |
| `og_kush` | 10 min | 5 | 5 | 25 | Lv.3 |
| `purple_haze` | 15 min | 5 | 8 | 50 | Lv.5 |

```typescript
// Get available strains
const unlocked = plants.getUnlockedStrains();

// Get strain info
const strain = plants.getStrain("og_kush");
console.log(`${strain.name}: ${strain.growthTime / 60000} minutes`);
```

### Events

```typescript
plants.onPlantEvent((plantId, event, data) => {
  switch (event) {
    case "planted":
      spawnPlantSprite(plantId);
      break;
    case "stage_change":
      updatePlantSprite(plantId, data.newStage);
      break;
    case "needs_water":
      showWaterIcon(plantId);
      break;
    case "harvested":
      removePlantSprite(plantId);
      showReward(data.yield, data.xp);
      break;
    case "died":
      showDeadPlant(plantId);
      break;
  }
});
```

---

## BuildableObjectManager

Manages placed objects with progress states and visual stages.

### Object Templates

Each buildable item has a template defining:

```typescript
interface BuildableObjectTemplate {
  id: string;
  name: string;
  icon: string;
  zoneType: string;
  cost: number;
  requiredLevel: number;
  buildTime: number;        // Time to complete (ms)
  stages: ObjectStage[];    // Visual stages
  isProducer?: boolean;     // Produces resources?
  productionInterval?: number;
  producesItem?: string;
  producesAmount?: number;
}
```

### Visual Stages

Objects can have multiple visual stages based on progress:

```typescript
stages: [
  { minProgress: 0, maxProgress: 49, prefab: "pot_empty.map" },
  { minProgress: 50, maxProgress: 99, prefab: "pot_soil.map" },
  { minProgress: 100, maxProgress: 100, prefab: "pot_ready.map" },
]
```

### Default Templates

| Template | Zone Type | Build Time | Stages |
|----------|-----------|------------|--------|
| `pot_basic` | plant | 10s | 3 |
| `pot_large` | plant | 30s | 3 |
| `grow_light` | equipment | 20s | 3 |
| `water_system` | equipment | 60s | 3 |
| `plant_decor` | decoration | instant | 1 |

### Usage

```typescript
import { BuildableObjectManager } from "./game/BuildableObject";

const manager = BuildableObjectManager.getInstance();

// Create object at zone
const obj = await manager.create("pot_basic", "zone_1", position, "map_1");

// Get progress info
const info = manager.getProgressInfo(obj.id);
console.log(`${info.stageName}: ${info.progress}%`);
console.log(`Time remaining: ${info.timeRemaining}ms`);

// Query objects
const inZone = manager.getObjectsInZone("zone_1");
const pots = manager.getObjectsByTemplate("pot_basic");
```

### Events

```typescript
manager.onObjectEvent((objectId, event, data) => {
  switch (event) {
    case "created":
      console.log("Started building");
      break;
    case "stage_changed":
      updateVisual(objectId, data.newStage);
      break;
    case "completed":
      console.log("Build complete!");
      break;
    case "produced":
      addToInventory(data.item, data.amount);
      break;
  }
});
```

### Custom Templates

```typescript
manager.registerTemplate({
  id: "super_pot",
  name: "Super Pot",
  icon: "🌺",
  zoneType: "plant",
  cost: 500,
  requiredLevel: 5,
  buildTime: 2 * 60 * 1000, // 2 minutes
  stages: [
    { minProgress: 0, maxProgress: 33, prefab: "pots/super_frame.map" },
    { minProgress: 34, maxProgress: 66, prefab: "pots/super_base.map" },
    { minProgress: 67, maxProgress: 99, prefab: "pots/super_soil.map" },
    { minProgress: 100, maxProgress: 100, prefab: "pots/super_ready.map" },
  ],
});
```

---

## GameHUD

In-game heads-up display.

### Usage

```typescript
import { GameHUD } from "./ui/GameHUD";

const hud = GameHUD.getInstance();

// Show/hide
hud.show();
hud.hide();

// Notifications
hud.showNotification("Plant harvested!", "success");
hud.showNotification("Low water!", "warning");
hud.showNotification("Plant died!", "error");

// Plant info panel
hud.showPlantInfo(plantId);
hud.hidePlantInfo();

// Game awards (queued, auto-dismiss)
hud.showGameAward("🏆", "First Harvest!");
```

### HUD Elements

- **Top bar** - Money, level, XP progress, stock inventory, game time
  - **Money pill** - Current cash with 💰 icon
  - **Level pill** - Current level with XP progress bar
  - **Stock pill** - Total cured product grams (click to view inventory)
  - **Time display** - Day number, clock, time-of-day icon, speed toggle
- **Quick inventory** - First 8 items
- **Notifications** - Slide-in alerts (top-right)
- **Plant info** - Selected plant details panel
- **Game awards** - Centered celebration banners

### Stock Inventory

Click the 📦 stock pill to open the stock inventory modal showing:
- All cured products with strain name
- Quality percentage (color-coded)
- Quantity in grams
- Value per gram
- Total stock value estimate

---

## Debug Console

Test game systems from browser console:

```javascript
// View state
game.state()

// Add resources
game.addMoney(1000)
game.addXP(500)
game.addItem("seed_og_kush", "seed", 10)

// Plant
game.plant("basic")
game.plant("og_kush")

// Time control
game.timeScale(60)  // 60x speed
game.timeScale(1)   // Normal

// Save/Reset
game.save()
game.reset()
```

---

## Integration Example

Complete setup in a game scene:

```typescript
import { GameState, GameTimer, PlantSystem } from "./game";
import { GameHUD } from "./ui/GameHUD";

class MyGame {
  start() {
    // Initialize systems
    GameState.getInstance();
    GameTimer.getInstance();
    PlantSystem.getInstance();
    
    // Show HUD
    GameHUD.getInstance().show();
  }

  update() {
    // Must call every frame
    GameTimer.getInstance().update();
  }

  shutdown() {
    // Save and cleanup
    GameState.getInstance().save();
    GameHUD.getInstance().hide();
  }
}
```

---

## OrderSystem

Manages customer orders and fulfillment.

### Customer Templates

```typescript
const customer: CustomerTemplate = {
  id: "vip",
  name: "VIP Customer",
  icon: "👑",
  unlockLevel: 5,
  basePatience: 3 * 60 * 1000, // 3 minutes
  tipMultiplier: 2.0,          // Double tips!
  requestableItems: ["harvest_purple_haze"],
  quantityRange: [5, 10],
  dialogues: ["Only the best for me!"],
};

OrderSystem.getInstance().registerCustomer(customer);
```

### Order Events

```typescript
OrderSystem.getInstance().onOrderEvent((event, data) => {
  switch (event) {
    case "order_created": // New order appeared
    case "order_ready":   // Player has items to fulfill
    case "order_completed": // Order fulfilled
    case "order_expired": // Ran out of time
  }
});
```

---

## CuringSystem

Manages the curing process for harvested products.

### Curing Flow

1. **Harvest** → Fresh product goes to fresh storage
2. **Start Curing** → Place fresh product in curing barrel
3. **Wait** → Curing takes time based on barrel speed
4. **Collect** → Cured product goes to inventory (sellable)

### Usage

```typescript
import { CuringSystem } from "./game/CuringSystem";

const curing = CuringSystem.getInstance();

// Get fresh storage (uncured harvests)
const freshItems = curing.getFreshStorage();

// Start curing in a barrel
curing.startCuring("barrel_basic", "fresh_item_id");

// Check progress
const progress = curing.getCuringProgress(slotId);
// { progress: 75, timeRemaining: 30000, isComplete: false }

// Collect when complete
const result = curing.collectCured(slotId);
// { success: true, amount: 10, itemId: "harvest_og_kush", value: 150 }
```

### Barrel Types

| Barrel | Capacity | Speed | Unlock |
|--------|----------|-------|--------|
| Basic | 50g | 1.0x | Lv.1 |
| Large | 200g | 1.0x | Lv.5 |
| Premium | 100g | 0.5x (2x faster) | Lv.10 |

---

## DealerSystem

Manages selling cured products to dealers.

### Sellable Products

Products become sellable after curing. The system tracks:
- **Item ID** - `harvest_<strain>` format
- **Quality** - Affects price (from plant health/care)
- **Strain ID** - Original strain for display
- **Value per gram** - Base price

```typescript
import { DealerSystem } from "./game/DealerSystem";

const dealers = DealerSystem.getInstance();

// Get all sellable products
const products = dealers.getSellableProducts();
// [{ itemId, name, category, basePrice, quality, quantity, strainId }]

// Calculate price for a dealer
const price = dealers.calculatePrice("dealer_street", "harvest_og_kush", 10, 85);
// { pricePerUnit, totalPrice, breakdown: { base, dealerBonus, qualityBonus, ... } }

// Execute sale
const result = dealers.sellToDealer("dealer_street", [
  { itemId: "harvest_og_kush", quantity: 10 }
]);
```

### Dealer Types

| Dealer | Price Mult | Preferred | Unlock |
|--------|------------|-----------|--------|
| Street | 0.8x | Any | Lv.1 |
| Dispensary | 1.0x | High quality | Lv.5 |
| Collector | 1.5x | Rare strains | Lv.10 |

---

## ShopSystem

Manages item purchasing.

### Shop Items

```typescript
const item: ShopItem = {
  id: "super_seed",
  name: "Super Seeds",
  description: "Rare seeds with bonus yield",
  icon: "✨",
  category: "seeds",
  price: 500,
  itemType: "seed",
  quantity: 1,
  requiredLevel: 10,
  maxPurchases: 3,  // Limited purchases
  stock: 5,         // Limited stock
  restockInterval: 60000, // Restocks every minute
  isVisible: true,
  onSale: false,
  saleDiscount: 0,
};

ShopSystem.getInstance().registerItem(item);
```

### Sales

```typescript
// Put item on 30% sale
ShopSystem.getInstance().setSale("super_seed", 0.3);

// End sale
ShopSystem.getInstance().endSale("super_seed");
```

---

## EquipmentSystem

Manages equipment bonuses and automation.

### Equipment Effects

| Effect Type | Description |
|-------------|-------------|
| `growth_speed` | Multiplier for plant growth |
| `water_retention` | Reduces water consumption |
| `yield_bonus` | Increases harvest yield |
| `xp_bonus` | Increases XP gained |
| `auto_water` | Automatically waters plants |
| `quality_bonus` | Increases product quality |

### Equipment Templates

```typescript
const template: EquipmentTemplate = {
  id: "super_light",
  name: "Super Grow Light",
  icon: "💡",
  description: "50% faster growth",
  zoneType: "equipment",
  effects: [
    { type: "growth_speed", value: 0.5, radius: 200 },
  ],
  powerConsumption: 20,
  requiresActivation: false,
  automationInterval: 0,
};

EquipmentSystem.getInstance().registerTemplate(template);
```

### Getting Bonuses

```typescript
// Get growth speed multiplier at position
const multiplier = EquipmentSystem.getInstance().getMultiplier(
  "growth_speed",
  { x: 100, y: 0, z: 100 },
  "current_map"
);
// Returns 1.5 if near a 50% growth light
```

---

## QuestSystem

Manages objectives and missions.

### Quest Definition

```typescript
const quest: Quest = {
  id: "master_grower",
  name: "Master Grower",
  description: "Harvest 50 plants",
  icon: "🏆",
  category: "main",
  requiredLevel: 5,
  prerequisites: ["first_harvest"],
  objectives: [
    {
      id: "harvest_50",
      type: "harvest",
      description: "Harvest 50 plants",
      target: 50,
      current: 0,
      isComplete: false,
      isOptional: false,
    },
  ],
  rewards: [
    { type: "money", amount: 5000 },
    { type: "xp", amount: 500 },
    { type: "unlock", amount: 1, targetId: "super_pot" },
  ],
  autoStart: false,
  canAbandon: true,
  isRepeatable: false,
  repeatCooldown: 0,
  timeLimit: 0,
};

QuestSystem.getInstance().registerQuest(quest);
```

### Updating Progress

```typescript
// When player harvests
QuestSystem.getInstance().updateObjective("harvest", { 
  strainId: "basic", 
  quantity: 1 
});

// When player builds
QuestSystem.getInstance().updateObjective("build", { 
  itemId: "pot_basic" 
});

// When player completes order
QuestSystem.getInstance().updateObjective("complete_order", {});
```

---

## AchievementSystem

Manages goals and rewards.

### Achievement Definition

```typescript
const achievement: Achievement = {
  id: "millionaire",
  name: "Millionaire",
  description: "Earn $1,000,000 total",
  icon: "💎",
  category: "economy",
  tier: "platinum",
  conditions: [
    { type: "stat_reach", target: 1000000, targetId: "moneyEarned" },
  ],
  rewards: [
    { type: "title", amount: 1, targetId: "millionaire" },
  ],
  isSecret: false,
  points: 100,
};

AchievementSystem.getInstance().registerAchievement(achievement);
```

### Checking Achievements

```typescript
// Check all achievements (call after state changes)
AchievementSystem.getInstance().checkAll();

// Get progress
const progress = AchievementSystem.getInstance().getProgress("millionaire");
console.log(`${progress.conditionProgress[0]} / 1000000`);
```

---

## Day/Night Cycle

The GameTimer includes a full day/night cycle system.

### Configuration

```typescript
const timer = GameTimer.getInstance();

// Set day length (default: 24 real minutes = 1 game day)
timer.setDayLength(24 * 60 * 1000); // 24 minutes
timer.setDayLength(60 * 1000);      // 1 minute = 1 day (fast)
```

### Time Queries

```typescript
// Current time
timer.getHour();        // 0-23
timer.getMinute();      // 0-59
timer.getDay();         // Day number (starts at 1)
timer.getTimeString();  // "14:30" format

// Time of day
timer.getTimeOfDay();   // "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night"
timer.isDaytime();      // true if 6:00-18:00
timer.isNighttime();    // true if 18:00-6:00
```

### Visual Effects

```typescript
// For lighting/rendering
timer.getSunIntensity();  // 0-1 (0 at night, 1 at noon)
timer.getSkyColor();      // { r, g, b } for sky tinting
```

### Time Control

```typescript
// Skip time
timer.skipHours(6);       // Skip 6 game hours
timer.skipToHour(8);      // Skip to 8:00 AM
```

---

## NPCSystem

Manages NPC spawning, interactions, and dialogues.

### NPC Template

```typescript
const npc: NPCTemplate = {
  id: "npc_dealer",
  name: "Street Dealer",
  icon: "🧑",
  defaultLocation: "slums_street",
  spawnConditions: [
    { type: "time_of_day", value: "night" },
  ],
  interactions: [
    {
      type: "shop",
      shopId: "shop_street_dealer",
      icon: "🛒",
    },
    {
      type: "dialogue",
      dialogueId: "dialogue_dealer_intro",
      icon: "💬",
    },
  ],
};
```

### Dialogue Trees

```typescript
const dialogue: DialogueTree = {
  id: "dialogue_dealer_intro",
  nodes: [
    {
      id: "start",
      text: "Hey, you looking to buy?",
      choices: [
        { text: "What do you have?", nextNode: "shop" },
        { text: "Not today.", nextNode: null },
      ],
    },
    {
      id: "shop",
      text: "Check out my selection.",
      action: { type: "open_shop", shopId: "shop_street_dealer" },
    },
  ],
};
```

### Interaction Icons

| Icon | Meaning |
|------|---------|
| ❗ | Quest available |
| ❓ | Quest ready to turn in |
| 🛒 | Shop available |
| 💬 | Dialogue available |
| 🔒 | Locked/unavailable |

---

## WorldSystem

Manages areas, lots, and navigation.

### Area Template

```typescript
const area: AreaTemplate = {
  id: "slums_street",
  name: "Slums Street",
  description: "A run-down neighborhood",
  icon: "🏚️",
  mapFile: "maps/slums_street.map",
  tier: "slums",
  portals: [
    {
      id: "to_downtown",
      targetArea: "downtown",
      targetPortal: "from_slums",
      position: { x: 100, y: 0, z: 0 },
    },
  ],
  accessRequirements: [
    { type: "level", value: 1 },
  ],
  areaBonuses: [],
  lotIds: ["slums_garage"],
};
```

### Lot Template

```typescript
const lot: LotTemplate = {
  id: "slums_garage",
  name: "Abandoned Garage",
  description: "A small space to start",
  areaId: "slums_street",
  price: 0,  // Free starter lot
  plantSlots: 4,
  buildSlots: 6,
  lotBonuses: [],
  unlockRequirements: [],
};
```

### Navigation

```typescript
const world = WorldSystem.getInstance();

// Check access
const result = world.canAccessArea("downtown");
if (!result.canAccess) {
  console.log(result.reason); // "Requires level 5"
}

// Enter area
world.enterArea("slums_street");

// Purchase and enter lot
world.purchaseLot("slums_garage");
world.enterLot("slums_garage");
```

---

## Adding New Content

### Using JSON Files (Recommended)

Edit the JSON files in `src/data/`:

```json
// src/data/strains.json
{
  "strains": [
    {
      "id": "genetics_new_strain",
      "name": "New Strain",
      ...
    }
  ]
}
```

See [Data Files](./data-files.md) for full documentation.

### Using TypeScript

For content not yet migrated to JSON, edit `GameData.ts`:

```typescript
export const PLANT_STRAINS: StrainDefinition[] = [
  // ... existing
  {
    id: "new_strain",
    name: "New Strain",
    growthTime: 20 * 60 * 1000,
    stages: 6,
    waterConsumption: 12,
    baseYield: 10,
    xpReward: 75,
    seedId: "seed_new_strain",
    harvestId: "harvest_new_strain",
    unlockLevel: 7,
  },
];
```

Don't forget to add seed items to starting inventory or shop!

---

## See Also

- [Genetics System](./genetics-system.md) - Detailed breeding documentation
- [Data Files](./data-files.md) - JSON data format
- [Configuration](./config.md) - Engine configuration
