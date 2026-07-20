import { describe, expect, it } from "vitest";
import { InputButtons } from "../BotConfig";
import { BotGameState } from "../BotGameState";
import type { NavStep, NavTriggerMetadata } from "../BotNavGraph";
import { BotSequenceRegistry, BotSequenceRuntime } from "../BotSequence";
import { TraverseJumppadSequence } from "../sequences/TraverseJumppadSequence";
import { TraverseTeleporterSequence } from "../sequences/TraverseTeleporterSequence";

const teleporter: NavTriggerMetadata = {
  id: 4,
  min: { x: 80, y: -16, z: -16 },
  max: { x: 120, y: 16, z: 16 },
  dest: { x: 3000, y: 64, z: 800 },
  destYaw: Math.PI / 2,
};

const jumppad: NavTriggerMetadata = {
  id: 9,
  min: { x: 80, y: -16, z: -16 },
  max: { x: 120, y: 16, z: 16 },
  dest: { x: 800, y: 512, z: 0 },
};

function makeStep(type: "teleporter" | "jumppad", trigger: NavTriggerMetadata): NavStep {
  return {
    from: { id: 0, type, position: { x: 50, y: 0, z: 0 } },
    to: { id: 1, type, position: { ...trigger.dest } },
    type,
    cost: 32,
    horizontalDistance: Math.hypot(trigger.dest.x - 50, trigger.dest.z),
    heightDelta: trigger.dest.y,
    requiresPreciseApproach: true,
    trigger,
  };
}

function makeRuntime(sequence: TraverseTeleporterSequence | TraverseJumppadSequence) {
  const registry = new BotSequenceRegistry();
  registry.register(sequence);
  return new BotSequenceRuntime(registry);
}

describe("authored trigger traversal sequences", () => {
  it("approaches a teleporter, commits inside its exact AABB, and verifies the lifted exit", () => {
    const state = new BotGameState();
    state.tick = 0;
    state.self.position = { x: 50, y: 0, z: 0 };
    state.self.isGrounded = true;
    const navStep = makeStep("teleporter", teleporter);
    const context = { state, navStep };
    const runtime = makeRuntime(new TraverseTeleporterSequence());

    expect(runtime.startBest(context)).toBe(true);
    const approach = runtime.tick(context);
    expect(approach).toMatchObject({ status: "running", phase: "approach" });
    expect(approach!.input.buttons).toBe(InputButtons.FORWARD);
    expect(approach!.input.yaw).toBeCloseTo(Math.PI / 2, 6);

    state.tick = 10;
    state.self.position = { x: 100, y: 0, z: 0 };
    expect(runtime.tick(context)).toMatchObject({ status: "running", phase: "activate" });
    expect(runtime.isCommitted(20)).toBe(true);

    state.tick = 11;
    state.self.position = { x: 3000, y: 89, z: 800 };
    const exited = runtime.tick(context);
    expect(exited).toMatchObject({ status: "succeeded", phase: "exit_verified" });
    expect(exited!.input.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(runtime.isActive).toBe(false);
  });

  it("confirms a jumppad launch before accepting its ballistic target", () => {
    const state = new BotGameState();
    state.tick = 0;
    state.self.position = { x: 100, y: 0, z: 0 };
    state.self.isGrounded = true;
    const navStep = makeStep("jumppad", jumppad);
    const context = { state, navStep };
    const runtime = makeRuntime(new TraverseJumppadSequence());

    expect(runtime.startBest(context)).toBe(true);
    expect(runtime.tick(context)).toMatchObject({ status: "running", phase: "activate" });

    state.tick = 2;
    state.self.position = { x: 140, y: 40, z: 0 };
    state.self.velocity = { x: 600, y: 700, z: 0 };
    state.self.isGrounded = false;
    expect(runtime.tick(context)).toMatchObject({ status: "running", phase: "airborne" });
    expect(runtime.isCommitted(100)).toBe(true);

    state.tick = 70;
    state.self.position = { ...jumppad.dest };
    expect(runtime.tick(context)).toMatchObject({ status: "succeeded", phase: "target_verified" });
    expect(runtime.isActive).toBe(false);
  });

  it("reports an authored pad that never launches", () => {
    const state = new BotGameState();
    state.tick = 0;
    state.self.position = { x: 0, y: 0, z: 0 };
    state.self.isGrounded = true;
    const navStep = makeStep("jumppad", jumppad);
    const context = { state, navStep };
    const runtime = makeRuntime(new TraverseJumppadSequence());

    expect(runtime.startBest(context)).toBe(true);
    expect(runtime.tick(context)).toMatchObject({ status: "running", phase: "approach" });

    state.tick = 2;
    state.self.isGrounded = false;
    state.self.velocity = { x: 0, y: 700, z: 0 };
    expect(runtime.tick(context)).toMatchObject({ status: "running", phase: "approach" });

    state.tick = 3;
    state.self.position = { x: 100, y: 0, z: 0 };
    state.self.velocity = { x: 0, y: 0, z: 0 };
    state.self.isGrounded = true;
    expect(runtime.tick(context)).toMatchObject({ status: "running", phase: "activate" });
    state.tick = 43;
    expect(runtime.tick(context)).toMatchObject({
      status: "failed",
      phase: "activate",
      reason: "jumppad_launch_not_confirmed",
    });
    expect(runtime.isActive).toBe(false);
  });
});
