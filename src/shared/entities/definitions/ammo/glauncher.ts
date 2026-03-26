import type { AmmoDef } from "../../AmmoDef";
import { EntityType } from "../../EntityType";

export const GRENADE_AMMO: AmmoDef = {
  id: "ammo_grenades",
  name: "Grenades",
  type: EntityType.AMMO,
  classname: "ammo_grenades",

  ammoType: "grenades",
  amount: 10,

  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  scale: 1.0,

  // Pickup glow (green)
  glowColor: { r: 0.3, g: 0.9, b: 0.2 },
};
