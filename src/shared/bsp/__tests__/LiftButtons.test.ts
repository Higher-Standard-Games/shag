import { describe, expect, it } from "vitest";
import { extractLifts, LiftSystem } from "../LiftSystem";

// Q3 space: a split door like wdm16's techdoor3 (two halves, one going up and
// one down) and a button made of two corner panels either side of it.
const models = [
  { mins: [-4096, -4096, -4096], maxs: [4096, 4096, 4096] },
  { mins: [-64, -656, -256], maxs: [128, -624, -176] }, // *1 lower half, angle -2
  { mins: [-64, -656, -192], maxs: [128, -624, -64] }, // *2 upper half, angle -1
  { mins: [-106, -710, -222], maxs: [170, -570, -194] }, // *3 the button's bounds
  { mins: [-106, -576, -256], maxs: [-78, -568, -222] }, // *4 a touch volume
];
const panels = [
  { mins: [-106, -576, -222], maxs: [-78, -570, -194] },
  { mins: [142, -710, -222], maxs: [170, -704, -194] },
];
const door = (model: string, angle: string) => ({
  classname: "func_door",
  properties: { model, angle, targetname: "techdoor3", speed: "1500", health: "-1" },
});
const button = (extra: Record<string, string> = {}) => ({
  classname: "func_button",
  properties: { model: "*3", target: "techdoor3", angle: "-2", speed: "1000", health: "1", ...extra },
});
const make = (entities: { classname: string; properties: Record<string, string> }[]) =>
  new LiftSystem(
    extractLifts(entities, models, (i) => (i === 3 ? panels : [])),
    () => ({ fraction: 1, solid: false, normalY: 0, modelIndex: -1 }),
  );
// Engine space is Q3 (x, z, y).
const at = (x: number, y: number, z: number) => ({ x, y: z, z: y });
const body = (x: number, y: number, z: number) => ({ position: at(x, y, z), velocity: { x: 0, y: 0, z: 0 } });

describe("func_button callers", () => {
  it("a shootable button ignores touch", () => {
    const lifts = make([door("*1", "-2"), door("*2", "-1"), button()]);
    // Standing in the doorway is inside the button's bounds.
    for (let i = 0; i < 30; i++) lifts.step(1 / 60, [body(32, -640, -232)]);
    expect(lifts.snapshot().map((s) => s.phase)).toEqual(["bottom", "bottom"]);
  });

  it("a shot on a panel opens both halves; a shot between the panels does not", () => {
    const lifts = make([door("*1", "-2"), door("*2", "-1"), button()]);
    expect(lifts.strike(at(32, -640, -208))).toBe(0);
    expect(lifts.strike(at(-92, -569, -208))).toBe(2);
    expect(lifts.snapshot().map((s) => s.phase)).toEqual(["up", "up"]);
    // It rests for its default 3 s, so a second shot does nothing.
    expect(lifts.strike(at(-92, -569, -208))).toBe(0);
  });

  it("a blast reaches the button's bounds", () => {
    const lifts = make([door("*1", "-2"), door("*2", "-1"), button()]);
    expect(lifts.strike(at(32, -760, -208), 40)).toBe(0);
    expect(lifts.strike(at(32, -740, -208), 40)).toBe(2);
  });

  it("presses in at its speed, holds while resting, and comes back", () => {
    const lifts = make([door("*1", "-2"), door("*2", "-1"), button()]);
    expect(lifts.buttons.map((b) => b.modelIndex)).toEqual([3]);
    expect(lifts.buttonOffset(3).y).toBe(0);
    lifts.strike(at(155, -705, -208));
    lifts.step(0.01, []);
    // 1000 u/s for 10 ms is 10 of its 24 units (28 tall less a 4 lip), downward.
    expect(lifts.buttonOffset(3).y).toBeCloseTo(-10);
    for (let i = 0; i < 60; i++) lifts.step(1 / 60, []);
    expect(lifts.buttonOffset(3).y).toBeCloseTo(-24);
    for (let i = 0; i < 130; i++) lifts.step(1 / 60, []);
    expect(lifts.buttonOffset(3).y).toBe(0);
  });

  it("touch volumes and a button without health still open by contact", () => {
    const touch = { classname: "trigger_multiple", properties: { model: "*4", target: "techdoor3" } };
    const lifts = make([door("*1", "-2"), door("*2", "-1"), touch]);
    lifts.step(1 / 60, [body(-92, -572, -240)]);
    expect(lifts.snapshot().map((s) => s.phase)).toEqual(["up", "up"]);
    const plain = make([door("*1", "-2"), door("*2", "-1"), button({ health: "0" })]);
    plain.step(1 / 60, [body(32, -640, -232)]);
    expect(plain.snapshot().map((s) => s.phase)).toEqual(["up", "up"]);
  });

  it("restores a button's press from the serialized caller cooldown", () => {
    const server = make([door("*1", "-2"), door("*2", "-1"), button()]);
    server.strike(at(-92, -569, -208));
    for (let i = 0; i < 30; i++) server.step(1 / 60, []);
    const client = make([door("*1", "-2"), door("*2", "-1"), button()]);
    client.restore(server.snapshot());
    expect(client.buttonOffset(3).y).toBeCloseTo(server.buttonOffset(3).y);
    expect(client.buttonOffset(3).y).toBeCloseTo(-24);
  });
});
