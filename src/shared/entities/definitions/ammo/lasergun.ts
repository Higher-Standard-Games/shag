import type { AmmoDef } from "../../AmmoDef";
import { EntityType } from "../../EntityType";

export const LASER_AMMO: AmmoDef = {
  id: "ammo_lasers",
  name: "Laser Cells",
  type: EntityType.AMMO,
  classname: "ammo_lasergun", // Warsow per-weapon name (what maps use)
  classnameAliases: ["ammo_lasers"], // legacy Quake-style

  ammoType: "lasers",
  amount: 100,

  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  scale: 1.0,

  // Pickup glow (red)
  glowColor: { r: 1.0, g: 0.2, b: 0.2 },
};
