import { describe, expect, it } from "vitest";
import type { PickupEntry } from "../../shared/bsp/PickupTable";
import { BotGameState } from "../BotGameState";
import { collectItemGoals, MAX_ITEM_CANDIDATES } from "../goals/ItemGoalSource";

function entry(id: number, classname: string, type: PickupEntry["type"], kind: string, x: number): PickupEntry {
  return { id, classname, type, kind, position: { x, y: 0, z: 0 } };
}

function stateAtOrigin(activeMask: boolean[] = []): BotGameState {
  const state = new BotGameState();
  state.self.position = { x: 0, y: 0, z: 0 };
  state.pickupActiveMask = activeMask;
  state.pickups = [];
  return state;
}

describe("collectItemGoals", () => {
  // Twenty shells within reach, a Red Armor across the map.
  const shells = Array.from({ length: 20 }, (_, i) => entry(i, "ammo_riotgun", "ammo", "shells", 100 + i * 10));
  const redArmor = entry(20, "item_armor_ra", "armor", "ra", 2500);

  it("keeps the nearest few ordinary items", () => {
    const goals = collectItemGoals(stateAtOrigin(), { pickupPositions: shells, maxDistance: 1500 });
    expect(goals).toHaveLength(MAX_ITEM_CANDIDATES);
    expect(goals.every((g) => g.pickupId !== undefined && g.pickupId < MAX_ITEM_CANDIDATES)).toBe(true);
  });

  it("always offers a major item that is up, however far and however many are nearer", () => {
    const goals = collectItemGoals(stateAtOrigin(), { pickupPositions: [...shells, redArmor], maxDistance: 1500 });
    expect(goals.some((g) => g.pickupId === 20)).toBe(true);
    expect(goals).toHaveLength(MAX_ITEM_CANDIDATES + 1);
  });

  it("does not offer a major item that has been taken", () => {
    const mask = Array.from({ length: 21 }, (_, i) => i !== 20);
    const goals = collectItemGoals(stateAtOrigin(mask), { pickupPositions: [...shells, redArmor], maxDistance: 1500 });
    expect(goals.some((g) => g.pickupId === 20)).toBe(false);
  });
});
