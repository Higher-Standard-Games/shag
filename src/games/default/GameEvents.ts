/**
 * GameEvents - Game-specific event type definitions
 * 
 * These interfaces provide type safety for game-specific events.
 * The engine EventBus is generic and doesn't know about these types.
 * 
 * Usage:
 *   import { EventBus } from '@engine/core';
 *   import type { PlantEvents } from './GameEvents';
 *   
 *   EventBus.emit<PlantEvents["plant:harvested"]>("plant:harvested", { ... });
 */

// ==================== Plant System Events ====================

export interface PlantEvents {
  "plant:planted": { plantId: string; strain: string; position: { x: number; y: number; z: number } };
  "plant:watered": { plantId: string; waterLevel: number };
  "plant:fertilized": { plantId: string; speedBoost: number };
  "plant:stage_change": { plantId: string; oldStage: number; newStage: number };
  "plant:harvested": { plantId: string; strain: string; yield: number; quality: number };
  "plant:died": { plantId: string; reason: string };
}

// ==================== Shop System Events ====================

export interface ShopEvents {
  "shop:purchased": { itemId: string; quantity: number; cost: number };
  "shop:sold": { itemId: string; quantity: number; revenue: number };
  "shop:restocked": { itemId: string; newStock: number };
}

// ==================== Building System Events ====================

export interface BuildingEvents {
  "building:started": { objectId: string; templateId: string; zoneId: string };
  "building:progress": { objectId: string; progress: number };
  "building:completed": { objectId: string; templateId: string; zoneId: string };
  "building:demolished": { objectId: string; templateId: string };
}

// ==================== Player Events ====================

export interface PlayerEvents {
  "player:levelup": { oldLevel: number; newLevel: number };
  "player:xp_gained": { amount: number; source: string };
  "player:money_changed": { oldAmount: number; newAmount: number; delta: number };
}

// ==================== Curing System Events ====================

export interface CuringEvents {
  "curing:started": { barrelId: string; strainId: string; amount: number };
  "curing:completed": { barrelId: string; strainId: string; amount: number };
  "curing:decayed": { itemId: string; amount: number };
}

// ==================== Game State Events ====================

export interface GameStateEvents {
  "game:saved": { timestamp: number };
  "game:loaded": { timestamp: number };
  "game:day_changed": { day: number };
  "game:paused": Record<string, never>;
  "game:resumed": Record<string, never>;
}

// ==================== Union Type ====================

/**
 * Union of all game-specific event types for type-safe emit/on
 */
export type AllGameEvents = 
  PlantEvents & 
  ShopEvents & 
  BuildingEvents & 
  PlayerEvents & 
  CuringEvents & 
  GameStateEvents;

/**
 * Helper type to get event data type by event name
 */
export type GameEventData<K extends keyof AllGameEvents> = AllGameEvents[K];
