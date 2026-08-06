import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractTriggerVolumes, q3AngleToGameYaw } from "../TriggerTable";

/**
 * Fixtures are the REAL wdm2 records (dumped from map_wdm2.pk3 — see
 * docs/research/triggerbrushes-and-targets.md §1). Q3 coords throughout;
 * the extractor converts to Babylon space (Y↔Z swap).
 */

const ent = (classname: string, properties: Record<string, string> = {}) => ({ classname, properties });

/** wdm2 submodels (models lump, Q3 coords). Index 0 = worldspawn. */
const WDM2_MODELS: Array<{ mins: [number, number, number]; maxs: [number, number, number] }> = [
  { mins: [-2000, -2000, -100], maxs: [2000, 2000, 800] }, // *0 worldspawn
  { mins: [-1032, -272, 208], maxs: [-992, -112, 384] }, // *1 teleporter → t1
  { mins: [-816, 40, 400], maxs: [-624, 64, 576] }, // *2 teleporter → t4
  { mins: [-48, -976, 0], maxs: [80, -848, 16] }, // *3 JUMPPAD → jump-mega1
  { mins: [-488, 262, 144], maxs: [-358, 392, 320] }, // *4 teleporter → t6
  { mins: [656, 224, 32], maxs: [848, 232, 208] }, // *5 teleporter → t2
];

const WDM2_ENTITIES = [
  ent("worldspawn"),
  ent("misc_teleporter_dest", { origin: "-784 -192 424", angle: "-1.40334e-014", targetname: "t1" }),
  ent("trigger_teleport", { model: "*1", target: "t1" }),
  ent("trigger_teleport", { model: "*2", target: "t4" }),
  ent("misc_teleporter_dest", { targetname: "t4", origin: "-920 -192 232" }),
  ent("trigger_push", { model: "*3", target: "jump-mega1" }),
  ent("target_position", { targetname: "jump-mega1", angle: "90", origin: "16 -912 312" }),
  ent("misc_teleporter_dest", { targetname: "t2", angle: "-90", origin: "752 240 424" }),
  ent("trigger_teleport", { model: "*4", target: "t6" }),
  ent("misc_teleporter_dest", { targetname: "t6", angle: "180", origin: "112 560 424" }),
  ent("trigger_teleport", { model: "*5", target: "t2" }),
  // Nav-hint noise — must be ignored (wdm2 has ~70 of these)
  ent("target_position", { targetname: "target_position8", origin: "-392 -848 496" }),
  ent("misc_portal_surface", { target: "misc_portal_surface2", origin: "752 288 104" }),
];

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractTriggerVolumes (wdm2 ground truth)", () => {
  it("extracts all 4 teleporters + 1 jumppad in BSP order with sequential ids", () => {
    const volumes = extractTriggerVolumes(WDM2_ENTITIES, WDM2_MODELS);

    expect(volumes).toHaveLength(5);
    expect(volumes.map((v) => v.id)).toEqual([0, 1, 2, 3, 4]);
    expect(volumes.map((v) => v.type)).toEqual(["teleport", "teleport", "push", "teleport", "teleport"]);
  });

  it("converts trigger AABBs to Babylon space with min<max preserved on every axis", () => {
    const volumes = extractTriggerVolumes(WDM2_ENTITIES, WDM2_MODELS);

    // *1: Q3 mins(-1032,-272,208) maxs(-992,-112,384) → Babylon y=q3z, z=q3y
    expect(volumes[0].min).toEqual({ x: -1032, y: 208, z: -272 });
    expect(volumes[0].max).toEqual({ x: -992, y: 384, z: -112 });

    for (const v of volumes) {
      expect(v.min.x).toBeLessThan(v.max.x);
      expect(v.min.y).toBeLessThan(v.max.y);
      expect(v.min.z).toBeLessThan(v.max.z);
    }
  });

  it("resolves teleporter destinations with position swap + exit yaw", () => {
    const volumes = extractTriggerVolumes(WDM2_ENTITIES, WDM2_MODELS);

    // *1 → t1 at Q3 (-784,-192,424), angle ≈ 0
    expect(volumes[0].dest).toEqual({ x: -784, y: 424, z: -192 });
    expect(volumes[0].destYaw).toBeCloseTo(Math.PI / 2, 6);

    // *5 → t2 at Q3 (752,240,424), angle -90 → yaw π
    const t2 = volumes[4];
    expect(t2.dest).toEqual({ x: 752, y: 424, z: 240 });
    expect(t2.destYaw).toBeCloseTo(Math.PI, 6);

    // t4 has no angle key → yaw defaults to q3AngleToGameYaw(0)
    expect(volumes[1].destYaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it("resolves the jumppad target (no yaw) — the wdm2 pad is dead-vertical over its center", () => {
    const pad = extractTriggerVolumes(WDM2_ENTITIES, WDM2_MODELS)[2];

    expect(pad.type).toBe("push");
    expect(pad.dest).toEqual({ x: 16, y: 312, z: -912 });
    expect(pad.destYaw).toBeUndefined();

    // Ballistic sanity for the profile solve: target sits exactly above the
    // trigger AABB center (Q3 center (16,-912,8) → Babylon (16,8,-912)).
    const center = {
      x: (pad.min.x + pad.max.x) / 2,
      y: (pad.min.y + pad.max.y) / 2,
      z: (pad.min.z + pad.max.z) / 2,
    };
    expect(center).toEqual({ x: 16, y: 8, z: -912 });
    expect(pad.dest.x).toBe(center.x);
    expect(pad.dest.z).toBe(center.z);
    expect(pad.dest.y - center.y).toBe(304); // height for the AimAtTarget solve
  });

  it("is deterministic: identical input → identical output", () => {
    const a = extractTriggerVolumes(WDM2_ENTITIES, WDM2_MODELS);
    const b = extractTriggerVolumes(WDM2_ENTITIES, WDM2_MODELS);
    expect(a).toEqual(b);
  });
});

describe("extractTriggerVolumes (fail-closed)", () => {
  const models = WDM2_MODELS;

  it("drops triggers with an unresolvable target and keeps ids sequential", () => {
    const volumes = extractTriggerVolumes(
      [
        ent("trigger_teleport", { model: "*1", target: "nope" }),
        ent("trigger_teleport", { model: "*2", target: "t4" }),
        ent("misc_teleporter_dest", { targetname: "t4", origin: "-920 -192 232" }),
      ],
      models,
    );

    expect(volumes).toHaveLength(1);
    expect(volumes[0].id).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"nope" unresolved'));
  });

  it("drops triggers with a missing, non-brush, worldspawn, or out-of-range model", () => {
    const volumes = extractTriggerVolumes(
      [
        ent("trigger_teleport", { target: "t1" }), // no model
        ent("trigger_teleport", { model: "16 -912 312", target: "t1" }), // not "*N"
        ent("trigger_teleport", { model: "*0", target: "t1" }), // worldspawn
        ent("trigger_teleport", { model: "*99", target: "t1" }), // out of range
        ent("misc_teleporter_dest", { targetname: "t1", origin: "-784 -192 424" }),
      ],
      models,
    );

    expect(volumes).toHaveLength(0);
  });

  it("drops triggers whose destination has a malformed origin", () => {
    const volumes = extractTriggerVolumes(
      [
        ent("trigger_push", { model: "*3", target: "pad" }),
        ent("target_position", { targetname: "pad", origin: "not numbers" }),
      ],
      models,
    );

    expect(volumes).toHaveLength(0);
  });

  it("accepts target_position and info_notnull as teleporter destinations (Q3 compat)", () => {
    const volumes = extractTriggerVolumes(
      [
        ent("trigger_teleport", { model: "*1", target: "a" }),
        ent("target_position", { targetname: "a", origin: "0 0 100" }),
        ent("trigger_teleport", { model: "*2", target: "b" }),
        ent("info_notnull", { targetname: "b", origin: "0 0 200" }),
      ],
      models,
    );

    expect(volumes).toHaveLength(2);
  });

  // Regression: several shipping maps aim triggers at classnames that were NOT
  // in the old allow-list, so the pad/teleporter was silently dropped (dead
  // jumppads on wdm12/17/18/19, wbomb6; dead teleporters on wbomb2/wctf1/wda4).
  it("resolves a jumppad whose dest is target_location (real wdm12 records)", () => {
    // wdm12: trigger_push *4 → target_location "target_location1" at Q3 (192 96 120)
    const volumes = extractTriggerVolumes(
      [
        ent("trigger_push", { model: "*3", target: "target_location1" }),
        ent("target_location", { targetname: "target_location1", angle: "180", origin: "192 96 120" }),
      ],
      models,
    );

    expect(volumes).toHaveLength(1);
    expect(volumes[0].type).toBe("push");
    expect(volumes[0].dest).toEqual({ x: 192, y: 120, z: 96 }); // Y↔Z swap
  });

  it("resolves a teleporter whose dest is info_teleport_destination (Q3 standard)", () => {
    // wbomb2/wctf1: trigger_teleport → info_teleport_destination with an exit angle.
    const volumes = extractTriggerVolumes(
      [
        ent("trigger_teleport", { model: "*1", target: "dst" }),
        ent("info_teleport_destination", { targetname: "dst", angle: "90", origin: "0 0 300" }),
      ],
      models,
    );

    expect(volumes).toHaveLength(1);
    expect(volumes[0].type).toBe("teleport");
    expect(volumes[0].dest).toEqual({ x: 0, y: 300, z: 0 });
    expect(volumes[0].destYaw).toBeCloseTo(0, 6); // q3 angle 90 → game yaw 0
  });
});

describe("q3AngleToGameYaw", () => {
  it("maps Q3 yaw degrees to game yaw radians (forward = (sin yaw, 0, cos yaw))", () => {
    expect(q3AngleToGameYaw(0)).toBeCloseTo(Math.PI / 2, 9); // Q3 +X → Babylon +X
    expect(q3AngleToGameYaw(90)).toBeCloseTo(0, 9); // Q3 +Y → Babylon +Z
    expect(q3AngleToGameYaw(180)).toBeCloseTo(-Math.PI / 2, 9);
    expect(q3AngleToGameYaw(-90)).toBeCloseTo(Math.PI, 9);
    expect(q3AngleToGameYaw(270)).toBeCloseTo(Math.PI, 9); // normalized into (−π, π]
  });

  it("treats Q3 up/down special angles (−1/−2) as 0", () => {
    expect(q3AngleToGameYaw(-1)).toBeCloseTo(Math.PI / 2, 9);
    expect(q3AngleToGameYaw(-2)).toBeCloseTo(Math.PI / 2, 9);
  });
});
