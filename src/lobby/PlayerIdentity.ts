/**
 * PlayerIdentity — the rules for player keys and names, shared by the lobby
 * server and the browser so both read a pasted key and judge a name the same way.
 *
 * A key is 120 random bits written as 24 characters of Crockford base32. The
 * canonical form is what the server hashes; formatKey() is how players see it.
 * See docs/research/PLAYER_IDENTITY.md.
 */

import { isBotName } from "../shared/bot/BotNames";

/** Crockford base32: no I, L, O or U, so a key survives being read aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const KEY_BYTES = 15;
export const KEY_LENGTH = 24;
const KEY_PREFIX = "WASHOI";
const CANONICAL_KEY = /^[0-9A-HJKMNP-TV-Z]{24}$/;

/** Encode KEY_BYTES random bytes as a canonical key. */
export function encodeKey(bytes: Uint8Array): string {
  if (bytes.length !== KEY_BYTES) throw new Error(`A player key is ${KEY_BYTES} bytes, got ${bytes.length}`);
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/**
 * The canonical key in whatever a player pasted, or null if it can't be one.
 * Ignores case, spaces and dashes and a leading WASHOI, and reads O as 0 and
 * I or L as 1.
 */
export function normalizeKey(input: string): string | null {
  let key = input.toUpperCase().replace(/[\s-]/g, "");
  if (key.length === KEY_PREFIX.length + KEY_LENGTH && key.startsWith(KEY_PREFIX)) key = key.slice(KEY_PREFIX.length);
  key = key.replace(/O/g, "0").replace(/[IL]/g, "1");
  return CANONICAL_KEY.test(key) ? key : null;
}

/**
 * The key characters in partly typed or pasted text, canonical and at most
 * KEY_LENGTH long: for showing a player how much of a key they have so far.
 */
export function keyCharacters(input: string): string {
  let text = input.toUpperCase().replace(/[\s-]/g, "");
  if (text.startsWith(KEY_PREFIX)) text = text.slice(KEY_PREFIX.length);
  return text
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "")
    .slice(0, KEY_LENGTH);
}

/** A key the way players see it: WASHOI-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. */
export function formatKey(key: string): string {
  const canonical = normalizeKey(key) ?? key;
  return [KEY_PREFIX, ...(canonical.match(/.{1,4}/g) ?? [])].join("-");
}

/** What a deleted account is called everywhere. NAME_PATTERN keeps anyone from picking it. */
export const DELETED_ACCOUNT_NAME = "[deleted account]";

/** 2 to 16 letters, digits, underscores or dashes. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;
/** New accounts are named Player_<number>; nobody can pick such a name. */
const DEFAULT_NAME = /^player_\d+$/i;

export type NameProblem = "name_invalid" | "name_reserved";

/** Why a player can't take `name`, or null if they can (unless someone already has it). */
export function checkPlayerName(name: string): NameProblem | null {
  if (!NAME_PATTERN.test(name)) return "name_invalid";
  if (DEFAULT_NAME.test(name) || isBotName(name)) return "name_reserved";
  return null;
}
