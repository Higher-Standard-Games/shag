import type { AmmoDef } from "../../AmmoDef";
import { EntityType } from "../../EntityType";

export const BOLT_AMMO: AmmoDef = {
  id: "ammo_bolts",
  name: "Electro Bolts",
  type: EntityType.AMMO,
  classname: "ammo_bolts",

  ammoType: "bolts",
  amount: 10,

  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  scale: 1.0,

  // Pickup glow (electric blue)
  glowColor: { r: 0.3, g: 0.5, b: 1.0 },
};
