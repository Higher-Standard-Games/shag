import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWHEIGHT } from "../../engine/physics/PlayerPhysicsConstants";
import { type BotInput, BotState } from "../BotBrain";
import { type BotDifficulty, InputButtons } from "../BotConfig";
import { BotGameState, type VisiblePlayer } from "../BotGameState";
import { BotNavGraph, type NavEdgeType, type NavPath } from "../BotNavGraph";
import { StateMachineBrain } from "../StateMachineBrain";

const difficulty: BotDifficulty = {
  aimAccuracy: 1,
  reactionTimeMs: 0,
  trackingSpeed: 999,
  predictionSkill: 1,
  itemTimingSkill: 1,
  strafeJumpSkill: 1,
  dodgeSkill: 1,
  mistakeRate: 0,
  lookAroundInterval: 10,
};

function makeEnemy(distance: number): VisiblePlayer {
  return {
    entityId: "player_2",
    playerId: "enemy",
    position: { x: 0, y: 0, z: distance },
    velocity: { x: 0, y: 0, z: 0 },
    isDead: false,
    team: "",
    relation: "enemy",
    distance,
  };
}

function makeState(overrides: Partial<BotGameState["self"]>, enemyDistance = 600): BotGameState {
  const state = new BotGameState();
  state.selfEntityId = "player_1";
  state.selfPlayerId = "bot";
  state.tick = 0;
  state.self = {
    ...state.self,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    health: 100,
    armor: 0,
    isDead: false,
    isGrounded: true,
    ...overrides,
  };
  state.players = [makeEnemy(enemyDistance)];
  return state;
}

describe("StateMachineBrain combat", () => {
  it("charges and releases the blade projectile at mid range", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 } }, 700);

    const charging = brain.decide(state);
    expect(charging.buttons & InputButtons.ALT_FIRE).not.toBe(0);
    expect(charging.buttons & InputButtons.FIRE).toBe(0);

    state.tick = 200;
    const release = brain.decide(state);
    expect(release.buttons & InputButtons.ALT_FIRE).toBe(0);
    expect(release.buttons & InputButtons.FIRE).toBe(0);

    state.tick = 201;
    const nextCharge = brain.decide(state);
    expect(nextCharge.buttons & InputButtons.ALT_FIRE).not.toBe(0);
  });

  it("swings the blade at melee range", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 } }, 80);

    const input = brain.decide(state);
    expect(input.buttons & InputButtons.FIRE).not.toBe(0);
    expect(input.buttons & InputButtons.ALT_FIRE).toBe(0);
  });

  it("fires with the weapon profile selected for this command", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState(
      { currentWeapon: "blade", weapons: ["blade", "machinegun"], ammo: { blade: 1, machinegun: 160 } },
      600,
    );

    const input = brain.decide(state);
    expect(input.weaponSlot).toBe(2);
    expect(input.buttons & InputButtons.FIRE).not.toBe(0);
    expect(input.buttons & InputButtons.ALT_FIRE).toBe(0);
  });

  it("aims hitscan fire from eye height toward the enemy origin", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ currentWeapon: "machinegun", weapons: ["machinegun"], ammo: { machinegun: 160 } }, 600);

    const input = brain.decide(state);
    expect(input.buttons & InputButtons.FIRE).not.toBe(0);
    expect(input.pitch).toBeGreaterThan(0);
    expect(input.pitch).toBeCloseTo(Math.atan2(DEFAULT_VIEWHEIGHT, 600), 3);
  });
});

describe("StateMachineBrain movement", () => {
  it("starts crouchslide while hunting at slide speed", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState(
      { currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 }, velocity: { x: 0, y: 0, z: 420 } },
      600,
    );
    state.players = [];

    const input = brain.decide(state);
    expect(input.buttons & InputButtons.SPRINT).not.toBe(0);
    expect(input.buttons & InputButtons.FORWARD).not.toBe(0);
    expect(input.buttons & InputButtons.CROUCH).not.toBe(0);
    expect(brain.isSequenceActive()).toBe(true);
    expect(brain.getNavigationDebug()).toContain("sequence=route_crouchslide phase=engage");
  });

  it("continues a crouchslide and jump-cancels near the end", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState(
      { currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 }, velocity: { x: 0, y: 0, z: 420 } },
      600,
    );
    state.players = [];

    brain.decide(state);
    state.tick = 5;
    state.self.isSliding = true;
    const sliding = brain.decide(state);
    expect(sliding.buttons & InputButtons.CROUCH).not.toBe(0);

    state.tick = 80;
    const input = brain.decide(state);
    expect(input.buttons & InputButtons.CROUCH).toBe(0);
    expect(input.buttons & InputButtons.JUMP).not.toBe(0);
    expect(brain.isSequenceCommitted()).toBe(true);
  });

  it("keeps walking when authoritative state does not confirm the optional slide", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState(
      { currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 }, velocity: { x: 0, y: 0, z: 420 } },
      600,
    );
    state.players = [];

    brain.decide(state);
    state.tick = 20;
    const input = brain.decide(state);

    expect(brain.isSequenceActive()).toBe(false);
    expect(input.buttons & InputButtons.FORWARD).not.toBe(0);
    expect(input.buttons & InputButtons.CROUCH).toBe(0);
  });

  it("does not crouchslide while charging blade alt-fire", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState(
      { currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 }, velocity: { x: 0, y: 0, z: 420 } },
      700,
    );

    const input = brain.decide(state);
    expect(input.buttons & InputButtons.ALT_FIRE).not.toBe(0);
    expect(input.buttons & InputButtons.CROUCH).toBe(0);
  });
});
type TraversalHarness = {
  currentState: BotState;
  _navGraph: BotNavGraph | null;
  _currentPath: NavPath | null;
  _blockedNavEdges: Map<string, number>;
  _getNavPathOptions: (tick: number) => { blockedEdgeKeys: ReadonlySet<string> };
  _tryStartRouteCrouchslide: (input: BotInput, state: BotGameState) => BotInput | null;
  _tickActiveSequence: (state: BotGameState) => BotInput | null;
  _lastBotVision: {
    probeDrop: () => { safe: boolean; reason: "no_landing"; fallDistance: number; landing: null };
  } | null;
  _followCurrentPath: (
    state: BotGameState,
    urgent: boolean,
  ) => { status: "moving"; input: BotInput } | { status: "complete" } | { status: "blocked"; reason: string };
};

function makeTraversal(edgeType: NavEdgeType): { graph: BotNavGraph; path: NavPath } {
  const from = edgeType === "fall" ? { x: 0, y: 128, z: 0 } : { x: 0, y: 0, z: 0 };
  const to =
    edgeType === "teleporter"
      ? { x: 3000, y: 0, z: 0 }
      : edgeType === "jumppad"
        ? { x: 3000, y: 512, z: 0 }
        : edgeType === "fall"
          ? { x: 64, y: 0, z: 0 }
          : { x: 101, y: 50, z: 0 };
  const trigger =
    edgeType === "teleporter" || edgeType === "jumppad"
      ? {
          id: 0,
          min: { x: -20, y: -20, z: -20 },
          max: { x: 20, y: 20, z: 20 },
          dest: { ...to },
          destYaw: edgeType === "teleporter" ? 0 : undefined,
        }
      : undefined;
  const graph = new BotNavGraph("testmap");
  graph.loadStaticData({
    nodes: [
      { id: 0, type: edgeType === "teleporter" ? "teleporter" : "spawn", position: from },
      { id: 1, type: edgeType === "teleporter" ? "teleporter" : "floor", position: to },
    ],
    edges: [{ from: 0, to: 1, type: edgeType, cost: 100, trigger }],
  });
  const path = graph.findPath(from, to);
  if (!path) throw new Error("test graph did not produce a path");
  return { graph, path };
}

describe("StateMachineBrain traversal executors", () => {
  it("rejects a route slide before a sharp upcoming turn", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ velocity: { x: 0, y: 0, z: 420 } });
    state.players = [];
    const start = { id: 0, type: "spawn" as const, position: { x: 0, y: 0, z: 0 } };
    const corner = { id: 1, type: "floor" as const, position: { x: 0, y: 0, z: 400 } };
    const exit = { id: 2, type: "floor" as const, position: { x: 400, y: 0, z: 400 } };
    const harness = brain as unknown as TraversalHarness;
    harness.currentState = BotState.HUNT;
    harness._currentPath = {
      nodes: [start, corner, exit],
      steps: [
        {
          from: start,
          to: corner,
          type: "walk",
          cost: 400,
          horizontalDistance: 400,
          heightDelta: 0,
          requiresPreciseApproach: false,
        },
        {
          from: corner,
          to: exit,
          type: "walk",
          cost: 400,
          horizontalDistance: 400,
          heightDelta: 0,
          requiresPreciseApproach: false,
        },
      ],
      totalCost: 800,
      cursor: 0,
    };

    const input: BotInput = {
      direction: { x: 0, y: 0, z: 1 },
      pitch: 0,
      yaw: 0,
      buttons: InputButtons.FORWARD | InputButtons.SPRINT,
      weaponSlot: 0,
    };
    expect(harness._tryStartRouteCrouchslide(input, state)).toBeNull();
    expect(brain.isSequenceActive()).toBe(false);
  });

  it("explicitly jumps at a jump edge takeoff", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ position: { x: 0, y: 0, z: 0 } });
    const { graph, path } = makeTraversal("jump");
    const harness = brain as unknown as TraversalHarness;
    harness._navGraph = graph;
    harness._currentPath = path;

    const result = harness._followCurrentPath(state, false);

    expect(result.status).toBe("moving");
    if (result.status === "moving") expect(result.input.buttons & InputButtons.JUMP).not.toBe(0);
    expect(brain.getNavigationDebug()).toBe("step=jump remaining=1");
  });

  it("executes cached validated jump metadata as a committed sequence", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({
      position: { x: 0, y: 25, z: 0 },
      velocity: { x: 160, y: 0, z: 0 },
      currentWeapon: "blade",
      weapons: ["blade"],
      ammo: { blade: 1 },
    });
    state.players = [];
    state.tick = 100;
    const graph = new BotNavGraph("validated-jump-test");
    graph.loadStaticData({
      nodes: [
        { id: 0, type: "spawn", position: { x: 0, y: 0, z: 0 } },
        { id: 1, type: "floor", position: { x: 100, y: 0, z: 0 } },
      ],
      edges: [
        {
          from: 0,
          to: 1,
          type: "jump",
          cost: 100,
          opportunityId: "jump:0->1",
          requiredSpeed: 160,
          expectedTicks: 40,
          successMargin: 24,
          validated: true,
        },
      ],
      opportunities: [
        {
          id: "jump:0->1",
          kind: "jump",
          fromNodeId: 0,
          toNodeId: 1,
          takeoff: {
            position: { x: 0, y: 25, z: 0 },
            radius: 32,
            minSpeed: 160,
            maxSpeed: 160,
            yawRange: [Math.PI / 2 - 0.1, Math.PI / 2 + 0.1],
          },
          landing: {
            position: { x: 100, y: 25, z: 0 },
            radius: 48,
            surfaceNormal: { x: 0, y: 1, z: 0 },
          },
          inputPlan: {
            direction: { x: 1, y: 0, z: 0 },
            initialSpeed: 160,
            buttons: InputButtons.FORWARD | InputButtons.SPRINT | InputButtons.JUMP,
            jumpTicks: 1,
            maxTicks: 150,
          },
          expectedTicks: 40,
          successMargin: 24,
          risk: { fallDamage: false, requiresLedgeGrab: false },
        },
      ],
    });
    const path = graph.findPath(state.self.position, { x: 100, y: 0, z: 0 });
    if (!path) throw new Error("validated graph did not produce a path");
    const harness = brain as unknown as TraversalHarness;
    harness.currentState = BotState.HUNT;
    harness._navGraph = graph;
    harness._currentPath = path;

    const result = harness._followCurrentPath(state, false);

    expect(result.status).toBe("moving");
    if (result.status === "moving") {
      expect(result.input.buttons & InputButtons.JUMP).not.toBe(0);
      expect(result.input.yaw).toBeCloseTo(Math.PI / 2, 6);
    }
    expect(brain.isSequenceActive()).toBe(true);
    expect(brain.getNavigationDebug()).toContain("sequence=nav_validated_jump phase=takeoff");

    state.tick = 105;
    state.self.isGrounded = false;
    state.self.position = { x: 50, y: 70, z: 0 };
    const airborne = brain.decide(state, null, null, graph);
    expect(airborne.buttons & InputButtons.JUMP).toBe(0);
    expect(brain.getNavigationDebug()).toContain("phase=airborne");

    state.tick = 140;
    state.self.isGrounded = true;
    state.self.position = { x: 104, y: 25, z: 0 };
    brain.decide(state, null, null, graph);
    expect(brain.isSequenceActive()).toBe(false);
  });

  it("commits to a teleporter and verifies the non-local exit", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ position: { x: 0, y: 0, z: 0 }, yaw: 1.25 });
    state.players = [];
    const { graph, path } = makeTraversal("teleporter");
    const harness = brain as unknown as TraversalHarness;
    harness._navGraph = graph;
    harness._currentPath = path;

    const result = harness._followCurrentPath(state, false);
    expect(result.status).toBe("moving");
    if (result.status === "moving") {
      expect(result.input.buttons & InputButtons.FORWARD).not.toBe(0);
      expect(result.input.buttons & (InputButtons.SPRINT | InputButtons.JUMP | InputButtons.CROUCH)).toBe(0);
      expect(result.input.yaw).toBe(1.25);
    }
    expect(brain.getNavigationDebug()).toContain("sequence=nav_traverse_teleporter phase=activate");

    state.tick = 5;
    state.self.position = { x: 3000, y: 25, z: 0 };
    state.self.isGrounded = false;
    harness._tickActiveSequence(state);
    graph.getNextStep(state.self.position, path);
    expect(brain.isSequenceActive()).toBe(false);
    expect(path.cursor).toBe(1);
  });

  it("confirms a jumppad launch and ballistic target", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ position: { x: 0, y: 0, z: 0 } });
    state.players = [];
    const { graph, path } = makeTraversal("jumppad");
    const harness = brain as unknown as TraversalHarness;
    harness._navGraph = graph;
    harness._currentPath = path;

    expect(harness._followCurrentPath(state, false).status).toBe("moving");
    expect(brain.getNavigationDebug()).toContain("sequence=nav_traverse_jumppad phase=activate");

    state.tick = 5;
    state.self.isGrounded = false;
    state.self.velocity = { x: 600, y: 700, z: 0 };
    state.self.position = { x: 300, y: 100, z: 0 };
    harness._tickActiveSequence(state);
    expect(brain.getNavigationDebug()).toContain("phase=airborne");

    state.tick = 70;
    state.self.position = { x: 3000, y: 512, z: 0 };
    harness._tickActiveSequence(state);
    graph.getNextStep(state.self.position, path);
    expect(brain.isSequenceActive()).toBe(false);
    expect(path.cursor).toBe(1);
  });

  it("cools down and replans after an unconfirmed teleporter activation", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ position: { x: 0, y: 0, z: 0 } });
    state.players = [];
    const { graph, path } = makeTraversal("teleporter");
    const harness = brain as unknown as TraversalHarness;
    harness.currentState = BotState.HUNT;
    harness._navGraph = graph;
    harness._currentPath = path;

    expect(harness._followCurrentPath(state, false).status).toBe("moving");
    state.tick = 40;
    harness._tickActiveSequence(state);

    expect(brain.isSequenceActive()).toBe(false);
    expect(brain.getNavigationDebug()).toBe("blocked=sequence:nav_traverse_teleporter:teleport_not_confirmed");
    expect(harness._currentPath).toBeNull();
    expect(harness._blockedNavEdges.size).toBe(1);
  });

  it("blocks a fall edge when the landing probe fails", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState({ position: { x: 0, y: 128, z: 0 } });
    const { graph, path } = makeTraversal("fall");
    const harness = brain as unknown as TraversalHarness;
    harness._navGraph = graph;
    harness._currentPath = path;
    harness._lastBotVision = {
      probeDrop: () => ({ safe: false, reason: "no_landing", fallDistance: 128, landing: null }),
    };

    expect(harness._followCurrentPath(state, false)).toEqual({ status: "blocked", reason: "fall:no_landing" });
    expect(brain.getNavigationDebug()).toBe("blocked=fall:no_landing");
    expect(harness._blockedNavEdges.size).toBe(1);
    expect(harness._getNavPathOptions(624).blockedEdgeKeys.size).toBe(1);
    expect(harness._getNavPathOptions(625).blockedEdgeKeys.size).toBe(0);
  });
});
