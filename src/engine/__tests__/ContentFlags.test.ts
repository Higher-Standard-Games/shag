/**
 * ContentFlags — BSP collision flag tests
 *
 * Verifies isPlayerSolid, isSolid, isLiquid with various
 * flag combinations. If these break, players walk through walls.
 */

import { describe, expect, it } from "vitest";
import { CollisionMasks, ContentFlags, isLiquid, isPlayerSolid, isSolid, SurfaceFlags } from "../physics/ContentFlags";

describe("ContentFlags", () => {
  describe("isPlayerSolid", () => {
    it("should return true for SOLID", () => {
      expect(isPlayerSolid(ContentFlags.SOLID)).toBe(true);
    });

    it("should return true for PLAYERCLIP", () => {
      expect(isPlayerSolid(ContentFlags.PLAYERCLIP)).toBe(true);
    });

    it("should return true for SOLID | PLAYERCLIP", () => {
      expect(isPlayerSolid(ContentFlags.SOLID | ContentFlags.PLAYERCLIP)).toBe(true);
    });

    it("should return false for DETAIL (never solid)", () => {
      expect(isPlayerSolid(ContentFlags.DETAIL)).toBe(false);
    });

    it("should return false for DETAIL | SOLID", () => {
      // DETAIL overrides SOLID — this is Q3 behavior
      expect(isPlayerSolid(ContentFlags.DETAIL | ContentFlags.SOLID)).toBe(false);
    });

    it("should return false for WATER", () => {
      expect(isPlayerSolid(ContentFlags.WATER)).toBe(false);
    });

    it("should return false for TRIGGER", () => {
      expect(isPlayerSolid(ContentFlags.TRIGGER)).toBe(false);
    });

    it("should return false for zero flags", () => {
      expect(isPlayerSolid(0)).toBe(false);
    });

    it("should return false for MONSTERCLIP (only blocks NPCs)", () => {
      expect(isPlayerSolid(ContentFlags.MONSTERCLIP)).toBe(false);
    });
  });

  describe("isSolid", () => {
    it("should return true for SOLID", () => {
      expect(isSolid(ContentFlags.SOLID)).toBe(true);
    });

    it("should return false for PLAYERCLIP (player-blocking only)", () => {
      expect(isSolid(ContentFlags.PLAYERCLIP)).toBe(false);
    });

    it("should return false for DETAIL", () => {
      expect(isSolid(ContentFlags.DETAIL | ContentFlags.SOLID)).toBe(false);
    });
  });

  describe("isLiquid", () => {
    it("should return true for WATER", () => {
      expect(isLiquid(ContentFlags.WATER)).toBe(true);
    });

    it("should return true for LAVA", () => {
      expect(isLiquid(ContentFlags.LAVA)).toBe(true);
    });

    it("should return true for SLIME", () => {
      expect(isLiquid(ContentFlags.SLIME)).toBe(true);
    });

    it("should return true for WATER | LAVA", () => {
      expect(isLiquid(ContentFlags.WATER | ContentFlags.LAVA)).toBe(true);
    });

    it("should return false for SOLID", () => {
      expect(isLiquid(ContentFlags.SOLID)).toBe(false);
    });

    it("should return false for zero flags", () => {
      expect(isLiquid(0)).toBe(false);
    });
  });

  describe("CollisionMasks", () => {
    it("PLAYERSOLID should include SOLID and PLAYERCLIP", () => {
      expect(CollisionMasks.PLAYERSOLID & ContentFlags.SOLID).toBeTruthy();
      expect(CollisionMasks.PLAYERSOLID & ContentFlags.PLAYERCLIP).toBeTruthy();
    });

    it("SHOT should only include SOLID (not PLAYERCLIP)", () => {
      expect(CollisionMasks.SHOT & ContentFlags.SOLID).toBeTruthy();
      expect(CollisionMasks.SHOT & ContentFlags.PLAYERCLIP).toBe(0);
    });

    it("WATER mask should include all liquid types", () => {
      expect(CollisionMasks.WATER & ContentFlags.WATER).toBeTruthy();
      expect(CollisionMasks.WATER & ContentFlags.LAVA).toBeTruthy();
      expect(CollisionMasks.WATER & ContentFlags.SLIME).toBeTruthy();
    });
  });

  describe("SurfaceFlags", () => {
    it("should have expected values for common flags", () => {
      expect(SurfaceFlags.SLICK).toBe(0x2);
      expect(SurfaceFlags.SKY).toBe(0x4);
      expect(SurfaceFlags.NODRAW).toBe(0x80);
      expect(SurfaceFlags.METALSTEPS).toBe(0x1000);
    });

    it("should support bitwise OR for combinations", () => {
      const flags = SurfaceFlags.SLICK | SurfaceFlags.NOMARKS;
      expect(flags & SurfaceFlags.SLICK).toBeTruthy();
      expect(flags & SurfaceFlags.NOMARKS).toBeTruthy();
      expect(flags & SurfaceFlags.SKY).toBe(0);
    });
  });
});
