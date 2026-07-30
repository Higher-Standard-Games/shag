/**
 * Spawn kits: the table, and what it refuses.
 *
 * The refusals are the interesting half. A loadout parser that quietly falls
 * back to a default when it does not recognise a name hands someone a rocket
 * launcher when they asked for a lasergun and says nothing.
 */

import { describe, expect, it } from "vitest";
import { normalizeTeamId } from "../GametypeTypes";
import {
  buildLoadout,
  DEFAULT_LOADOUT,
  describeLoadout,
  LOADOUT_SPAWN_ARMOR,
  PRIMARY_CHOICES,
  parseLoadout,
  SECONDARY_CHOICES,
  WEAPON_LABELS,
} from "../Loadout";

describe("the table", () => {
  it("keeps primary and secondary disjoint, so a slot means something", () => {
    const overlap = PRIMARY_CHOICES.filter((p) => (SECONDARY_CHOICES as readonly string[]).includes(p));
    expect(overlap).toEqual([]);
  });

  it("labels every weapon it offers", () => {
    for (const id of [...PRIMARY_CHOICES, ...SECONDARY_CHOICES]) {
      expect(WEAPON_LABELS[id]).toBeTruthy();
    }
  });

  it("has a default that is actually offered", () => {
    expect(PRIMARY_CHOICES).toContain(DEFAULT_LOADOUT.primary);
    expect(SECONDARY_CHOICES).toContain(DEFAULT_LOADOUT.secondary);
  });
});

describe("parsing", () => {
  it("accepts canonical ids", () => {
    expect(parseLoadout("electrobolt", "plasmagun")).toEqual({ primary: "electrobolt", secondary: "plasmagun" });
  });

  it("accepts the short names players type, and the Warsow ones", () => {
    // `lg` means the Lasergun in Warsow; here that weapon is the Voltaic.
    expect(parseLoadout("lg", "rg")).toEqual({ primary: "voltaic", secondary: "riotgun" });
    expect(parseLoadout("lasergun", "mg")).toEqual({ primary: "voltaic", secondary: "machinegun" });
    expect(parseLoadout("  RL  ", "GL")).toEqual({ primary: "rlauncher", secondary: "glauncher" });
  });

  it("refuses rather than defaulting", () => {
    expect(parseLoadout("instagun", "mg")).toBeNull();
    expect(parseLoadout("rl", undefined)).toBeNull();
    expect(parseLoadout("", "")).toBeNull();
    expect(parseLoadout("nonsense", "garbage")).toBeNull();
  });

  it("refuses a weapon in the wrong slot", () => {
    // Two power weapons is exactly what this design does not offer.
    expect(parseLoadout("mg", "rl")).toBeNull();
    expect(parseLoadout("rl", "eb")).toBeNull();
  });

  it("never lets the blade be chosen — you always have it", () => {
    expect(parseLoadout("blade", "mg")).toBeNull();
    expect(parseLoadout("rl", "blade")).toBeNull();
  });
});

describe("building the kit", () => {
  it("always includes the blade, and the two chosen weapons", () => {
    const kit = buildLoadout({ primary: "rlauncher", secondary: "riotgun" });
    expect(kit.weapons).toEqual(["blade", "rlauncher", "riotgun"]);
    expect(kit.armor).toBe(LOADOUT_SPAWN_ARMOR);
    expect(kit.health).toBe(100);
  });

  it("gives ammo for everything it gives a weapon for", () => {
    for (const primary of PRIMARY_CHOICES) {
      for (const secondary of SECONDARY_CHOICES) {
        const kit = buildLoadout({ primary, secondary });
        for (const weapon of kit.weapons) {
          expect(kit.ammo[weapon], `${primary}/${secondary} → ${weapon}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("reads back as something a player would recognise", () => {
    expect(describeLoadout({ primary: "voltaic", secondary: "glauncher" })).toBe("Voltaic + Grenade Launcher");
  });
});

// ── Team ids across the lobby boundary ───────────────────────────────

describe("normalizeTeamId", () => {
  it("translates the lobby's vocabulary into the match's", () => {
    // The lobby names its sides alpha/bravo (CTF's entity vocabulary) and the
    // match names them udon/soba. Nothing translated, so a side chosen in the
    // lobby was discarded on join and the server auto-balanced instead.
    expect(normalizeTeamId("alpha")).toBe("udon");
    expect(normalizeTeamId("bravo")).toBe("soba");
    expect(normalizeTeamId("beta")).toBe("soba");
  });

  it("passes through ids the match already uses", () => {
    expect(normalizeTeamId("udon")).toBe("udon");
    expect(normalizeTeamId("soba")).toBe("soba");
    expect(normalizeTeamId("spectator")).toBe("spectator");
  });

  it("is case and whitespace insensitive", () => {
    expect(normalizeTeamId("  ALPHA ")).toBe("udon");
  });

  it("returns null for anything else, so the caller can fall back to balancing", () => {
    // Never guess: dropping a player onto an invalid team is worse than
    // balancing them onto a real one.
    expect(normalizeTeamId("green")).toBeNull();
    expect(normalizeTeamId("")).toBeNull();
    expect(normalizeTeamId(undefined)).toBeNull();
  });
});
