import type { AmmoDef } from "../../AmmoDef";
import { EntityType } from "../../EntityType";

export const INSTA_AMMO: AmmoDef = {
  id: "ammo_instas",
  name: "Insta Charges",
  type: EntityType.AMMO,
  classname: "ammo_instas",

  ammoType: "instas",
  amount: 5,

  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  scale: 1.0,

  // Pickup glow (bright purple)
  glowColor: { r: 0.8, g: 0.2, b: 1.0 },
};
