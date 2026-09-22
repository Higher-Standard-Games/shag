/**
 * Names the bot server gives its bots. The lobby reserves them, so a bot and a
 * player never share a name in a room, a scoreboard or a demo.
 *
 * When the list runs out the bot server adds `_2`, `_3`, … to reuse it
 * (see getNextBotName in BotConfig.ts); those forms are reserved too.
 */

export const BOT_NAMES: readonly string[] = [
  "Wraith",
  "Phantom",
  "Specter",
  "Requiem",
  "Cipher",
  "Havoc",
  "Vortex",
  "Blitz",
  "Nova",
  "Eclipse",
  "Reaper",
  "Shadow",
  "Storm",
  "Fury",
  "Titan",
  "Ghost",
  "Raven",
  "Nemesis",
  "Valkyrie",
  "Phoenix",
  "Sentinel",
  "Apex",
  "Onyx",
  "Pulse",
  "Cobalt",
  "Chrome",
  "Haze",
  "Lynx",
  "Vertex",
  "Zero",
];

const RESERVED = new Set(BOT_NAMES.map((name) => name.toLowerCase()));

/** Whether `name` is a bot name, in any capitals, with or without a `_<digits>` suffix. */
export function isBotName(name: string): boolean {
  return RESERVED.has(name.toLowerCase().replace(/_\d+$/, ""));
}
