/**
 * Voltaic Ammo - Cell ammo pickup for Voltaic beam weapon
 */

import type { AmmoDef } from "../../AmmoDef";
import { EntityType } from "../../EntityType";

export const VOLTAIC_AMMO: AmmoDef = {
  id: "ammo_cells",
  name: "Energy Cells",
  type: EntityType.AMMO,
  classname: "ammo_cells",
  // NOTE: "ammo_lasers" is owned by lasergun ammo (kind "lasers"); voltaic uses
  // its own cell pool. No shipped map spawns ammo_cells/ammo_voltaic.

  ammoType: "cells",
  amount: 100,

  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  scale: 1.0,

  // Pickup glow (electric cyan, matches voltaic)
  glowColor: { r: 0.2, g: 0.8, b: 1.0 },
};
