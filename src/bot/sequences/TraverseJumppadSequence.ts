import type { BotInput } from "../BotBrain";
import { InputButtons } from "../BotConfig";
import type { Vec3 } from "../BotGameState";
import type { NavTriggerMetadata } from "../BotNavGraph";
import type { BotSequence, BotSequenceContext, BotSequenceState, BotSequenceTick } from "../BotSequence";

const LAUNCH_CONFIRM_TICKS = 40;
const FLIGHT_COMMIT_TICKS = 180;
const TARGET_HORIZONTAL_TOLERANCE = 128;
const TARGET_VERTICAL_TOLERANCE = 128;
const MIN_LAUNCH_VERTICAL_SPEED = 80;

function yawToward(from: Vec3, to: Vec3, fallback: number): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz) < 1 ? fallback : Math.atan2(dx, dz);
}

function forwardInput(context: BotSequenceContext, target: Vec3): BotInput {
  const self = context.state.self;
  return {
    direction: { x: 0, y: 0, z: 1 },
    pitch: self.pitch,
    yaw: yawToward(self.position, target, self.yaw),
    buttons: InputButtons.FORWARD,
    weaponSlot: 0,
  };
}

function triggerFrom(state: BotSequenceState): NavTriggerMetadata {
  return state.data.trigger as NavTriggerMetadata;
}
function triggerCenter(trigger: NavTriggerMetadata): Vec3 {
  return {
    x: (trigger.min.x + trigger.max.x) * 0.5,
    y: (trigger.min.y + trigger.max.y) * 0.5,
    z: (trigger.min.z + trigger.max.z) * 0.5,
  };
}

function overlapsTrigger(context: BotSequenceContext, trigger: NavTriggerMetadata): boolean {
  const position = context.state.self.position;
  const maxY = context.state.self.isCrouching ? 8 : 32;
  return (
    position.x - 16 <= trigger.max.x &&
    position.x + 16 >= trigger.min.x &&
    position.y - 24 <= trigger.max.y &&
    position.y + maxY >= trigger.min.y &&
    position.z - 16 <= trigger.max.z &&
    position.z + 16 >= trigger.min.z
  );
}
function nearTrigger(position: Vec3, trigger: NavTriggerMetadata): boolean {
  const dx = Math.max(trigger.min.x - position.x, 0, position.x - trigger.max.x);
  const dz = Math.max(trigger.min.z - position.z, 0, position.z - trigger.max.z);
  return Math.hypot(dx, dz) <= 64 && position.y - 24 <= trigger.max.y + 64 && position.y + 32 >= trigger.min.y - 64;
}

function reachedTarget(position: Vec3, trigger: NavTriggerMetadata): boolean {
  return (
    Math.hypot(position.x - trigger.dest.x, position.z - trigger.dest.z) <= TARGET_HORIZONTAL_TOLERANCE &&
    Math.abs(position.y - trigger.dest.y) <= TARGET_VERTICAL_TOLERANCE
  );
}

/** Enters an authored jumppad, confirms launch, and verifies its ballistic target. */
export class TraverseJumppadSequence implements BotSequence {
  readonly id = "nav_traverse_jumppad";
  readonly tags = ["navigation", "movement", "jumppad"] as const;
  readonly maxTicks = 260;

  score(context: BotSequenceContext): number | null {
    return context.navStep?.type === "jumppad" && context.navStep.trigger ? 1150 : null;
  }

  start(context: BotSequenceContext): BotSequenceState {
    const trigger = context.navStep?.trigger;
    if (!trigger) throw new Error("TraverseJumppadSequence requires trigger metadata");
    return {
      phase: "approach",
      startedTick: context.state.tick,
      phaseStartedTick: context.state.tick,
      commitUntilTick: context.state.tick,
      data: {
        trigger,
        enteredTick: null,
        launchTick: null,
        launchArmed: context.state.self.isGrounded && nearTrigger(context.state.self.position, trigger),
      },
    };
  }

  tick(context: BotSequenceContext, state: BotSequenceState): BotSequenceTick {
    const trigger = triggerFrom(state);
    const self = context.state.self;
    const source = triggerCenter(trigger);
    const launchTick = state.data.launchTick as number | null;

    const enteredTick = state.data.enteredTick as number | null;
    if (self.isGrounded && nearTrigger(self.position, trigger)) {
      state.data.launchArmed = true;
    }
    if (launchTick !== null) {
      if (reachedTarget(self.position, trigger)) {
        return {
          input: forwardInput(context, trigger.dest),
          status: "succeeded",
          phase: "target_verified",
        };
      }
      if (self.isGrounded && context.state.tick > launchTick) {
        return {
          input: forwardInput(context, trigger.dest),
          status: "failed",
          phase: "airborne",
          reason: "jumppad_landed_short",
        };
      }
      return {
        input: forwardInput(context, trigger.dest),
        status: "running",
        phase: "airborne",
      };
    }

    if (state.data.launchArmed === true && !self.isGrounded && self.velocity.y >= MIN_LAUNCH_VERTICAL_SPEED) {
      state.data.launchTick = context.state.tick;
      return {
        input: forwardInput(context, trigger.dest),
        status: "running",
        phase: "airborne",
        commitForTicks: FLIGHT_COMMIT_TICKS,
      };
    }

    if (enteredTick !== null) {
      if (context.state.tick - enteredTick >= LAUNCH_CONFIRM_TICKS) {
        return {
          input: forwardInput(context, source),
          status: "failed",
          phase: "activate",
          reason: "jumppad_launch_not_confirmed",
        };
      }
      return {
        input: forwardInput(context, source),
        status: "running",
        phase: "activate",
        commitForTicks: LAUNCH_CONFIRM_TICKS,
      };
    }

    if (overlapsTrigger(context, trigger)) {
      state.data.enteredTick = context.state.tick;
      state.data.launchArmed = true;
      return {
        input: forwardInput(context, source),
        status: "running",
        phase: "activate",
        commitForTicks: LAUNCH_CONFIRM_TICKS,
      };
    }

    return {
      input: forwardInput(context, source),
      status: "running",
      phase: "approach",
    };
  }
}
