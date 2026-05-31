/**
 * PickupTable.test.ts — locks the shared pickup extractor that gives the server
 * and client identical pickup ids across ALL tracked types (weapon/armor/health).
 * This shared id space is the key to server-authoritative pickup state; see
 * docs/research/SERVER_AUTHORITATIVE_PICKUPS.md.
 */

import { describe, expect, it } from "vitest";
import { CLASSNAME_TO_WEAPON, extractPickups, extractWeaponPickups, PICKUP_CLASSNAMES } from "../PickupTable";

type Ent = { classname: string; properties: Record<string, string> };

const ent = (classname: string, origin?: string): Ent => ({
  classname,
  properties: origin ? { origin } : {},
});

describe("extractPickups", () => {
  it("keeps weapon/armor/health classnames in BSP order with one shared id space", () => {
    const out = extractPickups([
      ent("worldspawn"),
      ent("info_player_deathmatch", "0 0 0"),
      ent("weapon_rocketlauncher", "100 200 16"),
      ent("item_armor_ga", "50 50 0"),
      ent("misc_model", "1 1 1"), // untracked → ignored
      ent("item_health_mega", "300 400 16"),
    ]);
    expect(out.map((e) => [e.id, e.type, e.kind])).toEqual([
      [0, "weapon", "rlauncher"],
      [1, "armor", "ga"],
      [2, "health", "mega"],
    ]);
  });

  it("applies the Q3→Babylon coordinate swap (origin 'x y z' → {x, y:z, z:y})", () => {
    const [rl] = extractPickups([ent("weapon_rocketlauncher", "100 200 16")]);
    expect(rl.position).toEqual({ x: 100, y: 16, z: 200 });
  });

  it("maps Warsow armor + health classnames to the right kinds", () => {
    const out = extractPickups([
      ent("item_armor_shard", "0 0 0"),
      ent("item_armor_ya", "0 0 0"),
      ent("item_armor_ra", "0 0 0"),
      ent("item_health_small", "0 0 0"),
      ent("item_health_large", "0 0 0"),
      ent("item_health_ultra", "0 0 0"),
    ]);
    expect(out.map((e) => `${e.type}:${e.kind}`)).toEqual([
      "armor:shard",
      "armor:ya",
      "armor:ra",
      "health:small",
      "health:large",
      "health:ultra",
    ]);
  });

  it("skips entities with missing or malformed origin", () => {
    const out = extractPickups([
      ent("weapon_rocketlauncher"), // no origin
      ent("item_health_mega", "nope"), // malformed
      ent("weapon_lasergun", "1 2 3"), // valid
    ]);
    expect(out.map((e) => e.kind)).toEqual(["lasergun"]);
    expect(out[0].id).toBe(0);
  });

  it("is deterministic — identical input yields identical ids (server == client)", () => {
    const entities: Ent[] = [
      ent("weapon_rocketlauncher", "100 200 16"),
      ent("item_armor_ra", "500 600 16"),
      ent("weapon_rocketlauncher", "700 800 16"),
    ];
    const a = extractPickups(entities);
    const b = extractPickups(entities);
    expect(a).toEqual(b);
    expect(a[0].id).not.toBe(a[2].id); // two RLs, distinct ids
  });
});

describe("extractWeaponPickups (back-compat)", () => {
  it("returns only weapons but keeps ids from the full pickup id space", () => {
    const weapons = extractWeaponPickups([
      ent("item_armor_ga", "0 0 0"), // id 0 (armor)
      ent("weapon_rocketlauncher", "1 1 1"), // id 1 (weapon)
    ]);
    expect(weapons).toHaveLength(1);
    expect(weapons[0].id).toBe(1); // not 0 — ids span all types
    expect(weapons[0].kind).toBe("rlauncher");
  });
});

describe("PICKUP_CLASSNAMES", () => {
  it("includes every weapon classname", () => {
    for (const classname of Object.keys(CLASSNAME_TO_WEAPON)) {
      expect(PICKUP_CLASSNAMES[classname]?.type).toBe("weapon");
    }
  });
});
