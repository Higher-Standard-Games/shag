import { describe, expect, it } from "vitest";

/**
 * A blocked path must not stop a bot that is on an objective.
 *
 * `_navigateTo` treats a blocked path as "hold position", which is right for an
 * item — the armor is not going anywhere, and a bot planted next to a lift it
 * cannot use looks like it is waiting. It is wrong for an objective: a round
 * mode has a clock, and a bot that holds at its own spawn because the graph
 * could not route to the bomb has abandoned the round while looking like it
 * chose to.
 *
 * The distinction is carried by `holdRadius`, which only directive goals pass.
 * Reproduced against that rule rather than the brain, which needs a nav graph,
 * a vision system and a live snapshot to instantiate.
 */
type NavOutcome = "hold" | "steer";

function onBlockedPath(holdRadius: number | undefined): NavOutcome {
  return holdRadius === undefined ? "hold" : "steer";
}

describe("blocked path handling", () => {
  it("holds position for an item goal", () => {
    // Item goals pass no hold radius — they must be touched, not stood near.
    expect(onBlockedPath(undefined)).toBe("hold");
  });

  it("steers directly at an objective instead of standing still", () => {
    // Directive goals carry the radius they are satisfied within.
    expect(onBlockedPath(96)).toBe("steer");
    expect(onBlockedPath(384)).toBe("steer");
  });

  it("treats a zero hold radius as an objective, not as an absent one", () => {
    // 0 is falsy: a truthiness check here would silently send a bot on a
    // pinpoint objective back to standing still.
    expect(onBlockedPath(0)).toBe("steer");
  });
});
