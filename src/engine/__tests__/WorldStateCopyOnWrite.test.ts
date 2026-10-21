import { describe, expect, it } from "vitest";
import { Simulation } from "../server/core/Simulation";
import { createPlayerEntity } from "../server/ecs/Entity";
import { entityId, playerId } from "../server/ecs/types";

function simWithPlayer(copyOnWrite?: boolean) {
  const sim = new Simulation(copyOnWrite === undefined ? {} : { copyOnWrite });
  const id = entityId(1);
  sim.getStateMut().addEntity(createPlayerEntity(id, playerId(1), { x: 0, y: 0, z: 0 }));
  sim.tick();
  return { sim, id };
}

describe("WorldState copy-on-write switch", () => {
  it("clones on first write by default, leaving the previous tick's entity alone", () => {
    const { sim, id } = simWithPlayer();
    const before = sim.getState();
    const old = before.getEntity(id);
    sim.tick();
    const mut = sim.getStateMut().getEntityMut(id);
    expect(mut).not.toBe(old);
    mut!.transform!.position.x = 5;
    expect(old!.transform!.position.x).toBe(0);
  });

  it("writes in place when switched off, and stays off across ticks and reset", () => {
    const { sim, id } = simWithPlayer(false);
    const old = sim.getState().getEntity(id);
    sim.tick();
    expect(sim.getStateMut().getEntityMut(id)).toBe(old);
    expect(sim.getState().clone().copyOnWrite).toBe(false);
    sim.reset();
    expect(sim.getState().copyOnWrite).toBe(false);
  });
});
