// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { AudioManager } from "../AudioManager";
import { Cvar } from "../core/Cvar";

beforeEach(() => {
  Cvar.init();
  Cvar.register("s_sfxvolume", 1, { type: "float", min: 0, max: 1 });
  Cvar.reset("s_sfxvolume");
  AudioManager.resetInstance();
});

describe("effects volume defaults", () => {
  it("starts and resets at full volume", () => {
    const audio = AudioManager.getInstance();
    expect(audio.getSfxVolume()).toBe(1);
    Cvar.set("s_sfxvolume", 0.4);
    expect(audio.getSfxVolume()).toBe(0.4);
    Cvar.reset("s_sfxvolume");
    expect(audio.getSfxVolume()).toBe(1);
  });

  it("applies a saved custom level and preserves the full-volume reset default", () => {
    Cvar.set("s_sfxvolume", 0.35);
    const audio = AudioManager.getInstance();
    expect(audio.getSfxVolume()).toBe(0.35);
    audio.registerCvars();
    expect(Cvar.getCvar("s_sfxvolume")?.defaultValue).toBe(1);
    Cvar.reset("s_sfxvolume");
    expect(audio.getSfxVolume()).toBe(1);
  });
});
