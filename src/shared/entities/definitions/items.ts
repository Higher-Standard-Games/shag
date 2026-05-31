/**
 * Armor & health pickup definitions.
 *
 * These describe the CLIENT-side visual pickup (model, glow, classname). The
 * actual gameplay (amounts, plate rules, caps, decay) is server-authoritative
 * and lives in shared/items/ItemGrants.ts, keyed by the classname→kind map in
 * shared/bsp/PickupTable.ts. Classnames follow Warsow conventions.
 *
 * TODO(models): modelPath uses the generic ammobox placeholder so pickups load
 * and render out-of-the-box. Swap in real armor/health models when available
 * (data-only change — no code impact).
 */

import type { EntityDef } from "../EntityDef";
import { EntityType } from "../EntityType";

const PLACEHOLDER_MODEL = "models/items/ammo/ammobox/ammobox.md3";

// ── Armor (unified plate model: shard +5, ga/ya/ra = 1/2/4 plates) ──

export const ARMOR_SHARD: EntityDef = {
  id: "armor_shard",
  name: "Armor Shard",
  type: EntityType.ARMOR,
  classname: "item_armor_shard",
  modelPath: PLACEHOLDER_MODEL,
  scale: 0.8,
  glowColor: { r: 0.3, g: 1.0, b: 0.3 },
};

export const ARMOR_GREEN: EntityDef = {
  id: "armor_ga",
  name: "Green Armor",
  type: EntityType.ARMOR,
  classname: "item_armor_ga",
  modelPath: PLACEHOLDER_MODEL,
  scale: 1.0,
  glowColor: { r: 0.2, g: 1.0, b: 0.2 },
};

export const ARMOR_YELLOW: EntityDef = {
  id: "armor_ya",
  name: "Yellow Armor",
  type: EntityType.ARMOR,
  classname: "item_armor_ya",
  modelPath: PLACEHOLDER_MODEL,
  scale: 1.0,
  glowColor: { r: 1.0, g: 0.85, b: 0.1 },
};

export const ARMOR_RED: EntityDef = {
  id: "armor_ra",
  name: "Red Armor",
  type: EntityType.ARMOR,
  classname: "item_armor_ra",
  modelPath: PLACEHOLDER_MODEL,
  scale: 1.0,
  glowColor: { r: 1.0, g: 0.2, b: 0.2 },
};

// ── Health (small +25, large +50, mega/ultra +100 overheal→200) ──

export const HEALTH_SMALL: EntityDef = {
  id: "health_small",
  name: "Health (Small)",
  type: EntityType.HEALTH,
  classname: "item_health_small",
  modelPath: PLACEHOLDER_MODEL,
  scale: 0.8,
  glowColor: { r: 0.4, g: 0.6, b: 1.0 },
};

export const HEALTH_LARGE: EntityDef = {
  id: "health_large",
  name: "Health (Large)",
  type: EntityType.HEALTH,
  classname: "item_health_large",
  modelPath: PLACEHOLDER_MODEL,
  scale: 1.0,
  glowColor: { r: 0.5, g: 0.8, b: 1.0 },
};

export const HEALTH_MEGA: EntityDef = {
  id: "health_mega",
  name: "Mega Health",
  type: EntityType.HEALTH,
  classname: "item_health_mega",
  modelPath: PLACEHOLDER_MODEL,
  scale: 1.2,
  glowColor: { r: 1.0, g: 0.3, b: 0.3 },
};

// Ultra is a distinct classname that behaves identically to mega (see PickupTable).
export const HEALTH_ULTRA: EntityDef = {
  id: "health_ultra",
  name: "Ultra Health",
  type: EntityType.HEALTH,
  classname: "item_health_ultra",
  modelPath: PLACEHOLDER_MODEL,
  scale: 1.2,
  glowColor: { r: 1.0, g: 0.2, b: 0.5 },
};

export const ARMOR_DEFS = [ARMOR_SHARD, ARMOR_GREEN, ARMOR_YELLOW, ARMOR_RED];
export const HEALTH_DEFS = [HEALTH_SMALL, HEALTH_LARGE, HEALTH_MEGA, HEALTH_ULTRA];
