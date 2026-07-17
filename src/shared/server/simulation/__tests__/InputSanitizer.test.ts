import { describe, expect, it } from "vitest";
import type { NetworkCommand } from "../../../net/BinaryProtocol";
import { sanitizeCommand, sanitizeMovement, sanitizeMovementOrZero } from "../InputSanitizer";

function command(overrides: Partial<NetworkCommand> = {}): NetworkCommand {
  return {
    type: "move",
    playerId: "p1",
    seq: 7,
    direction: { x: 0.3, y: 0, z: 0.4 },
    pitch: 0.2,
    yaw: -0.5,
    buttons: 0xffff,
    tick: 123,
    weaponSlot: 2,
    ...overrides,
  };
}

describe("sanitizeCommand", () => {
  it("rejects non-finite direction and angles", () => {
    expect(sanitizeCommand(command({ direction: { x: Number.NaN, y: 0, z: 0 } }))).toBeNull();
    expect(sanitizeCommand(command({ pitch: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(sanitizeCommand(command({ yaw: Number.NEGATIVE_INFINITY }))).toBeNull();
  });

  it("clamps oversized wish directions to unit length", () => {
    const clean = sanitizeCommand(command({ direction: { x: 1000, y: 0, z: 0 } }));
    expect(clean).not.toBeNull();
    expect(Math.hypot(clean!.direction.x, clean!.direction.z)).toBeCloseTo(1, 6);
    expect(clean!.direction).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("preserves sub-unit analog wish directions", () => {
    const clean = sanitizeCommand(command({ direction: { x: 0.3, y: 99, z: 0.3 } }));
    expect(clean).not.toBeNull();
    expect(clean!.direction.x).toBeCloseTo(0.3, 6);
    expect(clean!.direction.y).toBe(0);
    expect(clean!.direction.z).toBeCloseTo(0.3, 6);
  });

  it("clamps pitch to vertical look bounds", () => {
    expect(sanitizeCommand(command({ pitch: Math.PI }))!.pitch).toBeCloseTo(Math.PI / 2, 6);
    expect(sanitizeCommand(command({ pitch: -Math.PI }))!.pitch).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("wraps yaw into the canonical range", () => {
    const clean = sanitizeCommand(command({ yaw: 3 * Math.PI }));
    expect(clean).not.toBeNull();
    expect(clean!.yaw).toBeCloseTo(Math.PI, 6);
  });

  it("preserves finite in-range command fields", () => {
    const clean = sanitizeCommand(command());
    expect(clean).toEqual({
      direction: { x: 0.3, y: 0, z: 0.4 },
      pitch: 0.2,
      yaw: -0.5,
      buttons: 0xffff,
      weaponSlot: 2,
      sequence: 7,
    });
  });

  it("bounds weapon slot defensively", () => {
    expect(sanitizeCommand(command({ weaponSlot: 255 }))!.weaponSlot).toBe(9);
    expect(sanitizeCommand(command({ weaponSlot: -1 as never }))!.weaponSlot).toBe(0);
  });
});

describe("sanitizeMovement", () => {
  it("returns only movement fields (no weaponSlot/sequence) and clamps them", () => {
    const move = sanitizeMovement({ direction: { x: 1000, y: 9, z: 0 }, pitch: Math.PI, yaw: 0, buttons: 0xffff });
    expect(move).toEqual({
      direction: { x: 1, y: 0, z: 0 },
      pitch: Math.PI / 2,
      yaw: 0,
      buttons: 0xffff,
    });
  });

  it("rejects non-finite movement", () => {
    expect(sanitizeMovement({ direction: { x: Number.NaN, y: 0, z: 0 }, pitch: 0, yaw: 0, buttons: 0 })).toBeNull();
  });
});

describe("sanitizeMovementOrZero", () => {
  it("clamps finite input like the server", () => {
    const move = sanitizeMovementOrZero({ direction: { x: 0, y: 0, z: 1000 }, pitch: -Math.PI, yaw: 0, buttons: 4 });
    expect(move.direction).toEqual({ x: 0, y: 0, z: 1 });
    expect(move.pitch).toBeCloseTo(-Math.PI / 2, 6);
    expect(move.buttons).toBe(4);
  });

  it("neutralizes non-finite input to a zero movement (never null)", () => {
    const move = sanitizeMovementOrZero({
      direction: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      pitch: 0,
      yaw: 0,
      buttons: 8,
    });
    expect(move).toEqual({ direction: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, buttons: 0 });
  });
});
