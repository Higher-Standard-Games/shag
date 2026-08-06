/**
 * Water level on the wire (water Phase 1).
 *
 * `waterLevel` rides in the two remaining free bits of `MovementStateComponent`'s
 * flags byte — bits 0-1 are sliding and crouching, 2-3 wall jump, 4-5 ledge.
 * Those are the LAST two: whatever needs replicating next has to widen the
 * field, and it should not discover that by silently corrupting ledge state.
 */

import { describe, expect, it } from "vitest";
import { MovementStateComponent } from "../network/components/MovementStateComponent";
import { BinaryDecoder, BinaryEncoder } from "../network/protocol/BinaryProtocol";

function roundTrip(state: MovementStateComponent): MovementStateComponent {
  const encoder = new BinaryEncoder();
  state.serialize(encoder);

  const decoded = new MovementStateComponent();
  decoded.deserialize(new BinaryDecoder(encoder.getData()));
  return decoded;
}

describe("MovementStateComponent — water level", () => {
  it("round-trips every level", () => {
    for (const level of [0, 1, 2, 3] as const) {
      const state = new MovementStateComponent({ waterLevel: level });

      expect(roundTrip(state).waterLevel).toBe(level);
    }
  });

  it("defaults to dry", () => {
    expect(new MovementStateComponent().waterLevel).toBe(0);
    expect(roundTrip(new MovementStateComponent()).waterLevel).toBe(0);
  });

  it("does not disturb the flags that share its byte", () => {
    const state = new MovementStateComponent({
      isSliding: true,
      isCrouching: true,
      wallJumpState: "charging",
      ledgeGrabState: "pulling",
      waterLevel: 3,
    });

    const decoded = roundTrip(state);

    expect(decoded.isSliding).toBe(true);
    expect(decoded.isCrouching).toBe(true);
    expect(decoded.wallJumpState).toBe("charging");
    expect(decoded.ledgeGrabState).toBe("pulling");
    expect(decoded.waterLevel).toBe(3);
  });

  it("is not disturbed BY the flags that share its byte", () => {
    // The reverse direction: a fully-set neighbour must not bleed into the top
    // two bits.
    const state = new MovementStateComponent({
      isSliding: true,
      isCrouching: true,
      wallJumpState: "charging",
      ledgeGrabState: "pulling",
      waterLevel: 0,
    });

    expect(roundTrip(state).waterLevel).toBe(0);
  });

  it("still fits in one byte", () => {
    const encoder = new BinaryEncoder();
    new MovementStateComponent({
      isSliding: true,
      isCrouching: true,
      wallJumpState: "charging",
      ledgeGrabState: "pulling",
      waterLevel: 3,
    }).serialize(encoder);

    // 1 flags byte + 2 float32s. If the flags ever needed a second byte this
    // would be 10, and every reader of this component would need a version.
    expect(encoder.getData().byteLength).toBe(9);
  });

  it("carries the level through clone", () => {
    const state = new MovementStateComponent({ waterLevel: 2 });

    expect(state.clone().waterLevel).toBe(2);
  });

  it("takes the level from a movement result", () => {
    const state = new MovementStateComponent();

    state.updateFrom({ waterLevel: 3 });

    expect(state.waterLevel).toBe(3);
  });

  it("leaves the level alone when a result omits it", () => {
    // Movement results are partial by convention; an absent field means "no
    // news", not "dry".
    const state = new MovementStateComponent({ waterLevel: 2 });

    state.updateFrom({ isSliding: true });

    expect(state.waterLevel).toBe(2);
  });

  it("never decodes a level outside 0..3", () => {
    // Two bits cannot express anything else, but the type says so and a reader
    // downstream will index an array with it.
    const decoded = roundTrip(new MovementStateComponent({ waterLevel: 3 }));

    expect(decoded.waterLevel).toBeGreaterThanOrEqual(0);
    expect(decoded.waterLevel).toBeLessThanOrEqual(3);
  });
});
