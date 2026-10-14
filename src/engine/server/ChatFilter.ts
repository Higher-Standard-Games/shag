import { Profanity } from "@2toad/profanity";

// Server-only: reuse the compiled dictionary across lobby, room and match chat.
// The general dictionary uses Unicode boundaries to avoid substring false positives.
const filter = new Profanity({
  languages: ["en"],
  wholeWord: true,
  unicodeWordBoundaries: true,
  grawlix: "***",
});

// Match only these strong terms inside larger strings. Broad dictionary substring
// matching also masks ordinary words such as "assassin" and "classic".
// Consume the known place-name exception first, without exempting nearby text.
const strongSubstrings = /scunthorpe|fuck|shit|cunt|nigger|faggot/gi;

/** Mask a normalized chat body, keeping the caller's existing character limit. */
export function filterChatText(text: string, maxLength: number): string {
  const censored = filter.censor(text.slice(0, maxLength));
  return censored
    .replace(strongSubstrings, (match) => (match.toLowerCase() === "scunthorpe" ? match : "***"))
    .slice(0, maxLength);
}
