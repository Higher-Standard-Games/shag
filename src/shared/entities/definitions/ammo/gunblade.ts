
import { AmmoDef } from '../../AmmoDef';
import { EntityType } from '../../EntityType';

export const GUNBLADE_AMMO: AmmoDef = {
    id: 'ammo_gunblade',
    name: 'Gunblade Charge',
    type: EntityType.AMMO,
    classname: 'ammo_gunblade',

    ammoType: 'gunblade',
    amount: 1,

    modelPath: 'models/items/ammo/ammobox/ammobox.md3',
    scale: 1.0,

    // Pickup glow (golden)
    glowColor: { r: 1.0, g: 0.8, b: 0.3 },
};
