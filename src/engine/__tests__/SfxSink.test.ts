import { describe, expect, it, vi } from "vitest";
import { AudioManager } from "../AudioManager";
import type { AudioV2Sfx } from "../audio/AudioV2Sfx";
import type { SfxSink } from "../audio/SfxSink";

describe("isolated sound presentation", () => {
  it("collects muted requests with their options and restores speaker routing", async () => {
    const manager = AudioManager.getInstance();
    const backend = (manager as unknown as { sfxBackend: AudioV2Sfx }).sfxBackend;
    const speaker = vi.spyOn(backend, "play2D").mockResolvedValue(true);
    const loop = { stop: vi.fn() };
    const sink: SfxSink = {
      preload: vi.fn().mockResolvedValue(undefined),
      play2D: vi.fn(),
      play3D: vi.fn(),
      playLoop3D: vi.fn().mockResolvedValue(loop),
    };
    const enabled = manager.isSfxEnabled();
    const release = manager.ownSfxSink(sink);
    try {
      manager.setSfxEnabled(false);
      await manager.preloadSfx(["fire"]);
      manager.playSfx2D("fire", 0.7, 2, "hits");
      manager.playSfx3D("impact", { x: 1, y: 2, z: 3 }, { volume: 0.4, slot: "pain" });
      expect(await manager.playLoop3D("hold", null, { pitch: 150 })).toBe(loop);
      expect(sink.preload).toHaveBeenCalledWith(["fire"], undefined);
      expect(sink.play2D).toHaveBeenCalledWith("fire", { volume: 0.7, maxInstances: 2, channel: "hits" });
      expect(sink.play3D).toHaveBeenCalledWith("impact", { x: 1, y: 2, z: 3 }, { volume: 0.4, slot: "pain" });
      expect(speaker).not.toHaveBeenCalled();
      expect(() => manager.ownSfxSink(sink)).toThrow("already has an owner");
      release();
      const releaseAgain = manager.ownSfxSink(sink);
      try {
        release();
        expect(manager.hasSfxSink).toBe(true);
      } finally {
        releaseAgain();
      }
      manager.playSfx2D("muted");
      expect(speaker).not.toHaveBeenCalled();
      manager.setSfxEnabled(true);
      manager.playSfx2D("live");
      expect(speaker).toHaveBeenCalledWith("live", expect.any(Object));
    } finally {
      release();
      manager.setSfxEnabled(enabled);
      speaker.mockRestore();
    }
  });
});
