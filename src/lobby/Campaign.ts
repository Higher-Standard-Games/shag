/**
 * Campaign rules: the missions in `config/campaign.json`, in order, and which
 * of them an account or a room may play.
 *
 * The lobby owns these rules. The game client draws the story and art for each
 * mission by its id, and receives the rules with `campaign:state`.
 */

import { BOT_ACCOUNT_PRESETS, type BotPreset } from "../shared/ranking/BotMatchRatingGroups";
import { NAME_PATTERN } from "./PlayerIdentity";
import type { CampaignBotInfo, CampaignClear, CampaignMissionInfo, CampaignModels, LobbyCampaignInfo } from "./types";

/** The models a campaign may force; the ones every client ships. */
const CAMPAIGN_MODELS = ["police", "female", "cartel", "riotkitty", "robot"] as const;
const CAMPAIGN_GAMETYPES = ["duel", "amphi", "ffa", "snd"] as const;
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

function parseModels(value: unknown, where: string): CampaignModels {
  const models = value as Partial<CampaignModels> | null;
  if (!models || typeof models !== "object") fail(`${where}: models must be an object`);
  for (const side of ["ally", "enemy"] as const) {
    if (!CAMPAIGN_MODELS.includes(models[side] as (typeof CAMPAIGN_MODELS)[number]))
      fail(`${where}: models.${side} must be one of ${CAMPAIGN_MODELS.join(", ")}`);
  }
  return { ally: models.ally as string, enemy: models.enemy as string };
}

function parseBot(value: unknown, where: string, hasTeams: boolean): CampaignBotInfo {
  const bot = value as Partial<CampaignBotInfo> | null;
  if (!bot || typeof bot !== "object") fail(`${where} must be an object`);
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
  return { name: bot.name, difficulty: bot.difficulty as string, side, ...(bot.model ? { model: bot.model } : {}) };
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
  if (!Array.isArray(file.missions)) fail("missions must be an array");
  const length = file.length ?? file.missions.length;
  if (!Number.isInteger(length) || (length as number) < file.missions.length || (length as number) > 64)
    fail("length must be a whole number of missions, at least as many as are written");
  const ids = new Set<string>();
  const missions = file.missions.map((value, index): CampaignMissionInfo => {
    const where = `missions[${index}]`;
    const mission = value as Record<string, unknown> | null;
    if (!mission || typeof mission !== "object") fail(`${where} must be an object`);
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
    return {
      id,
      number: index + 1,
      map: mission.map,
      mapTitle: mapTitle(mission.map),
      gametype,
      bots,
      models: parseModels(mission.models, where),
      ...(mission.side === "attack" ? { side: "attack" as const } : {}),
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
  return {
    missionId: mission.id,
    models: mission.models,
    ...(Object.keys(botModels).length ? { botModels } : {}),
  };
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
