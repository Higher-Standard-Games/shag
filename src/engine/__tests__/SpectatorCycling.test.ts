/**
 * SpectatorCycling tests — Player list management and cycling logic
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SpectatorCycling } from "../camera/controllers/SpectatorCycling";
import { GameState } from "../network/core/GameState";

// ─── Helpers ─────────────────────────────────────────────────────

/** Create a minimal GameState with player entities */
function makeGameState(
  players: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    dead?: boolean;
    name?: string;
  }>,
): GameState {
  const state = new GameState();

  for (const p of players) {
    const components = new Map<string, unknown>();
    components.set("transform", {
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: 0, y: 0, z: 0 },
    });
    if (p.dead !== undefined) {
      components.set("health", { dead: p.dead, current: p.dead ? 0 : 100 });
    }

    const entity = {
      getComponent: (name: string) => components.get(name) ?? undefined,
    };
    state.entities.set(p.id, entity as never);
  }

  // Add player names to state.players map
  const playerMap = new Map<string, unknown>();
  for (const p of players) {
    if (p.name) {
      playerMap.set(p.id, { entityId: p.id, name: p.name });
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.players = playerMap as any;

  return state;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("SpectatorCycling", () => {
  let cycling: SpectatorCycling;

  beforeEach(() => {
    cycling = new SpectatorCycling();
  });

  // ── Entity list building ──────────────────────────────────────

  describe("updateFromGameState", () => {
    it("builds sorted list of alive player entities", () => {
      const state = makeGameState([
        { id: "player_3", x: 0, y: 0, z: 0 },
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      expect(cycling.getAlivePlayerIds()).toEqual(["player_1", "player_2", "player_3"]);
    });

    it("filters dead players", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0, dead: false },
        { id: "player_2", x: 0, y: 0, z: 0, dead: true },
        { id: "player_3", x: 0, y: 0, z: 0, dead: false },
      ]);
      cycling.updateFromGameState(state);
      expect(cycling.getAlivePlayerIds()).toEqual(["player_1", "player_3"]);
    });

    it("filters non-player entities", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "projectile_1", x: 0, y: 0, z: 0 },
        { id: "pickup_1", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      expect(cycling.getAlivePlayerIds()).toEqual(["player_1"]);
    });

    it("filters entities without position", () => {
      const state = new GameState();
      const entity = {
        getComponent: () => undefined,
      };
      state.entities.set("player_1", entity as never);
      cycling.updateFromGameState(state);
      expect(cycling.getAlivePlayerIds()).toEqual([]);
    });

    it("excludes specified entity (local player)", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state, "player_1");
      expect(cycling.getAlivePlayerIds()).toEqual(["player_2"]);
    });

    it("returns alive count", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      expect(cycling.getAliveCount()).toBe(2);
    });
  });

  // ── Cycling ───────────────────────────────────────────────────

  describe("next", () => {
    it("selects first player when no target set", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      expect(cycling.next()).toBe("player_1");
    });

    it("cycles to next player", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
        { id: "player_3", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");
      expect(cycling.next()).toBe("player_2");
    });

    it("wraps around at end of list", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_2");
      expect(cycling.next()).toBe("player_1");
    });

    it("returns null with empty list", () => {
      expect(cycling.next()).toBeNull();
    });

    it("stays on same player with single player", () => {
      const state = makeGameState([{ id: "player_1", x: 0, y: 0, z: 0 }]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");
      expect(cycling.next()).toBe("player_1");
    });
  });

  describe("prev", () => {
    it("selects last player when no target set", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      expect(cycling.prev()).toBe("player_2");
    });

    it("cycles to previous player", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
        { id: "player_3", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_2");
      expect(cycling.prev()).toBe("player_1");
    });

    it("wraps around at beginning of list", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");
      expect(cycling.prev()).toBe("player_2");
    });

    it("returns null with empty list", () => {
      expect(cycling.prev()).toBeNull();
    });
  });

  // ── Auto-cycle ────────────────────────────────────────────────

  describe("auto-cycle", () => {
    it("auto-selects next player when target disappears", () => {
      const state1 = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state1);
      cycling.setTarget("player_1");

      // player_1 disappears
      const state2 = makeGameState([{ id: "player_2", x: 0, y: 0, z: 0 }]);
      cycling.updateFromGameState(state2);
      expect(cycling.getTargetEntityId()).toBe("player_2");
    });

    it("clears target when all players disappear", () => {
      const state1 = makeGameState([{ id: "player_1", x: 0, y: 0, z: 0 }]);
      cycling.updateFromGameState(state1);
      cycling.setTarget("player_1");

      const state2 = makeGameState([]);
      cycling.updateFromGameState(state2);
      expect(cycling.getTargetEntityId()).toBeNull();
    });

    it("keeps target when it is still alive", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");

      // Update with same state
      cycling.updateFromGameState(state);
      expect(cycling.getTargetEntityId()).toBe("player_1");
    });
  });

  // ── Death, as the live server reports it ──────────────────────

  describe("death from combat_state", () => {
    /** Snapshot entities carry no health; the server reports death as an event. */
    function withDead(state: GameState, ...entityIds: string[]): GameState {
      for (const entityId of entityIds) {
        state.events.push({ type: "combat_state", entityId, health: 0, armor: 0, dead: true } as never);
      }
      return state;
    }

    const four = () =>
      makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
        { id: "player_3", x: 0, y: 0, z: 0 },
        { id: "player_4", x: 0, y: 0, z: 0 },
      ]);

    it("leaves dead players out of the cycle", () => {
      cycling.updateFromGameState(withDead(four(), "player_2"));
      expect(cycling.getAlivePlayerIds()).toEqual(["player_1", "player_3", "player_4"]);
      expect(cycling.isAlive("player_2")).toBe(false);
      expect(cycling.isAlive("player_3")).toBe(true);
    });

    it("keeps a target that died but is still in the snapshot", () => {
      cycling.updateFromGameState(four());
      cycling.setTarget("player_2");
      cycling.updateFromGameState(withDead(four(), "player_2"));
      expect(cycling.getTargetEntityId()).toBe("player_2");
    });

    it("keeps a dead target the snapshot no longer draws while they are still in the match", () => {
      cycling.updateFromGameState(four());
      cycling.setTarget("player_2");

      // The server sends no entity for a dead player, only their player entry.
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_3", x: 0, y: 0, z: 0 },
      ]);
      (state.players as unknown as Map<string, unknown>).set("2", { entityId: "player_2", name: "Two" });
      cycling.updateFromGameState(withDead(state, "player_2"));

      expect(cycling.getTargetEntityId()).toBe("player_2");
      expect(cycling.isAlive("player_2")).toBe(false);
    });

    it("steps from a dead target's place in the order", () => {
      cycling.updateFromGameState(four());
      cycling.setTarget("player_2");
      cycling.updateFromGameState(withDead(four(), "player_2"));
      expect(cycling.next()).toBe("player_3");

      cycling.setTarget("player_2");
      expect(cycling.prev()).toBe("player_1");
    });

    it("falls back to a dead player when the target leaves and nobody is alive", () => {
      cycling.updateFromGameState(four());
      cycling.setTarget("player_4");
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0 },
        { id: "player_2", x: 0, y: 0, z: 0 },
      ]);
      cycling.updateFromGameState(withDead(state, "player_1", "player_2"));
      expect(cycling.getTargetEntityId()).toBe("player_1");
    });
  });

  // ── Name lookup ───────────────────────────────────────────────

  describe("name lookup", () => {
    it("resolves entity ID to player name from GameState", () => {
      const state = makeGameState([{ id: "player_1", x: 0, y: 0, z: 0, name: "Alice" }]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");
      expect(cycling.getTargetName()).toBe("Alice");
    });

    it("falls back to formatted entity ID", () => {
      const state = makeGameState([{ id: "player_42", x: 0, y: 0, z: 0 }]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_42");
      expect(cycling.getTargetName()).toBe("Player 42");
    });

    it("returns empty string with no target", () => {
      expect(cycling.getTargetName()).toBe("");
    });

    it("getPlayerName resolves any entity", () => {
      const state = makeGameState([{ id: "player_5", x: 0, y: 0, z: 0, name: "Bob" }]);
      cycling.updateFromGameState(state);
      expect(cycling.getPlayerName("player_5")).toBe("Bob");
    });
  });

  // ── State and reset ───────────────────────────────────────────

  describe("state", () => {
    it("getState returns complete cycling state", () => {
      const state = makeGameState([
        { id: "player_1", x: 0, y: 0, z: 0, name: "Alice" },
        { id: "player_2", x: 0, y: 0, z: 0, name: "Bob" },
      ]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");

      const cycleState = cycling.getState();
      expect(cycleState.targetEntityId).toBe("player_1");
      expect(cycleState.alivePlayerIds).toEqual(["player_1", "player_2"]);
      expect(cycleState.targetName).toBe("Alice");
    });

    it("reset clears all state", () => {
      const state = makeGameState([{ id: "player_1", x: 0, y: 0, z: 0 }]);
      cycling.updateFromGameState(state);
      cycling.setTarget("player_1");
      cycling.reset();

      expect(cycling.getTargetEntityId()).toBeNull();
      expect(cycling.getAlivePlayerIds()).toEqual([]);
      expect(cycling.getAliveCount()).toBe(0);
    });
  });
});
