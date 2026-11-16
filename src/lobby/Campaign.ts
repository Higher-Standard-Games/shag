/**
 * Campaign rules: the missions in `config/campaign.json`, in order, and which
 * of them an account or a room may play.
 *
 * The lobby owns these rules. The game client draws the story and art for each
 * mission by its id, and receives the rules with `campaign:state`.
 */

import { BOT_ACCOUNT_PRESETS, type BotPreset } from "../shared/ranking/BotMatchRatingGroups";
import { NAME_PATTERN } from "./PlayerIdentity";
import type {
  CampaignBotInfo,
  CampaignClear,
  CampaignMatchRules,
  CampaignMissionInfo,
  CampaignModels,
  CampaignRobotKit,
  CampaignSurvivalRules,
  CampaignSurvivalWave,
  LobbyCampaignInfo,
} from "./types";

/** The models a campaign may force; the ones every client ships. */
const CAMPAIGN_MODELS = ["police", "female", "cartel", "riotkitty", "robot"] as const;
/**
 * Gametypes a mission may use: the lobby's four, and two the campaign alone
 * plays (a team deathmatch, and survival), which no Play page offers.
 */
const CAMPAIGN_GAMETYPES = ["duel", "amphi", "ffa", "snd", "tdm", "survival"] as const;
/** The campaign-only gametypes: no rating pool, so their matches clear progress without being rated. */
export const UNRATED_CAMPAIGN_GAMETYPES: readonly string[] = ["tdm", "survival"];
const MAX_BOT_SCALE = 3;
/** The most health or armor a campaign bot may spawn with. */
const MAX_BOT_STAT = 500;
/** Robot weapons a survival mission may hand out. */
const SURVIVAL_WEAPONS = [
  "blade",
  "machinegun",
  "riotgun",
  "plasmagun",
  "glauncher",
  "rlauncher",
  "electrobolt",
  "voltaic",
];
const MISSION_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export interface CampaignCatalog {
  /** Missions the campaign has in all, written or not. */
  length: number;
  /** The written missions, numbered from 1 in play order. */
  missions: CampaignMissionInfo[];
}

export const EMPTY_CAMPAIGN: CampaignCatalog = { length: 0, missions: [] };

function fail(message: string): never {
  throw new Error(`campaign.json: ${message}`);
}

/** Refuse a key the file format does not have: a misspelt rule would otherwise do nothing, silently. */
function knownKeys(value: object, keys: readonly string[], where: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) fail(`${where}: unknown ${unknown.length > 1 ? "keys" : "key"} ${unknown.join(", ")}`);
}

function parseModels(value: unknown, where: string): CampaignModels {
  const models = value as Partial<CampaignModels> | null;
  if (!models || typeof models !== "object") fail(`${where}: models must be an object`);
  knownKeys(models, ["ally", "enemy"], `${where}.models`);
  for (const side of ["ally", "enemy"] as const) {
    if (!CAMPAIGN_MODELS.includes(models[side] as (typeof CAMPAIGN_MODELS)[number]))
      fail(`${where}: models.${side} must be one of ${CAMPAIGN_MODELS.join(", ")}`);
  }
  return { ally: models.ally as string, enemy: models.enemy as string };
}

function parseBot(value: unknown, where: string, hasTeams: boolean): CampaignBotInfo {
  const bot = value as Partial<CampaignBotInfo> | null;
  if (!bot || typeof bot !== "object") fail(`${where} must be an object`);
  knownKeys(bot, ["name", "difficulty", "side", "model", "scale", "kit", "health", "armor", "slimeImmune"], where);
  // The same names a player may pick, so every list and scoreboard can show them
  if (typeof bot.name !== "string" || !NAME_PATTERN.test(bot.name))
    fail(`${where}.name must be 2-16 letters, digits, _ or -`);
  if (!BOT_ACCOUNT_PRESETS.includes(bot.difficulty as BotPreset))
    fail(`${where}.difficulty must be one of ${BOT_ACCOUNT_PRESETS.join(", ")}`);
  const side = bot.side ?? "enemy";
  if (side !== "ally" && side !== "enemy") fail(`${where}.side must be ally or enemy`);
  if (!hasTeams && side === "ally") fail(`${where}: a free-for-all has no allies`);
  if (bot.model !== undefined && !CAMPAIGN_MODELS.includes(bot.model as (typeof CAMPAIGN_MODELS)[number]))
    fail(`${where}.model must be one of ${CAMPAIGN_MODELS.join(", ")}`);
  if (bot.scale !== undefined && !(typeof bot.scale === "number" && bot.scale >= 1 && bot.scale <= MAX_BOT_SCALE))
    fail(`${where}.scale must be a number from 1 to ${MAX_BOT_SCALE}`);
  if (bot.kit !== undefined && bot.kit !== "random") fail(`${where}.kit must be "random"`);
  if (bot.slimeImmune !== undefined && typeof bot.slimeImmune !== "boolean")
    fail(`${where}.slimeImmune must be true or false`);
  if (bot.health !== undefined && !positiveInteger(bot.health, MAX_BOT_STAT))
    fail(`${where}.health must be a whole number from 1 to ${MAX_BOT_STAT}`);
  if (bot.armor !== undefined && !(bot.armor === 0 || positiveInteger(bot.armor, MAX_BOT_STAT)))
    fail(`${where}.armor must be a whole number from 0 to ${MAX_BOT_STAT}`);
  return {
    name: bot.name,
    difficulty: bot.difficulty as string,
    side,
    ...(bot.model ? { model: bot.model } : {}),
    ...(bot.scale !== undefined && bot.scale !== 1 ? { scale: bot.scale } : {}),
    ...(bot.kit ? { kit: bot.kit } : {}),
    ...(bot.health !== undefined ? { health: bot.health } : {}),
    ...(bot.armor !== undefined ? { armor: bot.armor } : {}),
    ...(bot.slimeImmune ? { slimeImmune: true } : {}),
  };
}

const positiveInteger = (value: unknown, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max;

function parseLimits(value: unknown, where: string): { scoreLimit?: number; timeLimit?: number } | undefined {
  if (value === undefined) return undefined;
  const limits = value as Record<string, unknown> | null;
  if (!limits || typeof limits !== "object") fail(`${where}.limits must be an object`);
  knownKeys(limits, ["scoreLimit", "timeLimit"], `${where}.limits`);
  if (limits.scoreLimit !== undefined && !positiveInteger(limits.scoreLimit, 500))
    fail(`${where}.limits.scoreLimit must be a whole number from 1`);
  if (limits.timeLimit !== undefined && !positiveInteger(limits.timeLimit, 3600))
    fail(`${where}.limits.timeLimit must be whole seconds from 1`);
  return {
    ...(limits.scoreLimit !== undefined ? { scoreLimit: limits.scoreLimit as number } : {}),
    ...(limits.timeLimit !== undefined ? { timeLimit: limits.timeLimit as number } : {}),
  };
}

function parseSurvival(value: unknown, where: string, enemies: number): CampaignSurvivalRules {
  const survival = value as Record<string, unknown> | null;
  if (!survival || typeof survival !== "object") fail(`${where}.survival must be an object`);
  knownKeys(survival, ["waves", "waveSeconds", "seconds", "robotKits", "lives"], `${where}.survival`);
  const waves = survival.waves;
  if (
    !Array.isArray(waves) ||
    waves.length === 0 ||
    !waves.every(
      (wave) =>
        wave &&
        typeof wave === "object" &&
        positiveInteger(wave.robots, 16) &&
        positiveInteger(wave.health, MAX_BOT_STAT),
    )
  )
    fail(`${where}.survival.waves must list each wave's robots and health, as whole numbers from 1`);
  for (const [i, wave] of waves.entries()) knownKeys(wave, ["robots", "health"], `${where}.survival.waves[${i}]`);
  if (Math.max(...(waves as CampaignSurvivalWave[]).map((wave) => wave.robots)) > enemies)
    fail(`${where}.survival.waves needs as many enemy bots as its biggest wave`);
  for (const key of ["waveSeconds", "seconds"] as const) {
    if (!positiveInteger(survival[key], 3600)) fail(`${where}.survival.${key} must be a whole number from 1`);
  }
  if (survival.lives !== undefined && !positiveInteger(survival.lives, 9))
    fail(`${where}.survival.lives must be a whole number from 1 to 9`);
  const kits = survival.robotKits;
  if (!Array.isArray(kits) || kits.length === 0) fail(`${where}.survival.robotKits must list at least one kit`);
  const robotKits = (kits as unknown[]).map((value, i): CampaignRobotKit => {
    const kit = value as Partial<CampaignRobotKit> | null;
    const at = `${where}.survival.robotKits[${i}]`;
    if (
      !kit ||
      !Array.isArray(kit.weapons) ||
      kit.weapons.length === 0 ||
      !kit.weapons.every((w) => typeof w === "string" && SURVIVAL_WEAPONS.includes(w))
    )
      fail(`${at}.weapons must list weapons from ${SURVIVAL_WEAPONS.join(", ")}`);
    knownKeys(kit, ["weapons", "ads"], at);
    if (kit.ads !== undefined && typeof kit.ads !== "boolean") fail(`${at}.ads must be true or false`);
    return { weapons: [...kit.weapons], ...(kit.ads === false ? { ads: false } : {}) };
  });
  return {
    waves: (waves as CampaignSurvivalWave[]).map(({ robots, health }) => ({ robots, health })),
    waveSeconds: survival.waveSeconds as number,
    seconds: survival.seconds as number,
    robotKits,
    ...(survival.lives !== undefined ? { lives: survival.lives as number } : {}),
  };
}

/**
 * Check a parsed `campaign.json`. `gametypes` gives each gametype's seats and
 * whether it has sides; a mission must fit its bots and one human.
 */
export function parseCampaign(
  raw: unknown,
  gametypes: ReadonlyMap<string, { maxPlayers: number; hasTeams: boolean }>,
  mapTitle: (map: string) => string = (map) => map,
): CampaignCatalog {
  const file = raw as { length?: unknown; missions?: unknown } | null;
  if (!file || typeof file !== "object") fail("must be an object");
  knownKeys(file, ["length", "missions"], "the file");
  if (!Array.isArray(file.missions)) fail("missions must be an array");
  const length = file.length ?? file.missions.length;
  if (!Number.isInteger(length) || (length as number) < file.missions.length || (length as number) > 64)
    fail("length must be a whole number of missions, at least as many as are written");
  const ids = new Set<string>();
  const missions = file.missions.map((value, index): CampaignMissionInfo => {
    const where = `missions[${index}]`;
    const mission = value as Record<string, unknown> | null;
    if (!mission || typeof mission !== "object") fail(`${where} must be an object`);
    knownKeys(mission, ["id", "map", "gametype", "bots", "models", "side", "limits", "survival"], where);
    const id = mission.id;
    if (typeof id !== "string" || !MISSION_ID.test(id)) fail(`${where}.id must be lowercase letters, digits and -`);
    if (ids.has(id)) fail(`${where}.id ${id} is used twice`);
    ids.add(id);
    const gametype = mission.gametype as string;
    if (!CAMPAIGN_GAMETYPES.includes(gametype as (typeof CAMPAIGN_GAMETYPES)[number]))
      fail(`${where}.gametype must be one of ${CAMPAIGN_GAMETYPES.join(", ")}`);
    const shape = gametypes.get(gametype);
    if (!shape) fail(`${where}: the lobby does not run ${gametype}`);
    if (typeof mission.map !== "string" || !/^[a-z0-9_]+$/.test(mission.map)) fail(`${where}.map must be a map name`);
    if (!Array.isArray(mission.bots) || mission.bots.length === 0) fail(`${where}.bots must list at least one bot`);
    const bots = mission.bots.map((bot, at) => parseBot(bot, `${where}.bots[${at}]`, shape.hasTeams));
    if (!bots.some((bot) => bot.side === "enemy")) fail(`${where} needs at least one enemy bot`);
    if (bots.length + 1 > shape.maxPlayers) fail(`${where}: ${bots.length} bots and a player do not fit ${gametype}`);
    const names = new Set(bots.map((bot) => bot.name.toLowerCase()));
    if (names.size !== bots.length) fail(`${where}: two bots share a name`);
    if (mission.side !== undefined && (mission.side !== "attack" || gametype !== "snd"))
      fail(`${where}.side may only be "attack", in snd`);
    const limits = parseLimits(mission.limits, where);
    if ((gametype === "survival") !== (mission.survival !== undefined))
      fail(`${where}: a survival mission needs survival rules, and only it may have them`);
    const survival =
      mission.survival === undefined
        ? undefined
        : parseSurvival(mission.survival, where, bots.filter((bot) => bot.side === "enemy").length);
    return {
      id,
      number: index + 1,
      map: mission.map,
      mapTitle: mapTitle(mission.map),
      gametype,
      bots,
      models: parseModels(mission.models, where),
      ...(mission.side === "attack" ? { side: "attack" as const } : {}),
      ...(limits ? { limits } : {}),
      ...(survival ? { survival } : {}),
    };
  });
  return { length: length as number, missions };
}

/**
 * The highest mission number an account may play: the first mission, and each
 * one after a cleared mission. Clears of missions no longer in the catalog do
 * not count.
 */
export function unlockedThrough(catalog: CampaignCatalog, clears: readonly Pick<CampaignClear, "missionId">[]): number {
  if (catalog.missions.length === 0) return 0;
  const cleared = new Set(clears.map((clear) => clear.missionId));
  let through = 1;
  for (const mission of catalog.missions) {
    if (!cleared.has(mission.id)) break;
    through = Math.min(mission.number + 1, catalog.missions.length);
  }
  return through;
}

/**
 * Whether these clears finish the campaign: every one of its `length`
 * missions written and cleared. A campaign still being written cannot be
 * finished.
 */
export function campaignFinished(
  catalog: CampaignCatalog,
  clears: readonly Pick<CampaignClear, "missionId">[],
): boolean {
  if (catalog.missions.length === 0 || catalog.missions.length < catalog.length) return false;
  const cleared = new Set(clears.map((clear) => clear.missionId));
  return catalog.missions.every((mission) => cleared.has(mission.id));
}

/** A room may play only what every human in it has unlocked: the lowest of theirs. */
export function roomUnlockedThrough(perMember: readonly number[]): number {
  return perMember.length === 0 ? 0 : Math.min(...perMember);
}

/** What a campaign room and its match tell clients: the mission and how to draw everyone. */
export function lobbyCampaignInfo(mission: CampaignMissionInfo): LobbyCampaignInfo {
  const botModels = Object.fromEntries(mission.bots.flatMap((bot) => (bot.model ? [[bot.name, bot.model]] : [])));
  const botScales = Object.fromEntries(mission.bots.flatMap((bot) => (bot.scale ? [[bot.name, bot.scale]] : [])));
  const slimeImmune = slimeImmuneBots(mission);
  return {
    missionId: mission.id,
    models: mission.models,
    ...(Object.keys(botModels).length ? { botModels } : {}),
    ...(Object.keys(botScales).length ? { botScales } : {}),
    ...(slimeImmune.length ? { slimeImmune } : {}),
  };
}

/**
 * Every bot name a campaign file's missions use, lowercased. No account may
 * take one (a campaign gives its bots their looks and size by name), and the
 * bot tools tell these bots from people by it. Reads the file's shape loosely:
 * a file the lobby would refuse still reserves the names it lists.
 */
export function campaignBotNames(raw: unknown): Set<string> {
  const names = new Set<string>();
  const missions = (raw as { missions?: unknown } | null)?.missions;
  if (!Array.isArray(missions)) return names;
  for (const mission of missions) {
    const bots = (mission as { bots?: unknown } | null)?.bots;
    if (!Array.isArray(bots)) continue;
    for (const bot of bots) {
      const name = (bot as { name?: unknown } | null)?.name;
      if (typeof name === "string") names.add(name.toLowerCase());
    }
  }
  return names;
}

/** The names of a mission's bots slime and lava do not hurt. */
function slimeImmuneBots(mission: CampaignMissionInfo): string[] {
  return mission.bots.filter((bot) => bot.slimeImmune).map((bot) => bot.name);
}

/** What a campaign match's game server needs beyond its map and gametype; null when nothing. */
export function campaignMatchRules(mission: CampaignMissionInfo): CampaignMatchRules | null {
  const scales = Object.fromEntries(mission.bots.flatMap((bot) => (bot.scale ? [[bot.name, bot.scale]] : [])));
  const randomKits = mission.bots.filter((bot) => bot.kit === "random").map((bot) => bot.name);
  const spawnStats = Object.fromEntries(
    mission.bots.flatMap((bot) =>
      bot.health !== undefined || bot.armor !== undefined
        ? [
            [
              bot.name,
              {
                ...(bot.health !== undefined ? { health: bot.health } : {}),
                ...(bot.armor !== undefined ? { armor: bot.armor } : {}),
              },
            ],
          ]
        : [],
    ),
  );
  const rules: CampaignMatchRules = {
    ...(mission.side === "attack" ? { attack: true } : {}),
    ...(mission.limits ?? {}),
    ...(mission.survival ? { survival: mission.survival } : {}),
    ...(Object.keys(scales).length ? { scales } : {}),
    ...(randomKits.length ? { randomKits } : {}),
    ...(Object.keys(spawnStats).length ? { spawnStats } : {}),
    ...(slimeImmuneBots(mission).length ? { slimeImmune: slimeImmuneBots(mission) } : {}),
  };
  return Object.keys(rules).length ? rules : null;
}

export function campaignMission(catalog: CampaignCatalog, id: unknown): CampaignMissionInfo | undefined {
  return typeof id === "string" ? catalog.missions.find((mission) => mission.id === id) : undefined;
}

/** Keep the better of two clears of the same mission: faster, then more frags. */
export function betterClear(
  previous: Pick<CampaignClear, "bestTimeMs" | "bestFrags"> | null,
  next: { timeMs: number; frags: number },
): { bestTimeMs: number; bestFrags: number } {
  if (!previous) return { bestTimeMs: next.timeMs, bestFrags: next.frags };
  return {
    bestTimeMs: Math.min(previous.bestTimeMs, next.timeMs),
    bestFrags: Math.max(previous.bestFrags, next.frags),
  };
}
