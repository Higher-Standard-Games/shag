/**
 * SpawnPointTable — the shared spawn extractor.
 *
 * The bug this exists to fix: the spawn classname list was duplicated in three
 * files and every copy listed only the Quake conventions, so Warsow's
 * `team_CTF_alphaspawn` / `team_CTF_betaspawn` matched nothing. Every team spawn
 * on every CTF and bomb map was invisible — 4 to 16 points per team across six
 * bomb maps — and team modes silently fell back to the untagged pool.
 */

import { describe, expect, it } from "vitest";
import {
  extractSpawnFacings,
  extractSpawnPoints,
  extractTeamSpawnPoints,
  hasTeamSpawns,
  PLAYER_ORIGIN_HEIGHT,
  SPAWN_CLASSNAMES,
  SPAWN_FACING_RADIUS,
  spawnFacingNear,
  TEAM_SPAWN_CLASSNAMES,
} from "../SpawnPointTable";
import { q3AngleToGameYaw } from "../TriggerTable";

type Ent = { classname: string; properties: Record<string, string> };
const ent = (classname: string, origin?: string): Ent => ({
  classname,
  properties: origin ? { origin } : {},
});

describe("extractSpawnPoints", () => {
  it("applies the Q3 to engine swap and lifts to player-origin height", () => {
    // BSP spawns sit at FEET level; player physics uses the origin 24 above.
    const [p] = extractSpawnPoints([ent("info_player_deathmatch", "100 200 16")]);
    expect(p).toEqual({ x: 100, y: 16 + PLAYER_ORIGIN_HEIGHT, z: 200 });
  });

  it("accepts every untagged classname", () => {
    const entities = SPAWN_CLASSNAMES.map((c, i) => ent(c, `${i} 0 0`));
    expect(extractSpawnPoints(entities)).toHaveLength(SPAWN_CLASSNAMES.length);
  });

  it("includes team-tagged spawns in the general pool", () => {
    // A team map's spawns are real locations; a non-team gametype on that map
    // should use them rather than fall back to hardcoded defaults.
    const out = extractSpawnPoints([ent("team_CTF_alphaspawn", "0 0 0"), ent("team_CTF_betaspawn", "100 0 0")]);
    expect(out).toHaveLength(2);
  });

  it("ignores non-spawn entities and malformed origins", () => {
    const out = extractSpawnPoints([
      ent("worldspawn"),
      ent("item_quad", "0 0 0"),
      ent("info_player_deathmatch"), // no origin
      ent("info_player_deathmatch", "nope nope nope"),
      ent("info_player_deathmatch", "1 2"), // too few components
      ent("info_player_deathmatch", "1 2 3"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("preserves BSP order, so selection is reproducible", () => {
    const out = extractSpawnPoints([
      ent("info_player_deathmatch", "1 0 0"),
      ent("info_player_deathmatch", "2 0 0"),
      ent("info_player_deathmatch", "3 0 0"),
    ]);
    expect(out.map((p) => p.x)).toEqual([1, 2, 3]);
  });
});

describe("extractTeamSpawnPoints", () => {
  it("maps Warsow alpha/beta onto the engine team ids", () => {
    const byTeam = extractTeamSpawnPoints([
      ent("team_CTF_alphaspawn", "0 0 0"),
      ent("team_CTF_alphaspawn", "10 0 0"),
      ent("team_CTF_betaspawn", "500 0 0"),
    ]);
    expect(byTeam.get("udon")).toHaveLength(2);
    expect(byTeam.get("soba")).toHaveLength(1);
    expect(TEAM_SPAWN_CLASSNAMES.team_CTF_alphaspawn).toBe("udon");
    expect(TEAM_SPAWN_CLASSNAMES.team_CTF_betaspawn).toBe("soba");
  });

  it("returns an empty map for a BSP with no team spawns", () => {
    expect(extractTeamSpawnPoints([ent("info_player_deathmatch", "0 0 0")]).size).toBe(0);
  });

  it("does not include untagged spawns under any team", () => {
    const byTeam = extractTeamSpawnPoints([
      ent("info_player_deathmatch", "0 0 0"),
      ent("team_CTF_alphaspawn", "1 0 0"),
    ]);
    expect(byTeam.get("udon")).toHaveLength(1);
    expect(byTeam.get("soba")).toBeUndefined();
  });

  it("applies the same coordinate convention as the general pool", () => {
    const byTeam = extractTeamSpawnPoints([ent("team_CTF_betaspawn", "7 8 9")]);
    expect(byTeam.get("soba")?.[0]).toEqual({ x: 7, y: 9 + PLAYER_ORIGIN_HEIGHT, z: 8 });
  });
});

describe("hasTeamSpawns", () => {
  it("requires BOTH teams to have points", () => {
    const alpha = ent("team_CTF_alphaspawn", "0 0 0");
    const beta = ent("team_CTF_betaspawn", "1 0 0");
    expect(hasTeamSpawns([alpha, beta])).toBe(true);
    // One-sided is not usable: the other team would have nowhere to go.
    expect(hasTeamSpawns([alpha])).toBe(false);
    expect(hasTeamSpawns([beta])).toBe(false);
    expect(hasTeamSpawns([ent("info_player_deathmatch", "0 0 0")])).toBe(false);
  });
});

describe("spawn facings", () => {
  const facing = (classname: string, origin: string, properties: Record<string, string> = {}) => ({
    classname,
    properties: { origin, ...properties },
  });

  it("reads the authored yaw from angle, or from the yaw of angles", () => {
    const facings = extractSpawnFacings([
      facing("info_player_deathmatch", "0 0 0", { angle: "90" }),
      facing("team_CTF_alphaspawn", "100 0 0", { angles: "0 180 0" }),
      facing("info_player_start", "200 0 0"),
      facing("weapon_rocketlauncher", "300 0 0", { angle: "45" }),
    ]);
    expect(facings.map((f) => f.yaw)).toEqual([q3AngleToGameYaw(90), q3AngleToGameYaw(180), q3AngleToGameYaw(0)]);
    // Same positions the server spawns at
    expect(facings[1].position).toEqual({ x: 100, y: PLAYER_ORIGIN_HEIGHT, z: 0 });
  });

  it("faces a player placed anywhere the spawn jitter can put them, and nowhere else", () => {
    const facings = extractSpawnFacings([
      facing("info_player_deathmatch", "0 0 0", { angle: "90" }),
      facing("info_player_deathmatch", "512 0 0", { angle: "270" }),
    ]);
    const at = (x: number, z: number, y = PLAYER_ORIGIN_HEIGHT) => spawnFacingNear(facings, { x, y, z });
    // Jitter moves up to 24 units on each axis: 34 diagonally
    expect(at(24, 24)).toBe(q3AngleToGameYaw(90));
    expect(at(500, -10)).toBe(q3AngleToGameYaw(270));
    expect(at(SPAWN_FACING_RADIUS + 1, 0)).toBeNull();
    expect(at(0, 0, PLAYER_ORIGIN_HEIGHT + 200)).toBeNull();
  });
});
