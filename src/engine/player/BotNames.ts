/**
 * BotNames — Fun themed bot names for arena matches
 *
 * Names riff on the project's DNA: Washiki/Washoi culture, Warsow/arena-shooter
 * nostalgia, SHAG engine jokes, and Q3 legends.
 */

const BOT_NAMES: string[] = [
  // Washiki / Washoi / Japanese culture
  "Washiki",
  "Washoi",
  "Wasabi",
  "Shogun",
  "Sensei",
  "Ronin",
  "Tanuki",
  "Origami",
  "Katana",
  "Bushido",
  "Kaizen",
  "Daimyo",

  // Warsow / arena-shooter nods
  "Warsow",
  "Viciious",
  "Zeroql",
  "Reflex",
  "Nexuiz",
  "Xonotic",
  "Toaster",
  "Defrag",

  // SHAG engine inside jokes
  "Sativa",
  "Hallucin",
  "Geomancer",
  "Noclip",
  "Fraglord",
  "Respawn",
  "Telefrag",
  "Giblet",
  "Strafe",
  "Bunnyhopr",
  "Rocketjmp",
  "Railgun",

  // Quake 3 nostalgia
  "Sarge",
  "Keel",
  "Slash",
  "Bones",
  "Anarki",
  "Sorlag",
  "Visor",
  "Xaero",
];

let _nameIndex = 0;

/**
 * Get the next bot name, cycling through the list.
 * Avoids names already in `usedNames`.
 */
export function getNextBotName(usedNames?: Set<string>): string {
  const startIndex = _nameIndex;

  // Try to find an unused name
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const idx = (_nameIndex + i) % BOT_NAMES.length;
    const name = BOT_NAMES[idx];
    if (!usedNames || !usedNames.has(name)) {
      _nameIndex = (idx + 1) % BOT_NAMES.length;
      return name;
    }
  }

  // All names used — fall back with numeric suffix
  _nameIndex = (startIndex + 1) % BOT_NAMES.length;
  return `Bot_${Math.floor(Math.random() * 1000)}`;
}

/** Reset the name cycle (e.g., on new match) */
export function resetBotNames(): void {
  _nameIndex = 0;
}

/** Get all available bot names */
export function getAllBotNames(): readonly string[] {
  return BOT_NAMES;
}
