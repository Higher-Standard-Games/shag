import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWHEIGHT } from "../../engine/physics/PlayerPhysicsConstants";
import { InputButtons, type BotDifficulty } from "../BotConfig";
import { BotGameState, type VisiblePlayer } from "../BotGameState";
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
  });

  it("continues a crouchslide and jump-cancels near the end", () => {
    const brain = new StateMachineBrain(difficulty);
    const state = makeState(
      { currentWeapon: "blade", weapons: ["blade"], ammo: { blade: 1 }, velocity: { x: 0, y: 0, z: 420 } },
      600,
    );
    state.players = [];

    brain.decide(state);
    state.tick = 70;
    const input = brain.decide(state);
    expect(input.buttons & InputButtons.CROUCH).not.toBe(0);
    expect(input.buttons & InputButtons.JUMP).not.toBe(0);
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
