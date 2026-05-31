/**
 * PickupTable.test.ts — locks the shared weapon-pickup extractor that gives the
 * server and client identical pickup ids (the key to server-authoritative
 * pickup state; see docs/research/SERVER_AUTHORITATIVE_PICKUPS.md).
 */

import { describe, expect, it } from "vitest";
import { CLASSNAME_TO_WEAPON, extractWeaponPickups } from "../PickupTable";

type Ent = { classname: string; properties: Record<string, string> };

const ent = (classname: string, origin?: string): Ent => ({
  classname,
  properties: origin ? { origin } : {},
});

describe("extractWeaponPickups", () => {
  it("keeps only known weapon classnames, assigning sequential ids in BSP order", () => {
    const entities: Ent[] = [
      ent("worldspawn"),
      ent("info_player_deathmatch", "0 0 0"),
      ent("weapon_rocketlauncher", "100 200 16"),
      ent("item_health", "50 50 0"), // not a weapon → ignored
      ent("weapon_plasmagun", "300 400 16"),
    ];

    const out = extractWeaponPickups(entities);
    expect(out.map((e) => [e.id, e.weaponId])).toEqual([
      [0, "rlauncher"],
      [1, "plasmagun"],
    ]);
  });

  it("applies the Q3→Babylon coordinate swap (origin 'x y z' → {x, y:z, z:y})", () => {
    const [rl] = extractWeaponPickups([ent("weapon_rocketlauncher", "100 200 16")]);
    expect(rl.position).toEqual({ x: 100, y: 16, z: 200 });
  });

  it("ignores non-weapon entities between weapons without affecting weapon ordinals", () => {
    const out = extractWeaponPickups([
      ent("weapon_machinegun", "1 1 1"),
      ent("item_armor_combat", "2 2 2"),
      ent("ammo_rockets", "3 3 3"),
      ent("weapon_rocketlauncher", "4 4 4"),
    ]);
    expect(out.map((e) => e.id)).toEqual([0, 1]);
    expect(out.map((e) => e.weaponId)).toEqual(["machinegun", "rlauncher"]);
  });

  it("skips entities with missing or malformed origin", () => {
    const out = extractWeaponPickups([
      ent("weapon_rocketlauncher"), // no origin
      ent("weapon_plasmagun", "nope"), // malformed
      ent("weapon_lasergun", "1 2 3"), // valid
    ]);
    expect(out.map((e) => e.weaponId)).toEqual(["lasergun"]);
    expect(out[0].id).toBe(0);
  });

  it("is deterministic — identical input yields identical ids (server == client)", () => {
    const entities: Ent[] = [
      ent("weapon_rocketlauncher", "100 200 16"),
      ent("weapon_rocketlauncher", "500 600 16"), // two RLs disambiguated by position
      ent("weapon_electrobolt", "700 800 16"),
    ];
    const a = extractWeaponPickups(entities);
    const b = extractWeaponPickups(entities);
    expect(a).toEqual(b);
    // The two rocket launchers get distinct ids but the same weaponId.
    expect(a[0].weaponId).toBe("rlauncher");
    expect(a[1].weaponId).toBe("rlauncher");
    expect(a[0].id).not.toBe(a[1].id);
  });

  it("every CLASSNAME_TO_WEAPON entry is a weapon_ classname", () => {
    for (const classname of Object.keys(CLASSNAME_TO_WEAPON)) {
      expect(classname.startsWith("weapon_")).toBe(true);
    }
  });
});
