import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { parseTags } from "../../loader/model/TagsLoader";
import { findViewBarrelSocket, WeaponBarrels } from "../WeaponBarrels";

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
    const state = barrels as unknown as {
      barrels: Array<{
        root: TransformNode;
        spinSpeed: number;
        spinDirection: number;
        spinAxis: "x";
        rotation: number;
        targetRotation: number;
        fireStepRadians: number;
      }>;
    };
    state.barrels = [
      {
        root: indexed,
        spinSpeed: 0,
        spinDirection: 1,
        spinAxis: "x",
        rotation: 0,
        targetRotation: 0,
        fireStepRadians: Math.PI / 4,
      },
      {
        root: continuous,
        spinSpeed: 4,
        spinDirection: -1,
        spinAxis: "x",
        rotation: 0,
        targetRotation: 0,
        fireStepRadians: 0,
      },
    ];

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
