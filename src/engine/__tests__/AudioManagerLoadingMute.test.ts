// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { AudioManager } from "../AudioManager";
import { Cvar } from "../core/Cvar";

afterEach(() => vi.restoreAllMocks());

it("restores only after the last loading mute, preserving disabled SFX and music settings", () => {
  AudioManager.resetInstance();
  const audio = AudioManager.getInstance();
  Cvar.set("s_sfxvolume", 0.37);
  Cvar.set("s_sfxenabled", false);
  Cvar.set("s_volume", 0.23);
  const backend = (audio as unknown as { sfxBackend: { setMuted(muted: boolean): void } }).sfxBackend;
  const mute = vi.spyOn(backend, "setMuted");
  const releaseA = audio.muteSfx();
  const releaseB = audio.muteSfx();
  releaseA();
  releaseA();
  expect(mute.mock.calls).toEqual([[true], [true]]);
  releaseB();
  expect(mute.mock.calls).toEqual([[true], [true], [false]]);
  expect(audio.getSfxVolume()).toBe(0.37);
  expect(audio.isSfxEnabled()).toBe(false);
  expect(audio.getMusicVolume()).toBe(0.23);
  expect(Cvar.getNumber("s_sfxvolume")).toBe(0.37);
  expect(Cvar.getBool("s_sfxenabled")).toBe(false);
});
