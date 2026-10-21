import { Profanity } from "@2toad/profanity";

/** Where the filter found a word; each becomes a fun word on the way out. */
const MASK = "\u{E000}";

// Server-only: reuse the compiled dictionary across lobby, room and match chat.
// The general dictionary uses Unicode boundaries to avoid substring false positives.
const filter = new Profanity({
  languages: ["en"],
  wholeWord: true,
  unicodeWordBoundaries: true,
  grawlix: MASK,
});

// Match only these strong terms inside larger strings. Broad dictionary substring
// matching also masks ordinary words such as "assassin" and "classic".
// Consume the known place-name exception first, without exempting nearby text.
const strongSubstrings = /scunthorpe|fuck|shit|cunt|nigger|faggot/gi;

/** What a filtered word becomes: Japanese noodles, fruits and silly animals. */
export const FUN_WORDS: readonly string[] = [
  "udon",
  "soba",
  "ramen",
  "somen",
  "yakisoba",
  "kishimen",
  "champon",
  "harusame",
  "hiyamugi",
  "banana",
  "mango",
  "kiwi",
  "papaya",
  "lychee",
  "yuzu",
  "durian",
  "kumquat",
  "pomelo",
  "persimmon",
  "duck",
  "wombat",
  "axolotl",
  "capybara",
  "platypus",
  "narwhal",
  "quokka",
  "aardvark",
  "blobfish",
  "alpaca",
  "sloth",
  "puffin",
  "tapir",
  "llama",
];

/** Front halves of a filtered name: Soggy_Ramen. At most 6 letters, so names stay within 16. */
const NAME_ADJECTIVES: readonly string[] = [
  "Wobbly",
  "Sleepy",
  "Soggy",
  "Fluffy",
  "Grumpy",
  "Spicy",
  "Sneaky",
  "Bouncy",
  "Crispy",
  "Sticky",
  "Silly",
  "Chonky",
];

const randomFunWord = () => FUN_WORDS[Math.floor(Math.random() * FUN_WORDS.length)];

/**
 * Filter a normalized chat body, keeping the caller's existing character
 * limit: each word the filter catches becomes a fun word ("What the duck").
 * `replace` picks it; tests pass a fixed one.
 */
export function filterChatText(text: string, maxLength: number, replace: () => string = randomFunWord): string {
  return filter
    .censor(text.slice(0, maxLength))
    .replace(strongSubstrings, (match) => (match.toLowerCase() === "scunthorpe" ? match : MASK))
    .replace(/\u{E000}/gu, () => replace())
    .slice(0, maxLength);
}

/** A name the chat filter would catch; `_` and `-` count as spaces, so Bad_Word is caught. */
export function isOffensiveName(name: string): boolean {
  const words = name.replace(/[_-]+/g, " ");
  return filterChatText(words, words.length, () => MASK) !== words;
}

/**
 * A player name as others see it. One the chat filter would catch becomes a
 * silly name of its own, Soggy_Ramen: the same name always gets the same one,
 * so a player keeps it for the whole match.
 */
export function filterPlayerName(name: string): string {
  if (!isOffensiveName(name)) return name;
  let hash = 2166136261;
  for (const char of name.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const adjective = NAME_ADJECTIVES[hash % NAME_ADJECTIVES.length];
  const noun = FUN_WORDS[Math.floor(hash / NAME_ADJECTIVES.length) % FUN_WORDS.length];
  return `${adjective}_${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
}
