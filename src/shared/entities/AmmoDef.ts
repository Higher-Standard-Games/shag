import type { EntityDef } from "./EntityDef";
import type { EntityType } from "./EntityType";

export interface AmmoDef extends EntityDef {
  type: EntityType.AMMO;

  /** The ammo type identifer (e.g. 'cells', 'shells') */
  ammoType: string;

  /** Amount of ammo to give */
  amount: number;

  /** Max ammo limit for this type (optional override?) */
  maxAmount?: number;

  /** Scale of the pickup */
  scale?: number;
}
