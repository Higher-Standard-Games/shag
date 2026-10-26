/**
 * DemoAnalyzer.test.ts — Unit tests for Phase 1 highlight detection
 *
 * Tests cover: single frag, airborne frag, rocket-jump frag, multi-kill
 * grouping (within / outside window), first_blood award, overlap deduplication,
 * and score correctness.
 */

import { describe, expect, it } from "vitest";
import { Entity } from "../../net/Entity";
import { GameState } from "../../net/GameState";
import { DemoAnalyzer } from "../DemoAnalyzer";
import type { DemoFrame, DemoHeader } from "../DemoReader";

// ── Component stubs ──────────────────────────────────────────────────────────

interface TransformStub {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  serialize(): void;
  deserialize(): void;
  clone(): TransformStub;
}

interface VelocityStub {
  x: number;
  y: number;
  z: number;
  linear: { x: number; y: number; z: number };
  grounded: boolean;
  serialize(): void;
  deserialize(): void;
  clone(): VelocityStub;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface EntityOpts {
  grounded?: boolean;
  velY?: number;
  velX?: number;
  velZ?: number;
  posX?: number;
  posY?: number;
  posZ?: number;
  health?: number;
}

function makeEntity(id: string, opts: EntityOpts = {}): Entity {
  const entity = new Entity(id);

  const posX = opts.posX ?? 0;
  const posY = opts.posY ?? 0;
  const posZ = opts.posZ ?? 0;
  const velX = opts.velX ?? 0;
  const velY = opts.velY ?? 0;
  const velZ = opts.velZ ?? 0;
  const grounded = opts.grounded ?? true;

  const transform: TransformStub = {
    position: { x: posX, y: posY, z: posZ },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this };
    },
  };

  const velocity: VelocityStub = {
    x: velX,
    y: velY,
    z: velZ,
    linear: { x: velX, y: velY, z: velZ },
    grounded,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this };
    },
  };

  entity.addComponent("transform", transform);
  entity.addComponent("velocity", velocity);

  return entity;
}

/**
 * Build a minimal DemoHeader.
 */
function makeHeader(
  players: Array<{ playerId: string; name: string; team?: string }> = [],
  snapshotRate = 20,
  tickRate = 60,
): DemoHeader {
  return {
    version: 1,
    map: "test_map",
    gametype: "ffa",
    tickRate,
    snapshotRate,
    startTime: 0,
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, team: p.team ?? "" })),
  };
}

/**
 * Build a DemoFrame with the given tick, events, and entities.
 */
function makeFrame(tick: number, events: Array<Record<string, unknown>> = [], entities: Entity[] = []): DemoFrame {
  const state = new GameState();
  state.tick = tick;
  state.events = events as GameState["events"];
  for (const e of entities) {
    state.entities.set(e.id, e);
  }
  return { tick, state, inputs: [] };
}

/**
 * Create a death event payload.
 */
function deathEvent(
  killerId: string,
  victimId: string,
  opts: {
    weaponId?: string;
    x?: number;
    y?: number;
    z?: number;
    velX?: number;
    velY?: number;
    velZ?: number;
  } = {},
): Record<string, unknown> {
  return {
    type: "death",
    entityId: victimId,
    killerId,
    weaponId: opts.weaponId ?? "rocket_launcher",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    z: opts.z ?? 0,
    velX: opts.velX ?? 0,
    velY: opts.velY ?? 0,
    velZ: opts.velZ ?? 0,
  };
}

function awardEvent(playerId: string, awardType: string, playerName = "killer"): Record<string, unknown> {
  return {
    type: "award",
    awardType,
    playerId,
    playerName,
    targetName: "victim",
    value: 1,
  };
}

/** A player moving along +x at `speed`, with the movement fields a snapshot carries. */
function mover(
  id: string,
  tick: number,
  speed: number,
  opts: { grounded?: boolean; sliding?: boolean; charging?: boolean; y?: number } = {},
): Entity {
  const entity = makeEntity(id, {
    grounded: opts.grounded ?? false,
    velX: speed,
    posX: (speed * tick) / 60,
    posY: opts.y ?? 0,
  });
  const movementState = {
    isSliding: opts.sliding ?? false,
    wallJumpState: opts.charging ? "charging" : "none",
    serialize() {},
    deserialize() {},
    clone() {
      return { ...movementState };
    },
  };
  entity.addComponent("movementState", movementState as never);
  return entity;
}

/** Frames every 3 ticks (20 Hz at 60 Hz) from `from` to `to`, each built by `at`. */
function framesBetween(from: number, to: number, at: (tick: number) => Entity[]): DemoFrame[] {
  const frames: DemoFrame[] = [];
  for (let tick = from; tick <= to; tick += 3) frames.push(makeFrame(tick, [], at(tick)));
  return frames;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DemoAnalyzer", () => {
  const analyzer = new DemoAnalyzer();

  describe("empty input", () => {
    it("returns empty highlights for zero frames", () => {
      const result = analyzer.analyze([], makeHeader(), 0);
      expect(result.highlights).toHaveLength(0);
      expect(result.totalTicks).toBe(0);
    });
  });

  describe("single frag", () => {
    it("produces exactly 1 highlight with base score 10", () => {
      // Killer at origin, victim at x=500 — neutral distance (>150, <1500)
      const killer = makeEntity("player_k1", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const frames = [makeFrame(100, [deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 })], [killer])];
      const header = makeHeader([
        { playerId: "k1", name: "Killer" },
        { playerId: "v1", name: "Victim" },
      ]);

      const result = analyzer.analyze(frames, header, 5000);

      expect(result.highlights).toHaveLength(1);
      const h = result.highlights[0];
      expect(h.primaryPlayer).toBe("player_k1");
      expect(h.primaryPlayerName).toBe("Killer");
      expect(h.victimPlayer).toBe("player_v1");
      expect(h.score).toBe(10);
      expect(h.tags).not.toContain("airborne");
      expect(h.tags).not.toContain("rocket_jump");
    });

    it("stores killerPos from transform component", () => {
      const killer = makeEntity("player_k1", { grounded: true, posX: 50, posY: 10, posZ: 30 });
      const frames = [makeFrame(100, [deathEvent("player_k1", "player_v1", { x: 50, y: 10, z: 30 })], [killer])];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 1000);
      const h = result.highlights[0];
      expect(h.killerPos).toEqual({ x: 50, y: 10, z: 30 });
      expect(h.victimPos).toEqual({ x: 50, y: 10, z: 30 });
    });
  });

  describe("airborne frag", () => {
    it("tags as 'airborne' when killer is not grounded, even rising off a plain or wall jump", () => {
      // Killer at origin, victim at x=500 (neutral distance); 420 is a wall jump's lift
      const killer = makeEntity("player_k1", { grounded: false, velY: 420, posX: 0, posY: 0, posZ: 0 });
      const frames = [makeFrame(200, [deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 })], [killer])];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 5000);

      expect(result.highlights).toHaveLength(1);
      const h = result.highlights[0];
      expect(h.tags).toContain("airborne");
      expect(h.tags).not.toContain("rocket_jump");
      // score = 10 * 1.5 (airborne)
      expect(h.score).toBe(15);
    });

    it("does not count a frag a hop off the ground: the feet must clear 32 units", () => {
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const victim = { x: 500, y: 0, z: 0 };
      const standing = makeEntity("player_k1", { grounded: true, posY: 0 });
      const hop = makeEntity("player_k1", { grounded: false, posY: 8 });
      const high = makeEntity("player_k1", { grounded: false, posY: 40 });

      // Without a map: against where the killer last stood
      const low = analyzer.analyze(
        [makeFrame(100, [], [standing]), makeFrame(110, [deathEvent("player_k1", "player_v1", victim)], [hop])],
        header,
        5000,
      );
      expect(low.highlights[0].tags).not.toContain("airborne");
      const clear = analyzer.analyze(
        [makeFrame(100, [], [standing]), makeFrame(110, [deathEvent("player_k1", "player_v1", victim)], [high])],
        header,
        5000,
      );
      expect(clear.highlights[0].tags).toContain("airborne");

      // With the map: the measured height wins, even over a ledge dropped from
      const measured = (height: number) =>
        new DemoAnalyzer(() => height).analyze(
          [makeFrame(100, [], [standing]), makeFrame(110, [deathEvent("player_k1", "player_v1", victim)], [hop])],
          header,
          5000,
        ).highlights[0].tags;
      expect(measured(31)).not.toContain("airborne");
      expect(measured(32)).toContain("airborne");
    });
  });

  describe("rocket jump frag", () => {
    it("tags as 'rocket_jump' when rising faster than any jump can, score ×1.8 not ×1.5", () => {
      // Killer at origin, victim at x=500 (neutral distance)
      const killer = makeEntity("player_k1", { grounded: false, velY: 500, posX: 0, posY: 0, posZ: 0 });
      const frames = [makeFrame(300, [deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 })], [killer])];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 5000);

      expect(result.highlights).toHaveLength(1);
      const h = result.highlights[0];
      expect(h.tags).toContain("rocket_jump");
      expect(h.tags).not.toContain("airborne");
      // score = 10 * 1.8 (rocket_jump) = 18
      expect(h.score).toBe(18);
    });
  });

  describe("multi-kill grouping", () => {
    it("merges two kills within 200 ticks into a multi_kill with killCount=2", () => {
      // Killer at origin, victims at x=500 (neutral distance — no distance tags)
      const killer = makeEntity("player_k1", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const frames = [
        makeFrame(100, [deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 })], [killer]),
        makeFrame(250, [deathEvent("player_k1", "player_v2", { x: 500, y: 0, z: 0 })], [killer]),
      ];
      const header = makeHeader([
        { playerId: "k1", name: "Killer" },
        { playerId: "v1", name: "Victim1" },
        { playerId: "v2", name: "Victim2" },
      ]);

      const result = analyzer.analyze(frames, header, 10000);

      expect(result.highlights).toHaveLength(1);
      const h = result.highlights[0];
      expect(h.type).toBe("multi_kill");
      expect(h.killCount).toBe(2);
      expect(h.tags).toContain("multi_kill");
      // score = 10 * 1.0 * (1 + 0.5*(2-1)) = 10 * 1.5 = 15
      expect(h.score).toBe(15);
    });

    it("does NOT merge two kills that are 201 ticks apart", () => {
      const killer = makeEntity("player_k1", { grounded: true });
      const frames = [
        makeFrame(100, [deathEvent("player_k1", "player_v1")], [killer]),
        makeFrame(302, [deathEvent("player_k1", "player_v2")], [killer]),
      ];
      const header = makeHeader(
        [
          { playerId: "k1", name: "Killer" },
          { playerId: "v1", name: "V1" },
          { playerId: "v2", name: "V2" },
        ],
        20,
        20,
      );

      const result = analyzer.analyze(frames, header, 20000);

      // Should produce 2 separate highlights (unless they overlap after context expansion)
      const killerHighlights = result.highlights.filter((h) => h.primaryPlayer === "player_k1");
      // Both frags belong to same player but are far apart — should produce 2
      // Use a 20Hz server tick rate here so context-window deduplication does
      // not hide the two distinct multi-kill groups being asserted.
      // At 20Hz, 3s = 60 ticks leadin, 2s = 40 followthrough
      // Frag1 at 100: window [40,140]
      // Frag2 at 302: window [242,342]
      // No overlap → both kept
      expect(killerHighlights).toHaveLength(2);
      expect(killerHighlights.every((h) => h.type !== "multi_kill")).toBe(true);
    });

    it("merges exactly at the boundary (200 ticks apart)", () => {
      const killer = makeEntity("player_k1", { grounded: true });
      const frames = [
        makeFrame(100, [deathEvent("player_k1", "player_v1")], [killer]),
        makeFrame(300, [deathEvent("player_k1", "player_v2")], [killer]),
      ];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 10000);
      const h = result.highlights.find((x) => x.type === "multi_kill");
      expect(h).toBeDefined();
      expect(h?.killCount).toBe(2);
    });
  });

  describe("first_blood award", () => {
    it("attaches 'first_blood' tag and multiplies score by 1.5", () => {
      // Killer at origin, victim at x=500 (neutral distance)
      const killer = makeEntity("player_k1", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const frames = [
        makeFrame(
          50,
          [deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 }), awardEvent("k1", "first_blood", "Killer")],
          [killer],
        ),
      ];
      const header = makeHeader([
        { playerId: "k1", name: "Killer" },
        { playerId: "v1", name: "Victim" },
      ]);

      const result = analyzer.analyze(frames, header, 5000);

      expect(result.highlights).toHaveLength(1);
      const h = result.highlights[0];
      expect(h.tags).toContain("first_blood");
      // score = 10 * 1.5 = 15
      expect(h.score).toBe(15);
    });
  });

  describe("overlap deduplication", () => {
    it("removes the lower-scored candidate when windows overlap", () => {
      // Two frags by different players at close ticks — both get context windows
      // that will overlap if they're close enough.
      // tickRate=60: leadin=180, followthrough=120. Both windows clamp to
      // the available [100, 120] recording range and overlap.
      // They overlap → keep B (score 18), drop A (score 10)
      // Killers at origin, victims at x=500 (neutral — no distance tag)
      const killerA = makeEntity("player_a", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const killerB = makeEntity("player_b", { grounded: false, velY: 500, posX: 0, posY: 0, posZ: 0 });

      const frames = [
        makeFrame(100, [deathEvent("player_a", "player_v1", { x: 500, y: 0, z: 0 })], [killerA]),
        makeFrame(120, [deathEvent("player_b", "player_v2", { x: 500, y: 0, z: 0 })], [killerB]),
      ];

      const header = makeHeader([
        { playerId: "a", name: "A" },
        { playerId: "b", name: "B" },
        { playerId: "v1", name: "V1" },
        { playerId: "v2", name: "V2" },
      ]);

      const result = analyzer.analyze(frames, header, 10000);

      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].primaryPlayer).toBe("player_b");
      expect(result.highlights[0].score).toBe(18);
    });

    it("keeps both highlights when windows do not overlap", () => {
      // With tickRate=60: leadin=180, followthrough=120.
      // Frag A at tick 100: window [100, 220]
      // Frag B at tick 401: window [221, 401]
      // No overlap → both kept
      const killerA = makeEntity("player_a", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const killerB = makeEntity("player_b", { grounded: true, posX: 0, posY: 0, posZ: 0 });

      const frames = [
        makeFrame(100, [deathEvent("player_a", "player_v1", { x: 500, y: 0, z: 0 })], [killerA]),
        makeFrame(401, [deathEvent("player_b", "player_v2", { x: 500, y: 0, z: 0 })], [killerB]),
      ];

      const header = makeHeader([
        { playerId: "a", name: "A" },
        { playerId: "b", name: "B" },
        { playerId: "v1", name: "V1" },
        { playerId: "v2", name: "V2" },
      ]);

      const result = analyzer.analyze(frames, header, 30000);

      expect(result.highlights).toHaveLength(2);
    });
  });

  describe("long_range and close_range tags", () => {
    it("tags long_range when distance > 1500", () => {
      const killer = makeEntity("player_k1", {
        grounded: true,
        posX: 0,
        posY: 0,
        posZ: 0,
      });
      const frames = [
        // victim is 2000 units away on X axis
        makeFrame(100, [deathEvent("player_k1", "player_v1", { x: 2000, y: 0, z: 0 })], [killer]),
      ];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 5000);
      expect(result.highlights[0].tags).toContain("long_range");
    });

    it("tags close_range when distance < 150", () => {
      const killer = makeEntity("player_k1", {
        grounded: true,
        posX: 0,
        posY: 0,
        posZ: 0,
      });
      const frames = [
        // victim is 100 units away
        makeFrame(100, [deathEvent("player_k1", "player_v1", { x: 100, y: 0, z: 0 })], [killer]),
      ];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 5000);
      expect(result.highlights[0].tags).toContain("close_range");
    });
  });

  describe("player name map", () => {
    it("maps entityId to display name from header", () => {
      const frames = [makeFrame(1, [], [])];
      const header = makeHeader([
        { playerId: "abc", name: "Alice" },
        { playerId: "xyz", name: "Bob" },
      ]);
      const result = analyzer.analyze(frames, header, 1000);
      expect(result.playerNames.get("player_abc")).toBe("Alice");
      expect(result.playerNames.get("player_xyz")).toBe("Bob");
    });
  });

  describe("highlights sorted by score descending", () => {
    it("returns highlights in descending score order", () => {
      // Frag A (grounded, score 10) at tick 100
      // Frag B (rocket_jump, score 18) at tick 500
      // Expect B first — victims at x=500 (neutral distance)
      const killerA = makeEntity("player_a", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const killerB = makeEntity("player_b", { grounded: false, velY: 500, posX: 0, posY: 0, posZ: 0 });

      const frames = [
        makeFrame(100, [deathEvent("player_a", "player_v1", { x: 500, y: 0, z: 0 })], [killerA]),
        makeFrame(500, [deathEvent("player_b", "player_v2", { x: 500, y: 0, z: 0 })], [killerB]),
      ];

      const header = makeHeader([
        { playerId: "a", name: "A" },
        { playerId: "b", name: "B" },
        { playerId: "v1", name: "V1" },
        { playerId: "v2", name: "V2" },
      ]);

      const result = analyzer.analyze(frames, header, 30000);

      expect(result.highlights[0].primaryPlayer).toBe("player_b");
      expect(result.highlights[0].score).toBeGreaterThan(result.highlights[1].score);
    });
  });

  describe("self-kill / suicide", () => {
    it("does not create a highlight for self-kills (killerId === victimId)", () => {
      const player = makeEntity("player_p1", { grounded: true });
      const frames = [makeFrame(100, [deathEvent("player_p1", "player_p1")], [player])];
      const header = makeHeader([{ playerId: "p1", name: "P" }]);
      const result = analyzer.analyze(frames, header, 5000);
      expect(result.highlights).toHaveLength(0);
    });
  });

  describe("context window clamping", () => {
    it("clamps startTick to firstTick when frag is near start", () => {
      const killer = makeEntity("player_k1", { grounded: true });
      const frames = [makeFrame(5, [deathEvent("player_k1", "player_v1")], [killer]), makeFrame(1000, [], [])];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 50000);
      expect(result.highlights[0].startTick).toBeGreaterThanOrEqual(5);
    });

    it("clamps endTick to lastTick when frag is near end", () => {
      const killer = makeEntity("player_k1", { grounded: true });
      const frames = [makeFrame(100, [], []), makeFrame(995, [deathEvent("player_k1", "player_v1")], [killer])];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 50000);
      expect(result.highlights[0].endTick).toBeLessThanOrEqual(995);
    });

    it("sizes context windows from server tick rate rather than requested snapshot rate", () => {
      const killer = makeEntity("player_k1", { grounded: true });
      const frames = [makeFrame(0), makeFrame(500, [deathEvent("player_k1", "player_v1")], [killer]), makeFrame(1000)];
      const header = makeHeader([{ playerId: "k1", name: "K" }], 60, 125);
      const result = analyzer.analyze(frames, header, 8000);

      expect(result.highlights[0].startTick).toBe(125);
      expect(result.highlights[0].endTick).toBe(750);
    });
  });

  describe("on_fire / raging / unstoppable awards", () => {
    it("attaches on_fire tag and applies ×1.2 multiplier", () => {
      // Killer at origin, victim at x=500 (neutral distance)
      const killer = makeEntity("player_k1", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const frames = [
        makeFrame(
          100,
          [deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 }), awardEvent("k1", "on_fire")],
          [killer],
        ),
      ];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 5000);
      const h = result.highlights[0];
      expect(h.tags).toContain("on_fire");
      // score = 10 * 1.2 = 12
      expect(h.score).toBeCloseTo(12, 2);
    });

    it("stacks raging (×1.4) on top of on_fire (×1.2)", () => {
      // Killer at origin, victim at x=500 (neutral distance)
      const killer = makeEntity("player_k1", { grounded: true, posX: 0, posY: 0, posZ: 0 });
      const frames = [
        makeFrame(
          100,
          [
            deathEvent("player_k1", "player_v1", { x: 500, y: 0, z: 0 }),
            awardEvent("k1", "on_fire"),
            awardEvent("k1", "raging"),
          ],
          [killer],
        ),
      ];
      const header = makeHeader([{ playerId: "k1", name: "K" }]);
      const result = analyzer.analyze(frames, header, 5000);
      const h = result.highlights[0];
      expect(h.tags).toContain("on_fire");
      expect(h.tags).toContain("raging");
      // score = 10 * 1.2 * 1.4 = 16.8
      expect(h.score).toBeCloseTo(16.8, 2);
    });
  });

  describe("totalTicks and totalDurationMs", () => {
    it("reports correct totalTicks (lastTick - firstTick + 1)", () => {
      const frames = [makeFrame(10, [], []), makeFrame(110, [], [])];
      const result = analyzer.analyze(frames, makeHeader(), 5000);
      expect(result.totalTicks).toBe(101);
      expect(result.totalDurationMs).toBe(5000);
    });
  });
});

describe("DemoAnalyzer — did the victim see it coming", () => {
  /** The victim at the origin looking along `yaw`; the killer 200 units down +z. */
  function fragFacing(yaw: number, victimInDeathFrame: boolean): boolean | undefined {
    const victim = makeEntity("player_2");
    (victim.getComponent("transform") as unknown as TransformStub).rotation = { x: 0, y: yaw, z: 0, w: 1 };
    const killer = () => makeEntity("player_1", { posZ: 200 });
    const frames = [
      makeFrame(10, [], [killer(), victim]),
      makeFrame(13, [deathEvent("player_1", "player_2")], victimInDeathFrame ? [killer(), victim] : [killer()]),
    ];
    return new DemoAnalyzer().analyze(frames, makeHeader(), 1000).highlights[0]?.victimFacedKiller;
  }

  it("is yes when the victim looked at the killer, no when they looked away", () => {
    expect(fragFacing(0, true)).toBe(true);
    expect(fragFacing(Math.PI, true)).toBe(false);
  });

  it("reads the victim's last view when they are already gone from the death frame", () => {
    expect(fragFacing(0.3, false)).toBe(true);
  });

  describe("movement highlights", () => {
    const analyzer = new DemoAnalyzer();
    const header = makeHeader([{ playerId: "m", name: "Mover" }]);

    it("finds a chain of hops faster than sprinting, with its route", () => {
      // Two seconds at 550 u/s, touching down for one frame every half second
      const frames = framesBetween(0, 120, (tick) => [
        mover("player_m", tick, 550, { grounded: tick % 30 === 0 && tick > 0 }),
      ]);
      frames.push(...framesBetween(123, 240, (tick) => [mover("player_m", tick, 100, { grounded: true })]));
      const { highlights } = analyzer.analyze(frames, header, 4000);
      expect(highlights).toHaveLength(1);
      const h = highlights[0];
      expect(h.type).toBe("movement");
      expect(h.primaryPlayerName).toBe("Mover");
      expect(h.tags).toContain("bunny_hop");
      expect(h.startTick).toBe(0);
      expect(h.endTick).toBeGreaterThan(120);
      expect(h.path!.length).toBeGreaterThan(10);
      expect(h.score).toBeCloseTo(5 * 1.2, 5);
    });

    it("tags a wall-jump climb and peaks at its top", () => {
      const frames = framesBetween(0, 120, (tick) => [
        mover("player_m", tick, tick >= 30 && tick < 42 ? 0 : 500, {
          charging: tick >= 30 && tick < 42,
          y: tick < 42 ? 0 : Math.min(150, (tick - 42) * 4),
        }),
      ]);
      const { highlights } = analyzer.analyze(frames, header, 4000);
      expect(highlights).toHaveLength(1);
      expect(highlights[0].tags).toEqual(expect.arrayContaining(["wall_jump", "height_gain"]));
      expect(highlights[0].peakTick).toBeGreaterThan(42);
    });

    it("ignores plain fast running, a lone jump and anything too short", () => {
      const running = framesBetween(0, 240, (tick) => [mover("player_m", tick, 600, { grounded: true })]);
      const oneJump = framesBetween(0, 120, (tick) => [mover("player_m", tick, 500, { grounded: tick === 0 })]);
      const short = framesBetween(0, 30, (tick) => [mover("player_m", tick, 800, { charging: tick === 9 })]);
      for (const frames of [running, oneJump, short]) {
        expect(analyzer.analyze(frames, header, 4000).highlights).toHaveLength(0);
      }
    });

    it("counts each player's frags over the whole demo", () => {
      const frames = [
        makeFrame(100, [deathEvent("player_a", "player_b")]),
        makeFrame(5000, [deathEvent("player_a", "player_c")]),
        makeFrame(9000, [deathEvent("player_b", "player_a"), deathEvent("player_c", "player_c")]),
      ];
      const { frags } = analyzer.analyze(frames, header, 4000);
      expect([...frags]).toEqual([
        ["player_a", 2],
        ["player_b", 1],
      ]);
    });

    it("keeps a movement highlight that overlaps a frag", () => {
      const frames = framesBetween(0, 120, (tick) => [
        mover("player_m", tick, 550, { grounded: tick % 30 === 0 && tick > 0 }),
      ]);
      frames[10].state.events = [deathEvent("player_k1", "player_v1", { x: 500 })] as never;
      const { highlights } = analyzer.analyze(frames, header, 4000);
      expect(highlights.map((h) => h.type).sort()).toEqual(["frag", "movement"]);
    });
  });
});
