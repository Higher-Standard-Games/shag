import { afterEach, expect, it } from "vitest";
import { clearWeaponIdResolver, registerWeaponIdResolver, resolveWeaponId } from "../WeaponIdResolver";

afterEach(clearWeaponIdResolver);

it("leaves IDs unchanged without a selected game", () => {
  clearWeaponIdResolver();
  expect(resolveWeaponId("custom_weapon")).toBe("custom_weapon");
  expect(resolveWeaponId("lasergun")).toBe("lasergun");
});

it("uses the selected mapping and releases it when cleared", () => {
  registerWeaponIdResolver((id) => (id === "old_id" ? "current_id" : id));
  expect(resolveWeaponId("old_id")).toBe("current_id");
  expect(resolveWeaponId("other")).toBe("other");
  clearWeaponIdResolver();
  expect(resolveWeaponId("old_id")).toBe("old_id");
});
