
import { AmmoDef } from '../../AmmoDef';
import { EntityType } from '../../EntityType';

export const PLASMA_AMMO: AmmoDef = {
    id: 'ammo_plasmagun',
    name: 'Plasma Cells',
    type: EntityType.AMMO,
    classname: 'ammo_plasmagun',

    ammoType: 'cells',
    amount: 50,

    modelPath: 'models/items/ammo/ammobox/ammobox.md3',
    scale: 1.0,
};
