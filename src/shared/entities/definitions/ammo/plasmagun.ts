
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

    // Pickup glow (same cyan as plasmagun)
    glowColor: { r: 0.2, g: 0.8, b: 1.0 },
};
