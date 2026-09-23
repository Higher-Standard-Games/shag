/**
 * Version 3 records the command the server applied, so training on a demo need
 * not guess which buttons produced the motion. TF-1 in
 * docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import { describe, expect, it } from "vitest";
import { aggregateCommand, decodeInputs, encodeInputs, type RecordedInput } from "../DemoInputs";

const cmd = (over: Partial<Parameters<typeof aggregateCommand>[1]> = {}) => ({
  buttons: 0,
  yaw: 0,
  pitch: 0,
  forward: 0,
  right: 0,
  weaponSlot: 0,
  ...over,
});

describe("aggregating a frame's commands", () => {
  it("keeps every button pressed during the interval", () => {
    let acc: RecordedInput | undefined;
    acc = aggregateCommand(acc, cmd({ buttons: 0b0001 }), "p1");
    acc = aggregateCommand(acc, cmd({ buttons: 0b0100 }), "p1");
    // A jump between two snapshots survives rather than being dropped
    expect(acc.buttons).toBe(0b0101);
    expect(acc.commands).toBe(2);
  });

  it("takes the last aim and wish direction, not an average", () => {
    let acc = aggregateCommand(undefined, cmd({ yaw: 1, pitch: 0.2, forward: 1, right: 0 }), "p1");
    acc = aggregateCommand(acc, cmd({ yaw: -1, pitch: -0.2, forward: 0, right: 1 }), "p1");
    expect(acc).toMatchObject({ yaw: -1, pitch: -0.2, forward: 0, right: 1 });
  });

  it("keeps the previous weapon slot when a command omits one", () => {
    let acc = aggregateCommand(undefined, cmd({ weaponSlot: 5 }), "p1");
    acc = aggregateCommand(acc, { buttons: 0, yaw: 0, pitch: 0, forward: 0, right: 0 }, "p1");
    expect(acc.weaponSlot).toBe(5);
  });
});

describe("encoding", () => {
  it("round-trips every field", () => {
    const inputs: RecordedInput[] = [
      { playerId: "p1", buttons: 0xff, yaw: 1.5, pitch: -0.5, forward: -1, right: 1, weaponSlot: 7, commands: 3 },
      { playerId: "p2", buttons: 0, yaw: 0, pitch: 0, forward: 0, right: 0, weaponSlot: 0, commands: 1 },
    ];
    const decoded = decodeInputs(encodeInputs(inputs));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ playerId: "p1", buttons: 0xff, weaponSlot: 7, commands: 3 });
    expect(decoded[0].yaw).toBeCloseTo(1.5, 5);
    expect(decoded[1]).toMatchObject({ playerId: "p2", buttons: 0 });
  });

  it("reads an empty block as no inputs", () => {
    expect(decodeInputs(new Uint8Array(0))).toEqual([]);
    expect(decodeInputs(encodeInputs([]))).toEqual([]);
  });
});
