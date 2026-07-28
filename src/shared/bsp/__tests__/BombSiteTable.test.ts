/**
 * BombSiteTable — locks the Warsow Bomb extraction contract
 * (docs/research/Search_And_Destroy.md §3).
 *
 * The fixtures below reproduce the THREE authoring styles found across the six
 * shipped `wbomb*` maps, because the differences between them are exactly what
 * a naive extractor gets wrong:
 *
 *   wbomb1 — volumes + `misc_capture_area_indicatorN` names
 *   wbomb5 — volumes + `bombsite[ab]0` names, several volumes per site
 *   wbomb3 — bare indicators: NO volumes and NO targetnames at all
 *
 * Values are taken from the real map survey so the fixtures stay recognisable.
 */

import { describe, expect, it } from "vitest";
import {
  BOMB_SPAWN_CLASSNAMES,
  type BombSite,
  DEFAULT_BOMBSITE_HALF_HEIGHT,
  DEFAULT_BOMBSITE_RADIUS,
  extractBombSites,
  extractTeamSpawns,
  isBombMap,
  isInsideBombSite,
  spawnCentroid,
  validateBombRoles,
} from "../BombSiteTable";

// ── Fixture helpers ──────────────────────────────────────────────────

type Ent = { classname: string; properties: Record<string, string> };

const indicator = (origin: string, targetname?: string): Ent => ({
  classname: "misc_capture_area_indicator",
  properties: targetname ? { origin, targetname } : { origin },
});

const volume = (model: string, target: string): Ent => ({
  classname: "trigger_capture_area",
  properties: { model, target },
});

const spawn = (team: "alpha" | "beta", origin: string): Ent => ({
  classname: BOMB_SPAWN_CLASSNAMES[team],
  properties: { origin },
});

/** Q3 mins/maxs (x, y, z_up) — converted to Babylon by the extractor. */
const model = (mins: [number, number, number], maxs: [number, number, number]) => ({ mins, maxs });

/** wbomb1 style: one volume per site, `misc_capture_area_indicatorN` naming. */
const WBOMB1: Ent[] = [
  { classname: "worldspawn", properties: {} },
  indicator("-528 -448 360", "misc_capture_area_indicator1"),
  indicator("1952 -532 80", "misc_capture_area_indicator2"),
  volume("*3", "misc_capture_area_indicator1"),
  volume("*4", "misc_capture_area_indicator2"),
  spawn("alpha", "-500 -400 360"),
  spawn("beta", "3000 3000 0"),
];

/** wbomb5 style: `bombsite[ab]0` naming, four volumes on A and two on B. */
const WBOMB5: Ent[] = [
  indicator("960 -448 624", "bombsitea0"),
  indicator("-1432 672 -80", "bombsiteb0"),
  volume("*11", "bombsitea0"),
  volume("*12", "bombsitea0"),
  volume("*13", "bombsiteb0"),
  volume("*14", "bombsitea0"),
  volume("*16", "bombsiteb0"),
  volume("*17", "bombsitea0"),
  spawn("alpha", "900 -400 624"),
  spawn("beta", "-4000 2000 0"),
];

/** wbomb3 style: bare indicators — no volumes, no targetnames. */
const WBOMB3: Ent[] = [
  indicator("704 -2750 88"),
  indicator("416 -606 -72"),
  spawn("alpha", "700 -2700 88"),
  spawn("beta", "-3000 1000 0"),
];

/** Enough submodels that "*17" resolves. Index 0 is worldspawn. */
const MODELS = Array.from({ length: 20 }, (_, i) => model([i * 10, -100, 0], [i * 10 + 200, 100, 128]));

// ── Detection ────────────────────────────────────────────────────────

describe("isBombMap", () => {
  it("accepts a map with two indicators and team spawns", () => {
    expect(isBombMap(WBOMB1)).toBe(true);
    expect(isBombMap(WBOMB3)).toBe(true);
    expect(isBombMap(WBOMB5)).toBe(true);
  });

  it("rejects capture areas without team spawns (wdm4 / wdm9)", () => {
    // Three capture areas and no team spawns at all — these exist in the
    // shipped pack and must not be mistaken for bomb maps.
    const wdm4: Ent[] = [indicator("0 0 0"), indicator("100 0 0"), indicator("200 0 0")];
    expect(isBombMap(wdm4)).toBe(false);
  });

  it("rejects a map with team spawns but no capture areas (plain CTF)", () => {
    expect(isBombMap([spawn("alpha", "0 0 0"), spawn("beta", "100 0 0")])).toBe(false);
  });

  it("rejects a site count other than two", () => {
    expect(isBombMap([indicator("0 0 0"), spawn("alpha", "0 0 0")])).toBe(false);
  });
});

// ── Extraction across all three authoring styles ─────────────────────

describe("extractBombSites", () => {
  it("reads wbomb1 style: one volume per site, named indicators", () => {
    const sites = extractBombSites(WBOMB1, MODELS);
    expect(sites).toHaveLength(2);
    expect(sites[0].label).toBe("A");
    expect(sites[1].label).toBe("B");
    expect(sites[0].volumes).toHaveLength(1);
    expect(sites[1].volumes).toHaveLength(1);
  });

  it("reads wbomb5 style: many volumes per site, bombsite[ab] naming", () => {
    const sites = extractBombSites(WBOMB5, MODELS);
    expect(sites.map((s) => s.label)).toEqual(["A", "B"]);
    expect(sites[0].volumes).toHaveLength(4);
    expect(sites[1].volumes).toHaveLength(2);
  });

  it("reads wbomb3 style: bare indicators fall back to the radius cylinder", () => {
    // Half the shipped bomb maps look like this, so it is the primary path.
    const sites = extractBombSites(WBOMB3, MODELS);
    expect(sites).toHaveLength(2);
    for (const site of sites) {
      expect(site.volumes).toHaveLength(0);
      expect(site.radius).toBe(DEFAULT_BOMBSITE_RADIUS);
      expect(site.halfHeight).toBe(DEFAULT_BOMBSITE_HALF_HEIGHT);
    }
    // Labels still assigned, from BSP order.
    expect(sites.map((s) => s.label)).toEqual(["A", "B"]);
  });

  it("applies the Q3→Babylon axis swap to indicator origins", () => {
    const sites = extractBombSites([indicator("100 200 16")], []);
    expect(sites[0].position).toEqual({ x: 100, y: 16, z: 200 });
  });

  it("converts volume AABBs with min < max preserved on every axis", () => {
    const sites = extractBombSites(
      [indicator("0 0 0", "s"), volume("*1", "s")],
      [model([0, 0, 0], [0, 0, 0]), model([-10, -20, -30], [10, 20, 30])],
    );
    const v = sites[0].volumes[0];
    expect(v.min).toEqual({ x: -10, y: -30, z: -20 });
    expect(v.max).toEqual({ x: 10, y: 30, z: 20 });
    expect(v.min.x).toBeLessThan(v.max.x);
    expect(v.min.y).toBeLessThan(v.max.y);
    expect(v.min.z).toBeLessThan(v.max.z);
  });

  it("assigns ids from BSP order, not from the label", () => {
    // wbomb6 lists indicator2 BEFORE indicator1. Ids must follow the bytes so
    // server and bots agree; the label is cosmetic and may look out of order.
    const wbomb6: Ent[] = [
      indicator("1664 3840 296", "misc_capture_area_indicator2"),
      indicator("-928 3600 232", "misc_capture_area_indicator1"),
    ];
    const sites = extractBombSites(wbomb6, MODELS);
    expect(sites[0].id).toBe(0);
    expect(sites[1].id).toBe(1);
    // Labels come from the authored names, so they read B then A.
    expect(sites.map((s) => s.label)).toEqual(["B", "A"]);
  });

  it("is deterministic — identical input yields identical output", () => {
    expect(extractBombSites(WBOMB5, MODELS)).toEqual(extractBombSites(WBOMB5, MODELS));
  });

  it("drops an indicator with a malformed origin", () => {
    const sites = extractBombSites([indicator("nope"), indicator("0 0 0")], []);
    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe(0);
  });

  it("ignores volumes that reference no known indicator", () => {
    // Happens whenever indicators have no targetname: the volume cannot be
    // attributed, so the site keeps its radius fallback rather than erroring.
    const sites = extractBombSites([indicator("0 0 0"), volume("*1", "nobody")], MODELS);
    expect(sites[0].volumes).toHaveLength(0);
  });

  it("ignores a volume whose model index is out of range", () => {
    const sites = extractBombSites([indicator("0 0 0", "s"), volume("*99", "s")], MODELS);
    expect(sites[0].volumes).toHaveLength(0);
  });
});

// ── Containment ──────────────────────────────────────────────────────

describe("isInsideBombSite", () => {
  const bare: BombSite = {
    id: 0,
    label: "A",
    position: { x: 0, y: 0, z: 0 },
    volumes: [],
    radius: DEFAULT_BOMBSITE_RADIUS,
    halfHeight: DEFAULT_BOMBSITE_HALF_HEIGHT,
  };

  it("accepts a point inside the fallback radius", () => {
    expect(isInsideBombSite(bare, { x: 300, y: 0, z: 0 })).toBe(true);
    expect(isInsideBombSite(bare, { x: 270, y: 0, z: 270 })).toBe(true);
  });

  it("rejects a point beyond the fallback radius", () => {
    expect(isInsideBombSite(bare, { x: 400, y: 0, z: 0 })).toBe(false);
  });

  it("is a CYLINDER, not a sphere — height is bounded independently", () => {
    // The whole point of §3.3: a spherical test would let a player plant from
    // far above a flat site.
    expect(isInsideBombSite(bare, { x: 0, y: DEFAULT_BOMBSITE_HALF_HEIGHT - 1, z: 0 })).toBe(true);
    expect(isInsideBombSite(bare, { x: 0, y: DEFAULT_BOMBSITE_HALF_HEIGHT + 1, z: 0 })).toBe(false);
    // A sphere of radius 384 would contain this point; the cylinder must not.
    expect(isInsideBombSite(bare, { x: 100, y: 300, z: 0 })).toBe(false);
  });

  it("uses authored volumes instead of the radius when present", () => {
    const authored: BombSite = {
      ...bare,
      volumes: [{ min: { x: -50, y: -10, z: -50 }, max: { x: 50, y: 10, z: 50 } }],
    };
    expect(isInsideBombSite(authored, { x: 40, y: 0, z: 40 })).toBe(true);
    // Inside the 384 radius but outside the authored box — the box wins.
    expect(isInsideBombSite(authored, { x: 300, y: 0, z: 0 })).toBe(false);
  });

  it("accepts a point in ANY of several volumes (wbomb5 has four on one site)", () => {
    const multi: BombSite = {
      ...bare,
      volumes: [
        { min: { x: -50, y: -10, z: -50 }, max: { x: 50, y: 10, z: 50 } },
        { min: { x: 500, y: -10, z: 500 }, max: { x: 600, y: 10, z: 600 } },
      ],
    };
    expect(isInsideBombSite(multi, { x: 550, y: 0, z: 550 })).toBe(true);
    expect(isInsideBombSite(multi, { x: 300, y: 0, z: 300 })).toBe(false);
  });
});

// ── Spawns and the role sanity check ─────────────────────────────────

describe("team spawns", () => {
  it("extracts each team's spawns in BSP order with the axis swap", () => {
    const alpha = extractTeamSpawns(WBOMB1, BOMB_SPAWN_CLASSNAMES.alpha);
    expect(alpha).toHaveLength(1);
    expect(alpha[0]).toEqual({ x: -500, y: 360, z: -400 });
    expect(extractTeamSpawns(WBOMB1, BOMB_SPAWN_CLASSNAMES.beta)).toHaveLength(1);
  });

  it("returns an empty centroid for an empty set rather than NaN", () => {
    expect(spawnCentroid([])).toBeNull();
  });
});

describe("validateBombRoles", () => {
  const sites = extractBombSites(WBOMB1, MODELS);
  const near = extractTeamSpawns(WBOMB1, BOMB_SPAWN_CLASSNAMES.alpha);
  const far = extractTeamSpawns(WBOMB1, BOMB_SPAWN_CLASSNAMES.beta);

  it("passes when defenders spawn nearer the objectives", () => {
    const result = validateBombRoles(sites, far, near);
    expect(result.ok).toBe(true);
    expect(result.defenderNearest).toBeLessThan(result.attackerNearest);
  });

  it("fails loudly when the roles are swapped", () => {
    // The silent-in-review, obvious-in-play failure this exists to catch:
    // attackers would spawn on the objective and plant in about a second.
    const result = validateBombRoles(sites, near, far);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("wrong teams");
  });

  it("fails rather than throwing when spawns or sites are missing", () => {
    expect(validateBombRoles(sites, [], far).ok).toBe(false);
    expect(validateBombRoles([], near, far).ok).toBe(false);
  });
});
