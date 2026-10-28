import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import type { ModelLoadResult } from "../../loader/model/ModelLoader";
import { parseTags } from "../../loader/model/TagsLoader";
import {
  attachWorldBarrels,
  findViewBarrelSocket,
  prepareBarrelMaterials,
  prepareWorldWeaponMaterials,
  WeaponBarrels,
} from "../WeaponBarrels";

// No tags.txt: barrels mount on the GLB's authored tag_barrel node
vi.mock("../../loader/model/TagsLoader", async (original) => ({
  ...(await original<typeof import("../../loader/model/TagsLoader")>()),
  loadTags: async () => [],
}));

/** A loaded barrel's state, as load() builds it. */
function barrelState(root: TransformNode, overrides: Record<string, number> = {}) {
  const spinSpeed = overrides.spinSpeed ?? 0;
  return {
    root,
    spinSpeed,
    firingSpinSpeed: spinSpeed,
    spinDownSeconds: 0,
    speed: spinSpeed,
    firingHold: 0,
    spinDirection: 1,
    spinAxis: "x" as const,
    rotation: 0,
    targetRotation: 0,
    fireStepRadians: 0,
    stepFrom: 0,
    stepSeconds: 0,
    stepElapsed: 0,
    slideDistance: 0,
    slideRest: 0,
    slideDelay: 0,
    slideSeconds: 0,
    slideElapsed: 0,
    ...overrides,
  };
}

function setBarrels(barrels: WeaponBarrels, states: ReturnType<typeof barrelState>[]): void {
  (barrels as unknown as { barrels: ReturnType<typeof barrelState>[] }).barrels = states;
}

describe("barrel materials", () => {
  it("draws energy layers added and self-lit, glass translucent, and the shell as it was", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const layer = (name: string) => {
      const mesh = new Mesh(name, scene);
      mesh.material = new PBRMaterial(`models/weapons/plasmagun/${name}`, scene);
      return mesh;
    };
    const meshes = [
      "plasmagun_barrel_plasma",
      "plasmagun_barrel_halo",
      "plasmagun_barrel_glass",
      "plasmagun_barrel",
    ].map(layer);
    prepareBarrelMaterials(meshes);
    const [plasma, halo, glass, shell] = meshes.map((mesh) => mesh.material as PBRMaterial);

    for (const energy of [plasma, halo]) {
      expect(energy.unlit).toBe(true);
      expect(energy.alphaMode).toBe(Constants.ALPHA_ADD);
      expect(energy.needAlphaBlending()).toBe(true);
      expect(energy.disableDepthWrite).toBe(true);
    }
    expect(glass.unlit).toBe(false);
    expect(glass.alpha).toBeCloseTo(0.35);
    expect(glass.needAlphaBlending()).toBe(true);
    expect(shell.unlit).toBe(false);
    expect(shell.needAlphaBlending()).toBe(false);

    scene.dispose();
    engine.dispose();
  });
});

describe("WeaponBarrels shot indexing", () => {
  it("keeps authored plasma tags on the legacy root placement while using GLB sockets without tags.txt", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const glbSocket = new TransformNode("tag_barrel", scene);
    const plasmaSocket = new TransformNode("tag_barrel2", scene);
    const nodes = [glbSocket, plasmaSocket];
    const [plasmaTag] = parseTags('tag "tag_barrel2" "tag_barrel" 0 0 0 0 0 0');

    expect(findViewBarrelSocket(plasmaTag, nodes)).toBeNull();
    expect(findViewBarrelSocket(undefined, nodes)).toBe(glbSocket);

    scene.dispose();
    engine.dispose();
  });

  it("turns one 45 degree step per shot and leaves continuous barrels unchanged", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const indexed = new TransformNode("grenade_barrel", scene);
    const continuous = new TransformNode("plasma_barrel", scene);
    const barrels = new WeaponBarrels();
    setBarrels(barrels, [
      barrelState(indexed, { spinSpeed: 0, fireStepRadians: Math.PI / 4 }),
      barrelState(continuous, { spinSpeed: 4, spinDirection: -1 }),
    ]);

    barrels.fire();
    barrels.update(0.08);
    expect(indexed.rotation.x).toBeCloseTo(Math.PI / 8);
    expect(continuous.rotation.x).toBeCloseTo(-0.32);
    barrels.update(0.08);
    expect(indexed.rotation.x).toBeCloseTo(Math.PI / 4);
    barrels.fire();
    barrels.update(0.16);
    expect(indexed.rotation.x).toBeCloseTo(Math.PI / 2);

    barrels.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("WeaponBarrels firing spin", () => {
  it("spins up while firing and slows back to idle over spinDownSeconds after the last shot", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const barrels = new WeaponBarrels();
    const state = barrelState(new TransformNode("plasma_barrel", scene), {
      spinSpeed: 2,
      firingSpinSpeed: 7.5,
      spinDownSeconds: 1.5,
    });
    setBarrels(barrels, [state]);

    barrels.update(0.1);
    expect(state.speed).toBe(2);
    // Shots every 0.1 s hold it at firing speed, reached within 0.15 s
    for (let shot = 0; shot < 5; shot++) {
      barrels.fire(0.1);
      barrels.update(0.05);
      barrels.update(0.05);
    }
    expect(state.speed).toBeCloseTo(7.5);
    // The last shot's hold (1.5 refire intervals) runs out, then it slows evenly
    barrels.update(0.04);
    expect(state.speed).toBeCloseTo(7.5);
    barrels.update(0.75);
    expect(state.speed).toBeCloseTo(4.75);
    barrels.update(0.75);
    expect(state.speed).toBeCloseTo(2);
    barrels.update(1);
    expect(state.speed).toBe(2);

    barrels.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("world weapon barrels", () => {
  it("mounts each barrel at the weapon's barrel socket plus its own offset, and stops when the weapon goes", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const leader = new Mesh("plasmagun", scene);
    const load = async (): Promise<ModelLoadResult> => {
      const root = new TransformNode("source", scene);
      const mesh = new Mesh("barrel", scene);
      mesh.parent = root;
      return { root, meshes: [mesh], skeletons: [], animationGroups: [], lights: [] };
    };
    const adopted: ModelLoadResult[] = [];
    const barrels = [
      { modelPath: "/data/models/weapons/plasmagun/plasmagun_barrel.glb", spinSpeed: 2, offset: { x: 0, y: 0, z: -4 } },
      { modelPath: "/data/models/weapons/plasmagun/plasmagun_barrel.glb", spinSpeed: 2 },
    ];
    await attachWorldBarrels({
      leader,
      barrels,
      attachmentPoints: {
        tag_barrel: { position: new Vector3(10, 5, 0), rotation: new Vector3(0, 0, 0.5), rotationQuaternion: null },
      },
      scene,
      load,
      adopt: (barrel) => adopted.push(barrel),
      label: "test",
    });
    expect(adopted).toHaveLength(2);
    const [first, second] = adopted.map((barrel) => barrel.meshes[0]);
    expect(first.parent).toBe(leader);
    expect(first.position.asArray()).toEqual([10, 5, -4]);
    expect(second.position.asArray()).toEqual([10, 5, 0]);
    expect(second.rotation.z).toBeCloseTo(0.5);

    let gone = false;
    const late: ModelLoadResult[] = [];
    await attachWorldBarrels({
      leader,
      barrels,
      scene,
      load: async () => {
        gone = true;
        return load();
      },
      adopt: (barrel) => late.push(barrel),
      stale: () => gone,
      label: "test",
    });
    expect(late).toHaveLength(0);
    expect(scene.getMeshByName("barrel")).toBe(first);

    scene.dispose();
    engine.dispose();
  });
});

describe("WeaponBarrels reload turn", () => {
  it("turns a shot's step over the whole refire interval, easing in and out", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const barrels = new WeaponBarrels();
    const drum = new TransformNode("grenade_barrel", scene);
    const step = (405 * Math.PI) / 180;
    setBarrels(barrels, [barrelState(drum, { fireStepRadians: step })]);

    barrels.fire(0.8);
    barrels.update(0.1);
    // Eased: slower than even at the start, half way at half time
    expect(drum.rotation.x).toBeGreaterThan(0);
    expect(drum.rotation.x).toBeLessThan(step / 8);
    barrels.update(0.3);
    expect(drum.rotation.x).toBeCloseTo(step / 2);
    barrels.update(0.4);
    expect(drum.rotation.x).toBeCloseTo(step);
    barrels.update(0.5);
    expect(drum.rotation.x).toBeCloseTo(step);

    barrels.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("WeaponBarrels bolt slide", () => {
  it("cycles the bolt back and home on a shot, and racks it once during a reload", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const barrels = new WeaponBarrels();
    const bolt = new TransformNode("machinegun_bolt", scene);
    bolt.position.x = 2;
    setBarrels(barrels, [barrelState(bolt, { slideDistance: 1.5, slideRest: 2 })]);

    barrels.update(0.05);
    expect(bolt.position.x).toBe(2);
    barrels.fire(0.104);
    barrels.update(0.03); // the back stroke ends at 30% of the 0.1 s cycle
    expect(bolt.position.x).toBeCloseTo(0.5);
    barrels.update(0.035);
    expect(bolt.position.x).toBeGreaterThan(0.5);
    expect(bolt.position.x).toBeLessThan(2);
    barrels.update(0.05);
    expect(bolt.position.x).toBe(2);

    barrels.reload(1.5);
    barrels.update(0.6); // still waiting: the rack starts 45% into the reload
    expect(bolt.position.x).toBe(2);
    barrels.update(0.1);
    barrels.update(0.1);
    expect(bolt.position.x).toBeLessThan(2);
    barrels.update(0.4);
    expect(bolt.position.x).toBe(2);

    barrels.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("world weapon materials", () => {
  it("draws a gun's glow gradient as added light and leaves its strips and body alone", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const meshes = ["electrobolt_glow", "electrobolt_emit", "electrobolt"].map((name) => {
      const mesh = new Mesh(name, scene);
      mesh.material = new PBRMaterial(`models/weapons/electrobolt/${name}`, scene);
      return mesh;
    });
    prepareWorldWeaponMaterials(meshes);
    const [glow, emit, body] = meshes.map((mesh) => mesh.material as PBRMaterial);
    expect(glow.unlit).toBe(true);
    expect(glow.alphaMode).toBe(Constants.ALPHA_ADD);
    expect(glow.needAlphaBlending()).toBe(true);
    for (const untouched of [emit, body]) {
      expect(untouched.unlit).toBe(false);
      expect(untouched.needAlphaBlending()).toBe(false);
    }
    scene.dispose();
    engine.dispose();
  });
});
