/**
 * CinematicCameraPaths.test.ts — Unit tests for Phase 3 camera path generation
 */

import { describe, it, expect } from "vitest";
import type { HighlightCandidate } from "../DemoAnalyzer";
import { generateCameraPath, interpolatePath } from "../CinematicCameraPaths";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHighlight(overrides: Partial<HighlightCandidate> = {}): HighlightCandidate {
  return {
    startTick: 100,
    peakTick: 110,
    endTick: 150,
    score: 20,
    type: "frag",
    primaryPlayer: "player_1",
    primaryPlayerName: "Alice",
    victimPlayer: "player_2",
    victimPlayerName: "Bob",
    weaponId: "rocket_launcher",
    killCount: 1,
    tags: [],
    killerPos: { x: 0, y: 0, z: 0 },
    victimPos: { x: 200, y: 0, z: 0 },
    killerVelocity: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const SNAPSHOT_RATE = 20;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateCameraPath", () => {
  // 1. chase_hero → type 'chase', targetEntityId = highlight.primaryPlayer
  it("chase_hero returns a chase path targeting the primary player", () => {
    const h = makeHighlight({ primaryPlayer: "player_42" });
    const result = generateCameraPath("chase_hero", h, 100, 150, SNAPSHOT_RATE);
    expect(result.type).toBe("chase");
    expect(result.targetEntityId).toBe("player_42");
    expect(result.keyframes).toBeUndefined();
  });

  // 2. victim_pov → type 'chase', targetEntityId = highlight.victimPlayer
  it("victim_pov returns a chase path targeting the victim", () => {
    const h = makeHighlight({ victimPlayer: "player_99" });
    const result = generateCameraPath("victim_pov", h, 100, 150, SNAPSHOT_RATE);
    expect(result.type).toBe("chase");
    expect(result.targetEntityId).toBe("player_99");
  });

  // 3. victim_pov fallback → primaryPlayer when no victimPlayer
  it("victim_pov falls back to primaryPlayer when victimPlayer is absent", () => {
    const h = makeHighlight({ victimPlayer: undefined, primaryPlayer: "player_7" });
    const result = generateCameraPath("victim_pov", h, 100, 150, SNAPSHOT_RATE);
    expect(result.type).toBe("chase");
    expect(result.targetEntityId).toBe("player_7");
  });

  // 4. orbit_kill → freefly, has keyframes, interpolation catmull_rom
  it("orbit_kill returns a freefly path with keyframes and catmull_rom interpolation", () => {
    const h = makeHighlight({
      killerPos: { x: 0, y: 0, z: 0 },
      victimPos: { x: 300, y: 0, z: 0 },
    });
    const result = generateCameraPath("orbit_kill", h, 100, 200, SNAPSHOT_RATE);
    expect(result.type).toBe("freefly");
    expect(result.keyframes).toBeDefined();
    expect(result.keyframes!.length).toBeGreaterThan(0);
    expect(result.interpolation).toBe("catmull_rom");
  });

  // 5. orbit_kill keyframes all at same radius from midpoint (±1 tolerance)
  it("orbit_kill keyframes are all at the same radius from the midpoint", () => {
    const killerPos = { x: 0, y: 0, z: 0 };
    const victimPos = { x: 200, y: 0, z: 0 };
    const h = makeHighlight({ killerPos, victimPos });
    const result = generateCameraPath("orbit_kill", h, 100, 200, SNAPSHOT_RATE);

    const midpoint = { x: 100, y: 0, z: 0 };
    const dist = distance3d(killerPos, victimPos); // 200
    const expectedRadius = Math.max(dist * 0.8, 200); // 200
    const orbitHeight = midpoint.y + 80;

    for (const kf of result.keyframes!) {
      // Only check horizontal distance (x, z plane) from midpoint
      const dx = kf.position.x - midpoint.x;
      const dz = kf.position.z - midpoint.z;
      const r = Math.sqrt(dx * dx + dz * dz);
      expect(r).toBeCloseTo(expectedRadius, 0); // ±1 tolerance via 0 decimal places
      expect(kf.position.y).toBeCloseTo(orbitHeight, 0);
    }
  });

  // 6. replay_orbit → freefly, 9+ keyframes
  it("replay_orbit returns a freefly path with at least 9 keyframes", () => {
    const h = makeHighlight({ killerPos: { x: 0, y: 50, z: 0 } });
    const result = generateCameraPath("replay_orbit", h, 100, 300, SNAPSHOT_RATE);
    expect(result.type).toBe("freefly");
    expect(result.keyframes!.length).toBeGreaterThanOrEqual(9);
  });

  // 7. dramatic_zoom → fov decreases from first to last keyframe
  it("dramatic_zoom produces keyframes with decreasing fov", () => {
    const h = makeHighlight({
      killerPos: { x: 0, y: 0, z: 0 },
      victimPos: { x: 400, y: 0, z: 0 },
    });
    const result = generateCameraPath("dramatic_zoom", h, 100, 200, SNAPSHOT_RATE);
    expect(result.type).toBe("freefly");
    const kfs = result.keyframes!;
    expect(kfs.length).toBeGreaterThanOrEqual(3);
    const firstFov = kfs[0].fov ?? 90;
    const lastFov = kfs[kfs.length - 1].fov ?? 90;
    expect(firstFov).toBeGreaterThan(lastFov);
  });

  // 8. rocket_jump_hero → freefly, exactly 3 keyframes
  it("rocket_jump_hero returns a freefly path with exactly 3 keyframes", () => {
    const h = makeHighlight({ killerPos: { x: 0, y: 100, z: 0 } });
    const result = generateCameraPath("rocket_jump_hero", h, 100, 200, SNAPSHOT_RATE);
    expect(result.type).toBe("freefly");
    expect(result.keyframes).toHaveLength(3);
  });
});

describe("interpolatePath", () => {
  const keyframes = [
    { tick: 0, position: { x: 0, y: 0, z: 0 }, lookAt: { x: 10, y: 0, z: 0 }, fov: 90 },
    { tick: 100, position: { x: 100, y: 0, z: 0 }, lookAt: { x: 110, y: 0, z: 0 }, fov: 70 },
    { tick: 200, position: { x: 200, y: 0, z: 0 }, lookAt: { x: 210, y: 0, z: 0 }, fov: 50 },
  ];

  // 9. tick before first keyframe → returns first keyframe values
  it("returns first keyframe values when tick is before the first keyframe", () => {
    const result = interpolatePath(keyframes, -10);
    expect(result.position.x).toBeCloseTo(0);
    expect(result.fov).toBeCloseTo(90);
  });

  // 10. tick after last keyframe → returns last keyframe values
  it("returns last keyframe values when tick is after the last keyframe", () => {
    const result = interpolatePath(keyframes, 999);
    expect(result.position.x).toBeCloseTo(200);
    expect(result.fov).toBeCloseTo(50);
  });

  // 11. tick at midpoint → returns lerped values
  it("returns linearly interpolated values at the midpoint between two keyframes", () => {
    const result = interpolatePath(keyframes, 50);
    // Midpoint between tick 0 and tick 100: position.x = 50, fov = 80
    expect(result.position.x).toBeCloseTo(50);
    expect(result.fov).toBeCloseTo(80);
    expect(result.lookAt.x).toBeCloseTo(60);
  });

  // Bonus: exact keyframe tick returns exact values
  it("returns exact values when tick matches a keyframe exactly", () => {
    const result = interpolatePath(keyframes, 100);
    expect(result.position.x).toBeCloseTo(100);
    expect(result.fov).toBeCloseTo(70);
  });
});
