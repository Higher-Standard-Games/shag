/**
 * GameHUDSetup - Connects the generic HUD system to game-specific data
 * 
 * This file bridges the engine's HUD system with game systems like
 * GameState, GameClock, QuestSystem, OrderSystem, etc.
 */

import { HUD } from '../../../engine/ui/hud';
import { GamePaths } from '../../../engine/core/GamePaths';
import { GameState } from '../GameState';
import { GameClock } from '../../../engine/core/GameClock';
import { QuestSystem } from '../QuestSystem';
import { OrderSystem } from '../OrderSystem';
import { CameraSystem } from '../../../engine/camera';
import { FPSController } from '../../../engine/camera/controllers/FPSController';

/**
 * Get period icon based on time of day
 */
function getPeriodIcon(period: string): string {
  switch (period) {
    case 'dawn': return '🌅';
    case 'morning': return '☀️';
    case 'afternoon': return '🌤️';
    case 'evening': return '🌆';
    case 'dusk': return '🌇';
    case 'night': return '🌙';
    default: return '🌙';
  }
}

/**
 * Initialize and configure the HUD system for the game
 */
export async function setupGameHUD(): Promise<void> {
  console.log('[GameHUD] Setting up...');

  // Initialize HUD system with config from game directory
  const hudConfigPath = GamePaths.getInstance().hudConfigPath();
  await HUD.init(hudConfigPath);

  // ============================================================================
  // Value Bindings
  // ============================================================================

  // Money pill
  HUD.bind('money', () => GameState.getInstance().getPlayer().money);

  // Level pill with XP progress
  HUD.bind('level', () => GameState.getInstance().getPlayer().level);
  HUD.bind('xpProgress', () => {
    const gs = GameState.getInstance();
    const player = gs.getPlayer();
    const currentXP = player.xp;
    const currentLevel = player.level;
    const xpForCurrentLevel = gs.getXPForLevel(currentLevel);
    const xpForNextLevel = gs.getXPForLevel(currentLevel + 1);
    const xpInLevel = currentXP - xpForCurrentLevel;
    const xpNeeded = xpForNextLevel - xpForCurrentLevel;
    return xpNeeded > 0 ? xpInLevel / xpNeeded : 0;
  });

  // Stock pill - total items in inventory
  HUD.bind('stock', () => {
    const inventory = GameState.getInstance().getInventory();
    // Sum up all item quantities
    let total = 0;
    for (const item of inventory.items) {
      total += item.quantity || 1;
    }
    return total;
  });

  // Inventory count - number of items
  HUD.bind('inventory', () => {
    const inventory = GameState.getInstance().getInventory();
    return inventory.items.length;
  });

  // Time pill group values
  HUD.bind('time', () => {
    const clock = GameClock.getInstance();
    const timeOfDay = clock.getTimeOfDay();
    return {
      day: clock.getCurrentDay(),
      clock: clock.formatTime12h(),
      period: getPeriodIcon(timeOfDay.period),
    };
  });

  // Badge counts
  HUD.bind('activeQuestCount', () => {
    return QuestSystem.getInstance().getActiveQuests().length;
  });

  HUD.bind('activeOrderCount', () => {
    return OrderSystem.getInstance().getPendingOrders().length;
  });

  // Weapon & Ammo
  HUD.bind('weapon', () => {
    const controller = CameraSystem.getInstance().getActiveController();
    if (controller instanceof FPSController) {
      const weapon = controller.inventory.getCurrentWeapon();
      return weapon ? weapon.name : 'Unarmed';
    }
    return '';
  });

  HUD.bind('ammo', () => {
    const controller = CameraSystem.getInstance().getActiveController();
    if (controller instanceof FPSController) {
      const inv = controller.inventory;
      const weaponId = inv.getCurrentWeaponId();
      if (weaponId) {
        const loaded = inv.getLoadedAmmo(weaponId);
        // Optionally show reserve too? For now just loaded
        return loaded;
      }
    }
    return 0;
  });

  // ============================================================================
  // List Bindings
  // ============================================================================

  // Quest list
  HUD.bindList('quests', {
    data: () => {
      const quests = QuestSystem.getInstance().getActiveQuests();
      return quests.map(quest => {
        // Calculate progress from objectives
        let progress = 0;
        if (quest.objectives && quest.objectives.length > 0) {
          const completed = quest.objectives.filter(o => o.current >= o.target).length;
          progress = completed / quest.objectives.length;
        }

        return {
          icon: '📜',
          title: quest.questId,
          description: quest.objectives?.[0]
            ? `${quest.objectives[0].current}/${quest.objectives[0].target}`
            : '',
          progress,
        };
      });
    }
  });

  // Order list
  HUD.bindList('orders', {
    data: () => {
      const orders = OrderSystem.getInstance().getPendingOrders();
      return orders.map(order => ({
        icon: '📦',
        title: order.customerName || 'Customer',
        description: order.status || 'Pending',
      }));
    }
  });

  // Events list (placeholder)
  HUD.bindList('events', {
    data: () => {
      // TODO: Connect to event system when available
      return [];
    }
  });

  // ============================================================================
  // Click Handlers
  // ============================================================================

  HUD.onClick('money', () => {
    // TODO: Open shop panel
    console.log('[GameHUD] Money clicked - open shop');
  });

  HUD.onClick('stock', () => {
    // TODO: Open stock panel
    console.log('[GameHUD] Stock clicked - open stock');
  });

  HUD.onClick('inventory', () => {
    // TODO: Open inventory panel
    console.log('[GameHUD] Inventory clicked - open inventory');
  });

  HUD.onClick('speed-btn', () => {
    const clock = GameClock.getInstance();
    if (clock.isPausedState()) {
      clock.resume();
    } else {
      clock.pause();
    }
  });

  HUD.onClick('fullscreen-btn', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });

  // ============================================================================
  // Start Update Loop
  // ============================================================================

  HUD.start();

  console.log('[GameHUD] Setup complete');
}

/**
 * Cleanup the HUD system
 */
export function destroyGameHUD(): void {
  HUD.destroy();
}
