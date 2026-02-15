
import { AmmoDef } from '../../AmmoDef';
import { EntityType } from '../../EntityType';

export const ROCKET_AMMO: AmmoDef = {
    id: 'ammo_rockets',
    name: 'Rockets',
    type: EntityType.AMMO,
    classname: 'ammo_rockets',

    ammoType: 'rockets',
    amount: 10,

    modelPath: 'models/items/ammo/ammobox/ammobox.md3',
    scale: 1.0,

    // Pickup glow (red-orange)
    glowColor: { r: 1.0, g: 0.4, b: 0.1 },
};
