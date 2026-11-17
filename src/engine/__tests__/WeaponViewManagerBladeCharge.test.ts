import { describe, expect, it } from "vitest";
import { WeaponViewManager } from "../weapon/WeaponViewManager";

type Inside = {
  currentWeaponDef: { meleeRadius?: number } | null;
  bladeCharging(aiming: boolean): boolean;
};

const blade = { meleeRadius: 64 };
const gun = {};
const watch = (manager: WeaponViewManager, entityId: string, aiming: boolean) =>
  manager.updateFollowedBob({
    entityId,
    aiming,
    deltaTime: 0.016,
    grounded: true,
    horizontalSpeed: 0,
    velocityY: 0,
    landingVelocity: 0,
    bobCycle: 0,
  });

describe("the blade's charge on screen", () => {
  it("is not started by aim held through a weapon switch", () => {
    const manager = new WeaponViewManager();
    const inside = manager as unknown as Inside;
    inside.currentWeaponDef = gun;
    expect(inside.bladeCharging(true)).toBe(false);
    inside.currentWeaponDef = blade;
    expect(inside.bladeCharging(true)).toBe(false);
    expect(inside.bladeCharging(false)).toBe(false);
    expect(inside.bladeCharging(true)).toBe(true);
  });

  it("shows at once on a player watched mid-charge, after one with another weapon", () => {
    const manager = new WeaponViewManager();
    const inside = manager as unknown as Inside;
    watch(manager, "player_1", false);
    inside.currentWeaponDef = gun;
    expect(inside.bladeCharging(false)).toBe(false);
    // The spectator moves on to someone already charging the blade
    watch(manager, "player_2", true);
    inside.currentWeaponDef = blade;
    expect(inside.bladeCharging(true)).toBe(true);
  });
});
