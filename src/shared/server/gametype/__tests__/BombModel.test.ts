/**
 * BombModel — carry, the speed-drop plant, arm, defuse, detonate.
 *
 * The rules interact in ways that are cheap to get wrong and expensive to
 * notice in play: a carrier who dies mid-plant, a bomb dropped outside a site,
 * a defuse landing on the same tick the timer expires. This is the table of
 * cases (docs/research/Search_And_Destroy.md §5.3).
 */

import { describe, expect, it } from "vitest";
import type { BombSite } from "../../../bsp/BombSiteTable";
import { DEFAULT_BOMBSITE_HALF_HEIGHT, DEFAULT_BOMBSITE_RADIUS } from "../../../bsp/BombSiteTable";
import { BombModel, type BombPlayerView } from "../BombModel";

const ATTACK = "udon";
const DEFEND = "soba";

/** Two sites, far apart, using the bare-indicator radius fallback. */
const SITES: BombSite[] = [
  {
    id: 0,
    label: "A",
    position: { x: 0, y: 0, z: 0 },
    volumes: [],
    radius: DEFAULT_BOMBSITE_RADIUS,
    halfHeight: DEFAULT_BOMBSITE_HALF_HEIGHT,
  },
  {
    id: 1,
    label: "B",
    position: { x: 10000, y: 0, z: 0 },
    volumes: [],
    radius: DEFAULT_BOMBSITE_RADIUS,
    halfHeight: DEFAULT_BOMBSITE_HALF_HEIGHT,
  },
];

/** Short durations keep the tests readable; the ratios are what matter. */
const RULES = { armTicks: 4, defuseTicks: 5, detonateTicks: 20, pickupRadius: 64, dropSpeedThreshold: 100 };

function player(over: Partial<BombPlayerView> & { entityId: number }): BombPlayerView {
  return {
    team: ATTACK,
    position: { x: 0, y: 0, z: 0 },
    horizontalSpeed: 300,
    alive: true,
    ...over,
  };
}

/** Run `ticks` updates with a fixed player set, collecting every event. */
function run(bomb: BombModel, players: BombPlayerView[], ticks: number, from = 0) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...bomb.update(from + i, players, SITES, ATTACK));
  return events;
}

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

// ── Carry ────────────────────────────────────────────────────────────

describe("carrying", () => {
  it("is picked up by a living attacker who touches it", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    const events = run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);
    expect(kinds(events)).toContain("picked_up");
    expect(bomb.phase).toBe("carried");
    expect(bomb.carrierId).toBe(1);
  });

  it("cannot be picked up by a defender", () => {
    // Defenders can neither carry nor deny a loose bomb.
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 2, team: DEFEND, position: { x: 5000, y: 0, z: 0 } })], 5);
    expect(bomb.phase).toBe("dropped");
  });

  it("is not picked up from out of reach", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5200, y: 0, z: 0 } })], 3);
    expect(bomb.phase).toBe("dropped");
  });

  it("follows the carrier", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);
    run(bomb, [player({ entityId: 1, position: { x: 6000, y: 0, z: 0 } })], 1);
    expect(bomb.position.x).toBe(6000);
  });

  it("drops where the carrier died", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);
    const events = run(bomb, [player({ entityId: 1, position: { x: 7000, y: 0, z: 0 }, alive: false })], 1);
    expect(kinds(events)).toContain("dropped");
    expect(bomb.position.x).toBe(7000);
    expect(bomb.carrierId).toBeNull();
  });

  it("drops if the carrier leaves the game entirely", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);
    run(bomb, [], 1); // carrier disconnected
    expect(bomb.phase).toBe("dropped");
  });
});

// ── The speed-drop plant ─────────────────────────────────────────────

describe("drop-to-plant", () => {
  it("drops when a carrier slows down INSIDE a site", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);

    const inSiteFast = player({ entityId: 1, position: { x: 0, y: 0, z: 0 }, horizontalSpeed: 500 });
    run(bomb, [inSiteFast], 1);
    expect(bomb.phase).toBe("carried");

    const inSiteSlow = { ...inSiteFast, horizontalSpeed: 50 };
    const events = run(bomb, [inSiteSlow], 1);
    expect(kinds(events)).toContain("dropped");
  });

  it("does NOT drop when slowing outside a site", () => {
    // The rule that keeps carrying safe: landings, corners and knockback all
    // dip under the threshold, and none of them should cost you the bomb.
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 }, horizontalSpeed: 0 })], 10);
    expect(bomb.phase).toBe("carried");
  });

  it("uses horizontal speed only, so falling is not a plant", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 } })], 1);
    // Inside the site horizontally but moving fast — vertical motion is not
    // part of the input at all.
    run(bomb, [player({ entityId: 1, position: { x: 0, y: 100, z: 0 }, horizontalSpeed: 400 })], 1);
    expect(bomb.phase).toBe("carried");
  });
});

// ── Arming ───────────────────────────────────────────────────────────

describe("arming", () => {
  const armed = () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 0, y: 0, z: 0 }); // already lying in site A
    return bomb;
  };

  it("arms after holding inside the site", () => {
    const bomb = armed();
    const events = run(bomb, [player({ entityId: 1, horizontalSpeed: 0 })], RULES.armTicks);
    expect(kinds(events)).toContain("arm_started");
    expect(kinds(events)).toContain("armed");
    expect(bomb.phase).toBe("armed");
    expect(bomb.siteId).toBe(0);
  });

  it("cancels when the planter leaves the radius", () => {
    const bomb = armed();
    run(bomb, [player({ entityId: 1 })], 2);
    const events = run(bomb, [player({ entityId: 1, position: { x: 900, y: 0, z: 0 } })], 1);
    expect(kinds(events)).toContain("arm_cancelled");
    expect(bomb.phase).toBe("dropped");
  });

  it("discards progress — leaving and returning starts over", () => {
    const bomb = armed();
    run(bomb, [player({ entityId: 1 })], RULES.armTicks - 1);
    run(bomb, [player({ entityId: 1, position: { x: 900, y: 0, z: 0 } })], 1);
    run(bomb, [player({ entityId: 1 })], 1);
    expect(bomb.phase).toBe("dropped");
    expect(bomb.progressFor(1)).toBeLessThan(1);
  });

  it("cancels if the planter dies", () => {
    const bomb = armed();
    run(bomb, [player({ entityId: 1 })], 2);
    run(bomb, [player({ entityId: 1, alive: false })], 1);
    expect(bomb.phase).toBe("dropped");
  });

  it("can be armed by any attacker, not only whoever carried it", () => {
    const bomb = armed();
    run(bomb, [player({ entityId: 7 })], RULES.armTicks);
    expect(bomb.phase).toBe("armed");
  });

  it("cannot be armed by a defender", () => {
    const bomb = armed();
    run(bomb, [player({ entityId: 2, team: DEFEND })], RULES.armTicks * 2);
    expect(bomb.phase).toBe("dropped");
  });

  it("cannot be armed outside a site", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 5000, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1, position: { x: 5000, y: 0, z: 0 }, horizontalSpeed: 0 })], RULES.armTicks * 2);
    // Picked up instead — a loose bomb outside a site is just carryable.
    expect(bomb.phase).toBe("carried");
  });

  it("is not snatched away by a teammate walking over it mid-plant", () => {
    const bomb = armed();
    const planter = player({ entityId: 1 });
    const passerby = player({ entityId: 2, position: { x: 10, y: 0, z: 0 } });
    run(bomb, [planter, passerby], 2);
    expect(bomb.phase).toBe("dropped");
    expect(bomb.carrierId).toBeNull();
  });
});

// ── Defusing and detonation ──────────────────────────────────────────

describe("defusing", () => {
  /**
   * Arm the bomb and report the tick it armed on.
   *
   * Holding for `armTicks` starting at tick 0 completes on tick `armTicks - 1`,
   * because the starting tick counts as holding (see ChannelledAction). Tests
   * need that exact tick, since detonation is measured from it.
   */
  function armedBomb(): { bomb: BombModel; armedAt: number; detonatesAt: number } {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 0, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1 })], RULES.armTicks);
    expect(bomb.phase).toBe("armed");
    const armedAt = RULES.armTicks - 1;
    return { bomb, armedAt, detonatesAt: armedAt + RULES.detonateTicks };
  }

  it("defuses after a defender holds the same radius", () => {
    const { bomb, armedAt } = armedBomb();
    const events = run(bomb, [player({ entityId: 2, team: DEFEND })], RULES.defuseTicks, armedAt + 1);
    expect(kinds(events)).toContain("defuse_started");
    expect(kinds(events)).toContain("defused");
    expect(bomb.phase).toBe("defused");
  });

  it("cannot be defused by an attacker", () => {
    const { bomb, armedAt } = armedBomb();
    run(bomb, [player({ entityId: 1 })], RULES.defuseTicks * 2, armedAt + 1);
    expect(bomb.phase).toBe("armed");
  });

  it("cancels when the defuser steps out", () => {
    const { bomb, armedAt } = armedBomb();
    run(bomb, [player({ entityId: 2, team: DEFEND })], 2, armedAt + 1);
    const events = run(bomb, [player({ entityId: 2, team: DEFEND, position: { x: 900, y: 0, z: 0 } })], 1, armedAt + 3);
    expect(kinds(events)).toContain("defuse_cancelled");
    expect(bomb.phase).toBe("armed");
  });

  it("detonates when the timer runs out", () => {
    const { bomb, armedAt, detonatesAt } = armedBomb();
    const events = run(bomb, [], detonatesAt - armedAt, armedAt + 1);
    expect(kinds(events)).toContain("detonated");
    expect(bomb.phase).toBe("detonated");
  });

  it("counts down while armed", () => {
    const { bomb, armedAt } = armedBomb();
    expect(bomb.ticksUntilDetonation(armedAt)).toBe(RULES.detonateTicks);
    run(bomb, [], 5, armedAt + 1);
    expect(bomb.ticksUntilDetonation(armedAt + 5)).toBe(RULES.detonateTicks - 5);
  });

  it("lets a defuse landing on the final tick win", () => {
    // The most memorable thing that happens in this mode should not lose to an
    // ordering accident, so channels resolve before the detonation deadline.
    const { bomb, detonatesAt } = armedBomb();
    const defuser = player({ entityId: 2, team: DEFEND });
    const startAt = detonatesAt - RULES.defuseTicks + 1;
    run(bomb, [defuser], RULES.defuseTicks - 1, startAt);
    expect(bomb.phase).toBe("armed");

    const events = bomb.update(detonatesAt, [defuser], SITES, ATTACK);
    expect(kinds(events)).toContain("defused");
    expect(kinds(events)).not.toContain("detonated");
    expect(bomb.phase).toBe("defused");
  });

  it("stops responding once resolved", () => {
    const { bomb, armedAt, detonatesAt } = armedBomb();
    run(bomb, [], detonatesAt - armedAt, armedAt + 1);
    expect(bomb.phase).toBe("detonated");
    const events = run(bomb, [player({ entityId: 2, team: DEFEND })], 20, detonatesAt + 1);
    expect(events).toHaveLength(0);
  });
});

// ── Round lifecycle ──────────────────────────────────────────────────

describe("reset", () => {
  it("returns the bomb to a fresh dropped state for the next round", () => {
    const bomb = new BombModel(RULES);
    bomb.reset({ x: 0, y: 0, z: 0 });
    run(bomb, [player({ entityId: 1 })], RULES.armTicks);
    expect(bomb.phase).toBe("armed");

    bomb.reset({ x: 5000, y: 0, z: 0 });
    expect(bomb.phase).toBe("dropped");
    expect(bomb.position.x).toBe(5000);
    expect(bomb.carrierId).toBeNull();
    expect(bomb.siteId).toBeNull();
    expect(bomb.isArmed).toBe(false);
    expect(bomb.progressFor(1)).toBe(0);
  });
});
