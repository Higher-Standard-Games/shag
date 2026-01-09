/**
 * GameCommands - Register game-specific debug commands
 * 
 * Connects console commands to game systems (not engine systems).
 */

import { CommandRegistry } from '../../engine/console/CommandRegistry';
import { Cvar } from '../../engine/core/Cvar';
import { GameState } from './GameState';
import { SaveManager } from './SaveManager';

export function registerGameCommands(): void {
  const registry = CommandRegistry.getInstance();

  // ============================================================================
  // Game Cvars (g_* prefix)
  // ============================================================================

  Cvar.register('g_autosave', true, {
    type: 'bool',
    description: 'Enable autosave',
  });

  Cvar.register('g_cheats', false, {
    type: 'bool',
    description: 'Enable cheat commands',
    persist: false, // Don't persist cheats
  });

  // ============================================================================
  // Give Commands (Cheats)
  // ============================================================================
  
  registry.register('give', (args) => {
    const resource = args[0]?.toLowerCase();
    const amount = parseInt(args[1]) || 1000;
    const gameState = GameState.getInstance();
    
    switch (resource) {
      case 'money':
        gameState.addMoney(amount);
        return `Gave $${amount}`;
        
      case 'xp':
        gameState.addXP(amount);
        return `Gave ${amount} XP`;
        
      case 'weed': {
        const strain = args[1] || 'og_kush';
        const qty = parseInt(args[2]) || 10;
        // Would need to wire to inventory system
        return `Gave ${qty}g of ${strain} (wire to InventorySystem)`;
      }
        
      default:
        return 'Usage: give <money|xp|weed> <amount>';
    }
  });

  // ============================================================================
  // NPC Commands (game-specific entity spawning)
  // ============================================================================
  
  registry.register('npc', (args) => {
    const subcommand = args[0]?.toLowerCase();
    
    switch (subcommand) {
      case 'spawn': {
        const type = args[1]?.toLowerCase() || 'generic';
        return `Spawning NPC: ${type} (wire to NPCSystem)`;
      }
      case 'dealer':
        return 'Spawning dealer (wire to DealerSystem)';
      case 'customer':
        return 'Spawning customer (wire to CustomerSystem)';
      case 'list':
        return 'Listing NPCs (wire to NPCSystem)';
      default:
        return 'Subcommands: spawn, dealer, customer, list';
    }
  });

  // ============================================================================
  // Quest Commands
  // ============================================================================
  
  registry.register('quest', (args) => {
    const subcommand = args[0]?.toLowerCase();
    
    switch (subcommand) {
      case 'list':
        return 'Active quests: (wire to QuestSystem)';
      case 'complete': {
        const questId = args[1];
        if (!questId) return 'Usage: quest complete <questid>';
        return `Completing quest: ${questId} (wire to QuestSystem)`;
      }
      case 'start': {
        const questId = args[1];
        if (!questId) return 'Usage: quest start <questid>';
        return `Starting quest: ${questId} (wire to QuestSystem)`;
      }
      default:
        return 'Subcommands: list, complete, start';
    }
  });

  // ============================================================================
  // Plant Commands
  // ============================================================================
  
  registry.register('plant', (args) => {
    const subcommand = args[0]?.toLowerCase();
    
    switch (subcommand) {
      case 'grow':
        return 'Growing all plants instantly (wire to PlantSystem)';
      case 'water':
        return 'Watering all plants (wire to PlantSystem)';
      case 'harvest':
        return 'Harvesting all ready plants (wire to PlantSystem)';
      default:
        return 'Subcommands: grow, water, harvest';
    }
  });

  // ============================================================================
  // Unlock Commands
  // ============================================================================
  
  registry.register('unlock', (args) => {
    const feature = args[0]?.toLowerCase();
    
    switch (feature) {
      case 'all':
        return 'Unlocking everything (wire to ProgressionSystem)';
      case 'strains':
        return 'Unlocking all strains (wire to StrainSystem)';
      case 'equipment':
        return 'Unlocking all equipment (wire to EquipmentSystem)';
      case 'areas':
        return 'Unlocking all areas (wire to AreaSystem)';
      default:
        return 'Usage: unlock <all|strains|equipment|areas>';
    }
  });

  // ============================================================================
  // Save/Load Commands
  // ============================================================================
  
  registry.register('save', (args) => {
    const slot = parseInt(args[0]) || 0;
    SaveManager.getInstance().saveGame(slot);
    return `Game saved to slot ${slot}`;
  });

  registry.register('load', async (args) => {
    const slot = parseInt(args[0]) || 0;
    const success = await SaveManager.getInstance().loadGame(slot);
    return success ? `Game loaded from slot ${slot}` : `Failed to load slot ${slot}`;
  });

  // ============================================================================
  // Goto Commands (game-specific named locations)
  // ============================================================================
  
  registry.register('goto', (args) => {
    const location = args[0]?.toLowerCase();
    
    switch (location) {
      case 'home':
        return 'Going to home (wire to MapSystem)';
      case 'shop':
        return 'Going to shop (wire to MapSystem)';
      case 'dealer':
        return 'Going to dealer (wire to MapSystem)';
      default:
        return 'Usage: goto <home|shop|dealer>';
    }
  });
}
