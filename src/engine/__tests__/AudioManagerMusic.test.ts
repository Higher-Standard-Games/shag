// @vitest-environment jsdom
/**
 * Music off and volume 0 must hold across map loads and menu returns: a saved
 * choice reaches a fresh AudioManager, and starting a playlist while music is
 * off plays nothing until music is turned back on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../AudioManager";
import { Cvar } from "../core/Cvar";

// biome-ignore lint/suspicious/noExplicitAny: reaches the private track player
const trackPlays = (audio: AudioManager) => vi.spyOn(audio as any, "playCurrentTrack").mockResolvedValue(undefined);
const playlist = { name: "game", tracks: [{ file: "a.mp3" }] };

beforeEach(() => {
  Cvar.init();
  AudioManager.resetInstance();
  AudioManager.getInstance();
  Cvar.reset("s_volume");
  Cvar.reset("s_musicenabled");
  AudioManager.resetInstance();
});

describe("music settings", () => {
  it("takes the saved volume and on/off when the cvars already hold them", () => {
    Cvar.set("s_volume", 0);
    Cvar.set("s_musicenabled", false);
    AudioManager.resetInstance();
    const audio = AudioManager.getInstance();
    expect(audio.getMusicVolume()).toBe(0);
    expect(audio.isMusicEnabled()).toBe(false);
  });

  it("plays no playlist while music is off, and starts it when music is turned on", () => {
    Cvar.set("s_musicenabled", false);
    AudioManager.resetInstance();
    const audio = AudioManager.getInstance();
    const plays = trackPlays(audio);
    audio.startPlaylist(playlist, "data/game.playlist.json");
    expect(plays).not.toHaveBeenCalled();
    Cvar.set("s_musicenabled", true);
    expect(plays).toHaveBeenCalledTimes(1);
  });

  it("plays a playlist when music is on", () => {
    const audio = AudioManager.getInstance();
    const plays = trackPlays(audio);
    audio.startPlaylist(playlist, "data/menu.playlist.json");
    expect(plays).toHaveBeenCalledTimes(1);
  });
});
