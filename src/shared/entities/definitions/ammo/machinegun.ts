import type { AmmoDef } from "../../AmmoDef";
import { EntityType } from "../../EntityType";

export const BULLET_AMMO: AmmoDef = {
  id: "ammo_bullets",
  name: "Bullets",
  type: EntityType.AMMO,
  classname: "ammo_bullets",

  ammoType: "bullets",
  amount: 50,

  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  scale: 1.0,

  // Pickup glow (yellow)
  glowColor: { r: 1.0, g: 0.9, b: 0.3 },
};
