
import { EntityDef } from './EntityDef';
import { EntityType } from './EntityType';

export interface AmmoDef extends EntityDef {
    type: EntityType.AMMO;

    /** The ammo type identifer (e.g. 'cells', 'shells') */
    ammoType: string;

    /** Amount of ammo to give */
    amount: number;

    /** Max ammo limit for this type (optional override?) */
    maxAmount?: number;

    /** Model to use for pickup */
    modelPath: string;

    /** Scale of the model */
    scale?: number;
}
