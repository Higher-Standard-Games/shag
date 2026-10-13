/**
 * Map ambience read from entity keys and sky shaders: which speakers loop or
 * repeat, how rotators spin, and how a sky shader's stages become cloud layers
 * placed with Quake 3's cloud-dome math.
 */

import { describe, expect, it } from "vitest";
import type { Q3ShaderStage } from "../../shader/Q3ShaderTypes";
import { cloudTexCoord } from "../../texture/SkyboxLoader";
import { rotationPlan, speakerPlan } from "../AmbientEntityHandlers";
import { cloudLayersFromStages } from "../mesh/skyClouds";

const entity = (classname: string, properties: Record<string, string>) => ({
  classname,
  properties: { classname, ...properties },
});

describe("speakerPlan", () => {
  it("loops a LOOPED_ON speaker where it stands, fading out over 1000 / attenuation", () => {
    const plan = speakerPlan(
      entity("target_speaker", {
        noise: "sounds/ambient/ceilingfan.ogg",
        spawnflags: "1",
        attenuation: "3",
        volume: "0.5",
        origin: "-662 -152 276",
      }),
    );
    expect(plan.kind).toBe("loop");
    if (plan.kind === "skip") return;
    expect(plan.position?.asArray()).toEqual([-662, 276, -152]);
    expect(plan.volume).toBe(0.5);
    expect(plan.attenuation).toBe(3);
  });

  it("plays a GLOBAL speaker everywhere", () => {
    const plan = speakerPlan(entity("target_speaker", { noise: "a.ogg", spawnflags: "5", origin: "0 0 0" }));
    expect(plan).toMatchObject({ kind: "loop", position: null });
  });

  it("repeats an untriggered speaker with a wait", () => {
    const plan = speakerPlan(entity("target_speaker", { noise: "drip.wav", wait: "4", random: "1", origin: "0 0 0" }));
    expect(plan).toMatchObject({ kind: "periodic", wait: 4, random: 1 });
  });

  it("leaves triggered, player and silent speakers to triggering", () => {
    expect(
      speakerPlan(
        entity("target_speaker", { noise: "sounds/world/dong.wav", targetname: "easteregg", spawnflags: "16" }),
      ).kind,
    ).toBe("skip");
    expect(speakerPlan(entity("target_speaker", { noise: "*falling1.wav", origin: "0 0 0" })).kind).toBe("skip");
    expect(speakerPlan(entity("target_speaker", { origin: "0 0 0" })).kind).toBe("skip");
    expect(speakerPlan(entity("target_speaker", { noise: "a.ogg", spawnflags: "3", origin: "0 0 0" })).kind).toBe(
      "skip",
    );
  });
});

describe("rotationPlan", () => {
  it("spins about the vertical axis by default, at 100 degrees a second", () => {
    const plan = rotationPlan(entity("func_rotating", { model: "*4" }));
    expect(plan.axis.asArray()).toEqual([0, 1, 0]);
    expect(plan.degreesPerSecond).toBe(-100);
    expect(plan.spinning).toBe(true);
  });

  it("takes X_AXIS, Y_AXIS, REVERSE and speed from the keys", () => {
    expect(rotationPlan(entity("func_rotating", { spawnflags: "4" })).axis.asArray()).toEqual([1, 0, 0]);
    expect(rotationPlan(entity("func_rotating", { spawnflags: "8" })).axis.asArray()).toEqual([0, 0, 1]);
    expect(rotationPlan(entity("func_rotating", { spawnflags: "2", speed: "700" })).degreesPerSecond).toBe(700);
  });

  it("stands still while it waits for a trigger, unless START_ON", () => {
    expect(rotationPlan(entity("func_rotating", { targetname: "fan" })).spinning).toBe(false);
    expect(rotationPlan(entity("func_rotating", { targetname: "fan", spawnflags: "1" })).spinning).toBe(true);
  });
});

describe("cloudLayersFromStages", () => {
  it("turns violetsky's three stages into tinted, scrolling, blended layers", () => {
    const stage = (over: Partial<Q3ShaderStage>): Q3ShaderStage => ({
      map: "textures/sky/violetsky2.blend.tga",
      ...over,
    });
    const layers = cloudLayersFromStages([
      stage({
        tcMod: [
          { type: "scale", sScale: 4, tScale: 4 },
          { type: "scroll", sSpeed: 0, tSpeed: -0.05 },
        ],
        rgbGen: { type: "const", color: [0.25, 0.25, 0.25] },
      }),
      stage({ map: "textures/sky/violetsky1.blend.tga", blendFunc: ["GL_ONE", "GL_ONE"] }),
      stage({ map: "$lightmap" }),
    ]);
    expect(layers).toEqual([
      {
        texture: "textures/sky/violetsky2.blend.tga",
        scale: [4, 4],
        scroll: [0, -0.05],
        color: [0.25, 0.25, 0.25],
        blend: "opaque",
      },
      { texture: "textures/sky/violetsky1.blend.tga", scale: [1, 1], scroll: [0, 0], color: [1, 1, 1], blend: "add" },
    ]);
  });

  it("maps filter and alpha blends", () => {
    const [, filter, alpha] = cloudLayersFromStages([
      { map: "a" },
      { map: "b", blendFunc: ["GL_DST_COLOR", "GL_ZERO"] },
      { map: "c", blendFunc: ["GL_SRC_ALPHA", "GL_ONE_MINUS_SRC_ALPHA"] },
    ]);
    expect(filter.blend).toBe("multiply");
    expect(alpha.blend).toBe("alpha");
  });
});

describe("cloudTexCoord", () => {
  it("puts straight up at the middle of the texture space, π/2 on both axes", () => {
    const [s, t] = cloudTexCoord([0, 0, 1], 2048);
    expect(s).toBeCloseTo(Math.PI / 2);
    expect(t).toBeCloseTo(Math.PI / 2);
  });

  it("moves s with x and t with y, more slowly near the zenith than at the horizon", () => {
    const near = cloudTexCoord([0.1, 0, 1], 2048)[0];
    const far = cloudTexCoord([1, 0, 0.1], 2048)[0];
    expect(near).toBeLessThan(Math.PI / 2);
    expect(far).toBeLessThan(near);
    expect(cloudTexCoord([0, 0.5, 1], 2048)[1]).toBeLessThan(Math.PI / 2);
  });
});
