/**
 * Effects age by the presentation clock a demo hands in (NullEngine).
 *
 * A reel's slow motion slows the lightning beam's updates too; aged on the
 * wall clock, the beam faded out between them and barely showed.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getHitscanEffects } from "../HitscanEffects";

afterEach(() => {
  getHitscanEffects().setPresentationClock(null);
  vi.restoreAllMocks();
});

describe("hitscan presentation clock", () => {
  it("keeps a remote lightning beam while the demo clock has not moved on, whatever the wall clock does", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = new Scene(new NullEngine());
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    const effects = getHitscanEffects();
    effects.init(scene);
    const counts = () =>
      (
        effects as unknown as { voltaicRenderer: { getDebugCounts(): { remote: number } } }
      ).voltaicRenderer.getDebugCounts().remote;

    let demoSeconds = 100;
    effects.setPresentationClock(() => demoSeconds);
    let wall = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wall);
    effects.updateRemoteLightningBeam("player_1", {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, 0, 1),
      endpoint: new Vector3(0, 0, 500),
      color: Color3.White(),
      impactKind: "none",
    });

    // A second of real time at 0.05× speed is 50 ms of demo: still lit
    wall = 1000;
    demoSeconds += 0.05;
    effects.update(1);
    expect(counts()).toBe(1);

    // Past the beam's own life in demo time, it goes
    demoSeconds += 0.3;
    effects.update(0.016);
    expect(counts()).toBe(0);

    scene.getEngine().dispose();
  });

  it("clears what is on screen when the clock changes", () => {
    const clear = vi.spyOn(getHitscanEffects(), "clear");
    const clock = () => 1;
    getHitscanEffects().setPresentationClock(clock);
    getHitscanEffects().setPresentationClock(clock);
    getHitscanEffects().setPresentationClock(null);
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
