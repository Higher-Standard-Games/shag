import { describe, expect, it } from "vitest";
import {
  betterClear,
  campaignBotNames,
  campaignFinished,
  campaignMatchRules,
  campaignMission,
  lobbyCampaignInfo,
  parseCampaign,
  roomUnlockedThrough,
  unlockedThrough,
} from "../Campaign";

const SHAPES = new Map([
  ["amphi", { maxPlayers: 2, hasTeams: true }],
  ["duel", { maxPlayers: 2, hasTeams: true }],
  ["ffa", { maxPlayers: 8, hasTeams: false }],
  ["snd", { maxPlayers: 10, hasTeams: true }],
  ["tdm", { maxPlayers: 8, hasTeams: true }],
  ["survival", { maxPlayers: 8, hasTeams: true }],
]);

const SURVIVAL = {
  waves: [{ robots: 1, health: 50 }],
  waveSeconds: 60,
  seconds: 60,
  robotKits: [{ weapons: ["machinegun"] }],
};

const mission = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  map: "washoi_dm2",
  gametype: "duel",
  bots: [{ name: "Rival", difficulty: "easy" }],
  models: { ally: "robot", enemy: "cartel" },
  ...extra,
});

describe("parseCampaign", () => {
  it("refuses a key the format does not have, wherever it is", () => {
    expect(() =>
      parseCampaign(
        { missions: [mission("one", { bots: [{ name: "Rival", difficulty: "easy", slimeImune: true }] })] },
        SHAPES,
      ),
    ).toThrow("missions[0].bots[0]: unknown key slimeImune");
    expect(() => parseCampaign({ missions: [mission("one", { limit: { timeLimit: 60 } })] }, SHAPES)).toThrow(
      "missions[0]: unknown key limit",
    );
    expect(() =>
      parseCampaign(
        { missions: [mission("one", { gametype: "survival", survival: { ...SURVIVAL, wave: 1 } })] },
        SHAPES,
      ),
    ).toThrow("missions[0].survival: unknown key wave");
  });

  it("names every campaign bot, lowercased, from a file of any shape", () => {
    expect(campaignBotNames({ missions: [mission("one"), { bots: [{ name: "Siege_Bot" }, {}] }] })).toEqual(
      new Set(["rival", "siege_bot"]),
    );
    expect(campaignBotNames(null).size).toBe(0);
  });

  it("numbers missions in order, defaults bots to enemies and names maps", () => {
    const catalog = parseCampaign({ length: 8, missions: [mission("one"), mission("two")] }, SHAPES, (map) =>
      map.toUpperCase(),
    );
    expect(catalog.length).toBe(8);
    expect(catalog.missions.map((m) => [m.id, m.number, m.mapTitle])).toEqual([
      ["one", 1, "WASHOI_DM2"],
      ["two", 2, "WASHOI_DM2"],
    ]);
    expect(catalog.missions[0].bots[0].side).toBe("enemy");
  });

  it("reads the shipped campaign", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync(new URL("../../../config/campaign.json", import.meta.url), "utf8"));
    const catalog = parseCampaign(raw, SHAPES);
    expect(catalog.length).toBe(8);
    expect(catalog.missions.slice(0, 2).map((m) => [m.map, m.gametype, m.bots.length])).toEqual([
      ["washoi_amphi2", "amphi", 1],
      ["washoi_dm1", "ffa", 4],
    ]);
    // Concrete Strike: the crew attacks every round, a cartel and riotkitty mix against police
    const strike = catalog.missions[2];
    expect(strike.side).toBe("attack");
    expect(strike.models.enemy).toBe("police");
    const crew = strike.bots.filter((bot) => bot.side === "ally").map((bot) => bot.model);
    expect(new Set(crew)).toEqual(new Set(["cartel", "riotkitty"]));
    expect(strike.bots.filter((bot) => bot.side === "enemy").every((bot) => bot.model === undefined)).toBe(true);

    // Operations 5-8: survival, a boss twice a player's size, a heist, and a 1v2
    expect(catalog.missions.slice(4).map((m) => [m.map, m.gametype])).toEqual([
      ["washoi_dm18", "survival"],
      ["washoi_amphi1", "amphi"],
      ["washoi_snd6", "snd"],
      ["washoi_dm5", "tdm"],
    ]);
    const [trap, siege, heist, road] = catalog.missions.slice(4);
    expect(campaignMatchRules(trap)?.survival).toEqual({
      waves: [
        { robots: 4, health: 30 },
        { robots: 5, health: 40 },
        { robots: 6, health: 50 },
        { robots: 7, health: 50 },
      ],
      waveSeconds: 60,
      seconds: 300,
      robotKits: [{ weapons: ["machinegun"] }, { weapons: ["machinegun"], ads: false }, { weapons: ["glauncher"] }],
    });
    expect(campaignMatchRules(siege)).toEqual({
      scales: { Siege_Bot: 2.5 },
      randomKits: ["Siege_Bot"],
      spawnStats: { Siege_Bot: { health: 200, armor: 200 } },
      slimeImmune: ["Siege_Bot"],
    });
    // The boss itself is told, so it does not climb out of the slime
    expect(lobbyCampaignInfo(siege).slimeImmune).toEqual(["Siege_Bot"]);
    expect(lobbyCampaignInfo(siege).botScales).toEqual({ Siege_Bot: 2.5 });
    expect(campaignMatchRules(heist)).toEqual({ attack: true });
    expect(road.bots.map((bot) => [bot.side, bot.model])).toEqual([
      ["enemy", "police"],
      ["enemy", "female"],
    ]);
    expect(campaignMatchRules(road)).toEqual({ scoreLimit: 15, timeLimit: 600 });
    // An operation with nothing beyond its map and gametype sends no rules
    expect(campaignMatchRules(catalog.missions[0])).toBeNull();
  });

  it.each([
    ["a duplicate id", { missions: [mission("one"), mission("one")] }, "used twice"],
    ["survival without its rules", { missions: [mission("one", { gametype: "survival" })] }, "survival"],
    ["survival rules outside survival", { missions: [mission("one", { survival: SURVIVAL })] }, "survival"],
    [
      "a wave bigger than the robots",
      {
        missions: [
          mission("one", { gametype: "survival", survival: { ...SURVIVAL, waves: [{ robots: 3, health: 50 }] } }),
        ],
      },
      "biggest wave",
    ],
    [
      "an unknown robot weapon",
      {
        missions: [
          mission("one", { gametype: "survival", survival: { ...SURVIVAL, robotKits: [{ weapons: ["bfg"] }] } }),
        ],
      },
      "robotKits[0].weapons",
    ],
    [
      "no health at all",
      { missions: [mission("one", { bots: [{ name: "A1", difficulty: "easy", health: 0 }] })] },
      ".health",
    ],
    [
      "a fractional armor",
      { missions: [mission("one", { bots: [{ name: "A1", difficulty: "easy", armor: 1.5 }] })] },
      ".armor",
    ],
    [
      "an unknown kit",
      { missions: [mission("one", { bots: [{ name: "A1", difficulty: "easy", kit: "rocket" }] })] },
      ".kit",
    ],
    [
      "a scale beyond three",
      { missions: [mission("one", { bots: [{ name: "A1", difficulty: "easy", scale: 4 }] })] },
      ".scale",
    ],
    ["a bad limit", { missions: [mission("one", { limits: { scoreLimit: 0 } })] }, "scoreLimit"],
    ["an attack side outside S&D", { missions: [mission("one", { side: "attack" })] }, ".side"],
    ["an unknown side", { missions: [mission("one", { gametype: "snd", side: "defend" })] }, ".side"],
    [
      "an unknown bot model",
      { missions: [mission("one", { bots: [{ name: "A1", difficulty: "easy", model: "ninja" }] })] },
      ".model",
    ],
    ["an unknown model", { missions: [mission("one", { models: { ally: "robot", enemy: "ninja" } })] }, "models.enemy"],
    [
      "too many bots",
      {
        missions: [
          mission("one", {
            bots: [
              { name: "A1", difficulty: "easy" },
              { name: "B1", difficulty: "easy" },
            ],
          }),
        ],
      },
      "do not fit",
    ],
    [
      "an ally in FFA",
      { missions: [mission("one", { gametype: "ffa", bots: [{ name: "A1", difficulty: "easy", side: "ally" }] })] },
      "no allies",
    ],
    [
      "only allies",
      { missions: [mission("one", { gametype: "snd", bots: [{ name: "A1", difficulty: "easy", side: "ally" }] })] },
      "enemy bot",
    ],
    [
      "a bad bot name",
      { missions: [mission("one", { bots: [{ name: "Cartel King", difficulty: "easy" }] })] },
      ".name",
    ],
    [
      "a bad difficulty",
      { missions: [mission("one", { bots: [{ name: "A1", difficulty: "brutal" }] })] },
      "difficulty",
    ],
    ["a length below the missions", { length: 0, missions: [mission("one")] }, "length"],
  ])("refuses %s", (_what, raw, message) => {
    expect(() => parseCampaign(raw, SHAPES)).toThrow(message);
  });
});

describe("unlocks", () => {
  const catalog = parseCampaign({ length: 8, missions: [mission("one"), mission("two"), mission("three")] }, SHAPES);

  it("opens the first mission, and each one after a clear", () => {
    expect(unlockedThrough(catalog, [])).toBe(1);
    expect(unlockedThrough(catalog, [{ missionId: "one" }])).toBe(2);
    expect(unlockedThrough(catalog, [{ missionId: "one" }, { missionId: "two" }])).toBe(3);
    expect(unlockedThrough(catalog, [{ missionId: "one" }, { missionId: "two" }, { missionId: "three" }])).toBe(3);
  });

  it("does not skip ahead on a clear out of order or of a removed mission", () => {
    expect(unlockedThrough(catalog, [{ missionId: "two" }])).toBe(1);
    expect(unlockedThrough(catalog, [{ missionId: "gone" }])).toBe(1);
  });

  it("lets a room play the lowest of its members' progress", () => {
    expect(roomUnlockedThrough([3, 1, 2])).toBe(1);
    expect(roomUnlockedThrough([])).toBe(0);
  });

  it("finds missions by id only", () => {
    expect(campaignMission(catalog, "two")?.number).toBe(2);
    expect(campaignMission(catalog, 2)).toBeUndefined();
  });

  it("keeps the fastest time and the most frags", () => {
    expect(betterClear(null, { timeMs: 500, frags: 3 })).toEqual({ bestTimeMs: 500, bestFrags: 3 });
    expect(betterClear({ bestTimeMs: 400, bestFrags: 2 }, { timeMs: 500, frags: 3 })).toEqual({
      bestTimeMs: 400,
      bestFrags: 3,
    });
  });

  it("finishes the campaign only when every mission of its full length is written and cleared", () => {
    const all = [{ missionId: "one" }, { missionId: "two" }, { missionId: "three" }];
    expect(campaignFinished(catalog, all)).toBe(false); // 3 of 8 written
    const complete = parseCampaign({ length: 3, missions: [mission("one"), mission("two"), mission("three")] }, SHAPES);
    expect(campaignFinished(complete, all.slice(0, 2))).toBe(false);
    expect(campaignFinished(complete, all)).toBe(true);
  });

  it("tells clients each bot that has a model of its own", () => {
    const crew = parseCampaign(
      {
        missions: [
          mission("one", {
            gametype: "snd",
            side: "attack",
            bots: [
              { name: "Ratchet", difficulty: "easy", side: "ally", model: "cartel" },
              { name: "Kade", difficulty: "easy" },
            ],
          }),
        ],
      },
      SHAPES,
    ).missions[0];
    expect(lobbyCampaignInfo(crew)).toEqual({
      missionId: "one",
      models: { ally: "robot", enemy: "cartel" },
      botModels: { Ratchet: "cartel" },
    });
    expect(lobbyCampaignInfo(catalog.missions[0]).botModels).toBeUndefined();
  });
});
