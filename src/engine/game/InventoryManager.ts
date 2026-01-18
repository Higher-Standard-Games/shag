/**
 * InventoryManager - Manages player weapons and ammunition
 */

import { WeaponDef } from '../../shared/entities/WeaponDef';
import { EntityRegistry } from '../../shared/entities/EntityRegistry';
import { EntityType } from '../../shared/entities/EntityType';

export interface AmmoState {
    [ammoType: string]: number;
}

export class InventoryManager {
    private weapons: Map<string, WeaponDef> = new Map();
    private slots: string[] = [];
    private ammo: AmmoState = {};
    private currentWeaponId: string | null = null;

    // Limits
    private static readonly MAX_AMMO = 200; // Default fallback

    constructor() {
        // Initialize with default ammo types (optional)
        this.ammo = {
            'shells': 0,
            'bullets': 0,
            'rockets': 0,
            'cells': 0,
            'slugs': 0,
            'grenades': 0
        };
    }

    /**
     * Give a weapon to the player
     * @returns true if weapon was new
     */
    public giveWeapon(weaponId: string): boolean {
        if (this.weapons.has(weaponId)) {
            return false;
        }

        const def = EntityRegistry.getInstance().get<WeaponDef>(weaponId);
        if (!def || def.type !== EntityType.WEAPON) {
            console.warn(`[InventoryManager] Invalid weapon ID: ${weaponId}`);
            return false;
        }

        this.weapons.set(weaponId, def);
        this.slots.push(weaponId); // Add to next available slot
        console.log(`[InventoryManager] Acquired weapon: ${def.name} (Slot ${this.slots.length})`);

        // Auto-switch if it's the first weapon or better? (For now, just log)
        if (!this.currentWeaponId) {
            this.equipWeapon(weaponId);
        }

        return true;
    }

    /**
     * Give ammo to the player
     * @returns amount actually added
     */
    public giveAmmo(ammoType: string, amount: number): number {
        const current = this.ammo[ammoType] || 0;
        const max = InventoryManager.MAX_AMMO; // TODO: Get from AmmoDef

        const added = Math.min(amount, max - current);
        this.ammo[ammoType] = current + added;

        return added;
    }

    /**
     * Equip a weapon
     */
    public equipWeapon(weaponId: string): boolean {
        if (!this.weapons.has(weaponId)) {
            console.warn(`[InventoryManager] Player does not have weapon: ${weaponId}`);
            return false;
        }

        this.currentWeaponId = weaponId;
        // TODO: Notify weapon view manager
        console.log(`[InventoryManager] Equipped: ${this.weapons.get(weaponId)?.name}`);
        return true;
    }

    // Track run-time state for weapons (e.g. loaded ammo)
    private weaponStates: Map<string, { loadedAmmo: number }> = new Map();

    private ensureWeaponState(weaponId: string, clipSize: number) {
        if (!this.weaponStates.has(weaponId)) {
            this.weaponStates.set(weaponId, { loadedAmmo: clipSize });
        }
    }

    /**
     * Get loaded ammo for a weapon
     */
    public getLoadedAmmo(weaponId: string): number {
        const def = this.weapons.get(weaponId);
        if (!def) return 0;

        // If no clip size (or 0), assume infinite/direct from reserve? 
        // For now let's assume if clipSize is defined and > 0, we use it.
        if (!def.clipSize) return this.getAmmoCount(def.ammoType || '');

        this.ensureWeaponState(weaponId, def.clipSize);
        return this.weaponStates.get(weaponId)!.loadedAmmo;
    }

    public getWeaponByIndex(index: number): string | undefined {
        if (index < 0 || index >= this.slots.length) return undefined;
        return this.slots[index];
    }

    /**
     * Consume ammo from the weapon's clip
     */
    public consumeLoadedAmmo(weaponId: string, amount: number = 1): boolean {
        const def = this.weapons.get(weaponId);
        if (!def) return false;

        // If no clip usage, consume from reserve directly
        if (!def.clipSize) {
            if (def.ammoType) {
                return this.consumeAmmo(def.ammoType, amount);
            }
            return true; // Infinite ammo if no type?
        }

        this.ensureWeaponState(weaponId, def.clipSize);
        const state = this.weaponStates.get(weaponId)!;

        if (state.loadedAmmo >= amount) {
            state.loadedAmmo -= amount;
            return true;
        }
        return false;
    }

    /**
     * Reload a weapon from reserve
     * @returns true if reload was successful (ammo moved)
     */
    public reloadWeapon(weaponId: string): boolean {
        const def = this.weapons.get(weaponId);
        if (!def || !def.clipSize || !def.ammoType) return false;

        this.ensureWeaponState(weaponId, def.clipSize);
        const state = this.weaponStates.get(weaponId)!;

        // Already full?
        if (state.loadedAmmo >= def.clipSize) return false;

        const needed = def.clipSize - state.loadedAmmo;
        const available = this.getAmmoCount(def.ammoType);

        if (available <= 0) return false;

        const toLoad = Math.min(needed, available);

        // Take from reserve
        this.consumeAmmo(def.ammoType, toLoad);

        // Add to clip
        state.loadedAmmo += toLoad;

        return true;
    }

    /**
     * Check if weapon needs reload
     */
    public needsReload(weaponId: string): boolean {
        const def = this.weapons.get(weaponId);
        if (!def || !def.clipSize) return false;

        this.ensureWeaponState(weaponId, def.clipSize);
        const state = this.weaponStates.get(weaponId)!;

        // Can reload if not full AND has reserve
        return state.loadedAmmo < def.clipSize &&
            (def.ammoType ? this.getAmmoCount(def.ammoType) > 0 : true);
    }

    public hasWeapon(weaponId: string): boolean {
        return this.weapons.has(weaponId);
    }

    public getCurrentWeapon(): WeaponDef | undefined {
        if (!this.currentWeaponId) return undefined;
        return this.weapons.get(this.currentWeaponId);
    }

    public getCurrentWeaponId(): string | null {
        return this.currentWeaponId;
    }



    public getAmmoCount(ammoType: string): number {
        return this.ammo[ammoType] || 0;
    }

    public hasAmmo(ammoType: string, amount: number): boolean {
        return (this.ammo[ammoType] || 0) >= amount;
    }

    // Directly consumes reserve ammo
    public consumeAmmo(ammoType: string, amount: number): boolean {
        if (!this.hasAmmo(ammoType, amount)) return false;
        this.ammo[ammoType] -= amount;
        return true;
    }
}
