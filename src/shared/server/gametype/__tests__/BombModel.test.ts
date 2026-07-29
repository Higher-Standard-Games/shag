/**
 * BombModel — carry, the speed-plant, arm, defuse, detonate.
 *
 * Ported from Warsow's `progs/gametypes/bomb/*.as`, so these cases encode the
 * real rules rather than plausible ones: the plant needs slow speed AND level
 * ground AND a site zone, arming happens within 100 units of the PLANTED bomb
 * (not the whole site), and progress is shared and decaying.
 */

import { describe, expect, it } from "vitest";
import type { BombSite } from "../../../bsp/BombSiteTable";
import { DEFAULT_BOMBSITE_HALF_HEIGHT, DEFAULT_BOMBSITE_RADIUS } from "../../../bsp/BombSiteTable";
import { BombModel, type BombPlayerView, DEFAULT_BOMB_RULES } from "../BombModel";

const ATTACK = "udon";
const DEFEND = "soba";

/** Two sites far apart, using the bare-indicator radius fallback. */
const SITES: BombSite[] = [
  {
    id: 0,
    label: "A",
    position: { x: 0, y: 0, z: 0 },
    volumes: [],
    radius: DEFAULT_BOMBSITE_RADIUS,
    halfHeight: DEFAULT_BOMBSITE_HALF_HEIGHT,
    explosions: [],
  },
  {
    id: 1,
    label: "B",
    position: { x: 10000, y: 0, z: 0 },
    volumes: [],
    radius: DEFAULT_BOMBSITE_RADIUS,
    halfHeight: DEFAULT_BOMBSITE_HALF_HEIGHT,
    explosions: [],
  },
];

/** Short durations keep the tests readable; the ratios are what matter. */
const RULES = {
  armTicks: 4,
  defuseTicks: 6,
  detonateTicks: 20,
  pickupRadius: 64,
  armDefuseRadius: 100,
  maxPlantSpeed: 400,
};

function player(over: Partial<BombPlayerView> & { entityId: number }): BombPlayerView {
  return {
    team: ATTACK,
    position: { x: 0, y: 0, z: 0 },
    speed: 0,
    alive: true,
    onPlantableGround: true,
    ...over,
  };
}

function run(bomb: BombModel, players: BombPlayerView[], ticks: number, from = 0) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...bomb.update(from + i, players, SITES, ATTACK));
  return events;
}

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

/** A carrier holding the bomb, ready to act. */
function carrying(rules = RULES): BombModel {
  const bomb = new BombModel(rules);
  bomb.reset({ x: 5000, y: 0, z: 0 });
  run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 }, speed: 300 })], 1);
  expect(bomb.phase).toBe("carried");
  return bomb;
}

// ── Carry ────────────────────────────────────────────────────────────

describe("carrying", () => {
  it("is picked up by a living attacker who touches it", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    const events = run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 }, speed: 500 })], 1);
    expect(kinds(events)).toContain("picked_up");
    expect(bomb.carrierId).toBe(1);
  });

  it("cannot be picked up by a defender", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 2, team: DEFEND, position: { x: 5000, y: 0, z: 0 } })], 5);
    expect(bomb.phase).toBe("dropped");
  });

  it("drops where the carrier died, for a teammate to retrieve", () => {
    const bomb = carrying();
    const events = run(bomb, [player({ entityId: 1, position: { x: 7000, y: 0, z: 0 }, alive: false })], 1);
    expect(kinds(events)).toContain("dropped");
    expect(bomb.position.x).toBe(7000);

    const mate = player({ entityId: 3, position: { x: 7000, y: 0, z: 0 } });
    run(bomb, [mate], 1);
    expect(bomb.carrierId).toBe(3);
  });

  it("drops if the carrier leaves the game", () => {
    const bomb = carrying();
    run(bomb, [], 1);
    expect(bomb.phase).toBe("dropped");
  });
});

// ── The plant ────────────────────────────────────────────────────────

describe("planting", () => {
  it("plants when a slow carrier stands in a site on level ground", () => {
    const bomb = carrying();
    const events = run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 }, speed: 100 })], 1);
    expect(kinds(events)).toContain("planted");
    expect(bomb.phase).toBe("planted");
    expect(bomb.siteId).toBe(0);
  });

  it("does not plant above the speed limit", () => {
    // Warsow's BOMB_MAX_PLANT_SPEED is 400, not 100 — running through a site
    // does not plant, but walking does.
    const bomb = carrying();
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 }, speed: 401 })], 1);
    expect(bomb.phase).toBe("carried");
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 }, speed: 399 })], 1);
    expect(bomb.phase).toBe("planted");
  });

  it("does not plant on unplantable ground", () => {
    // Ramps are excluded by the surface-normal check, which removes real plant
    // spots (wbomb1's B ramp) by design.
    const bomb = carrying();
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 }, onPlantableGround: false })], 5);
    expect(bomb.phase).toBe("carried");
  });

  it("does not plant outside a site, however slow the carrier is", () => {
    const bomb = carrying();
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 }, speed: 0 })], 10);
    expect(bomb.phase).toBe("carried");
  });
});

// ── Arming ───────────────────────────────────────────────────────────

describe("arming", () => {
  function planted(rules = RULES): BombModel {
    const bomb = carrying(rules);
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 } })], 1);
    expect(bomb.phase).toBe("planted");
    return bomb;
  }

  it("arms while an attacker stands near the planted bomb", () => {
    const bomb = planted();
    const events = run(bomb, [player({ entityId: 1 })], RULES.armTicks, 1);
    expect(kinds(events)).toContain("armed");
    expect(bomb.isArmed).toBe(true);
  });

  it("needs the arm radius, not merely the site", () => {
    // 200 units is well inside the site zone and well outside the arm radius —
    // conflating the two would let a bomb arm from across the room.
    const bomb = planted();
    run(bomb, [player({ entityId: 1, position: { x: 200, y: 0, z: 0 } })], RULES.armTicks * 3, 1);
    expect(bomb.phase).toBe("planted");
    expect(bomb.progress).toBe(0);
  });

  it("decays rather than resetting when the attacker steps away", () => {
    const bomb = planted({ ...RULES, armTicks: 10 });
    run(bomb, [player({ entityId: 1 })], 8, 1);
    const high = bomb.progress;
    run(bomb, [player({ entityId: 1, position: { x: 900, y: 0, z: 0 } })], 2, 20);
    expect(bomb.progress).toBeLessThan(high);
    expect(bomb.progress).toBeGreaterThan(0);
    expect(bomb.progressAdvancing).toBe(false);
  });

  it("can be armed by any attacker, and progress is shared", () => {
    // One attacker starts, dies, another finishes — the work is the team's.
    const bomb = planted({ ...RULES, armTicks: 6 });
    run(bomb, [player({ entityId: 1 })], 3, 1);
    const events = run(bomb, [player({ entityId: 9 })], 3, 10);
    expect(kinds(events)).toContain("armed");
  });

  it("does not arm faster with more attackers", () => {
    const solo = planted({ ...RULES, armTicks: 6 });
    run(solo, [player({ entityId: 1 })], 5, 1);
    expect(solo.phase).toBe("planted");

    const crowd = planted({ ...RULES, armTicks: 6 });
    run(crowd, [player({ entityId: 1 }), player({ entityId: 2 }), player({ entityId: 3 })], 5, 1);
    expect(crowd.phase).toBe("planted");
  });

  it("cannot be armed by a defender", () => {
    const bomb = planted();
    run(bomb, [player({ entityId: 2, team: DEFEND })], RULES.armTicks * 3, 1);
    expect(bomb.phase).toBe("planted");
  });

  it("cannot be picked back up once planted", () => {
    const bomb = planted();
    run(bomb, [player({ entityId: 5 })], 1, 1);
    expect(bomb.carrierId).toBeNull();
    expect(bomb.phase).toBe("planted");
  });
});

// ── Defusing and detonation ──────────────────────────────────────────

describe("defusing", () => {
  function armed(rules = RULES): { bomb: BombModel; armedAt: number } {
    const bomb = carrying(rules);
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 } })], 1);
    const events = run(bomb, [player({ entityId: 1 })], rules.armTicks, 1);
    expect(kinds(events)).toContain("armed");
    return { bomb, armedAt: rules.armTicks };
  }

  it("defuses while a defender stands near the bomb", () => {
    const { bomb, armedAt } = armed();
    const events = run(bomb, [player({ entityId: 2, team: DEFEND })], RULES.defuseTicks, armedAt + 1);
    expect(kinds(events)).toContain("defused");
  });

  it("cannot be defused by an attacker", () => {
    const { bomb, armedAt } = armed();
    run(bomb, [player({ entityId: 1 })], RULES.defuseTicks * 2, armedAt + 1);
    expect(bomb.isArmed).toBe(true);
  });

  it("decays a partial defuse instead of losing it", () => {
    // The reason this matters: trading a kill and stepping back in is a real
    // play rather than a wasted round.
    const { bomb, armedAt } = armed({ ...RULES, defuseTicks: 10, detonateTicks: 200 });
    run(bomb, [player({ entityId: 2, team: DEFEND })], 8, armedAt + 1);
    const high = bomb.progress;
    run(bomb, [], 3, armedAt + 20);
    expect(bomb.progress).toBeLessThan(high);
    expect(bomb.progress).toBeGreaterThan(0);
  });

  it("detonates when the timer runs out", () => {
    const { bomb, armedAt } = armed();
    const events = run(bomb, [], RULES.detonateTicks, armedAt + 1);
    expect(kinds(events)).toContain("detonated");
  });

  it("lets a defuse landing on the final tick win", () => {
    const { bomb, armedAt } = armed();
    const detonatesAt = armedAt + RULES.detonateTicks;
    const defuser = player({ entityId: 2, team: DEFEND });
    run(bomb, [defuser], RULES.defuseTicks - 1, detonatesAt - RULES.defuseTicks + 1);
    expect(bomb.isArmed).toBe(true);

    const events = bomb.update(detonatesAt, [defuser], SITES, ATTACK);
    expect(kinds(events)).toContain("defused");
    expect(kinds(events)).not.toContain("detonated");
  });

  it("stops responding once resolved", () => {
    const { bomb, armedAt } = armed();
    run(bomb, [], RULES.detonateTicks, armedAt + 1);
    expect(bomb.phase).toBe("detonated");
    expect(run(bomb, [player({ entityId: 2, team: DEFEND })], 20, 9999)).toHaveLength(0);
  });
});

// ── Beep and reset ───────────────────────────────────────────────────

describe("beep pacing", () => {
  it("shortens the interval as the timer runs down", () => {
    const bomb = new BombModel();
    expect(bomb.beepIntervalTicks(0)).toBeNull(); // not armed

    const live = carrying(DEFAULT_BOMB_RULES);
    run(live, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 } })], 1);
    run(live, [player({ entityId: 1 })], DEFAULT_BOMB_RULES.armTicks, 1);
    expect(live.isArmed).toBe(true);

    const armedAt = DEFAULT_BOMB_RULES.armTicks;
    const early = live.beepIntervalTicks(armedAt) ?? 0;
    const late = live.beepIntervalTicks(armedAt + DEFAULT_BOMB_RULES.detonateTicks - 125) ?? 0;
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThanOrEqual(25);
  });
});

describe("reset", () => {
  it("returns the bomb to a fresh loose state for the next round", () => {
    const bomb = carrying();
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 0, z: 0 } })], 1);
    expect(bomb.phase).toBe("planted");

    bomb.reset({ x: 5000, y: 0, z: 0 });
    expect(bomb.phase).toBe("dropped");
    expect(bomb.position.x).toBe(5000);
    expect(bomb.carrierId).toBeNull();
    expect(bomb.siteId).toBeNull();
    expect(bomb.progress).toBe(0);
  });
});
